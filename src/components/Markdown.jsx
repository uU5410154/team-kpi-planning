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
    ? <strong key={`${keyBase}-${i}`} style={{ fontWeight: 600 }}>{part.slice(2, -2)}</strong>
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
  // Body text at 14/20 (a little more air for Thai), lists indented 20px.
  const para = { lineHeight: '22px', maxWidth: '72ch' }
  return (
    <Box sx={{ '& > *:first-of-type': { mt: 0 }, '& > *:last-child': { mb: 0 } }}>
      {blocks.map((b) => {
        if (b.type === 'h') {
          return (
            <Typography key={b.key} variant="h3" sx={{ mt: dense ? 3 : 4, mb: 1 }}>
              {inline(b.text, b.key)}
            </Typography>
          )
        }
        if (b.type === 'list') {
          return (
            <Box key={b.key} component="ul" sx={{ m: 0, mb: 2, pl: 5 }}>
              {b.items.map((it) => (
                <Typography key={it.key} component="li" variant="body1" sx={{ ...para, mb: 1 }}>{inline(it.text, it.key)}</Typography>
              ))}
            </Box>
          )
        }
        return <Typography key={b.key} variant="body1" sx={{ ...para, mb: 2 }}>{inline(b.text, b.key)}</Typography>
      })}
    </Box>
  )
}
