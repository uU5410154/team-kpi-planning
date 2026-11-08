import { Box, Typography } from '@mui/material'

/*
 * THE LITTLE MARKDOWN THE AI WRITES: headings, bullets, bold, paragraphs.
 *
 * Built as React elements from the text, never as HTML — so whatever the
 * model returns, and whatever a member typed that it repeats, is shown as text
 * and cannot become markup on an administrator's page.
 */

const inline = (s, keyBase) => String(s).split(/(\*\*[^*]+\*\*)/g).map((part, i) => (
  /^\*\*[^*]+\*\*$/.test(part)
    ? <strong key={`${keyBase}-${i}`}>{part.slice(2, -2)}</strong>
    : part
))

export default function Markdown({ text, dense = false }) {
  const lines = String(text || '').replace(/\r\n/g, '\n').split('\n')
  const blocks = []
  let list = null
  lines.forEach((raw, i) => {
    const line = raw.trimEnd()
    const bullet = line.match(/^\s*(?:[-*•]|\d+[.)])\s+(.*)$/)
    if (bullet) {
      if (!list) { list = []; blocks.push({ type: 'list', items: list, key: `l${i}` }) }
      list.push({ text: bullet[1], key: `i${i}` })
      return
    }
    list = null
    if (!line.trim()) return
    const h = line.match(/^#{1,6}\s+(.*)$/)
    if (h) blocks.push({ type: 'h', text: h[1], key: `h${i}` })
    else blocks.push({ type: 'p', text: line, key: `p${i}` })
  })
  return (
    <Box sx={{ '& > *:first-of-type': { mt: 0 } }}>
      {blocks.map((b) => {
        if (b.type === 'h') {
          return (
            <Typography key={b.key} variant="subtitle2" sx={{ mt: dense ? 1.25 : 1.75, mb: 0.5, color: 'text.secondary' }}>
              {inline(b.text, b.key)}
            </Typography>
          )
        }
        if (b.type === 'list') {
          return (
            <Box key={b.key} component="ul" sx={{ m: 0, mb: 0.75, pl: 2.25 }}>
              {b.items.map((it) => (
                <Typography key={it.key} component="li" variant="body2" sx={{ mb: 0.4 }}>{inline(it.text, it.key)}</Typography>
              ))}
            </Box>
          )
        }
        return <Typography key={b.key} variant="body2" sx={{ mb: 0.75 }}>{inline(b.text, b.key)}</Typography>
      })}
    </Box>
  )
}
