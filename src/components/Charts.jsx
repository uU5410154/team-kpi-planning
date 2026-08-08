import { useState, useMemo, useRef, useLayoutEffect } from 'react'
import { Box, Typography, useTheme } from '@mui/material'
import { CHART, STATUS } from '../lib/palette.js'

/* ------------------------------------------------------------------ */
/* shared chrome                                                       */
/* ------------------------------------------------------------------ */

export const useChartTokens = () => {
  const t = useTheme()
  return CHART[t.palette.mode === 'dark' ? 'dark' : 'light']
}

/**
 * Measure the container so SVG geometry can be written in real pixels.
 * SVG presentation attributes do not accept CSS calc(), so percentage-based
 * bar widths have to be resolved in JS.
 */
function useMeasure() {
  const ref = useRef(null)
  const [w, setW] = useState(0)
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const ro = new ResizeObserver(([entry]) => {
      setW(Math.floor(entry.contentRect.width))
    })
    ro.observe(el)
    setW(Math.floor(el.getBoundingClientRect().width))
    return () => ro.disconnect()
  }, [])
  return [ref, w]
}

function useTooltip(hostRef) {
  const [tip, setTip] = useState(null)
  const show = (e, content) => {
    const box = hostRef.current?.getBoundingClientRect()
    if (!box) return
    setTip({ x: e.clientX - box.left, y: e.clientY - box.top, content })
  }
  return { tip, show, hide: () => setTip(null) }
}

function Tip({ tip, tokens }) {
  if (!tip) return null
  return (
    <Box
      sx={{
        position: 'absolute',
        left: Math.max(8, tip.x + 14),
        top: Math.max(8, tip.y - 10),
        pointerEvents: 'none',
        zIndex: 5,
        px: 1.25,
        py: 0.75,
        maxWidth: 280,
        borderRadius: 1,
        bgcolor: tokens.surface,
        border: `1px solid ${tokens.border}`,
        boxShadow: '0 4px 16px rgba(0,0,0,0.18)',
        fontSize: '0.75rem',
        lineHeight: 1.5,
        color: tokens.textPrimary,
        fontVariantNumeric: 'tabular-nums',
        whiteSpace: 'pre-line',
      }}
    >
      {tip.content}
    </Box>
  )
}

export function Legend({ items }) {
  const tokens = useChartTokens()
  if (items.length < 2) return null
  return (
    <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1.5, mt: 1.5 }}>
      {items.map((it) => (
        <Box key={it.label} sx={{ display: 'flex', alignItems: 'center', gap: 0.75 }}>
          <Box sx={{ width: 10, height: 10, borderRadius: '2px', bgcolor: it.color, flexShrink: 0 }} />
          <Typography variant="caption" sx={{ color: tokens.textSecondary }}>{it.label}</Typography>
        </Box>
      ))}
    </Box>
  )
}

/* ------------------------------------------------------------------ */
/* Meter — one ratio against a limit                                   */
/* ------------------------------------------------------------------ */

export function Meter({ value, target, label, sublabel, format = (n) => Math.round(n).toLocaleString() }) {
  const tokens = useChartTokens()
  const pct = target > 0 ? value / target : 0
  const clamped = Math.min(1.25, Math.max(0, pct))
  const fill = pct >= 1 ? tokens.seq[5] : pct >= 0.85 ? tokens.seq[4] : tokens.seq[3]

  return (
    <Box>
      <Box sx={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', mb: 0.75 }}>
        <Typography variant="caption" sx={{ color: tokens.textSecondary }}>{label}</Typography>
        <Typography variant="caption" sx={{ color: tokens.textSecondary, fontVariantNumeric: 'tabular-nums' }}>
          {format(value)} / {format(target)}
        </Typography>
      </Box>
      <Box sx={{ position: 'relative', height: 10, borderRadius: '5px', bgcolor: tokens.gridline, overflow: 'hidden' }}>
        <Box
          sx={{
            position: 'absolute', inset: 0, width: `${(clamped / 1.25) * 100}%`,
            bgcolor: fill, borderRadius: '5px', transition: 'width .3s ease',
          }}
        />
        <Box
          sx={{
            position: 'absolute', left: `${(1 / 1.25) * 100}%`, top: -2, bottom: -2,
            width: 2, bgcolor: tokens.textPrimary, opacity: 0.55,
          }}
        />
      </Box>
      {sublabel && (
        <Typography variant="caption" sx={{ color: tokens.muted, mt: 0.75, display: 'block' }}>
          {sublabel}
        </Typography>
      )}
    </Box>
  )
}

/* ------------------------------------------------------------------ */
/* Horizontal bar — magnitude, one hue                                 */
/* ------------------------------------------------------------------ */

const LABEL_W = 78
const RIGHT_PAD = 62
const ROW_H = 26

export function HBar({ data, valueFormat = (n) => Math.round(n).toLocaleString(), unit = '' }) {
  const tokens = useChartTokens()
  const [ref, W] = useMeasure()
  const { tip, show, hide } = useTooltip(ref)

  const gap = 8
  const h = data.length * (ROW_H + gap) + 12
  const max = Math.max(1, ...data.map((d) => d.value))
  const track = Math.max(0, W - LABEL_W - RIGHT_PAD)

  return (
    <Box ref={ref} sx={{ position: 'relative', width: '100%', minHeight: h }}>
      {W > 0 && (
        <svg width={W} height={h} role="img" aria-label="Bar chart" style={{ display: 'block' }}>
          {data.map((d, i) => {
            const y = i * (ROW_H + gap) + 4
            const w = (d.value / max) * track
            return (
              <g key={d.label}>
                <text x={LABEL_W - 10} y={y + ROW_H / 2 + 4} textAnchor="end" fontSize="12" fill={tokens.textSecondary}>
                  {d.label}
                </text>
                <rect x={LABEL_W} y={y + 4} width={track} height={ROW_H - 8} rx="4" fill={tokens.gridline} opacity="0.5" />
                <rect
                  x={LABEL_W} y={y + 4} width={Math.max(0, w)} height={ROW_H - 8} rx="4"
                  fill={d.color || tokens.seq[4]}
                  style={{ cursor: 'pointer' }}
                  onMouseMove={(e) => show(e, `${d.label}\n${valueFormat(d.value)}${unit}${d.note ? `\n${d.note}` : ''}`)}
                  onMouseLeave={hide}
                />
                {/* direct label — the relief for the light-mode contrast WARN */}
                <text
                  x={W - RIGHT_PAD + 8} y={y + ROW_H / 2 + 4} fontSize="12" fontWeight="600"
                  fill={tokens.textPrimary} style={{ fontVariantNumeric: 'tabular-nums' }}
                >
                  {valueFormat(d.value)}
                </text>
              </g>
            )
          })}
        </svg>
      )}
      <Tip tip={tip} tokens={tokens} />
    </Box>
  )
}

/* ------------------------------------------------------------------ */
/* Stacked horizontal bar — part-to-whole, categorical                 */
/* ------------------------------------------------------------------ */

export function StackedHBar({ rows, series, valueFormat = (n) => Math.round(n).toLocaleString() }) {
  const tokens = useChartTokens()
  const [ref, W] = useMeasure()
  const { tip, show, hide } = useTooltip(ref)

  const gap = 10
  const h = rows.length * (ROW_H + gap) + 12
  const max = Math.max(1, ...rows.map((r) => series.reduce((a, s) => a + (r.values[s.id] || 0), 0)))
  const track = Math.max(0, W - LABEL_W - RIGHT_PAD)

  return (
    <>
      <Box ref={ref} sx={{ position: 'relative', width: '100%', minHeight: h }}>
        {W > 0 && (
          <svg width={W} height={h} role="img" aria-label="Stacked bar chart" style={{ display: 'block' }}>
            {rows.map((r, i) => {
              const y = i * (ROW_H + gap) + 4
              const total = series.reduce((a, s) => a + (r.values[s.id] || 0), 0)
              let acc = 0
              return (
                <g key={r.label}>
                  <text x={LABEL_W - 10} y={y + ROW_H / 2 + 4} textAnchor="end" fontSize="12" fill={tokens.textSecondary}>
                    {r.label}
                  </text>
                  {total === 0 && (
                    <rect x={LABEL_W} y={y + 4} width={track} height={ROW_H - 8} rx="4" fill={tokens.gridline} opacity="0.4" />
                  )}
                  {series.map((s) => {
                    const v = r.values[s.id] || 0
                    if (v <= 0) return null
                    const x0 = LABEL_W + (acc / max) * track
                    acc += v
                    // 2px surface gap between adjacent segments
                    const w = Math.max(0, (v / max) * track - 2)
                    return (
                      <rect
                        key={s.id}
                        x={x0 + 1} y={y + 4} width={w} height={ROW_H - 8} rx="3" fill={s.color}
                        style={{ cursor: 'pointer' }}
                        onMouseMove={(e) =>
                          show(e, `${r.label} · ${s.label}\n${valueFormat(v)} hrs (${Math.round((v / (total || 1)) * 100)}% of their book)`)
                        }
                        onMouseLeave={hide}
                      />
                    )
                  })}
                  <text
                    x={W - RIGHT_PAD + 8} y={y + ROW_H / 2 + 4} fontSize="12" fontWeight="600"
                    fill={tokens.textPrimary} style={{ fontVariantNumeric: 'tabular-nums' }}
                  >
                    {valueFormat(total)}
                  </text>
                </g>
              )
            })}
          </svg>
        )}
        <Tip tip={tip} tokens={tokens} />
      </Box>
      <Legend items={series.map((s) => ({ label: s.label, color: s.color }))} />
    </>
  )
}

/* ------------------------------------------------------------------ */
/* Scatter — the efficiency gate (manday vs saving hours)              */
/* ------------------------------------------------------------------ */

export function GateScatter({
  points, gate, height = 320, emptyMessage,
  xLabel = 'Mandays invested', yLabel = 'Saving hours', fmt = (v) => Math.round(v).toLocaleString(),
}) {
  const tokens = useChartTokens()
  const ref = useRef(null)
  const { tip, show, hide } = useTooltip(ref)

  if (!points.length) {
    return (
      <Box
        sx={{
          height,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          textAlign: 'center',
          px: 4,
          border: `1px dashed ${tokens.gridline}`,
          borderRadius: 1,
        }}
      >
        <Typography variant="body2" sx={{ color: tokens.textSecondary, maxWidth: 420 }}>
          {emptyMessage || 'Nothing to plot yet.'}
        </Typography>
      </Box>
    )
  }

  const padL = 54
  const padB = 38
  const padT = 16
  const padR = 16
  const W = 700 // viewBox units — the svg scales to its container
  const H = height

  const { maxX, maxY } = useMemo(() => ({
    maxX: Math.max(10, ...points.map((p) => p.x)) * 1.08,
    maxY: Math.max(10, ...points.map((p) => p.y)) * 1.15,
  }), [points])

  // Log y — one epic at 1,262h beside a dozen under 20h is otherwise an
  // unreadable line of dots on the floor.
  const lmax = Math.log10(maxY + 1)
  const yScale = (v) => H - padB - (Math.log10(Math.max(0, v) + 1) / lmax) * (H - padB - padT)
  const xScale = (v) => padL + (v / maxX) * (W - padL - padR)

  // Decade ticks across whatever magnitude the values span, so the same chart
  // reads whether the axis is hours or millions of baht.
  const yTicks = Array.from({ length: 12 }, (_, i) => 10 ** i).filter((t) => t <= maxY && t >= maxY / 1e5)
  const xTicks = [0, 0.25, 0.5, 0.75, 1].map((f) => f * maxX)
  // Park the gate caption on the curve at 45% of the x-range, where the
  // scatter is sparse — pinning it to a corner collides with real points.
  const capX = maxX * 0.45
  const capY = Math.max(padT + 22, yScale(gate * capX) - 10)

  // Gate line: savingHours = gate * manday. On a log y this is a curve, so
  // sample it rather than drawing a straight segment.
  const gatePath = Array.from({ length: 60 }, (_, i) => {
    const x = (i / 59) * maxX
    return `${i === 0 ? 'M' : 'L'} ${xScale(x).toFixed(1)} ${yScale(gate * x).toFixed(1)}`
  }).join(' ')

  return (
    <>
      <Box ref={ref} sx={{ position: 'relative', width: '100%' }}>
        <svg viewBox={`0 0 ${W} ${H}`} width="100%" height={H} role="img"
             aria-label="Efficiency gate scatter" style={{ display: 'block' }}>
          {yTicks.map((t) => (
            <g key={t}>
              <line x1={padL} x2={W - padR} y1={yScale(t)} y2={yScale(t)} stroke={tokens.gridline} strokeWidth="1" />
              <text x={padL - 8} y={yScale(t) + 4} textAnchor="end" fontSize="11" fill={tokens.muted}
                    style={{ fontVariantNumeric: 'tabular-nums' }}>
                {fmt(t)}
              </text>
            </g>
          ))}
          {xTicks.map((t, i) => (
            <text key={i} x={xScale(t)} y={H - padB + 16} textAnchor="middle" fontSize="11" fill={tokens.muted}
                  style={{ fontVariantNumeric: 'tabular-nums' }}>
              {fmt(t)}
            </text>
          ))}
          <line x1={padL} x2={W - padR} y1={H - padB} y2={H - padB} stroke={tokens.baseline} strokeWidth="1" />
          <line x1={padL} x2={padL} y1={padT} y2={H - padB} stroke={tokens.baseline} strokeWidth="1" />

          <path d={gatePath} stroke={tokens.textSecondary} strokeWidth="2" strokeDasharray="5 4" fill="none" opacity="0.75" />
          <text
            x={xScale(capX)} y={capY} textAnchor="middle" fontSize="11" fontWeight="600"
            fill={tokens.textSecondary}
            stroke={tokens.surface} strokeWidth="4" paintOrder="stroke"
          >
            gate
          </text>

          {points.map((p) => {
            const pass = p.y >= gate * p.x
            return (
              <circle
                key={p.key}
                cx={xScale(p.x)}
                cy={yScale(p.y)}
                r={p.y > maxY / 4 ? 9 : 6}
                fill={pass ? STATUS.good : STATUS.critical}
                fillOpacity="0.82"
                stroke={tokens.surface}
                strokeWidth="2"
                style={{ cursor: 'pointer' }}
                onMouseMove={(e) =>
                  show(e, `${p.key} — ${p.summary}\n${p.note || `${fmt(p.x)} → ${fmt(p.y)}`}\n${pass ? 'PASSES' : 'FAILS'} the gate`)
                }
                onMouseLeave={hide}
              />
            )
          })}

          <text x={W / 2} y={H - 4} textAnchor="middle" fontSize="11" fill={tokens.textSecondary}>
            {xLabel}
          </text>
          <text transform={`rotate(-90 13 ${H / 2})`} x={13} y={H / 2} textAnchor="middle" fontSize="11" fill={tokens.textSecondary}>
            {yLabel} (log scale)
          </text>
        </svg>
        <Tip tip={tip} tokens={tokens} />
      </Box>
      {/* status colour never carries meaning alone */}
      <Legend
        items={[
          { label: 'Clears the gate', color: STATUS.good },
          { label: 'Below the gate — review scope or effort', color: STATUS.critical },
        ]}
      />
    </>
  )
}
