import { useEffect, useMemo, useRef, useState } from 'react'
import {
  Box, Paper, Typography, Button, TextField, Alert, ToggleButton, ToggleButtonGroup, Checkbox, FormControlLabel,
  Autocomplete, CircularProgress, IconButton, Link, MenuItem, Collapse, ButtonBase, Dialog,
} from '@mui/material'
import AddIcon from '@mui/icons-material/Add'
import CloseIcon from '@mui/icons-material/Close'
import CheckIcon from '@mui/icons-material/Check'
import AttachIcon from '@mui/icons-material/AttachFileOutlined'
import OpenInNewIcon from '@mui/icons-material/OpenInNew'
import EventIcon from '@mui/icons-material/EventOutlined'
import ExpandMoreIcon from '@mui/icons-material/ExpandMore'
import FolderIcon from '@mui/icons-material/FolderOutlined'
import { alpha } from '@mui/material/styles'
import * as api from '../lib/api.js'
import { addWeeks, weekNo, weekTitle } from '../lib/weekly.js'
import AiAssist from './AiAssist.jsx'
import { Pill } from './Brand.jsx'
import { ago } from './FollowUp.jsx'
import { mentionsHold, isHoldStatus } from '../lib/hold.js'
import {
  needsUpdate, failedPost, partialPost, postedSummary, updateProblems, readDraft, writeDraft, clearDraft, baseFields, differs, unsentDrafts,
} from '../lib/taskUpdate.js'
import { focusRingSx } from './focus.js'

/**
 * A MEMBER'S WEEK, FROM JIRA.
 *
 * Their Jira tasks for the week — the ones assigned to them whose dates cover
 * it — one card each, with its own update and its own Submit. Submitting posts
 * the update to the task in Jira: a comment, any screenshot, and Done when it
 * is finished. Above them, a filter between what still needs an update and
 * what has one; beside, a reminder to plan next week.
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

/* ------------------------------------------------------------ one task */

// Finished / Not finished / On hold: the picked one in its own colour, muted —
// a tinted border, tinted text and a tick — so the choice reads at a glance.
const STATUS_TONE = { yes: 'success', no: 'warning', hold: 'info' }
const toggleSx = (tone) => (t) => ({
  px: 1.5,
  gap: 0.5,
  ...focusRingSx,
  '&&.Mui-selected, &&.Mui-selected:hover': {
    color: t.palette[tone].light,
    bgcolor: alpha(t.palette[tone].main, 0.1),
    borderColor: alpha(t.palette[tone].main, 0.55),
  },
})

/** The task's dates, or that it has none. */
const span = (task) => {
  const a = task.start || task.sprintStart
  const b = task.due || task.sprintEnd
  if (!a && !b) return 'No dates yet'
  return `${fmt(a)} – ${fmt(b)}`
}

function TaskCard({
  task, week, person, planning, canWrite, writable, aiOn, highlight, onSaved, onPosted, grouped = false,
}) {
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

  // What is missing, shown on the fields once Submit has been pressed, and
  // cleared field by field as each is filled in.
  const problems = updateProblems(fields)
  const shownProblems = tried ? problems : {}
  const incomplete = Object.keys(problems).length > 0

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
        setMsg({ tone: 'error', text: `Up to ${MAX_IMAGES} pictures per update.` })
        break
      }
      try {
        const data = await imageData(f)
        if (data.length * 0.75 > MAX_BYTES) {
          setMsg({ tone: 'error', text: 'That picture is too large, even scaled down (4 MB at most).' })
          continue
        }
        added += 1
        setImages((cur) => (cur.length >= MAX_IMAGES ? cur
          : [...cur, { name: `${task.key}-${new Date().toISOString().slice(0, 10)}-${Date.now().toString(36)}${cur.length + 1}`, data }]))
      } catch {
        setMsg({ tone: 'error', text: 'That picture could not be read.' })
      }
    }
    if (added) setMsg({ tone: 'info', text: `${added === 1 ? 'Picture' : `${added} pictures`} added — sent to ${task.key} in Jira when you submit.` })
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
    if (incomplete) return
    post({
      progress, done, hold, reason, blocker, decision, decisionText, images,
    })
  }
  // The update kept here, sent again as it was: for a post Jira did not take.
  const retry = () => post({ ...baseFields(u) })

  const saveDates = async () => {
    setBusy(true)
    setMsg(null)
    try {
      await api.planJiraTask(task.key, { start: dates.start || null, due: dates.due || null })
      onPosted?.(task, null, `Dates written to ${task.key} in Jira: ${fmt(dates.start)} – ${fmt(dates.due)}.`)
      onSaved?.({ dates: true })
    } catch (e) {
      setMsg({ tone: 'error', text: e.message })
    } finally {
      setBusy(false)
    }
  }

  const project = task.project?.summary || task.parent?.summary || 'No project'
  const projectKey = task.project?.key || task.parent?.key || null
  const posted = u?.jira?.state === 'posted'
  const failed = failedPost(u, writable)
  const partial = partialPost(u)
  const heldInJira = !task.done && isHoldStatus(task.status)
  // The project's own epic, inside its own block: the block already names it.
  const ownEpic = grouped && task.epic
  return (
    <Paper
      variant="outlined"
      data-jira-task={task.key}
      data-task-project={task.project?.key || undefined}
      {...dropProps}
      sx={{
        p: { xs: 1.5, sm: 2 },
        display: 'flex',
        flexDirection: 'column',
        gap: 1.25,
        boxShadow: highlight ? (th) => `0 0 0 2px ${th.palette.primary.main}` : 'none',
        ...(dragging && { outline: '2px dashed', outlineColor: 'primary.main', outlineOffset: -4 }),
      }}
    >
      <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 1, flexWrap: 'wrap' }}>
        <Box sx={{ flex: 1, minWidth: 0 }}>
          {!grouped && (
            <Typography variant="caption" sx={{ color: 'text.secondary', display: 'block' }}>
              {projectKey ? `${projectKey} · ` : ''}{project}
            </Typography>
          )}
          <Box sx={{ display: 'flex', alignItems: 'baseline', gap: 0.75, flexWrap: 'wrap' }}>
            <Link href={task.url} target="_blank" rel="noopener" underline="hover" sx={{ fontWeight: 700, display: 'inline-flex', alignItems: 'center', gap: 0.5, ...focusRingSx }}>
              {task.key}<OpenInNewIcon sx={{ fontSize: 13 }} />
            </Link>
            {ownEpic
              ? <Typography variant="body2" sx={{ color: 'text.secondary', fontWeight: 600 }} data-own-epic>Project epic</Typography>
              : <Typography variant="body1" sx={{ fontWeight: 600 }}>{task.summary}</Typography>}
          </Box>
          <Typography variant="caption" sx={{ color: 'text.secondary' }}>
            {task.status}{' · '}{span(task)}
            {!task.start && !task.due && task.sprintName ? ` (${task.sprintName})` : ''}
          </Typography>
        </Box>
        <Box sx={{ display: 'flex', gap: 0.75, flexWrap: 'wrap', alignItems: 'center' }}>
          {task.epic && !ownEpic && <Pill label="Epic" tone="info" title="A project in Jira with you as PIC" />}
          {task.done && <Pill label="Done in Jira" tone="good" />}
          {heldInJira && <Pill label="On hold in Jira" tone="warn" />}
          {u && <Pill label={`${failed ? 'Not posted' : 'Updated'} ${ago(u.submittedAt)}`} tone={posted ? 'info' : 'warn'} title={posted ? 'Posted to Jira' : (u.jira?.error || 'Not posted to Jira')} />}
        </Box>
      </Box>

      {failed && (
        <Alert
          severity="warning"
          variant="outlined"
          sx={{ py: 0, alignItems: 'center' }}
          data-post-failed
          action={canWrite ? (
            <Button color="inherit" size="small" onClick={retry} disabled={busy} startIcon={busy ? <CircularProgress size={12} color="inherit" /> : null} sx={focusRingSx}>
              Retry posting
            </Button>
          ) : null}
        >
          Kept here, but NOT posted to {task.key} in Jira
          {u.jira?.error ? `: ${String(u.jira.error).replace(/\.?\s*$/, '.')}` : u.jira?.state === 'pending' ? ': the post did not finish.' : '.'}
          {' '}It still counts as to do until it reaches Jira.
        </Alert>
      )}
      {!failed && partial.length > 0 && (
        <Typography variant="caption" sx={{ color: 'warning.light' }} data-post-partial>
          Posted as a comment, but {partial.join('; ')}.
        </Typography>
      )}

      {planning ? (
        <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap', alignItems: 'center' }}>
          <TextField size="small" type="date" label="Start" value={dates.start} onChange={(e) => setDates((d) => ({ ...d, start: e.target.value }))} InputLabelProps={{ shrink: true }} disabled={!canWrite} />
          <TextField size="small" type="date" label="Due" value={dates.due} onChange={(e) => setDates((d) => ({ ...d, due: e.target.value }))} InputLabelProps={{ shrink: true }} disabled={!canWrite} />
          {canWrite && (
            <Button size="small" variant="outlined" onClick={saveDates} startIcon={busy ? <CircularProgress size={14} color="inherit" /> : null} disabled={busy || !writable || (dates.start === (task.start || '') && dates.due === (task.due || ''))} sx={focusRingSx}>
              Save dates
            </Button>
          )}
        </Box>
      ) : (
        <>
          {start.restored && dirty && (
            <Typography variant="caption" sx={{ color: 'text.secondary', mb: -0.5 }} data-draft-restored>
              Your unsent draft, kept in this browser — not posted yet.
            </Typography>
          )}
          <TextField
            label="This week's progress"
            value={progress}
            onChange={(e) => setProgress(e.target.value)}
            disabled={!canWrite}
            multiline
            minRows={2}
            maxRows={10}
            fullWidth
            error={!!shownProblems.progress}
            helperText={shownProblems.progress || (canWrite ? 'What you did on it. Links are fine. Paste a picture here (Ctrl/Cmd+V), drop one on the card, or attach it below.' : undefined)}
          />
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
          />
          {canWrite && (
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap' }}>
              <Button
                size="small"
                variant="outlined"
                startIcon={<AttachIcon />}
                onClick={() => fileRef.current?.click()}
                disabled={images.length >= MAX_IMAGES}
                data-attach-image
                sx={{ color: 'text.primary', borderColor: 'divider', ...focusRingSx }}
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
              <Typography variant="caption" sx={{ color: 'text.secondary' }}>
                {images.length ? `${images.length} of ${MAX_IMAGES} pictures` : `Up to ${MAX_IMAGES} pictures — paste, drop or attach`}
              </Typography>
            </Box>
          )}
          {images.length > 0 && (
            <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }} data-attached-images>
              {images.map((im, i) => (
                <Box key={im.name} sx={{ position: 'relative', border: 1, borderColor: 'divider', borderRadius: 1.5, overflow: 'hidden' }}>
                  <Box
                    component="img"
                    src={im.data}
                    alt={`picture ${i + 1}`}
                    onClick={() => setPreview(im.data)}
                    title="Click to see it full size"
                    sx={{ display: 'block', height: 72, maxWidth: 160, objectFit: 'cover', cursor: 'zoom-in' }}
                  />
                  <IconButton size="small" aria-label={`remove screenshot ${i + 1}`} onClick={() => setImages((l) => l.filter((_x, j) => j !== i))} sx={{ position: 'absolute', top: 2, right: 2, bgcolor: 'rgba(0,0,0,.55)', p: 0.25 }}>
                    <CloseIcon sx={{ fontSize: 14, color: '#fff' }} />
                  </IconButton>
                </Box>
              ))}
            </Box>
          )}
          <Dialog open={!!preview} onClose={() => setPreview(null)} maxWidth="lg">
            {preview && <Box component="img" src={preview} alt="picture, full size" onClick={() => setPreview(null)} sx={{ display: 'block', maxWidth: '90vw', maxHeight: '85vh', cursor: 'zoom-out' }} />}
          </Dialog>
          {u?.attachments?.length > 0 && (
            <Typography variant="caption" sx={{ color: 'text.secondary' }}>Already attached in Jira: {u.attachments.join(', ')}</Typography>
          )}

          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.5 }}>
            <ToggleButtonGroup
              size="small"
              exclusive
              value={hold ? 'hold' : done === null ? null : done ? 'yes' : 'no'}
              onChange={(_e, v) => v && choose(v)}
              disabled={!canWrite}
              aria-label={`finished ${task.key}`}
              aria-invalid={!!shownProblems.status || undefined}
              sx={(t) => ({
                alignSelf: 'flex-start',
                flexWrap: 'wrap',
                ...(shownProblems.status && { outline: `1px solid ${alpha(t.palette.error.main, 0.6)}`, outlineOffset: 2, borderRadius: '10px' }),
              })}
            >
              {[['yes', 'Finished'], ['no', 'Not finished'], ['hold', 'On hold']].map(([v, label]) => {
                const on = (hold ? 'hold' : done === null ? null : done ? 'yes' : 'no') === v
                return (
                  <ToggleButton key={v} value={v} disableFocusRipple sx={toggleSx(STATUS_TONE[v])}>
                    {on && <CheckIcon sx={{ fontSize: 16 }} />}
                    {label}
                  </ToggleButton>
                )
              })}
            </ToggleButtonGroup>
            {shownProblems.status && <Typography variant="caption" sx={{ color: 'error.light' }} data-field-error="status">{shownProblems.status}</Typography>}
          </Box>
          {hold && canWrite && (
            <Typography variant="caption" sx={{ color: 'text.secondary', mt: -0.5 }} data-hold-note>
              {holdAuto ? 'Your update says it is on hold, so On hold is picked — pick another if it is not. ' : ''}
              {heldInJira ? 'Already on hold in Jira.' : `Submit moves ${task.key} to its Hold status in Jira.`}
            </Typography>
          )}
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
              error={!!shownProblems.reason}
              helperText={shownProblems.reason}
            />
          )}
          <TextField size="small" label="Blocker (optional)" value={blocker} onChange={(e) => setBlocker(e.target.value)} disabled={!canWrite} multiline maxRows={4} fullWidth />
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.5 }}>
            <FormControlLabel
              sx={{ alignSelf: 'flex-start', mr: 0 }}
              control={<Checkbox size="small" checked={decision} onChange={(e) => setDecision(e.target.checked)} disabled={!canWrite} />}
              label={<Typography variant="body2">Decision needed?</Typography>}
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
                error={!!shownProblems.decisionText}
                helperText={shownProblems.decisionText}
              />
            )}
          </Box>
          {contradictsDone && (
            <Alert severity="warning" variant="outlined" sx={{ py: 0 }} data-done-warning>
              {task.key} is Done in Jira — this update won&rsquo;t reopen it. If the work is not finished, reopen it in Jira as well.
            </Alert>
          )}
          {canWrite && (
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, flexWrap: 'wrap' }}>
              <Button variant="contained" onClick={submit} disabled={busy} startIcon={busy ? <CircularProgress size={14} /> : null} aria-label={`submit ${task.key}`} sx={focusRingSx}>
                {contradictsDone ? 'Post anyway' : u ? 'Submit again' : 'Submit'}
              </Button>
              {tried && incomplete ? (
                <Typography variant="caption" sx={{ color: 'error.light' }} data-submit-problem>Fill in the marked {Object.keys(problems).length === 1 ? 'field' : 'fields'} to submit.</Typography>
              ) : (
                <Typography variant="caption" sx={{ color: 'text.secondary' }}>
                  {writable ? `Posts to ${task.key} in Jira — a comment, and a dated entry in its description${done && !task.done ? '; moves it to Done' : hold && !heldInJira ? '; puts it on hold' : ''}.` : 'Kept here; writing to Jira is switched off on the server.'}
                </Typography>
              )}
            </Box>
          )}
        </>
      )}
      {serverProblems.length > 0 && (
        <Alert severity="warning" variant="outlined" sx={{ py: 0 }}>
          <Box component="ul" sx={{ m: 0, pl: 2 }}>{serverProblems.map((p) => <li key={p}>{p}</li>)}</Box>
        </Alert>
      )}
      {msg && !serverProblems.length && <Alert severity={msg.tone} variant="outlined" sx={{ py: 0 }} onClose={() => setMsg(null)}>{msg.text}</Alert>}
    </Paper>
  )
}

/* ------------------------------------------------------- add a task */

function NewTask({
  week, projects, preset, onDone, onCancel, writable,
}) {
  const [project, setProject] = useState(() => projects.find((p) => p.key === preset) || null)
  const [summary, setSummary] = useState('')
  const [dates, setDates] = useState(() => workdays(week))
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  useEffect(() => { if (preset) setProject(projects.find((p) => p.key === preset) || null) }, [preset, projects])
  const create = async () => {
    setBusy(true)
    setError(null)
    try {
      const r = await api.newJiraTask({ projectKey: project?.key, summary, ...dates })
      onDone(r.task)
    } catch (e) {
      setError(e.message)
    } finally {
      setBusy(false)
    }
  }
  return (
    <Paper variant="outlined" sx={{ p: { xs: 1.5, sm: 2 }, display: 'flex', flexDirection: 'column', gap: 1.25 }} aria-label="new Jira task" component="section">
      <Typography variant="h4">New task in Jira</Typography>
      <Autocomplete
        size="small"
        options={projects}
        groupBy={(p) => (p.mine === 'pic' ? 'Your projects (you are PIC)' : p.mine === 'helping' ? 'Projects you help on' : 'Other projects')}
        openOnFocus
        autoHighlight
        value={project}
        onChange={(_e, v) => setProject(v)}
        getOptionLabel={(p) => `${p.jiraKey || p.key} · ${p.summary}`}
        isOptionEqualToValue={(a, b) => a.key === b.key}
        renderInput={(params) => <TextField {...params} label="Project" />}
      />
      <TextField size="small" label="Task" value={summary} onChange={(e) => setSummary(e.target.value)} fullWidth />
      <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
        <TextField size="small" type="date" label="Start" value={dates.start} onChange={(e) => setDates((d) => ({ ...d, start: e.target.value }))} InputLabelProps={{ shrink: true }} />
        <TextField size="small" type="date" label="Due" value={dates.due} onChange={(e) => setDates((d) => ({ ...d, due: e.target.value }))} InputLabelProps={{ shrink: true }} />
      </Box>
      {error && <Alert severity="error" sx={{ py: 0 }}>{error}</Alert>}
      <Box sx={{ display: 'flex', gap: 1, alignItems: 'center', flexWrap: 'wrap' }}>
        <Button variant="contained" onClick={create} startIcon={busy ? <CircularProgress size={14} color="inherit" /> : null} disabled={busy || !writable || !project || summary.trim().length < 3}>
          {busy ? 'Creating…' : 'Create in Jira'}
        </Button>
        <Button onClick={onCancel}>Cancel</Button>
        <Typography variant="caption" sx={{ color: 'text.secondary' }}>
          Created under {project?.jiraKey || 'the project’s epic'}, assigned to you.
        </Typography>
      </Box>
    </Paper>
  )
}

/* ------------------------------------------------- add a project */

function NewProject({ week, onDone, onCancel, writable }) {
  const [summary, setSummary] = useState('')
  const [kind, setKind] = useState('adhoc')
  const [dates, setDates] = useState(() => workdays(week))
  const [description, setDescription] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const create = async () => {
    setBusy(true)
    setError(null)
    try {
      onDone(await api.newJiraProject({ summary, kind, description, ...dates }))
    } catch (e) {
      setError(e.message)
    } finally {
      setBusy(false)
    }
  }
  return (
    <Paper variant="outlined" sx={{ p: { xs: 1.5, sm: 2 }, display: 'flex', flexDirection: 'column', gap: 1.25 }} aria-label="new project" component="section">
      <Typography variant="h4">New project</Typography>
      <Typography variant="caption" sx={{ color: 'text.secondary', mt: -0.75 }}>
        Created as an epic in Jira, assigned to you, and added to the register with you as PIC. An administrator sizes it later.
      </Typography>
      <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
        <TextField size="small" select label="Type" value={kind} onChange={(e) => setKind(e.target.value)} sx={{ minWidth: 180 }}>
          <MenuItem value="adhoc">Adhoc work</MenuItem>
          <MenuItem value="cr">Change Request</MenuItem>
        </TextField>
        <TextField size="small" label="Project name" value={summary} onChange={(e) => setSummary(e.target.value)} sx={{ flex: 1, minWidth: 220 }} />
      </Box>
      <TextField size="small" label="Description (optional)" value={description} onChange={(e) => setDescription(e.target.value)} multiline minRows={2} maxRows={6} fullWidth />
      <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
        <TextField size="small" type="date" label="Start" value={dates.start} onChange={(e) => setDates((d) => ({ ...d, start: e.target.value }))} InputLabelProps={{ shrink: true }} />
        <TextField size="small" type="date" label="Due" value={dates.due} onChange={(e) => setDates((d) => ({ ...d, due: e.target.value }))} InputLabelProps={{ shrink: true }} />
      </Box>
      {error && <Alert severity="error" sx={{ py: 0 }}>{error}</Alert>}
      <Box sx={{ display: 'flex', gap: 1 }}>
        <Button variant="contained" onClick={create} startIcon={busy ? <CircularProgress size={14} color="inherit" /> : null} disabled={busy || !writable || summary.trim().length < 3}>
          {busy ? 'Creating…' : 'Create project'}
        </Button>
        <Button onClick={onCancel}>Cancel</Button>
      </Box>
    </Paper>
  )
}

/* ------------------------------------------------- one project's tasks */

/**
 * A PROJECT BLOCK: one framed box holding the project's header and every task
 * under it, so it is plain which project each update is for. The header says
 * how many of its tasks still need an update, and folds the project away once
 * it is done with. What was just posted from it is confirmed inside it, so the
 * card that left for "Already updated" does not vanish without a word.
 */
function ProjectGroup({
  name, projectKey, rows, allRows = rows, planning, writable, flashes = [], onDismiss, children,
}) {
  // Counted over all of the project's tasks, not just the ones the filter
  // shows: under "Already updated" a block with tasks still to do must not
  // say "All updated".
  const left = allRows.filter(({ t }) => needsUpdate(t, writable)).length
  const [open, setOpen] = useState(true)
  return (
    <Box
      component="section"
      data-project-group={projectKey || 'none'}
      aria-label={`project ${name}`}
      sx={(t) => ({
        display: 'flex',
        flexDirection: 'column',
        borderRadius: 2,
        overflow: 'hidden',
        border: 1,
        borderColor: alpha(t.palette.primary.main, 0.35),
        borderLeft: `4px solid ${t.palette.primary.main}`,
        bgcolor: alpha(t.palette.primary.main, t.palette.mode === 'dark' ? 0.04 : 0.02),
      })}
    >
      <ButtonBase
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        sx={(t) => ({
          justifyContent: 'flex-start',
          textAlign: 'left',
          gap: 1.25,
          px: { xs: 1.25, sm: 1.75 },
          py: 1.25,
          borderBottom: open ? `1px solid ${alpha(t.palette.primary.main, 0.25)}` : 'none',
          bgcolor: alpha(t.palette.primary.main, t.palette.mode === 'dark' ? 0.13 : 0.07),
          '&:hover': { bgcolor: alpha(t.palette.primary.main, t.palette.mode === 'dark' ? 0.18 : 0.1) },
          '&.Mui-focusVisible': { outline: '2px solid', outlineColor: 'primary.light', outlineOffset: -2 },
        })}
      >
        <FolderIcon sx={{ color: 'primary.light', fontSize: 22, flexShrink: 0 }} />
        <Box sx={{ flex: 1, minWidth: 0 }}>
          {projectKey && (
            <Typography variant="caption" sx={{ color: 'primary.light', fontWeight: 700, letterSpacing: 0.4, display: 'block', lineHeight: 1.3 }}>
              {projectKey}
            </Typography>
          )}
          <Typography variant="h4" sx={{ fontWeight: 700, fontSize: { xs: '1rem', sm: '1.1rem' } }}>{name}</Typography>
        </Box>
        {planning
          ? rows.length > 0 && <Pill label={`${rows.length} task${rows.length === 1 ? '' : 's'}`} tone="neutral" />
          : left
            ? <Pill label={`${left} to update`} tone="warn" />
            : <Pill label="All updated" tone="good" />}
        <ExpandMoreIcon sx={{ color: 'text.secondary', transition: 'transform .2s', transform: open ? 'rotate(180deg)' : 'none', flexShrink: 0 }} />
      </ButtonBase>
      <Collapse in={open} unmountOnExit={false}>
        <Box data-project-body sx={{ display: 'flex', flexDirection: 'column', gap: 1.25, p: { xs: 1, sm: 1.5 } }}>
          {flashes.map((f) => (
            <Alert
              key={f.id}
              severity={f.tone}
              variant="outlined"
              icon={f.tone === 'success' ? <CheckIcon fontSize="inherit" /> : undefined}
              onClose={() => onDismiss(f.id)}
              sx={{ py: 0, bgcolor: 'transparent' }}
              data-posted={f.key}
            >
              {f.text}
            </Alert>
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

export default function JiraWeek({
  week, current, person, canWrite, jw, onReload, projects, preset, onPresetUsed, focusKey, aiOn, planIn, planInAt, onGoWeek,
  onProjectAdded, onDatesSaved, addSignal = 0,
}) {
  const [filter, setFilter] = useState('todo')
  const [adding, setAdding] = useState(false)
  const [addingProject, setAddingProject] = useState(false)
  const [note, setNote] = useState(null)
  useEffect(() => { if (preset) { setAdding(true) } }, [preset])
  // "Set dates / add tasks" in the Next step bar: open the new-task form.
  useEffect(() => { if (addSignal) setAdding(true) }, [addSignal])

  const planning = week > current
  const writable = !!jw.writable
  const rows = useMemo(() => [
    ...(jw.overdue || []).map((t) => ({ t })),
    ...(jw.tasks || []).map((t) => ({ t })),
  ], [jw])
  // A failed post is not an update: it stays to do, with a Retry on its card.
  const todo = rows.filter((r) => needsUpdate(r.t, writable))
  const doneRows = rows.filter((r) => !needsUpdate(r.t, writable))
  const shown = planning ? rows : filter === 'todo' ? todo : filter === 'done' ? doneRows : rows

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
        ? { tone: 'warning', text: `${postedSummary(task.key, j)} — but ${partial.join('; ')}.` }
        : { tone: 'success', text: `${postedSummary(task.key, j)}.` }
    } else if (!writable) flash = { tone: 'info', text: `Update on ${task.key} kept here — writing to Jira is switched off on the server.` }
    else flash = { tone: 'warning', text: `Kept here, but not posted to ${task.key} in Jira: ${j?.error || 'Jira did not answer'}. It stays under Not updated yet, with Retry posting on its card.` }
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

  const isCurrent = week === current
  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.5 }} component="section" aria-label="my Jira tasks">
      {!jw.writable && (
        <Alert severity="warning" variant="outlined" sx={{ py: 0 }}>
          Writing to Jira is switched off on the server, so updates are kept here but not posted to Jira, and new tasks
          cannot be created. An administrator turns it on with JIRA_ALLOW_WRITES=true in Render.
        </Alert>
      )}

      <Box sx={{ display: 'flex', gap: 1.5, alignItems: 'stretch', flexWrap: 'wrap' }}>
        <Box sx={{ flex: 1, minWidth: 260, display: 'flex', flexDirection: 'column', gap: 1 }}>
          {!planning && (
            <ToggleButtonGroup size="small" exclusive value={filter} onChange={(_e, v) => v && setFilter(v)} aria-label="which tasks" sx={{ flexWrap: 'wrap' }}>
              <ToggleButton value="todo" disableFocusRipple sx={focusRingSx}>Not updated yet ({todo.length})</ToggleButton>
              <ToggleButton value="done" disableFocusRipple sx={focusRingSx}>Already updated ({doneRows.length})</ToggleButton>
              <ToggleButton value="all" disableFocusRipple sx={focusRingSx}>All ({rows.length})</ToggleButton>
            </ToggleButtonGroup>
          )}
          <Typography variant="caption" sx={{ color: 'text.secondary' }}>
            The Jira epics and tasks with you ({jw.account}) as PIC whose timeline covers {weekTitle(week)}.
          </Typography>
        </Box>
        {/* Planning prompts only where planning can still happen: the week
            ahead, or this week's reminder about it. A past or closed week has
            none. */}
        {canWrite && (planning || isCurrent) && (
          <Paper variant="outlined" sx={{ p: 1.5, minWidth: 240, maxWidth: { sm: 340 }, display: 'flex', flexDirection: 'column', gap: 0.75 }} data-plan-box>
            {planning ? (
              <>
                <Typography variant="body2" sx={{ fontWeight: 700, display: 'flex', alignItems: 'center', gap: 0.75 }}><EventIcon fontSize="small" /> Planning week {weekNo(week)}</Typography>
                <Typography variant="caption" sx={{ color: 'text.secondary' }}>
                  Set dates on your Jira tasks so they fall in this week, or add new ones.
                  {planIn ? '' : ' Then press “My plan is set” at the top.'}
                </Typography>
                {planIn && <Typography variant="caption" sx={{ color: 'text.secondary' }}>Plan for week {weekNo(week)} recorded {planInAt ? ago(planInAt) : ''}.</Typography>}
              </>
            ) : (
              <>
                <Typography variant="body2" sx={{ fontWeight: 700, color: 'text.primary', display: 'flex', alignItems: 'center', gap: 0.75 }}>
                  <EventIcon fontSize="small" sx={{ color: 'warning.light' }} /> Don&rsquo;t forget next week&rsquo;s plan
                </Typography>
                <Typography variant="caption" sx={{ color: 'text.secondary' }}>
                  Week {weekNo(addWeeks(week, 1))}: set dates on the Jira tasks you will work on, before Monday 08:00.
                </Typography>
                <Button
                  size="small"
                  variant={todo.length === 0 ? 'outlined' : 'text'}
                  onClick={() => onGoWeek(1)}
                  sx={[{ alignSelf: 'flex-start' }, focusRingSx]}
                >
                  Plan week {weekNo(addWeeks(week, 1))} →
                </Button>
              </>
            )}
          </Paper>
        )}
      </Box>
      {note && <Alert severity={note.tone} variant="outlined" sx={{ py: 0 }} onClose={() => setNote(null)}>{note.text}</Alert>}

      {groups.map((g) => (
        <ProjectGroup
          key={g.key || 'none'}
          name={g.name}
          projectKey={g.key}
          rows={g.rows}
          allRows={rows.filter((r) => groupKeyOf(r.t) === g.key)}
          planning={planning}
          writable={writable}
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
        <Typography variant="body2" sx={{ color: 'text.secondary', py: 1 }}>
          {rows.length === 0
            ? (canWrite
              ? `Nothing in Jira with you as PIC covers ${weekTitle(week)} yet. ${planning ? 'Give a task below some dates, or add one.' : 'Add a task below, or give an undated one some dates.'}`
              : `Nothing in Jira with you as PIC covered ${weekTitle(week)}.`)
            : filter === 'todo' ? 'Every task this week has an update. Thank you.' : 'Nothing updated yet this week.'}
        </Typography>
      )}

      {(jw.undated || []).length > 0 && canWrite && (
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }} data-undated>
          <Typography variant="h4">No dates yet</Typography>
          <Typography variant="caption" sx={{ color: 'text.secondary', mt: -0.5 }}>
            Your open Jira tasks with no start or due date. Give one dates to put it in a week.
          </Typography>
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
        </Box>
      )}

      {canWrite && !adding && !addingProject && (
        <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
          <Button startIcon={<AddIcon />} onClick={() => setAdding(true)} sx={focusRingSx}>Add a task</Button>
          <Button startIcon={<AddIcon />} onClick={() => setAddingProject(true)} sx={focusRingSx}>New project</Button>
        </Box>
      )}
      {adding && canWrite && (
        <NewTask
          week={week}
          projects={projects}
          preset={preset}
          writable={jw.writable}
          onCancel={() => { setAdding(false); onPresetUsed?.() }}
          onDone={(task) => {
            setAdding(false)
            onPresetUsed?.()
            setNote({ tone: 'success', text: `${task.key} created in Jira and assigned to you.` })
            onReload?.()
          }}
        />
      )}
      {addingProject && canWrite && (
        <NewProject
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
      )}
    </Box>
  )
}
