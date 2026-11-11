import { useEffect, useState } from 'react'
import * as api from '../lib/api.js'
import { timelineOf, todayISO } from '../lib/model.js'
import { C, FONT, statusStyle, deckDate } from './theme.js'
import { deckStatus } from './templates.js'

/*
 * ONE PROJECT, OPENED FROM A SLIDE.
 *
 * Clicking a card, a roadmap row or a task while presenting opens this over
 * the slide: where the project stands against its plan, what the team wrote
 * about it in the last weeks, what is in its way, and its tasks in Jira. In
 * the deck's own light colours, so it reads as part of the presentation.
 */

const pill = (status) => {
  const s = statusStyle(status)
  return (
    <span style={{
      display: 'inline-block', padding: '3px 12px', borderRadius: 999, background: s.fill, color: s.text, border: `1px solid ${s.border}`,
      fontWeight: 700, fontSize: 12, letterSpacing: 0.3, whiteSpace: 'nowrap',
    }}
    >
      {status}
    </span>
  )
}

const H3 = ({ children }) => <div style={{ fontSize: 11, fontWeight: 700, color: C.blue, letterSpacing: 0.8, textTransform: 'uppercase', margin: '18px 0 8px' }}>{children}</div>

function PlanBar({ p }) {
  const t = timelineOf(p, todayISO())
  const a = t.plannedStart
  const b = t.adjustedEnd || t.plannedEnd
  const end = t.actualEnd || (t.running ? todayISO() : null)
  const dates = [a, b, t.actualStart, end].filter(Boolean).sort()
  if (dates.length < 2) return <div style={{ color: C.muted, fontSize: 13 }}>No dates planned yet.</div>
  const lo = Date.parse(dates[0])
  const hi = Date.parse(dates[dates.length - 1])
  const pos = (d) => `${((Date.parse(d) - lo) / Math.max(1, hi - lo)) * 100}%`
  const width = (x, y) => `${Math.max(1, ((Date.parse(y) - Date.parse(x)) / Math.max(1, hi - lo)) * 100)}%`
  const late = t.lateBy != null && t.lateBy > 0
  return (
    <div>
      <div style={{ position: 'relative', height: 44, margin: '6px 0 4px' }}>
        {a && t.plannedEnd && (
          <div title="Plan" style={{ position: 'absolute', left: pos(a), width: width(a, t.plannedEnd), top: 4, height: 14, border: `2px solid ${C.navy}`, borderRadius: 4, boxSizing: 'border-box' }} />
        )}
        {t.adjustedEnd && (
          <div title="Moved by another team" style={{ position: 'absolute', left: pos(t.plannedEnd), width: width(t.plannedEnd, t.adjustedEnd), top: 9, height: 4, background: '#C9921F', borderRadius: 2 }} />
        )}
        {t.actualStart && end && (
          <div title="Actual" style={{ position: 'absolute', left: pos(t.actualStart), width: width(t.actualStart, end), top: 24, height: 14, background: t.running ? '#3F6FD8' : late ? '#D64545' : '#1F9D3A', borderRadius: 4 }} />
        )}
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, color: C.muted }}>
        <span>{deckDate(dates[0])}</span>
        <span>
          Plan {deckDate(a)} → {deckDate(t.plannedEnd)}
          {t.adjustedEnd ? ` · now ${deckDate(t.adjustedEnd)}` : ''}
          {t.lateBy != null ? ` · ${t.lateBy > 0 ? `+${t.lateBy}d late` : t.lateBy < 0 ? `${t.lateBy}d early` : 'on time'}` : ''}
        </span>
        <span>{deckDate(dates[dates.length - 1])}</span>
      </div>
    </div>
  )
}

export default function ProjectDrill({ projectKey, project, onClose }) {
  const [facts, setFacts] = useState(null)
  const [error, setError] = useState(null)
  const [tasks, setTasks] = useState(null)
  // The plan's project, with the server's names for people ("James", not "james").
  const p = project ? { ...project, pic: facts?.project?.pic || project.pic } : (facts?.project || null)

  useEffect(() => {
    let stop = false
    api.deckProject(projectKey).then((r) => { if (!stop) setFacts(r) }).catch((e) => { if (!stop) setError(api.plainError(e)) })
    return () => { stop = true }
  }, [projectKey])

  useEffect(() => {
    const jk = p?.jiraKey
    if (!jk) return undefined
    let stop = false
    api.jiraChildren([jk]).then((r) => { if (!stop) setTasks((r.byParent && r.byParent[String(jk).toUpperCase()]) || []) }).catch(() => { if (!stop) setTasks([]) })
    return () => { stop = true }
  }, [p?.jiraKey])

  useEffect(() => {
    const k = (e) => { if (e.key === 'Escape') { e.stopPropagation(); onClose() } }
    window.addEventListener('keydown', k, true)
    return () => window.removeEventListener('keydown', k, true)
  }, [onClose])

  const weeks = []
  for (const h of facts?.history || []) {
    let w = weeks.find((x) => x.week === h.week)
    if (!w) { w = { week: h.week, items: [] }; weeks.push(w) }
    w.items.push(h)
  }

  return (
    <div
      onClick={onClose}
      style={{ position: 'fixed', inset: 0, background: 'rgba(7,20,45,0.55)', zIndex: 2000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}
    >
      <div
        role="dialog"
        aria-label={p?.summary || projectKey}
        onClick={(e) => e.stopPropagation()}
        style={{
          width: 'min(980px, 96vw)', maxHeight: '90vh', overflow: 'auto', background: '#fff', borderRadius: 12, fontFamily: FONT, color: C.ink,
          boxShadow: '0 20px 60px rgba(0,0,0,0.35)',
        }}
      >
        <div style={{ background: C.blue, color: '#fff', padding: '18px 24px', display: 'flex', alignItems: 'center', gap: 16, position: 'sticky', top: 0 }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 22, fontWeight: 700, lineHeight: 1.2 }}>{p?.summary || projectKey}</div>
            <div style={{ fontSize: 13, opacity: 0.9, marginTop: 4 }}>
              {[projectKey, p?.team, p?.program, p?.pic && `PIC ${p.pic}`].filter(Boolean).join(' · ')}
            </div>
          </div>
          {p && pill(deckStatus(p))}
          <button type="button" onClick={onClose} aria-label="close" style={{ background: 'transparent', border: 0, color: '#fff', fontSize: 26, cursor: 'pointer', lineHeight: 1 }}>×</button>
        </div>

        <div style={{ padding: '8px 24px 24px' }}>
          {error && <div style={{ color: '#B42318', margin: '12px 0' }}>{error}</div>}
          {p && (
            <>
              <H3>Plan and actual</H3>
              <PlanBar p={p} />
              <div style={{ display: 'flex', gap: 24, marginTop: 14, flexWrap: 'wrap', fontSize: 13 }}>
                {Number(p.savingHours) > 0 && <div><b style={{ fontSize: 20, color: C.navy }}>{Math.round(p.savingHours).toLocaleString('en-US')}</b> hours saved a month</div>}
                {Number(p.tasksTotal) > 0 && <div><b style={{ fontSize: 20, color: C.navy }}>{p.tasksDone || 0}/{p.tasksTotal}</b> Jira tasks done</div>}
                {p.adjustedCause && <div style={{ color: '#8A6212' }}>Moved by another team: {p.adjustedCause}</div>}
              </div>
            </>
          )}

          {!!facts?.blockers?.length && (
            <>
              <H3>In the way now</H3>
              {facts.blockers.map((b, i) => (
                <div key={i} style={{ background: '#FDECEC', border: '1px solid #F0A9A9', borderRadius: 8, padding: '8px 12px', marginBottom: 6, fontSize: 14 }}>
                  <b>{b.title}</b> — {b.blocker}
                  <span style={{ color: C.muted, fontSize: 12 }}> · {b.nick}{b.newDate ? ` · new date ${deckDate(b.newDate)}` : ''}</span>
                </div>
              ))}
            </>
          )}

          <H3>Weekly updates</H3>
          {!facts && !error && <div style={{ color: C.muted, fontSize: 14 }}>Loading…</div>}
          {facts && !weeks.length && <div style={{ color: C.muted, fontSize: 14 }}>No weekly updates on this project in the last eight weeks.</div>}
          {weeks.slice(0, 4).map((w) => (
            <div key={w.week} style={{ marginBottom: 12 }}>
              <div style={{ fontSize: 12, fontWeight: 700, color: C.muted, marginBottom: 4 }}>Week of {deckDate(w.week)}</div>
              {w.items.map((h, i) => (
                <div key={i} style={{ display: 'flex', gap: 10, alignItems: 'baseline', padding: '5px 0', borderBottom: '1px solid #EEF2F7', fontSize: 14 }}>
                  <span style={{
                    fontSize: 11, fontWeight: 700, padding: '1px 8px', borderRadius: 999, whiteSpace: 'nowrap',
                    background: h.done === true ? '#E9F8EF' : h.hold ? '#EEF1F5' : h.done === false ? '#FFF4DB' : '#EEF4FC',
                    color: h.done === true ? '#247A37' : h.hold ? '#5B6B80' : h.done === false ? '#8A6212' : '#2A4D88',
                  }}
                  >
                    {h.done === true ? 'Done' : h.hold ? 'On hold' : h.done === false ? 'Not done' : 'Planned'}
                  </span>
                  <div style={{ flex: 1 }}>
                    <b>{h.title}</b>
                    {h.progress && <div style={{ color: '#3B4A5E', marginTop: 2 }}>{h.progress}</div>}
                    {h.blocker && h.done === false && <div style={{ color: '#B42318', marginTop: 2 }}>Blocked: {h.blocker}</div>}
                  </div>
                  <span style={{ color: C.muted, fontSize: 12, whiteSpace: 'nowrap' }}>{h.nick}</span>
                </div>
              ))}
            </div>
          ))}

          {p?.jiraKey && (
            <>
              <H3>Tasks in Jira</H3>
              {tasks == null && <div style={{ color: C.muted, fontSize: 14 }}>Loading…</div>}
              {tasks && !tasks.length && <div style={{ color: C.muted, fontSize: 14 }}>No tasks under {p.jiraKey}.</div>}
              {tasks && tasks.slice(0, 20).map((t) => (
                <div key={t.key} style={{ display: 'flex', gap: 10, padding: '5px 0', borderBottom: '1px solid #EEF2F7', fontSize: 14, alignItems: 'baseline' }}>
                  <span style={{ color: C.muted, fontSize: 12, width: 82 }}>{t.key}</span>
                  <span style={{ flex: 1 }}>{t.summary}</span>
                  <span style={{ fontSize: 12, color: t.done ? '#247A37' : C.inkSoft, whiteSpace: 'nowrap' }}>{t.status}</span>
                  <span style={{ fontSize: 12, color: C.muted, width: 92, textAlign: 'right' }}>{t.due ? deckDate(t.due) : ''}</span>
                </div>
              ))}
            </>
          )}
        </div>
      </div>
    </div>
  )
}
