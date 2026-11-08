import { useEffect, useMemo, useRef, useState } from 'react'
import {
  Box, Typography, Button, TextField, Alert, ToggleButton, ToggleButtonGroup, Checkbox, FormControlLabel,
  Autocomplete, IconButton, Link, MenuItem, Collapse, ButtonBase, Dialog, DialogTitle, DialogContent, DialogActions,
  Tooltip, useMediaQuery,
} from '@mui/material'
import { useTheme } from '@mui/material/styles'
import AddIcon from '@mui/icons-material/Add'
import CloseIcon from '@mui/icons-material/Close'
import CheckIcon from '@mui/icons-material/Check'
import AttachIcon from '@mui/icons-material/AttachFileOutlined'
import OpenInNewIcon from '@mui/icons-material/OpenInNew'
import ExpandMoreIcon from '@mui/icons-material/ExpandMore'
import EventIcon from '@mui/icons-material/EventOutlined'
import TaskIcon from '@mui/icons-material/TaskAltOutlined'
import * as api from '../lib/api.js'
import { addWeeks, weekNo } from '../lib/weekly.js'
import AiAssist from './AiAssist.jsx'
import { Spinner } from './Loading.jsx'
import { ago } from './FollowUp.jsx'
import { EmptyState, ErrorState, Section, StatusPill } from './ui.jsx'
import { mentionsHold, isHoldStatus } from '../lib/hold.js'
import {
  needsUpdate, failedPost, partialPost, postedSummary, updateProblems, readDraft, writeDraft, clearDraft, baseFields, differs, unsentDrafts,
  firstLine, statusOf, PROBLEM_ORDER,
} from '../lib/taskUpdate.js'
import { focusRingSx } from './focus.js'

/**
 * A MEMBER'S WEEK, FROM JIRA.
 *
 * Their Jira tasks for the week — the ones assigned to them whose dates cover
 * it — under their projects. A task still to update is an open card with its
 * own update and its own Submit; one already posted folds to a single row
 * (its status, the first line of what was said, when) with Edit to open it
 * again. Submitting posts the update to the task in Jira: a comment, any
 * pictures, and Done or Hold when picked.
 *
 * A week ahead is for planning: the cards there carry their dates, which are
 * written to Jira, and a task or a project can be added.
 */

const fmt = (d) => (d ? new Date(`${d}T00:00:00Z`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' }) : 'no date')
const MAX_IMAGES = 3
const MAX_BYTES = 4 * 1024 * 1024
// Bigger than this, a picture is scaled down before it is sent: a phone photo
// or a 4K screenshot would otherwise be refused, and nobody needs every pixel.
const SHRINK_OVER = 1.5 * 1024 * 1024
const MAX_SIDE = 2000

const readAsDataUrl = (blob) => new Promise((resolve, reject) => {
  const rd = new FileReader()
  rd.onload = () => resolve(rd.result)
  rd.onerror = () => reject(rd.error)
  rd.readAsDataURL(blob)
})

/** A picture as a data: URL, scaled down when it is big. */
async function imageData(file) {
  const data = await readAsDataUrl(file)
  if (file.size <= SHRINK_OVER || file.type === 'image/gif') return data
  const img = await new Promise((resolve, reject) => {
    const i = new Image()
    i.onload = () => resolve(i)
    i.onerror = reject
    i.src = data
  })
  const k = Math.min(1, MAX_SIDE / Math.max(img.width, img.height))
  const canvas = document.createElement('canvas')
  canvas.width = Math.round(img.width * k)
  canvas.height = Math.round(img.height * k)
  canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height)
  return canvas.toDataURL('image/jpeg', 0.85)
}

/** The image files in a paste or a drop, if any. */
const imageFiles = (dt) => [...(dt?.items || [])]
  .filter((it) => it.kind === 'file' && it.type.startsWith('image/'))
  .map((it) => it.getAsFile())
  .filter(Boolean)

/** The Monday and Friday of a week, as dates for a new task. */
const workdays = (week) => {
  const fri = new Date(`${week}T00:00:00Z`)
  fri.setUTCDate(fri.getUTCDate() + 4)
  return { start: week, due: fri.toISOString().slice(0, 10) }
}

/*
 * Jira's status words in sentence case, as the rest of the page writes:
 * "In Progress" reads "In progress". A word Jira writes in capitals (UAT,
 * POC) stays as it is.
 */
export const sentence = (s) => String(s || '').split(' ')
  .map((w, i) => (i === 0 || (w.length > 1 && w === w.toUpperCase()) ? w : w.toLowerCase()))
  .join(' ')

/** The task's dates, or that it has none. */
const span = (task) => {
  const a = task.start || task.sprintStart
  const b = task.due || task.sprintEnd
  if (!a && !b) return 'no dates yet'
  return `${fmt(a)} to ${fmt(b)}`
}

/*
 * A CHOICE GROUP (Finished / Not finished / On hold): outlined buttons side
 * by side, the picked one on the subtle ground with a tick. The tone's colour
 * is on the tick only, never the button.
 */
export const choiceSx = (invalid = false) => (t) => ({
  bgcolor: 'transparent',
  p: 0,
  gap: 0,
  flexWrap: 'wrap',
  borderRadius: '6px',
  ...(invalid && { outline: `1px solid ${t.palette.error.main}`, outlineOffset: 2 }),
  '& .MuiToggleButtonGroup-grouped': {
    minHeight: 36,
    px: 3,
    gap: 1,
    border: `1px solid ${t.palette.border.strong}`,
    borderRadius: 0,
    color: 'text.secondary',
    ...focusRingSx,
    '&:not(:first-of-type)': { ml: '-1px' },
    '&:first-of-type': { borderTopLeftRadius: 6, borderBottomLeftRadius: 6 },
    '&:last-of-type': { borderTopRightRadius: 6, borderBottomRightRadius: 6 },
    '&.Mui-selected, &.Mui-selected:hover': { bgcolor: 'bg.subtle', color: 'text.primary', borderColor: t.palette.border.strong },
  },
})

const CHOICE_TONE = { yes: 'success', no: 'warning', hold: 'neutral' }

/*
 * A project in a picker: its key in a quiet fixed column, then its name —
 * "FNP-379 PL Forecast", with no dot between them.
 */
export const projectLabel = (p, keyOf = (x) => x.key) => `${keyOf(p)} ${p.summary}`
export const renderProjectOption = (keyOf = (x) => x.key) => function ProjectOption(props, p) {
  const { key, ...rest } = props
  return (
    <li key={key} {...rest}>
      <Box component="span" sx={{ color: 'text.secondary', minWidth: 76, mr: 2, flexShrink: 0 }}>{keyOf(p)}</Box>
      {' '}
      <Box component="span" sx={{ minWidth: 0, overflowWrap: 'anywhere' }}>{p.summary}</Box>
    </li>
  )
}

/* ------------------------------------------------------------ one task */

/** The key (a link to Jira) and the task's name, as one heading. */
function TaskTitle({ task, ownEpic }) {
  return (
    <Typography variant="h3" component="h4" sx={{ overflowWrap: 'anywhere' }}>
      <Link
        href={task.url}
        target="_blank"
        rel="noopener"
        underline="hover"
        aria-label={`${task.key} in Jira, opens in a new tab`}
        sx={{
          display: 'inline-flex', alignItems: 'center', gap: 0.5, mr: 1.5, fontWeight: 600, color: 'primary.text', verticalAlign: 'baseline', ...focusRingSx,
        }}
      >
        {task.key}
        <OpenInNewIcon sx={{ fontSize: 13 }} />
      </Link>
      {ownEpic
        ? <Box component="span" sx={{ color: 'text.secondary' }} data-own-epic>Project epic</Box>
        : task.summary}
    </Typography>
  )
}

function TaskCard({
  task, week, person, planning, canWrite, writable, aiOn, highlight, onSaved, onPosted, grouped = false,
}) {
  const theme = useTheme()
  const phone = useMediaQuery(theme.breakpoints.down('sm'))
  const u = task.update
  const editing = canWrite && !planning
  /*
   * Where the fields start: an unsent draft kept in this browser (typed before
   * a week switch, a page switch or a reload), else the last update.
   */
  const [start] = useState(() => {
    const d = editing ? readDraft(person, week, task.key, u?.submittedAt) : null
    return d ? { ...baseFields(u), ...d, restored: true } : { ...baseFields(u), holdAuto: false, picked: !!u, restored: false }
  })
  const [progress, setProgress] = useState(start.progress)
  const [done, setDone] = useState(start.done)
  // On hold: picked by hand, or for them when the update says so ("this
  // project is hold"). A hand-picked choice is never overruled.
  const [hold, setHold] = useState(!!start.hold)
  const [holdAuto, setHoldAuto] = useState(!!start.holdAuto)
  const [picked, setPicked] = useState(!!start.picked)
  useEffect(() => {
    if (picked) return
    const says = mentionsHold(progress)
    if (says && !hold) { setHold(true); setDone(false); setHoldAuto(true) }
    if (!says && hold && holdAuto) { setHold(false); setDone(null); setHoldAuto(false) }
  }, [progress, picked, hold, holdAuto])
  const choose = (v) => {
    setPicked(true)
    setHoldAuto(false)
    setHold(v === 'hold')
    setDone(v === 'yes')
  }
  const [reason, setReason] = useState(start.reason)
  const [blocker, setBlocker] = useState(start.blocker)
  const [decision, setDecision] = useState(!!start.decision)
  const [decisionText, setDecisionText] = useState(start.decisionText)
  const [images, setImages] = useState([])
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState(null)
  const [serverProblems, setServerProblems] = useState([])
  const [tried, setTried] = useState(false)
  const [dates, setDates] = useState({ start: task.start || '', due: task.due || '' })

  // The unsent draft, kept as it is typed; gone once it says what the last update says.
  const fields = {
    progress, done, hold, holdAuto, picked, reason, blocker, decision, decisionText,
  }
  const dirty = editing && differs(fields, u)
  useEffect(() => {
    if (!editing) return
    if (differs(fields, u)) writeDraft(person, week, task.key, u?.submittedAt, fields)
    else clearDraft(person, week, task.key)
    // fields is rebuilt every render; its members are the dependencies.
  }, [editing, person, week, task.key, u?.submittedAt, progress, done, hold, holdAuto, picked, reason, blocker, decision, decisionText])

  const posted = u?.jira?.state === 'posted'
  const failed = failedPost(u, writable)
  const partial = partialPost(u)
  const heldInJira = !task.done && isHoldStatus(task.status)
  /*
   * Folded to one row: an update already sent (Edit opens it again), or a
   * task this person can only read. A draft left unsent on a sent one opens
   * it, so the draft is in view.
   */
  const [open, setOpen] = useState(() => !u || failed || (start.restored && editing))
  const folded = !planning && (!canWrite || (!!u && !failed && !open))

  // What is missing, shown on the fields once Submit has been pressed, and
  // cleared field by field as each is filled in.
  const problems = updateProblems(fields)
  const shownProblems = tried ? problems : {}
  const missing = Object.keys(problems).length
  const refs = {
    progress: useRef(null), status: useRef(null), reason: useRef(null), decisionText: useRef(null),
  }

  /*
   * PICTURES: pasted anywhere on the card (copy an image or take a screenshot,
   * then Ctrl/Cmd+V), dropped onto it, or picked with "Attach image". Kept
   * beside the text, sent to the Jira issue as attachments on Submit.
   */
  const [dragging, setDragging] = useState(false)
  const [preview, setPreview] = useState(null)
  const fileRef = useRef(null)
  const addImages = async (files) => {
    const list = [...files].filter((f) => f && f.type?.startsWith('image/'))
    if (!list.length) {
      setMsg({ tone: 'error', text: 'Only pictures can be attached: PNG, JPEG, GIF or WebP.' })
      return
    }
    let added = 0
    for (const f of list) {
      if (images.length + added >= MAX_IMAGES) {
        setMsg({ tone: 'error', text: `Up to ${MAX_IMAGES} pictures per update. Remove one to add another.` })
        break
      }
      try {
        const data = await imageData(f)
        if (data.length * 0.75 > MAX_BYTES) {
          setMsg({ tone: 'error', text: 'That picture is over 4 MB even scaled down. Crop it and try again.' })
          continue
        }
        added += 1
        setImages((cur) => (cur.length >= MAX_IMAGES ? cur
          : [...cur, { name: `${task.key}-${new Date().toISOString().slice(0, 10)}-${Date.now().toString(36)}${cur.length + 1}`, data }]))
      } catch {
        setMsg({ tone: 'error', text: 'That picture could not be read. Try a PNG or JPEG.' })
      }
    }
    if (added) setMsg(null)
  }
  const onPaste = (e) => {
    const files = imageFiles(e.clipboardData)
    if (!files.length) return
    e.preventDefault()
    addImages(files)
  }
  const dropProps = editing ? {
    onPaste,
    onDragOver: (e) => {
      if ([...(e.dataTransfer?.types || [])].includes('Files')) { e.preventDefault(); setDragging(true) }
    },
    onDragLeave: (e) => { if (!e.currentTarget.contains(e.relatedTarget)) setDragging(false) },
    onDrop: (e) => {
      if (![...(e.dataTransfer?.types || [])].includes('Files')) return
      e.preventDefault()
      setDragging(false)
      addImages(e.dataTransfer.files)
    },
  } : {}

  // Done in Jira, and now said not to be: posting does not reopen it, and the
  // member is told so before it goes (QA, 2026-11-07).
  const contradictsDone = editing && task.done && done !== null && done !== true

  const post = async (body) => {
    setBusy(true)
    setMsg(null)
    setServerProblems([])
    try {
      const r = await api.submitTaskUpdate(week, task.key, body)
      clearDraft(person, week, task.key)
      setImages([])
      onPosted?.(task, r.update)
      onSaved?.()
    } catch (e) {
      setMsg({ tone: 'error', text: e.message })
      setServerProblems(e.problems || [])
    } finally {
      setBusy(false)
    }
  }
  const submit = () => {
    setTried(true)
    if (missing) {
      // To the first field that needs filling, in the order they are on the card.
      const first = PROBLEM_ORDER.find((k) => problems[k])
      const el = refs[first]?.current
      if (el) {
        el.scrollIntoView({ behavior: 'smooth', block: 'center' })
        setTimeout(() => el.focus({ preventScroll: true }), 250)
      }
      return
    }
    post({
      progress, done, hold, reason, blocker, decision, decisionText, images,
    })
  }
  // The update kept here, sent again as it was: for a post Jira did not take.
  const retry = () => post({ ...baseFields(u) })
  // Edit closed again without sending: the fields go back to what was sent.
  const cancelEdit = () => {
    const b = baseFields(u)
    setProgress(b.progress); setDone(b.done); setHold(b.hold); setHoldAuto(false); setPicked(true)
    setReason(b.reason); setBlocker(b.blocker); setDecision(b.decision); setDecisionText(b.decisionText)
    setImages([]); setTried(false); setMsg(null); setServerProblems([])
    clearDraft(person, week, task.key)
    setOpen(false)
  }

  const saveDates = async () => {
    setBusy(true)
    setMsg(null)
    try {
      await api.planJiraTask(task.key, { start: dates.start || null, due: dates.due || null })
      onPosted?.(task, null, `Dates saved to ${task.key} in Jira: ${fmt(dates.start)} to ${fmt(dates.due)}.`)
      onSaved?.({ dates: true })
    } catch (e) {
      setMsg({ tone: 'error', text: e.message })
    } finally {
      setBusy(false)
    }
  }

  const project = task.project?.summary || task.parent?.summary || 'No project'
  const projectKey = task.project?.key || task.parent?.key || null
  // The project's own epic, inside its own block: the block already names it.
  const ownEpic = grouped && task.epic
  const meta = [
    !grouped && (projectKey ? `${projectKey} ${project}` : project),
    sentence(task.status),
    `${span(task)}${!task.start && !task.due && task.sprintName ? ` (${task.sprintName})` : ''}`,
  ].filter(Boolean).join(', ')
  const st = statusOf(u)
  const datesChanged = dates.start !== (task.start || '') || dates.due !== (task.due || '')
  const fullOnPhone = phone ? { width: '100%', minHeight: 40 } : null

  return (
    <Box
      data-jira-task={task.key}
      data-task-project={task.project?.key || undefined}
      {...dropProps}
      sx={{
        px: { xs: 3, sm: 4 },
        py: folded ? 3 : { xs: 3, sm: 4 },
        display: 'flex',
        flexDirection: 'column',
        gap: 3,
        bgcolor: highlight ? 'primary.tint' : 'transparent',
        transition: 'background-color 180ms ease-out',
        scrollMarginTop: 96,
        ...(dragging && { outline: '2px dashed', outlineColor: 'primary.main', outlineOffset: -4 }),
      }}
    >
      {/* The heading: what the task is, when, and what Jira says of it. */}
      <Box sx={{
        display: 'flex', alignItems: 'flex-start', columnGap: 3, rowGap: 1, flexWrap: { xs: 'wrap', sm: 'nowrap' },
      }}
      >
        <Box sx={{ flex: '1 1 260px', minWidth: 0 }}>
          <TaskTitle task={task} ownEpic={ownEpic} />
          {!folded && (
            <Typography variant="body2" sx={{ color: 'text.secondary', mt: 0.5 }}>{meta}</Typography>
          )}
          {folded && (
            <>
              {u?.progress ? (
                <Typography
                  variant="body2"
                  title={u.progress}
                  sx={{
                    color: 'text.secondary', mt: 0.5, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                  }}
                >
                  {firstLine(u.progress)}
                </Typography>
              ) : (
                <Typography variant="body2" sx={{ color: 'text.secondary', mt: 0.5 }}>{meta}</Typography>
              )}
              {u && (
                <Typography variant="caption" component="div" sx={{ color: 'text.tertiary', mt: 0.5 }}>
                  {posted || !writable ? `Updated ${ago(u.submittedAt)}${posted ? '' : ', kept here only'}` : `Kept here ${ago(u.submittedAt)}, not posted to Jira`}
                </Typography>
              )}
            </>
          )}
        </Box>
        <Box sx={{
          display: 'flex', alignItems: 'center', gap: 2, flexShrink: 0, minHeight: 20, ml: { xs: 0, sm: 'auto' },
        }}
        >
          {folded ? (
            <>
              {st ? <StatusPill tone={st.tone}>{st.label}</StatusPill> : <StatusPill tone="neutral">No update</StatusPill>}
              {heldInJira && st?.label !== 'On hold' && <StatusPill tone="neutral">On hold in Jira</StatusPill>}
              {canWrite && u && (
                <Button
                  variant="text"
                  size="small"
                  onClick={() => setOpen(true)}
                  aria-label={`edit the update on ${task.key}`}
                  sx={{ minWidth: 0, px: 2, my: -1.5 }}
                >
                  Edit
                </Button>
              )}
            </>
          ) : (
            <>
              {task.epic && !ownEpic && <StatusPill tone="neutral" title="A project in Jira with you as PIC">Epic</StatusPill>}
              {task.done && <StatusPill tone="success">Done in Jira</StatusPill>}
              {heldInJira && <StatusPill tone="neutral">On hold in Jira</StatusPill>}
            </>
          )}
        </Box>
      </Box>

      {failed && (
        <ErrorState
          data-post-failed
          title={`Jira did not take this update on ${task.key}. Your text is kept.`}
          body={`${u.jira?.error ? String(u.jira.error).replace(/\.?\s*$/, '.') : u.jira?.state === 'pending' ? 'The post did not finish.' : ''} It counts as not updated until it reaches Jira.`.trim()}
          onRetry={canWrite ? retry : undefined}
          retryLabel={busy ? 'Posting…' : 'Try again'}
        />
      )}
      {!failed && partial.length > 0 && (
        <Typography variant="caption" sx={{ color: 'tone.warning.fg', mt: folded ? -2 : 0 }} data-post-partial>
          Posted as a comment, but {partial.join('; ')}.
        </Typography>
      )}

      {planning && (
        <Box sx={{
          display: 'flex', gap: 2, flexWrap: 'wrap', alignItems: 'center',
        }}
        >
          <TextField size="small" type="date" label="Start" value={dates.start} onChange={(e) => setDates((d) => ({ ...d, start: e.target.value }))} InputLabelProps={{ shrink: true }} disabled={!canWrite} sx={{ width: { xs: 'calc(50% - 4px)', sm: 170 } }} />
          <TextField size="small" type="date" label="Due" value={dates.due} onChange={(e) => setDates((d) => ({ ...d, due: e.target.value }))} InputLabelProps={{ shrink: true }} disabled={!canWrite} sx={{ width: { xs: 'calc(50% - 4px)', sm: 170 } }} />
          {canWrite && datesChanged && (
            <Button
              variant="outlined"
              onClick={saveDates}
              startIcon={busy ? <Spinner size={14} /> : null}
              disabled={busy || !writable}
              sx={{ minHeight: 36, ...fullOnPhone }}
            >
              {busy ? 'Saving…' : 'Save dates'}
            </Button>
          )}
        </Box>
      )}

      {!planning && !folded && (
        <>
          {start.restored && dirty && (
            <Typography variant="caption" sx={{ color: 'text.secondary', mb: -1 }} data-draft-restored>
              Your unsent draft, kept in this browser. It is not posted yet.
            </Typography>
          )}
          <Box>
            <TextField
              label="This week's progress"
              value={progress}
              onChange={(e) => setProgress(e.target.value)}
              disabled={!canWrite}
              multiline
              minRows={3}
              maxRows={12}
              fullWidth
              inputRef={refs.progress}
              error={!!shownProblems.progress}
              inputProps={{ 'aria-describedby': `${task.key}-progress-help` }}
            />
            <Box sx={{ mt: 2 }}>
              <AiAssist
                available={aiOn}
                disabled={!canWrite}
                field="progress"
                text={progress}
                onText={setProgress}
                task={{
                  title: `${task.key} ${task.summary}${task.epic ? ' (project epic)' : ''}`,
                  project: task.epic ? '' : project,
                  dates: `${task.start || task.sprintStart || '?'} to ${task.due || task.sprintEnd || '?'}`,
                  status: hold ? 'On hold' : done === true ? 'Finished' : done === false ? 'Not finished' : '',
                }}
                helper={(
                  <Typography
                    id={`${task.key}-progress-help`}
                    variant="caption"
                    component="div"
                    sx={{ color: shownProblems.progress ? 'tone.danger.fg' : 'text.secondary' }}
                    data-field-error={shownProblems.progress ? 'progress' : undefined}
                  >
                    {shownProblems.progress || 'Links and pictures welcome: paste, drop or attach.'}
                  </Typography>
                )}
              />
            </Box>
          </Box>

          {canWrite && (
            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
              <Box sx={{
                display: 'flex', alignItems: 'center', gap: 2, flexWrap: 'wrap',
              }}
              >
                <Button
                  variant="text"
                  size="small"
                  startIcon={<AttachIcon />}
                  onClick={() => fileRef.current?.click()}
                  disabled={images.length >= MAX_IMAGES}
                  data-attach-image
                  sx={{ ml: -1.5 }}
                >
                  Attach image
                </Button>
                <input
                  ref={fileRef}
                  type="file"
                  accept="image/png,image/jpeg,image/gif,image/webp"
                  multiple
                  hidden
                  aria-label={`attach an image to ${task.key}`}
                  onChange={(e) => { addImages(e.target.files); e.target.value = '' }}
                />
                <Typography variant="caption" sx={{ color: 'text.tertiary' }}>
                  {images.length ? `${images.length} of ${MAX_IMAGES} pictures, sent with the update` : `Up to ${MAX_IMAGES} pictures`}
                </Typography>
              </Box>
              {images.length > 0 && (
                <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap' }} data-attached-images>
                  {images.map((im, i) => (
                    <Box
                      key={im.name}
                      sx={{
                        position: 'relative', border: 1, borderColor: 'border.subtle', borderRadius: '6px', overflow: 'hidden', bgcolor: 'bg.subtle',
                      }}
                    >
                      <Box
                        component="img"
                        src={im.data}
                        alt={`picture ${i + 1}`}
                        onClick={() => setPreview(im.data)}
                        title="See it full size"
                        sx={{
                          display: 'block', height: 72, width: 96, objectFit: 'cover', cursor: 'zoom-in',
                        }}
                      />
                      <Tooltip title="Remove">
                        <IconButton
                          size="small"
                          aria-label={`remove screenshot ${i + 1}`}
                          onClick={() => setImages((l) => l.filter((_x, j) => j !== i))}
                          sx={{
                            position: 'absolute', top: 4, right: 4, width: 22, height: 22, p: 0, bgcolor: 'rgba(15,19,24,.72)', '&:hover': { bgcolor: 'rgba(15,19,24,.9)' },
                          }}
                        >
                          <CloseIcon sx={{ fontSize: 14, color: '#fff' }} />
                        </IconButton>
                      </Tooltip>
                    </Box>
                  ))}
                </Box>
              )}
            </Box>
          )}
          <Dialog open={!!preview} onClose={() => setPreview(null)} maxWidth="lg">
            {preview && <Box component="img" src={preview} alt="picture, full size" onClick={() => setPreview(null)} sx={{ display: 'block', maxWidth: '90vw', maxHeight: '85vh', cursor: 'zoom-out' }} />}
          </Dialog>
          {u?.attachments?.length > 0 && (
            <Typography variant="caption" sx={{ color: 'text.secondary', mt: -1 }}>Already in Jira: {u.attachments.join(', ')}</Typography>
          )}

          {/* Status, on its own labelled row. */}
          <Box sx={{
            display: 'flex', alignItems: 'flex-start', columnGap: 4, rowGap: 1.5, flexDirection: { xs: 'column', sm: 'row' },
          }}
          >
            <Typography variant="subtitle2" component="div" id={`${task.key}-status`} sx={{ color: 'text.secondary', width: { sm: 64 }, flexShrink: 0, pt: { sm: 2.5 } }}>
              Status
            </Typography>
            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1, minWidth: 0 }}>
              <ToggleButtonGroup
                exclusive
                value={hold ? 'hold' : done === null ? null : done ? 'yes' : 'no'}
                onChange={(_e, v) => v && choose(v)}
                disabled={!canWrite}
                aria-label={`finished ${task.key}`}
                aria-labelledby={`${task.key}-status`}
                aria-invalid={!!shownProblems.status || undefined}
                sx={choiceSx(!!shownProblems.status)}
              >
                {[['yes', 'Finished'], ['no', 'Not finished'], ['hold', 'On hold']].map(([v, label], i) => {
                  const on = (hold ? 'hold' : done === null ? null : done ? 'yes' : 'no') === v
                  return (
                    <ToggleButton key={v} value={v} disableFocusRipple ref={i === 0 ? refs.status : undefined}>
                      {on && <CheckIcon sx={{ fontSize: 16, color: `tone.${CHOICE_TONE[v]}.fg` }} />}
                      {label}
                    </ToggleButton>
                  )
                })}
              </ToggleButtonGroup>
              {shownProblems.status && <Typography variant="caption" sx={{ color: 'tone.danger.fg' }} data-field-error="status">{shownProblems.status}</Typography>}
              {hold && canWrite && (
                <Typography variant="caption" sx={{ color: 'text.secondary' }} data-hold-note>
                  {holdAuto ? 'Your update says it is on hold, so On hold is picked. Pick another if it is not. ' : ''}
                  {heldInJira ? 'It is already on hold in Jira.' : `Submit moves ${task.key} to its Hold status in Jira.`}
                </Typography>
              )}
            </Box>
          </Box>
          {done === false && (
            <TextField
              size="small"
              label={hold ? 'Why is it on hold? (optional)' : "Why isn't it finished?"}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              disabled={!canWrite}
              multiline
              maxRows={4}
              fullWidth
              inputRef={refs.reason}
              error={!!shownProblems.reason}
              helperText={shownProblems.reason}
            />
          )}

          {/* What is in the way, and whether somebody has to decide something. */}
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
            <TextField size="small" label="Blocker (optional)" value={blocker} onChange={(e) => setBlocker(e.target.value)} disabled={!canWrite} multiline maxRows={4} fullWidth />
            <FormControlLabel
              sx={{ alignSelf: 'flex-start', mr: 0, ml: -1.5 }}
              control={<Checkbox size="small" checked={decision} onChange={(e) => setDecision(e.target.checked)} disabled={!canWrite} />}
              label={<Typography variant="body1">Decision needed</Typography>}
            />
            {decision && (
              <TextField
                size="small"
                label="What decision is needed, and from whom?"
                value={decisionText}
                onChange={(e) => setDecisionText(e.target.value)}
                disabled={!canWrite}
                multiline
                maxRows={4}
                fullWidth
                inputRef={refs.decisionText}
                error={!!shownProblems.decisionText}
                helperText={shownProblems.decisionText}
              />
            )}
          </Box>
          {contradictsDone && (
            <Alert severity="warning" variant="outlined" data-done-warning>
              {task.key} is Done in Jira. This update won&rsquo;t reopen it; if the work is not finished, reopen it in Jira as well.
            </Alert>
          )}
          {serverProblems.length > 0 && (
            <Alert severity="warning" variant="outlined">
              <Box component="ul" sx={{ m: 0, pl: 4 }}>{serverProblems.map((p) => <li key={p}>{p}</li>)}</Box>
            </Alert>
          )}
          {msg && !serverProblems.length && (
            <Alert severity={msg.tone} variant="outlined" onClose={() => setMsg(null)}>{msg.text}</Alert>
          )}
          {canWrite && (
            <Box sx={{
              display: 'flex', alignItems: 'center', columnGap: 3, rowGap: 2, flexWrap: 'wrap',
            }}
            >
              <Button
                variant="contained"
                onClick={submit}
                disabled={busy}
                startIcon={busy ? <Spinner size={14} /> : null}
                aria-label={`submit ${task.key}`}
                sx={{ ...focusRingSx, ...fullOnPhone }}
              >
                {busy ? 'Posting…' : contradictsDone ? 'Post anyway' : u ? 'Submit again' : 'Submit update'}
              </Button>
              {u && !failed && (
                <Button variant="text" onClick={cancelEdit} disabled={busy} sx={fullOnPhone}>Cancel</Button>
              )}
              {tried && missing ? (
                <Typography variant="caption" role="alert" sx={{ color: 'tone.danger.fg' }} data-submit-problem>
                  {missing === 1 ? 'Fill in the marked field.' : `Fill in the ${missing} marked fields.`}
                </Typography>
              ) : (
                <Typography variant="caption" sx={{ color: 'text.secondary' }}>
                  {writable
                    ? `Posts to ${task.key} in Jira${done && !task.done ? ' and moves it to Done' : hold && !heldInJira ? ' and puts it on hold' : ''}.`
                    : 'Kept here only: writing to Jira is switched off on the server.'}
                </Typography>
              )}
            </Box>
          )}
        </>
      )}
      {planning && msg && (
        <Alert severity={msg.tone} variant="outlined" onClose={() => setMsg(null)}>{msg.text}</Alert>
      )}
    </Box>
  )
}

/* ------------------------------------------------------- the dialogs */

function FormDialog({
  open, onClose, title, label, intro, children, actions, busy,
}) {
  const theme = useTheme()
  const phone = useMediaQuery(theme.breakpoints.down('sm'))
  return (
    <Dialog
      open={open}
      onClose={busy ? undefined : onClose}
      maxWidth="sm"
      fullWidth
      fullScreen={phone}
      PaperProps={{ 'aria-label': label, component: 'section' }}
    >
      <DialogTitle sx={{
        display: 'flex', alignItems: 'center', gap: 2, pr: 3,
      }}
      >
        <Box component="span" sx={{ flex: 1 }}>{title}</Box>
        <IconButton aria-label="close" onClick={onClose} disabled={busy} size="small"><CloseIcon fontSize="small" /></IconButton>
      </DialogTitle>
      <DialogContent>
        {/*
         * What the dialog does, in one line, then 20px of clear space to the
         * first field's floating label. Fields are 16px apart: an outlined
         * field's label sits on its top edge, so 12px would leave it touching
         * the field above.
         */}
        {intro && (
          <Typography variant="body2" data-dialog-intro sx={{ color: 'text.secondary', maxWidth: '72ch', mb: 7 }}>
            {intro}
          </Typography>
        )}
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 4, pt: intro ? 0 : 1 }}>{children}</Box>
      </DialogContent>
      <DialogActions sx={phone ? { position: 'sticky', bottom: 0, bgcolor: 'bg.raised', borderTop: 1, borderColor: 'border.subtle' } : undefined}>
        {actions}
      </DialogActions>
    </Dialog>
  )
}

const dateRow = (dates, setDates) => (
  <Box sx={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 3 }}>
    <TextField size="small" type="date" label="Start" value={dates.start} onChange={(e) => setDates((d) => ({ ...d, start: e.target.value }))} InputLabelProps={{ shrink: true }} />
    <TextField size="small" type="date" label="Due" value={dates.due} onChange={(e) => setDates((d) => ({ ...d, due: e.target.value }))} InputLabelProps={{ shrink: true }} />
  </Box>
)

function NewTask({
  open, week, projects, preset, onDone, onCancel, writable,
}) {
  const [project, setProject] = useState(() => projects.find((p) => p.key === preset) || null)
  const [summary, setSummary] = useState('')
  const [dates, setDates] = useState(() => workdays(week))
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  useEffect(() => { if (preset) setProject(projects.find((p) => p.key === preset) || null) }, [preset, projects])
  useEffect(() => { if (open) { setError(null); setDates(workdays(week)) } }, [open, week])
  const ready = writable && !!project && summary.trim().length >= 3
  const create = async () => {
    setBusy(true)
    setError(null)
    try {
      const r = await api.newJiraTask({ projectKey: project?.key, summary, ...dates })
      setSummary('')
      onDone(r.task)
    } catch (e) {
      setError(e.message)
    } finally {
      setBusy(false)
    }
  }
  return (
    <FormDialog
      open={open}
      onClose={onCancel}
      title="Add a task in Jira"
      label="new Jira task"
      busy={busy}
      actions={(
        <>
          <Button onClick={onCancel} disabled={busy}>Cancel</Button>
          <Button variant="contained" onClick={create} startIcon={busy ? <Spinner size={14} /> : null} disabled={busy || !ready}>
            {busy ? 'Adding…' : 'Add task'}
          </Button>
        </>
      )}
    >
      <Autocomplete
        size="small"
        options={projects}
        groupBy={(p) => (p.mine === 'pic' ? 'Your projects (you are PIC)' : p.mine === 'helping' ? 'Projects you help on' : 'Other projects')}
        openOnFocus
        autoHighlight
        value={project}
        onChange={(_e, v) => setProject(v)}
        getOptionLabel={(p) => projectLabel(p, (x) => x.jiraKey || x.key)}
        renderOption={renderProjectOption((x) => x.jiraKey || x.key)}
        isOptionEqualToValue={(a, b) => a.key === b.key}
        renderInput={(params) => <TextField {...params} label="Project" />}
      />
      <TextField size="small" label="Task" value={summary} onChange={(e) => setSummary(e.target.value)} fullWidth />
      {dateRow(dates, setDates)}
      <Typography variant="caption" sx={{ color: 'text.secondary', mt: -2 }}>
        {writable
          ? `Created under ${project?.jiraKey || 'the project’s epic'} and assigned to you.`
          : 'Writing to Jira is switched off on the server, so tasks cannot be created here.'}
      </Typography>
      {error && <ErrorState title="Jira did not create the task." body={`${error} Your text is kept; try again.`} />}
    </FormDialog>
  )
}

function NewProject({
  open, week, onDone, onCancel, writable,
}) {
  const [summary, setSummary] = useState('')
  const [kind, setKind] = useState('adhoc')
  const [dates, setDates] = useState(() => workdays(week))
  const [description, setDescription] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  useEffect(() => { if (open) setError(null) }, [open])
  const create = async () => {
    setBusy(true)
    setError(null)
    try {
      const r = await api.newJiraProject({
        summary, kind, description, ...dates,
      })
      setSummary('')
      setDescription('')
      onDone(r)
    } catch (e) {
      setError(e.message)
    } finally {
      setBusy(false)
    }
  }
  return (
    <FormDialog
      open={open}
      onClose={onCancel}
      title="New project"
      label="new project"
      intro="Created as an epic in Jira, assigned to you, and added to the register with you as PIC."
      busy={busy}
      actions={(
        <>
          <Button onClick={onCancel} disabled={busy}>Cancel</Button>
          <Button variant="contained" onClick={create} startIcon={busy ? <Spinner size={14} /> : null} disabled={busy || !writable || summary.trim().length < 3}>
            {busy ? 'Creating…' : 'Create project in Jira'}
          </Button>
        </>
      )}
    >
      <TextField size="small" select label="Type" value={kind} onChange={(e) => setKind(e.target.value)}>
        <MenuItem value="adhoc">Adhoc work</MenuItem>
        <MenuItem value="cr">Change request</MenuItem>
      </TextField>
      <TextField size="small" label="Project name" value={summary} onChange={(e) => setSummary(e.target.value)} fullWidth />
      <TextField size="small" label="Description (optional)" value={description} onChange={(e) => setDescription(e.target.value)} multiline minRows={2} maxRows={6} fullWidth />
      {dateRow(dates, setDates)}
      {error && <ErrorState title="Jira did not create the project." body={`${error} Your text is kept; try again.`} />}
    </FormDialog>
  )
}

/* ------------------------------------------------- one project's tasks */

/**
 * A PROJECT BLOCK: the project's name on a subtle header, its tasks under it
 * as rows. The header says how many still need an update and folds the block
 * away. What was just posted from it is confirmed inside it, so the card that
 * left for "Already updated" does not vanish without a word.
 */
function ProjectGroup({
  name, projectKey, rows, planning, writable, canWrite = true, flashes = [], onDismiss, children,
}) {
  const left = rows.filter(({ t }) => needsUpdate(t, writable)).length
  const [open, setOpen] = useState(true)
  const count = planning
    ? (rows.length ? `${rows.length} task${rows.length === 1 ? '' : 's'}` : '')
    : left ? (canWrite ? `${left} to update` : `${left} not updated`) : 'All updated'
  return (
    <Box
      component="section"
      data-project-group={projectKey || 'none'}
      aria-label={`project ${name}`}
      sx={{
        border: 1, borderColor: 'border.subtle', borderRadius: '8px', overflow: 'hidden', bgcolor: 'bg.surface',
      }}
    >
      <ButtonBase
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        sx={(t) => ({
          width: '100%',
          justifyContent: 'flex-start',
          alignItems: 'center',
          textAlign: 'left',
          gap: 3,
          px: { xs: 3, sm: 4 },
          py: 2.5,
          minHeight: 48,
          bgcolor: 'bg.subtle',
          borderBottom: open ? 1 : 0,
          borderColor: 'border.subtle',
          transition: 'background-color 120ms',
          '&:hover': { bgcolor: t.palette.mode === 'dark' ? '#1D242E' : '#EAEDF1' },
          '&.Mui-focusVisible': { outline: '2px solid', outlineColor: 'primary.main', outlineOffset: -2 },
        })}
      >
        <Box sx={{
          flex: 1, minWidth: 0, display: 'flex', alignItems: 'baseline', columnGap: 2, rowGap: 0.25, flexWrap: 'wrap',
        }}
        >
          <Typography variant="h3" component="h3" sx={{ overflowWrap: 'anywhere' }}>{name}</Typography>
          {projectKey && <Typography variant="body2" sx={{ color: 'text.secondary', whiteSpace: 'nowrap' }}>{projectKey}</Typography>}
        </Box>
        {count && (
          <Typography variant="body2" sx={{ color: 'text.secondary', whiteSpace: 'nowrap', display: 'flex', alignItems: 'center', gap: 1 }}>
            {!planning && !left && <CheckIcon sx={{ fontSize: 16, color: 'tone.success.fg' }} />}
            {count}
          </Typography>
        )}
        <ExpandMoreIcon sx={{
          color: 'text.secondary', fontSize: 20, transition: 'transform 180ms ease-out', transform: open ? 'rotate(180deg)' : 'none', flexShrink: 0,
        }}
        />
      </ButtonBase>
      <Collapse in={open} unmountOnExit={false}>
        <Box
          data-project-body
          sx={{ display: 'flex', flexDirection: 'column', '& > * + *': { borderTop: 1, borderColor: 'border.subtle' } }}
        >
          {flashes.map((f) => (
            <Box key={f.id} sx={{ px: { xs: 3, sm: 4 }, py: 2.5 }}>
              <Alert
                severity={f.tone}
                variant="outlined"
                icon={f.tone === 'success' ? <CheckIcon fontSize="inherit" /> : undefined}
                onClose={() => onDismiss(f.id)}
                role={f.tone === 'success' || f.tone === 'info' ? 'status' : 'alert'}
                data-posted={f.key}
              >
                {f.text}
              </Alert>
            </Box>
          ))}
          {children}
        </Box>
      </Collapse>
    </Box>
  )
}

/* ------------------------------------------------------------ the week */

const groupKeyOf = (t) => t.project?.key || t.parent?.key || (t.epic ? t.key : '')
const groupNameOf = (t) => t.project?.summary || t.parent?.summary || 'No project'
// How long a confirmation stays when all went well; a warning stays until dismissed.
const FLASH_MS = 9000

/** Thursday or later in Bangkok: when next week's plan is worth a reminder. */
const lateInWeek = (now = Date.now()) => {
  const d = new Date(now + 7 * 3600_000).getUTCDay()
  return d === 0 || d >= 4
}

export default function JiraWeek({
  week, current, person, canWrite, jw, onReload, projects, preset, onPresetUsed, focusKey, aiOn, planIn, planInAt, onGoWeek,
  onProjectAdded, onDatesSaved, addSignal = 0,
}) {
  const theme = useTheme()
  const phone = useMediaQuery(theme.breakpoints.down('sm'))
  // Somebody who can only read the week reads all of it.
  const [filter, setFilter] = useState(canWrite ? 'todo' : 'all')
  const [adding, setAdding] = useState(false)
  const [addingProject, setAddingProject] = useState(false)
  const [note, setNote] = useState(null)
  useEffect(() => { if (preset) { setAdding(true) } }, [preset])
  // "Add a task" in the Next step bar: open the new-task dialog.
  useEffect(() => { if (addSignal) setAdding(true) }, [addSignal])

  const planning = week > current
  const isCurrent = week === current
  const writable = !!jw.writable
  const rows = useMemo(() => [
    ...(jw.overdue || []).map((t) => ({ t })),
    ...(jw.tasks || []).map((t) => ({ t })),
  ], [jw])
  // A failed post is not an update: it stays to do, with Try again on its card.
  const todo = rows.filter((r) => needsUpdate(r.t, writable))
  const doneRows = rows.filter((r) => !needsUpdate(r.t, writable))
  const shown = planning ? rows : filter === 'todo' ? todo : filter === 'done' ? doneRows : rows

  /*
   * NEXT WEEK'S PLAN, on this week: a one-line reminder from Thursday, until
   * it is set. Whether it is set is asked once.
   */
  const [nextPlanned, setNextPlanned] = useState(null)
  useEffect(() => {
    if (!isCurrent || !canWrite) return undefined
    let stop = false
    api.loadWeek(addWeeks(week, 1))
      .then((r) => { if (!stop) setNextPlanned(!!r?.mine?.planSubmittedAt) })
      .catch(() => { if (!stop) setNextPlanned(false) })
    return () => { stop = true }
  }, [isCurrent, canWrite, week])
  const remind = canWrite && isCurrent && nextPlanned === false && lateInWeek()

  /*
   * WHAT WAS JUST POSTED, confirmed in its project's block for a few seconds —
   * a warning (part of it did not reach Jira) until it is dismissed.
   */
  const [flashes, setFlashes] = useState([])
  const timers = useRef([])
  useEffect(() => () => timers.current.forEach(clearTimeout), [])
  const dismiss = (id) => setFlashes((l) => l.filter((f) => f.id !== id))
  const onPosted = (task, update, text) => {
    const j = update?.jira
    const partial = partialPost(update)
    let flash
    if (text) flash = { tone: 'success', text }
    else if (j?.state === 'posted') {
      flash = partial.length
        ? { tone: 'warning', text: `${postedSummary(task.key, j)}, but ${partial.join('; ')}.` }
        : { tone: 'success', text: `${postedSummary(task.key, j)}.` }
    } else if (!writable) flash = { tone: 'info', text: `Update on ${task.key} kept here. Writing to Jira is switched off on the server.` }
    else flash = { tone: 'warning', text: `Kept here, but not posted to ${task.key} in Jira: ${j?.error || 'Jira did not answer'}. It stays under Not updated yet; press Try again on its card.` }
    const id = `${task.key}:${Date.now()}`
    setFlashes((l) => [...l.filter((f) => f.key !== task.key), {
      ...flash, id, key: task.key, group: groupKeyOf(task), name: groupNameOf(task),
    }])
    if (flash.tone === 'success' || flash.tone === 'info') timers.current.push(setTimeout(() => dismiss(id), FLASH_MS))
  }

  /*
   * The tasks under their projects. The order is taken once per week, as the
   * projects first appear, and kept: a project does not jump about the page
   * because one of its tasks was just submitted.
   */
  const order = useRef({ week: null, keys: [] })
  if (order.current.week !== week) order.current = { week, keys: [] }
  for (const r of rows) {
    const k = groupKeyOf(r.t)
    if (!order.current.keys.includes(k)) order.current.keys.push(k)
  }
  const groups = useMemo(() => {
    const by = new Map()
    for (const r of shown) {
      const key = groupKeyOf(r.t)
      if (!by.has(key)) by.set(key, { key, name: groupNameOf(r.t), rows: [] })
      by.get(key).rows.push(r)
    }
    // A block whose last card just left still shows what was posted from it.
    for (const f of flashes) if (!by.has(f.group)) by.set(f.group, { key: f.group, name: f.name, rows: [] })
    // The project's own epic first, then its tasks.
    for (const g of by.values()) g.rows.sort((a, b) => Number(!!b.t.epic) - Number(!!a.t.epic))
    const at = (k) => { const i = order.current.keys.indexOf(k); return i < 0 ? 1e6 : i }
    return [...by.values()].sort((a, b) => at(a.key) - at(b.key))
  }, [shown, flashes])

  // An unsent draft on any card: the tab asks before it closes. (The draft is
  // kept in this browser either way; this is so nobody thinks it was sent.)
  useEffect(() => {
    const warn = (e) => {
      if (unsentDrafts(person, addWeeks(current, -1)).length) { e.preventDefault(); e.returnValue = '' }
    }
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [person, current])

  const nextNo = weekNo(addWeeks(week, 1))
  // The count after the label, quieter: "Not updated yet 2".
  const count = (n) => <>{' '}<Box component="span" sx={{ color: 'text.tertiary', ml: 0.5, fontWeight: 400 }}>{n}</Box></>
  const addButtons = canWrite && (
    <Box sx={{
      display: 'flex', gap: 1, flexWrap: 'wrap', ml: { sm: 'auto' }, mr: { sm: -1.5 },
    }}
    >
      <Button startIcon={<AddIcon />} onClick={() => setAdding(true)} sx={focusRingSx}>Add a task</Button>
      <Button startIcon={<AddIcon />} onClick={() => setAddingProject(true)} sx={focusRingSx}>New project</Button>
    </Box>
  )

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: { xs: 3, sm: 4 } }} component="section" aria-label="my Jira tasks">
      {!jw.writable && (
        <Alert severity="warning" variant="outlined">
          Writing to Jira is switched off on the server: updates are kept here but not posted, and new tasks cannot be created.
        </Alert>
      )}

      {/* The toolbar: which tasks, and adding one. */}
      {(!planning || canWrite) && (
        <Box sx={{
          display: 'flex', alignItems: 'center', columnGap: 3, rowGap: 2, flexWrap: 'wrap',
        }}
        >
          {!planning && (
            <ToggleButtonGroup
              exclusive
              value={filter}
              onChange={(_e, v) => v && setFilter(v)}
              aria-label="which tasks"
              sx={{
                width: { xs: '100%', sm: 'auto' },
                '& .MuiToggleButton-root': {
                  minHeight: { xs: 36, sm: 28 }, px: { xs: 1.5, sm: 3 }, whiteSpace: 'nowrap', flex: { xs: '1 1 auto', sm: '0 0 auto' },
                },
              }}
            >
              <ToggleButton value="todo" disableFocusRipple sx={focusRingSx}><span>{phone ? 'To update' : 'Not updated yet'}{count(todo.length)}</span></ToggleButton>
              <ToggleButton value="done" disableFocusRipple sx={focusRingSx}><span>{phone ? 'Updated' : 'Already updated'}{count(doneRows.length)}</span></ToggleButton>
              <ToggleButton value="all" disableFocusRipple sx={focusRingSx}><span>All{count(rows.length)}</span></ToggleButton>
            </ToggleButtonGroup>
          )}
          {canWrite && planning && (
            <Box
              data-plan-box
              sx={{
                display: 'flex', alignItems: 'center', gap: 2, px: 3, py: 2, minHeight: 36, borderRadius: '6px', bgcolor: 'bg.subtle', flex: '1 1 320px', minWidth: 0,
              }}
            >
              <EventIcon sx={{ fontSize: 18, color: 'text.secondary', flexShrink: 0 }} />
              <Typography variant="body2" sx={{ color: 'text.secondary' }}>
                {planIn
                  ? `Plan for week ${weekNo(week)} recorded${planInAt ? ` ${ago(planInAt)}` : ''}. Dates can still change until the week starts.`
                  : `Give your Jira tasks dates in week ${weekNo(week)}, or add new ones. Then confirm the plan above.`}
              </Typography>
            </Box>
          )}
          {addButtons}
        </Box>
      )}

      {/* Reminders only where planning can still happen: this week's, about
          next week's plan. A past or closed week has none. */}
      {remind && (
        <Box
          data-plan-box
          sx={{
            display: 'flex', alignItems: 'center', columnGap: 2, rowGap: 1, flexWrap: 'wrap', pl: 3, pr: 1.5, py: 1.5, minHeight: 44, borderRadius: '6px', bgcolor: 'bg.subtle',
          }}
        >
          <EventIcon sx={{ fontSize: 18, color: 'text.secondary', flexShrink: 0 }} />
          <Typography variant="body2" sx={{ color: 'text.secondary', flex: '1 1 240px' }}>
            <Box component="span" sx={{ color: 'text.primary', fontWeight: 500 }}>Don&rsquo;t forget next week&rsquo;s plan:</Box>
            {` set dates on your Jira tasks for week ${nextNo} before Monday 08:00.`}
          </Typography>
          <Button variant="text" size="small" onClick={() => onGoWeek(1)} sx={focusRingSx}>
            Plan week {nextNo}
          </Button>
        </Box>
      )}
      {note && <Alert severity={note.tone} variant="outlined" onClose={() => setNote(null)}>{note.text}</Alert>}

      {groups.map((g) => (
        <ProjectGroup
          key={g.key || 'none'}
          name={g.name}
          projectKey={g.key}
          rows={g.rows}
          planning={planning}
          writable={writable}
          canWrite={canWrite}
          flashes={flashes.filter((f) => f.group === g.key)}
          onDismiss={dismiss}
        >
          {g.rows.map(({ t }) => (
            <TaskCard
              key={`${t.key}:${t.update?.submittedAt || ''}`}
              task={t}
              week={week}
              person={person}
              planning={planning}
              canWrite={canWrite}
              writable={jw.writable}
              aiOn={aiOn}
              highlight={!!focusKey && t.project?.key === focusKey}
              onSaved={(x) => { if (x?.dates) onDatesSaved?.(); onReload?.() }}
              onPosted={onPosted}
              grouped
            />
          ))}
        </ProjectGroup>
      ))}
      {shown.length === 0 && (
        <Box sx={{
          border: 1, borderColor: 'border.subtle', borderRadius: '8px', bgcolor: 'bg.surface',
        }}
        >
          {rows.length === 0 ? (
            <EmptyState
              icon={EventIcon}
              title={canWrite ? `No Jira tasks of yours are dated in week ${weekNo(week)} yet.` : `No Jira tasks of yours were dated in week ${weekNo(week)}.`}
              body={canWrite ? (planning ? 'Give one of your tasks dates in this week, or add a task.' : 'Add a task, or give an undated one some dates.') : undefined}
            />
          ) : filter === 'todo' ? (
            <EmptyState icon={TaskIcon} title="Every task this week has an update." body="Open Already updated to read or change one." />
          ) : (
            <EmptyState icon={TaskIcon} title="No updates sent yet this week." body="Each task's update is posted from its card under Not updated yet." />
          )}
        </Box>
      )}

      {(jw.undated || []).length > 0 && canWrite && (
        <Section
          title="No dates yet"
          meta="Your open Jira tasks with no start or due date. Give one dates to put it in a week."
          padded={false}
          data-undated
          sx={{ scrollMarginTop: 96, '& [data-jira-task] + [data-jira-task]': { borderTop: 1, borderColor: 'border.subtle' } }}
        >
          {jw.undated.map((t) => (
            <TaskCard
              key={t.key}
              task={t}
              week={week}
              person={person}
              planning
              canWrite={canWrite}
              writable={jw.writable}
              onSaved={(x) => { if (x?.dates) onDatesSaved?.(); onReload?.() }}
              onPosted={onPosted}
            />
          ))}
        </Section>
      )}

      {canWrite && (
        <>
          <NewTask
            open={adding}
            week={week}
            projects={projects}
            preset={preset}
            writable={jw.writable}
            onCancel={() => { setAdding(false); onPresetUsed?.() }}
            onDone={(task) => {
              setAdding(false)
              onPresetUsed?.()
              setNote({ tone: 'success', text: `${task.key} added in Jira and assigned to you.` })
              onReload?.()
            }}
          />
          <NewProject
            open={addingProject}
            week={week}
            writable={jw.writable}
            onCancel={() => setAddingProject(false)}
            onDone={(r) => {
              setAddingProject(false)
              setNote({ tone: r.warning ? 'warning' : 'success', text: r.warning || `${r.epic.key} created in Jira and added to the register.` })
              onProjectAdded?.(r)
              onReload?.()
            }}
          />
        </>
      )}
    </Box>
  )
}
