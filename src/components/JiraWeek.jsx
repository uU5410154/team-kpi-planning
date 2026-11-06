import { useEffect, useMemo, useState } from 'react'
import {
  Box, Paper, Typography, Button, TextField, Alert, ToggleButton, ToggleButtonGroup, Checkbox, FormControlLabel,
  Autocomplete, CircularProgress, IconButton, Link, MenuItem,
} from '@mui/material'
import AddIcon from '@mui/icons-material/Add'
import CloseIcon from '@mui/icons-material/Close'
import OpenInNewIcon from '@mui/icons-material/OpenInNew'
import EventIcon from '@mui/icons-material/EventOutlined'
import * as api from '../lib/api.js'
import { addWeeks, weekNo, weekTitle } from '../lib/weekly.js'
import AiAssist from './AiAssist.jsx'
import { Pill } from './Brand.jsx'
import { ago } from './FollowUp.jsx'

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
  task, week, overdue, planning, canWrite, writable, aiOn, highlight, onSaved,
}) {
  const u = task.update
  const [progress, setProgress] = useState(u?.progress || '')
  const [done, setDone] = useState(u ? u.done : null)
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
        progress, done, reason, blocker, decision, decisionText, images,
      })
      const j = r.update?.jira || {}
      setImages([])
      setMsg(j.state === 'posted'
        ? { tone: 'success', text: `Submitted and posted to ${task.key} in Jira${j.done ? ` — moved to ${j.done}` : ''}.` }
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
          <Typography variant="caption" sx={{ color: 'text.secondary', display: 'block' }}>
            {projectKey ? `${projectKey} · ` : ''}{project}
          </Typography>
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
          {overdue && <Pill label="Past due" tone="bad" />}
          {task.done && <Pill label="Done in Jira" tone="good" />}
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
          <AiAssist available={aiOn} disabled={!canWrite} field="progress" text={progress} onText={setProgress} />
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
              value={done === null ? null : done ? 'yes' : 'no'}
              onChange={(_e, v) => v && setDone(v === 'yes')}
              disabled={!canWrite}
              aria-label={`finished ${task.key}`}
            >
              <ToggleButton value="yes">Finished</ToggleButton>
              <ToggleButton value="no">Not finished</ToggleButton>
            </ToggleButtonGroup>
            <FormControlLabel
              control={<Checkbox size="small" checked={decision} onChange={(e) => setDecision(e.target.checked)} disabled={!canWrite} />}
              label={<Typography variant="body2" sx={{ color: decision ? 'error.light' : 'text.primary' }}>Decision needed?</Typography>}
            />
          </Box>
          {done === false && (
            <TextField size="small" label="Why isn't it finished?" value={reason} onChange={(e) => setReason(e.target.value)} disabled={!canWrite} multiline maxRows={4} fullWidth />
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
                {writable ? `Posts a comment on ${task.key} in Jira${done ? ' and moves it to Done' : ''}.` : 'Kept here; writing to Jira is switched off on the server.'}
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
            Your Jira tasks ({jw.account}) whose dates fall in {weekTitle(week)}
            {(jw.overdue || []).length ? ', and the ones past due and not done' : ''}.
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
              <Button size="small" onClick={() => onGoWeek(1)} sx={{ alignSelf: 'flex-start' }}>Plan week {weekNo(addWeeks(week, 1))} →</Button>
            </>
          )}
          {canWrite && (planIn
            ? <Typography variant="caption" sx={{ color: 'text.secondary' }}>Plan for week {weekNo(week)} recorded {planInAt ? ago(planInAt) : ''}.</Typography>
            : (
              <Button size="small" variant="outlined" onClick={confirm} disabled={busy} sx={{ alignSelf: 'flex-start' }}>
                My plan for week {weekNo(week)} is set
              </Button>
            ))}
        </Paper>
      </Box>
      {note && <Alert severity={note.tone} sx={{ py: 0 }} onClose={() => setNote(null)}>{note.text}</Alert>}

      {shown.map(({ t, overdue }) => (
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
        />
      ))}
      {shown.length === 0 && (
        <Typography variant="body2" sx={{ color: 'text.secondary', py: 1 }}>
          {rows.length === 0
            ? `No Jira task of yours falls in ${weekTitle(week)}. Add one below, or give an undated one some dates.`
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
