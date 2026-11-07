import { useEffect, useMemo, useState } from 'react'
import {
  Box, Paper, Typography, Button, TextField, Alert, ToggleButton, ToggleButtonGroup, Checkbox, FormControlLabel,
  Autocomplete, CircularProgress, IconButton, Link, MenuItem, Collapse, ButtonBase,
} from '@mui/material'
import AddIcon from '@mui/icons-material/Add'
import CloseIcon from '@mui/icons-material/Close'
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
import { pulseSx } from './pulse.js'
import { mentionsHold } from '../lib/hold.js'

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

const fmt = (d) => (d ? new Date(`${d}T00:00:00Z`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' }) : '—')
const MAX_IMAGES = 3
const MAX_BYTES = 4 * 1024 * 1024

/** The Monday and Friday of a week, as dates for a new task. */
const workdays = (week) => {
  const fri = new Date(`${week}T00:00:00Z`)
  fri.setUTCDate(fri.getUTCDate() + 4)
  return { start: week, due: fri.toISOString().slice(0, 10) }
}

/* ------------------------------------------------------------ one task */

function TaskCard({
  task, week, overdue, planning, canWrite, writable, aiOn, highlight, onSaved, grouped = false,
}) {
  const u = task.update
  const [progress, setProgress] = useState(u?.progress || '')
  const [done, setDone] = useState(u ? u.done : null)
  // On hold: picked by hand, or for them when the update says so ("this
  // project is hold"). A hand-picked choice is never overruled.
  const [hold, setHold] = useState(!!u?.hold)
  const [holdAuto, setHoldAuto] = useState(false)
  const [picked, setPicked] = useState(!!u)
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
  const [reason, setReason] = useState(u?.reason || '')
  const [blocker, setBlocker] = useState(u?.blocker || '')
  const [decision, setDecision] = useState(!!u?.decision)
  const [decisionText, setDecisionText] = useState(u?.decisionText || '')
  const [images, setImages] = useState([])
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState(null)
  const [problems, setProblems] = useState([])
  const [dates, setDates] = useState({ start: task.start || '', due: task.due || '' })

  // A screenshot pasted into the progress box is kept beside it, not in it.
  const onPaste = (e) => {
    const files = [...(e.clipboardData?.items || [])].filter((it) => it.kind === 'file' && it.type.startsWith('image/')).map((it) => it.getAsFile())
    if (!files.length) return
    e.preventDefault()
    for (const f of files) {
      if (f.size > MAX_BYTES) { setMsg({ tone: 'error', text: 'That screenshot is over 4 MB.' }); continue }
      const rd = new FileReader()
      rd.onload = () => setImages((list) => (list.length >= MAX_IMAGES ? list
        : [...list, { name: `${task.key}-${new Date().toISOString().slice(0, 10)}-${list.length + 1}`, data: rd.result }]))
      rd.readAsDataURL(f)
    }
  }

  const submit = async () => {
    setBusy(true)
    setMsg(null)
    setProblems([])
    try {
      const r = await api.submitTaskUpdate(week, task.key, {
        progress, done, hold, reason, blocker, decision, decisionText, images,
      })
      const j = r.update?.jira || {}
      setImages([])
      setMsg(j.state === 'posted'
        ? {
          tone: String(j.hold || '').startsWith('not moved') || String(j.description || '').startsWith('not updated') ? 'warning' : 'success',
          text: `Submitted and posted to ${task.key} in Jira (comment${j.description === 'updated' ? ' and description' : ''})${j.done ? ` — moved to ${j.done}` : ''}${
            j.hold ? (String(j.hold).startsWith('not moved') ? `, but not put on hold: ${j.hold.replace(/^not moved: /, '')}` : ` — status ${j.hold}`) : ''}${
            String(j.description || '').startsWith('not updated') ? `. The description was not changed — ${j.description.replace(/^not updated: /, '')}` : ''}.`,
        }
        : { tone: 'warning', text: `Submitted here, but not posted to Jira: ${j.error || 'writing to Jira is switched off.'}` })
      onSaved?.()
    } catch (e) {
      setMsg({ tone: 'error', text: e.message })
      setProblems(e.problems || [])
    } finally {
      setBusy(false)
    }
  }

  const saveDates = async () => {
    setBusy(true)
    setMsg(null)
    try {
      await api.planJiraTask(task.key, { start: dates.start || null, due: dates.due || null })
      setMsg({ tone: 'success', text: 'Dates written to Jira.' })
      onSaved?.()
    } catch (e) {
      setMsg({ tone: 'error', text: e.message })
    } finally {
      setBusy(false)
    }
  }

  const project = task.project?.summary || task.parent?.summary || 'No project'
  const projectKey = task.project?.key || task.parent?.key || null
  const posted = u?.jira?.state === 'posted'
  return (
    <Paper
      variant="outlined"
      data-jira-task={task.key}
      data-task-project={task.project?.key || undefined}
      sx={{
        p: { xs: 1.5, sm: 2 },
        display: 'flex',
        flexDirection: 'column',
        gap: 1.25,
        boxShadow: highlight ? (th) => `0 0 0 2px ${th.palette.primary.main}` : 'none',
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
            <Link href={task.url} target="_blank" rel="noopener" underline="hover" sx={{ fontWeight: 700, display: 'inline-flex', alignItems: 'center', gap: 0.5 }}>
              {task.key}<OpenInNewIcon sx={{ fontSize: 13 }} />
            </Link>
            <Typography variant="body1" sx={{ fontWeight: 600 }}>{task.summary}</Typography>
          </Box>
          <Typography variant="caption" sx={{ color: 'text.secondary' }}>
            {task.status}{' · '}{fmt(task.start || task.sprintStart)} – {fmt(task.due || task.sprintEnd)}
            {!task.start && !task.due && task.sprintName ? ` (${task.sprintName})` : ''}
          </Typography>
        </Box>
        <Box sx={{ display: 'flex', gap: 0.75, flexWrap: 'wrap', alignItems: 'center' }}>
          {task.epic && <Pill label="Epic" tone="info" title="A project in Jira with you as PIC" />}
          {overdue && <Pill label="Past due" tone="bad" />}
          {task.done && <Pill label="Done in Jira" tone="good" />}
          {!task.done && /hold|paused|suspended|parked/i.test(task.status || '') && <Pill label="On hold in Jira" tone="warn" />}
          {u && <Pill label={`Updated ${ago(u.submittedAt)}`} tone={posted ? 'info' : 'warn'} title={posted ? 'Posted to Jira' : (u.jira?.error || 'Not posted to Jira')} />}
        </Box>
      </Box>

      {planning ? (
        <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap', alignItems: 'center' }}>
          <TextField size="small" type="date" label="Start" value={dates.start} onChange={(e) => setDates((d) => ({ ...d, start: e.target.value }))} InputLabelProps={{ shrink: true }} disabled={!canWrite} />
          <TextField size="small" type="date" label="Due" value={dates.due} onChange={(e) => setDates((d) => ({ ...d, due: e.target.value }))} InputLabelProps={{ shrink: true }} disabled={!canWrite} />
          {canWrite && (
            <Button size="small" variant="outlined" onClick={saveDates} disabled={busy || !writable || (dates.start === (task.start || '') && dates.due === (task.due || ''))}>
              Save dates
            </Button>
          )}
        </Box>
      ) : (
        <>
          <TextField
            label="This week's progress"
            value={progress}
            onChange={(e) => setProgress(e.target.value)}
            onPaste={onPaste}
            disabled={!canWrite}
            multiline
            minRows={2}
            maxRows={10}
            fullWidth
            helperText={canWrite ? 'What you did on it. Links are fine; paste a screenshot straight in.' : undefined}
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
          {images.length > 0 && (
            <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
              {images.map((im, i) => (
                <Box key={im.name} sx={{ position: 'relative', border: 1, borderColor: 'divider', borderRadius: 1.5, overflow: 'hidden' }}>
                  <Box component="img" src={im.data} alt={`screenshot ${i + 1}`} sx={{ display: 'block', height: 72, maxWidth: 160, objectFit: 'cover' }} />
                  <IconButton size="small" aria-label={`remove screenshot ${i + 1}`} onClick={() => setImages((l) => l.filter((_x, j) => j !== i))} sx={{ position: 'absolute', top: 2, right: 2, bgcolor: 'rgba(0,0,0,.55)', p: 0.25 }}>
                    <CloseIcon sx={{ fontSize: 14, color: '#fff' }} />
                  </IconButton>
                </Box>
              ))}
            </Box>
          )}
          {u?.attachments?.length > 0 && (
            <Typography variant="caption" sx={{ color: 'text.secondary' }}>Already attached in Jira: {u.attachments.join(', ')}</Typography>
          )}

          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, flexWrap: 'wrap' }}>
            <ToggleButtonGroup
              size="small"
              exclusive
              value={hold ? 'hold' : done === null ? null : done ? 'yes' : 'no'}
              onChange={(_e, v) => v && choose(v)}
              disabled={!canWrite}
              aria-label={`finished ${task.key}`}
            >
              <ToggleButton value="yes">Finished</ToggleButton>
              <ToggleButton value="no">Not finished</ToggleButton>
              <ToggleButton value="hold">On hold</ToggleButton>
            </ToggleButtonGroup>
            <FormControlLabel
              control={<Checkbox size="small" checked={decision} onChange={(e) => setDecision(e.target.checked)} disabled={!canWrite} />}
              label={<Typography variant="body2" sx={{ color: decision ? 'error.light' : 'text.primary' }}>Decision needed?</Typography>}
            />
          </Box>
          {hold && canWrite && (
            <Typography variant="caption" sx={{ color: 'warning.light', mt: -0.5 }} data-hold-note>
              {holdAuto ? 'Your update says it is on hold, so On hold is picked. ' : ''}
              Submit moves {task.key} to its Hold status in Jira.
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
            />
          )}
          <TextField size="small" label="Blocker (optional)" value={blocker} onChange={(e) => setBlocker(e.target.value)} disabled={!canWrite} multiline maxRows={4} fullWidth />
          {decision && (
            <TextField size="small" label="What decision is needed, and from whom?" value={decisionText} onChange={(e) => setDecisionText(e.target.value)} disabled={!canWrite} multiline maxRows={4} fullWidth />
          )}
          {canWrite && (
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, flexWrap: 'wrap' }}>
              <Button variant="contained" onClick={submit} disabled={busy} startIcon={busy ? <CircularProgress size={14} /> : null} aria-label={`submit ${task.key}`}>
                {u ? 'Submit again' : 'Submit'}
              </Button>
              <Typography variant="caption" sx={{ color: 'text.secondary' }}>
                {writable ? `Posts to ${task.key} in Jira — a comment, and a dated entry added to its description${done ? '; moves it to Done' : hold ? '; puts it on hold' : ''}.` : 'Kept here; writing to Jira is switched off on the server.'}
              </Typography>
            </Box>
          )}
        </>
      )}
      {problems.length > 0 && (
        <Alert severity="warning" sx={{ py: 0 }}>
          <Box component="ul" sx={{ m: 0, pl: 2 }}>{problems.map((p) => <li key={p}>{p}</li>)}</Box>
        </Alert>
      )}
      {msg && <Alert severity={msg.tone} sx={{ py: 0 }} onClose={() => setMsg(null)}>{msg.text}</Alert>}
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
        <Button variant="contained" onClick={create} disabled={busy || !writable || !project || summary.trim().length < 3}>
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
        <Button variant="contained" onClick={create} disabled={busy || !writable || summary.trim().length < 3}>
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
 * under it, so it is plain which project each update is for. The header says how many of its tasks still need an update,
 * and folds the project away once it is done with.
 */
function ProjectGroup({
  name, projectKey, rows, planning, children,
}) {
  const left = rows.filter(({ t }) => !t.update).length
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
          ? <Pill label={`${rows.length} task${rows.length === 1 ? '' : 's'}`} tone="neutral" />
          : left
            ? <Pill label={`${left} to update`} tone="warn" />
            : <Pill label="All updated" tone="good" />}
        <ExpandMoreIcon sx={{ color: 'text.secondary', transition: 'transform .2s', transform: open ? 'rotate(180deg)' : 'none', flexShrink: 0 }} />
      </ButtonBase>
      <Collapse in={open} unmountOnExit={false}>
        <Box data-project-body sx={{ display: 'flex', flexDirection: 'column', gap: 1.25, p: { xs: 1, sm: 1.5 } }}>{children}</Box>
      </Collapse>
    </Box>
  )
}

/* ------------------------------------------------------------ the week */

export default function JiraWeek({
  week, current, canWrite, jw, onReload, projects, preset, onPresetUsed, focusKey, aiOn, planIn, planInAt, onGoWeek, onPlanned, onProjectAdded,
}) {
  const [filter, setFilter] = useState('todo')
  const [adding, setAdding] = useState(false)
  const [addingProject, setAddingProject] = useState(false)
  const [note, setNote] = useState(null)
  const [busy, setBusy] = useState(false)
  useEffect(() => { if (preset) { setAdding(true) } }, [preset])

  const planning = week > current
  const rows = useMemo(() => [
    ...(jw.overdue || []).map((t) => ({ t, overdue: true })),
    ...(jw.tasks || []).map((t) => ({ t, overdue: false })),
  ], [jw])
  const isUpdated = (t) => !!t.update
  const todo = rows.filter((r) => !isUpdated(r.t))
  const doneRows = rows.filter((r) => isUpdated(r.t))
  const shown = planning ? rows : filter === 'todo' ? todo : filter === 'done' ? doneRows : rows
  // The tasks under their projects, in the order the projects first appear —
  // so a project with a task past due comes first.
  const groups = useMemo(() => {
    const by = new Map()
    for (const r of shown) {
      const key = r.t.project?.key || r.t.parent?.key || (r.t.epic ? r.t.key : '')
      if (!by.has(key)) by.set(key, { key, name: r.t.project?.summary || r.t.parent?.summary || 'No project', rows: [] })
      by.get(key).rows.push(r)
    }
    // The project's own epic first, then its tasks.
    for (const g of by.values()) g.rows.sort((a, b) => Number(!!b.t.epic) - Number(!!a.t.epic))
    return [...by.values()]
  }, [shown])

  const confirm = async () => {
    setBusy(true)
    setNote(null)
    try {
      const r = await api.confirmJiraPlan(week)
      setNote({ tone: 'success', text: `Plan for ${weekTitle(week)} recorded: ${r.planned} task${r.planned === 1 ? '' : 's'}.` })
      onPlanned?.()
    } catch (e) {
      setNote({ tone: 'error', text: e.message })
    } finally {
      setBusy(false)
    }
  }

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
            <ToggleButtonGroup size="small" exclusive value={filter} onChange={(_e, v) => v && setFilter(v)} aria-label="which tasks">
              <ToggleButton value="todo">Not updated yet ({todo.length})</ToggleButton>
              <ToggleButton value="done">Already updated ({doneRows.length})</ToggleButton>
              <ToggleButton value="all">All ({rows.length})</ToggleButton>
            </ToggleButtonGroup>
          )}
          <Typography variant="caption" sx={{ color: 'text.secondary' }}>
            The Jira epics and tasks with you ({jw.account}) as PIC whose timeline covers {weekTitle(week)}.
          </Typography>
        </Box>
        <Paper variant="outlined" sx={{ p: 1.5, minWidth: 240, maxWidth: { sm: 340 }, display: 'flex', flexDirection: 'column', gap: 0.75 }}>
          {planning ? (
            <>
              <Typography variant="body2" sx={{ fontWeight: 700, display: 'flex', alignItems: 'center', gap: 0.75 }}><EventIcon fontSize="small" /> Planning week {weekNo(week)}</Typography>
              <Typography variant="caption" sx={{ color: 'text.secondary' }}>
                Set dates on your Jira tasks so they fall in this week, or add new ones. Then confirm.
              </Typography>
            </>
          ) : (
            <>
              <Typography variant="body2" sx={{ fontWeight: 700, color: 'warning.light', display: 'flex', alignItems: 'center', gap: 0.75 }}>
                <EventIcon fontSize="small" /> Don&rsquo;t forget next week&rsquo;s plan
              </Typography>
              <Typography variant="caption" sx={{ color: 'text.secondary' }}>
                Week {weekNo(addWeeks(week, 1))}: set dates on the Jira tasks you will work on, before Monday 08:00.
              </Typography>
              <Button
                size="small"
                variant={todo.length === 0 && week === current ? 'contained' : 'text'}
                onClick={() => onGoWeek(1)}
                sx={[{ alignSelf: 'flex-start' }, todo.length === 0 && week === current && pulseSx]}
              >
                Plan week {weekNo(addWeeks(week, 1))} →
              </Button>
            </>
          )}
          {canWrite && (planIn
            ? <Typography variant="caption" sx={{ color: 'text.secondary' }}>Plan for week {weekNo(week)} recorded {planInAt ? ago(planInAt) : ''}.</Typography>
            : (
              <Button size="small" variant={planning ? 'contained' : 'outlined'} onClick={confirm} disabled={busy} sx={[{ alignSelf: 'flex-start' }, planning && pulseSx]}>
                My plan for week {weekNo(week)} is set
              </Button>
            ))}
        </Paper>
      </Box>
      {note && <Alert severity={note.tone} sx={{ py: 0 }} onClose={() => setNote(null)}>{note.text}</Alert>}

      {groups.map((g) => (
        <ProjectGroup key={g.key || 'none'} name={g.name} projectKey={g.key} rows={g.rows} planning={planning}>
          {g.rows.map(({ t, overdue }) => (
            <TaskCard
              key={`${t.key}:${t.update?.submittedAt || ''}`}
              task={t}
              week={week}
              overdue={overdue}
              planning={planning}
              canWrite={canWrite}
              writable={jw.writable}
              aiOn={aiOn}
              highlight={!!focusKey && t.project?.key === focusKey}
              onSaved={onReload}
              grouped
            />
          ))}
        </ProjectGroup>
      ))}
      {shown.length === 0 && (
        <Typography variant="body2" sx={{ color: 'text.secondary', py: 1 }}>
          {rows.length === 0
            ? `Nothing in Jira with you as PIC covers ${weekTitle(week)}. Add a task below, or give an undated one some dates.`
            : filter === 'todo' ? 'Every task this week has an update. Thank you.' : 'Nothing updated yet this week.'}
        </Typography>
      )}

      {(jw.undated || []).length > 0 && canWrite && (
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
          <Typography variant="h4">No dates yet</Typography>
          <Typography variant="caption" sx={{ color: 'text.secondary', mt: -0.5 }}>
            Your open Jira tasks with no start or due date. Give one dates to put it in a week.
          </Typography>
          {jw.undated.map((t) => (
            <TaskCard key={t.key} task={t} week={week} planning canWrite={canWrite} writable={jw.writable} onSaved={onReload} />
          ))}
        </Box>
      )}

      {canWrite && !adding && !addingProject && (
        <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
          <Button startIcon={<AddIcon />} onClick={() => setAdding(true)}>Add a task</Button>
          <Button startIcon={<AddIcon />} onClick={() => setAddingProject(true)}>New project</Button>
        </Box>
      )}
      {adding && (
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
      {addingProject && (
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
