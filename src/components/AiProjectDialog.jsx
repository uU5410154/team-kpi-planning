import { useEffect, useState } from 'react'
import {
  Dialog, DialogTitle, DialogContent, DialogActions, Box, Button, TextField, MenuItem, Typography,
  Alert, CircularProgress, Autocomplete,
} from '@mui/material'
import AutoAwesomeIcon from '@mui/icons-material/AutoAwesomeOutlined'
import * as api from '../lib/api.js'
import { friendlyAiError, AI_DOWN } from './AiAssist.jsx'

/*
 * A NEW PROJECT WITH THE LOTUS LLM (owner, 2026-11-24).
 *
 * Two steps in one dialog. First the person describes the project in their
 * own words, Thai or English; the Lotus LLM turns that into the form. Then
 * they check every field — what the words did not say is marked — and press
 * Create. Nothing is created before that click.
 *
 *   member  the Jira epic (Adhoc work or Change Request) and the register
 *           row, with them as PIC, written by the server — as the weekly
 *           page's own "New project" does.
 *   admin   the Jira epic, assigned to the PIC, then the register row added
 *           to the plan the page holds open (`onAddRow`), saved by its
 *           autosave. With Jira writes off, the register row alone, and the
 *           dialog says so before anything is pressed.
 *
 * With the AI off, the form opens empty to be filled in by hand.
 */

const EMPTY = {
  kind: '', summary: '', pic: '', team: '', subTeam: '', objective: '', start: '', due: '', savingHours: '', description: '',
}
const LABEL = {
  summary: 'project name', pic: 'PIC', team: 'team', objective: 'objective', start: 'start date', due: 'due date', savingHours: 'saving hours',
}
const EXAMPLE = 'e.g. Automate AP invoice matching for Non-Trade. Gun leads it, December to February. It should save about 40 hours a month for the AP team.'

export default function AiProjectDialog({
  open, onClose, mode = 'member', jira = null, onAddRow, onDone,
}) {
  const admin = mode === 'admin'
  const [aiOn, setAiOn] = useState(null)
  const [text, setText] = useState('')
  const [step, setStep] = useState('describe') // describe | review
  const [form, setForm] = useState(EMPTY)
  const [options, setOptions] = useState(null)
  const [missing, setMissing] = useState([])
  const [busy, setBusy] = useState(null) // 'draft' | 'create'
  const [error, setError] = useState(null)
  const [jiraSt, setJiraSt] = useState(jira)

  // Fresh each time it opens.
  useEffect(() => {
    if (!open) return undefined
    let dead = false
    setText(''); setStep('describe'); setForm(EMPTY); setMissing([]); setError(null); setBusy(null)
    api.aiStatus().then((s) => { if (!dead) setAiOn(!!s?.configured) }).catch(() => { if (!dead) setAiOn(false) })
    if (!jira) api.jiraStatus().then((s) => { if (!dead) setJiraSt(s) }).catch(() => { if (!dead) setJiraSt({ configured: false }) })
    else setJiraSt(jira)
    return () => { dead = true }
  }, [open])

  const jiraWrites = !!(jiraSt?.configured && jiraSt?.writable)
  // A member's project is always a Jira epic: without Jira writes there is nothing to create.
  const memberBlocked = !admin && jiraSt && !jiraWrites

  const fill = (draft, opts, miss) => {
    setOptions(opts)
    setForm({
      ...EMPTY,
      ...Object.fromEntries(Object.entries(draft || {}).map(([k, v]) => [k, v == null ? '' : String(v)])),
      kind: draft?.kind || (admin ? 'project' : 'adhoc'),
    })
    setMissing(miss || [])
    setStep('review')
  }

  const runDraft = async () => {
    setBusy('draft'); setError(null)
    try {
      const r = await api.aiProjectDraft(text)
      fill(r.draft, r.options, r.missing)
    } catch (e) {
      const m = friendlyAiError(e.message)
      setError(m === AI_DOWN ? 'The Lotus LLM is not available right now. Try again, or use “Fill in by hand”.' : m.replace(' Your text is unchanged.', ''))
    } finally {
      setBusy(null)
    }
  }
  const byHand = async () => {
    setBusy('draft'); setError(null)
    try {
      const r = await api.projectFormOptions()
      fill({ kind: admin ? 'project' : 'adhoc', description: text.trim() }, r.options, [])
    } catch (e) {
      setError(e.message)
    } finally {
      setBusy(null)
    }
  }

  const set = (k) => (e) => { const v = e?.target ? e.target.value : e; setForm((f) => ({ ...f, [k]: v ?? '' })); setMissing((m) => m.filter((x) => x !== k)) }
  const subsOf = options?.teams.find((t) => t.team === form.team)?.subs || []
  const problems = [
    form.summary.trim().length < 3 && 'Name the project.',
    admin && !form.pic && 'Pick the PIC.',
    (!form.start || !form.due) && 'Give a start date and a due date.',
    form.start && form.due && form.start > form.due && 'The start date is after the due date.',
    form.savingHours !== '' && !(Number(form.savingHours) >= 0) && 'Saving hours must be a number.',
  ].filter(Boolean)

  const create = async () => {
    setBusy('create'); setError(null)
    const body = {
      summary: form.summary.trim(), kind: form.kind, start: form.start, due: form.due, description: form.description.trim(),
      team: form.team || undefined, subTeam: form.subTeam || undefined, objective: form.objective || undefined,
      savingHours: form.savingHours === '' ? null : Number(form.savingHours),
    }
    try {
      if (!admin) {
        onDone?.(await api.newJiraProject(body))
        return
      }
      let epic = null
      let warning = null
      if (jiraWrites) {
        const r = await api.newJiraEpic({ ...body, pic: form.pic })
        epic = r.epic
        warning = r.warning || null
      }
      const kindName = options?.kinds.find((k) => k.id === form.kind)?.name || ''
      const picNick = options?.people.find((p) => p.id === form.pic)?.nick || form.pic
      const row = {
        summary: body.summary,
        jiraKey: epic?.key || null,
        kind: form.kind,
        program: form.kind === 'project' ? '' : kindName,
        pic: form.pic,
        team: form.team || 'Accounting',
        subTeam: form.subTeam || '',
        objective: form.objective || 'process_automation',
        savingHours: body.savingHours,
        savingEstimated: true,
        start: form.start,
        due: form.due,
        baselineDue: form.due,
        comment: [
          body.description,
          `Added with the Lotus LLM${epic ? ` as ${epic.key}` : ''}, PIC ${picNick}.`,
        ].filter(Boolean).join('\n'),
      }
      const made = onAddRow?.(row)
      onDone?.({ epic, warning, project: Array.isArray(made) ? made[0] : made })
    } catch (e) {
      setError(e.message)
    } finally {
      setBusy(null)
    }
  }

  const flag = (k) => (missing.includes(k)
    ? { helperText: 'Not in the description — please check', FormHelperTextProps: { sx: { color: 'warning.main' }, 'data-missing': k } }
    : {})
  const dense = { size: 'small', fullWidth: true }

  return (
    <Dialog open={open} onClose={busy ? undefined : onClose} fullWidth maxWidth="md" aria-labelledby="ai-project-title" data-ai-project>
      <DialogTitle id="ai-project-title" sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
        <AutoAwesomeIcon sx={{ color: 'primary.main' }} />
        New project with Lotus LLM
      </DialogTitle>
      <DialogContent sx={{ display: 'flex', flexDirection: 'column', gap: 1.5, pt: '4px !important' }}>
        {memberBlocked && (
          <Alert severity="warning" sx={{ py: 0 }}>Writing to Jira is switched off on this server, so a project cannot be created yet. An administrator can turn it on (JIRA_ALLOW_WRITES).</Alert>
        )}
        {admin && jiraSt && !jiraWrites && (
          <Alert severity="info" sx={{ py: 0 }} data-ai-project-nojira>Jira writing is off, so this adds the register row only — no Jira epic. Link it later with “Find new epics”.</Alert>
        )}

        {step === 'describe' ? (
          <>
            <Typography variant="body2" sx={{ color: 'text.secondary' }}>
              Describe the project in your own words, Thai or English: what it is, who it is for, {admin ? 'who leads it, ' : ''}when it runs, and what it saves.
              The Lotus LLM fills in the form; you check it before anything is created.
            </Typography>
            <TextField
              autoFocus multiline minRows={4} maxRows={10} fullWidth
              label="Describe the project" placeholder={EXAMPLE}
              value={text} onChange={(e) => setText(e.target.value)}
              inputProps={{ 'data-ai-project-text': true, maxLength: 3000 }}
              onKeyDown={(e) => { if ((e.metaKey || e.ctrlKey) && e.key === 'Enter' && aiOn && text.trim().length >= 8) runDraft() }}
            />
            {aiOn === false && (
              <Alert severity="info" sx={{ py: 0 }}>The Lotus LLM is not available right now. Fill the form in yourself.</Alert>
            )}
          </>
        ) : (
          <>
            {missing.length > 0 && (
              <Alert severity="warning" sx={{ py: 0 }} data-ai-project-missing>
                Not clear from the description: {missing.map((k) => LABEL[k] || k).join(', ')}. Fill {missing.length === 1 ? 'it' : 'them'} in below.
              </Alert>
            )}
            <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: '180px 1fr' }, gap: 1.5 }}>
              <TextField {...dense} select label="Type" value={form.kind} onChange={set('kind')} inputProps={{ 'data-field': 'kind' }}>
                {(options?.kinds || []).map((k) => <MenuItem key={k.id} value={k.id}>{k.name}</MenuItem>)}
              </TextField>
              <TextField {...dense} label="Project name" value={form.summary} onChange={set('summary')} {...flag('summary')} inputProps={{ 'data-field': 'summary', maxLength: 250 }} />
            </Box>
            <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr 1fr' }, gap: 1.5 }}>
              <TextField
                {...dense} select label="PIC" value={form.pic} onChange={set('pic')} disabled={!admin} {...(admin ? flag('pic') : {})}
                helperText={admin ? flag('pic').helperText : 'You — the project is yours'} inputProps={{ 'data-field': 'pic' }}
              >
                {(options?.people || []).map((p) => <MenuItem key={p.id} value={p.id}>{p.nick}{p.name && p.name !== p.nick ? ` — ${p.name}` : ''}</MenuItem>)}
              </TextField>
              <TextField {...dense} select label="Team" value={form.team} onChange={(e) => { set('team')(e); setForm((f) => ({ ...f, subTeam: '' })) }} {...flag('team')} inputProps={{ 'data-field': 'team' }}>
                <MenuItem value=""><em>Not set</em></MenuItem>
                {(options?.teams || []).map((t) => <MenuItem key={t.team} value={t.team}>{t.team}</MenuItem>)}
              </TextField>
              <Autocomplete
                freeSolo options={subsOf} value={form.subTeam} inputValue={form.subTeam}
                onInputChange={(_e, v) => setForm((f) => ({ ...f, subTeam: v || '' }))}
                renderInput={(params) => <TextField {...params} size="small" label="Sub team" inputProps={{ ...params.inputProps, 'data-field': 'subTeam' }} />}
              />
            </Box>
            <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr 1fr', sm: '1fr 1fr 1fr 1fr' }, gap: 1.5 }}>
              <TextField {...dense} type="date" label="Start" value={form.start} onChange={set('start')} InputLabelProps={{ shrink: true }} {...flag('start')} inputProps={{ 'data-field': 'start' }} />
              <TextField {...dense} type="date" label="Due" value={form.due} onChange={set('due')} InputLabelProps={{ shrink: true }} {...flag('due')} inputProps={{ 'data-field': 'due' }} />
              <TextField
                {...dense} select label="Objective" value={form.objective} onChange={set('objective')} {...flag('objective')}
                sx={{ gridColumn: { xs: '1 / -1', sm: 'auto' } }} inputProps={{ 'data-field': 'objective' }}
              >
                <MenuItem value=""><em>Not set</em></MenuItem>
                {(options?.objectives || []).map((o) => <MenuItem key={o.id} value={o.id}>{o.name}</MenuItem>)}
              </TextField>
              <TextField
                {...dense} type="number" label="Saving hrs / month" value={form.savingHours} onChange={set('savingHours')}
                {...(missing.includes('savingHours') ? { helperText: admin ? 'Not stated — leave empty if unknown' : 'Your estimate; an administrator sizes it' } : { helperText: admin ? 'An estimate until sized' : 'Your estimate; an administrator sizes it' })}
                sx={{ gridColumn: { xs: '1 / -1', sm: 'auto' } }} inputProps={{ 'data-field': 'savingHours', min: 0, step: 1 }}
              />
            </Box>
            <TextField {...dense} multiline minRows={3} maxRows={8} label="Description" value={form.description} onChange={set('description')} inputProps={{ 'data-field': 'description', maxLength: 4000 }} />
            <Typography variant="caption" sx={{ color: 'text.secondary' }}>
              {admin
                ? (jiraWrites ? 'Creates the epic in Jira, assigned to the PIC, and adds it to the register as Watch until you commit it.' : 'Adds it to the register as Watch until you commit it.')
                : 'Creates the epic in Jira, assigned to you, and adds it to the register with you as PIC. An administrator sizes it later.'}
            </Typography>
          </>
        )}
        {error && <Alert severity="error" sx={{ py: 0 }} data-ai-project-error>{error}</Alert>}
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 2, flexWrap: 'wrap', gap: 1 }}>
        {step === 'describe' ? (
          <>
            <Button onClick={byHand} disabled={!!busy} data-ai-project-byhand>Fill in by hand</Button>
            <Box sx={{ flex: 1 }} />
            <Button onClick={onClose} disabled={!!busy}>Cancel</Button>
            <Button
              variant="contained" onClick={runDraft} data-ai-project-draft
              disabled={!!busy || !aiOn || text.trim().length < 8}
              startIcon={busy === 'draft' ? <CircularProgress size={14} color="inherit" /> : <AutoAwesomeIcon />}
            >
              {busy === 'draft' ? 'Filling in the form…' : 'Fill in the form'}
            </Button>
          </>
        ) : (
          <>
            <Button onClick={() => { setStep('describe'); setError(null) }} disabled={!!busy} data-ai-project-back>Back to the description</Button>
            <Box sx={{ flex: 1 }} />
            {problems.length > 0 && <Typography variant="caption" sx={{ color: 'text.secondary' }} data-ai-project-problems>{problems[0]}</Typography>}
            <Button onClick={onClose} disabled={!!busy}>Cancel</Button>
            <Button
              variant="contained" onClick={create} data-ai-project-create
              disabled={!!busy || problems.length > 0 || memberBlocked}
              startIcon={busy === 'create' ? <CircularProgress size={14} color="inherit" /> : null}
            >
              {busy === 'create' ? 'Creating…' : admin && !jiraWrites ? 'Add to the register' : 'Create project'}
            </Button>
          </>
        )}
      </DialogActions>
    </Dialog>
  )
}
