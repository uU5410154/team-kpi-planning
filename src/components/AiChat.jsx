import { useCallback, useEffect, useRef, useState } from 'react'
import {
  Drawer, Box, Typography, IconButton, TextField, Button, Select, MenuItem, Tooltip, Alert,
} from '@mui/material'
import { alpha, useTheme } from '@mui/material/styles'
import CloseIcon from '@mui/icons-material/Close'
import SendIcon from '@mui/icons-material/ArrowUpward'
import AddIcon from '@mui/icons-material/Add'
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline'
import AutoAwesomeIcon from '@mui/icons-material/AutoAwesomeOutlined'
import * as api from '../lib/api.js'
import Loading from './Loading.jsx'
import Markdown from './Markdown.jsx'

/*
 * ASK ABOUT THE PLAN — the administrators' chatbot.
 *
 * It answers from everything the app holds, money included, and in the
 * language it is asked in. Each administrator's conversations are kept for
 * them and can be picked up again from the list at the top; nobody else sees
 * them. The answer is the model's reading of the data, and says so.
 */

const STARTERS = [
  'Which projects are past due, and who holds them?',
  'What is blocking the team this week?',
  'Which costed projects are below the ROI gate?',
  'สัปดาห์นี้ใครยังไม่ส่งแผนงานบ้าง',
]

/*
 * `seed` — { q, n } — is a question asked from elsewhere (the Dashboard's
 * starters). It opens a new conversation with that question, once per `n`.
 */
export default function AiChat({
  open, onClose, phone, seed,
}) {
  const theme = useTheme()
  const [chats, setChats] = useState([])
  const [chat, setChat] = useState(null)
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  // An earlier conversation on its way from the server.
  const [opening, setOpening] = useState(false)
  const end = useRef(null)

  const loadList = useCallback(async () => {
    try { setChats((await api.aiChats()).chats) } catch (e) { setError(e.message) }
  }, [])
  useEffect(() => { if (open) loadList() }, [open, loadList])
  useEffect(() => { end.current?.scrollIntoView({ block: 'end' }) }, [chat, busy])

  const pick = async (id) => {
    setError(null)
    if (!id) { setChat(null); return }
    setOpening(true)
    try { setChat((await api.aiChat(id)).chat) } catch (e) { setError(e.message) } finally { setOpening(false) }
  }

  const send = async (q, fresh = false) => {
    const question = String(q ?? text).trim()
    if (!question || busy) return
    setBusy(true)
    setError(null)
    if (!fresh) setText('')
    // Shown at once, so the question does not seem to vanish while the AI thinks.
    setChat((c) => (fresh
      ? { messages: [{ role: 'user', content: question, pending: true }] }
      : { ...(c || {}), messages: [...(c?.messages || []), { role: 'user', content: question, pending: true }] }))
    try {
      const r = await api.aiAsk(fresh ? null : chat?.id, question)
      setChat(r.chat)
      loadList()
    } catch (e) {
      setError(e.message)
      setText(question)
      setChat((c) => ({ ...c, messages: (c?.messages || []).filter((m) => !m.pending) }))
    } finally {
      setBusy(false)
    }
  }

  const seeded = useRef(null)
  useEffect(() => {
    if (!open || !seed?.q || seeded.current === seed.n) return
    seeded.current = seed.n
    send(seed.q, true)
    // send is recreated every render; the seed's number is what must not repeat.
  }, [open, seed])

  const remove = async () => {
    if (!chat?.id || !window.confirm('Delete this conversation?')) return
    await api.aiDeleteChat(chat.id).catch(() => {})
    setChat(null)
    loadList()
  }

  const messages = chat?.messages || []
  return (
    <Drawer
      anchor="right"
      open={open}
      onClose={onClose}
      PaperProps={{
        sx: {
          width: phone ? '100%' : 460, display: 'flex', flexDirection: 'column', bgcolor: 'background.paper', borderLeft: 1, borderColor: 'divider',
        },
      }}
    >
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, px: 2, py: 1.5, borderBottom: 1, borderColor: 'divider' }}>
        <AutoAwesomeIcon sx={{ fontSize: 18, color: 'text.secondary' }} />
        <Typography variant="h4" sx={{ flex: 1 }}>Ask about the plan</Typography>
        <Tooltip title="New conversation">
          <IconButton size="small" onClick={() => { setChat(null); setError(null) }} aria-label="new conversation"><AddIcon fontSize="small" /></IconButton>
        </Tooltip>
        {chat?.id && (
          <Tooltip title="Delete this conversation">
            <IconButton size="small" onClick={remove} aria-label="delete conversation"><DeleteOutlineIcon fontSize="small" /></IconButton>
          </Tooltip>
        )}
        <IconButton size="small" onClick={onClose} aria-label="close"><CloseIcon fontSize="small" /></IconButton>
      </Box>

      {chats.length > 0 && (
        <Box sx={{ px: 2, pt: 1.5 }}>
          <Select
            size="small"
            fullWidth
            displayEmpty
            value={chat?.id || ''}
            onChange={(e) => pick(e.target.value)}
            inputProps={{ 'aria-label': 'earlier conversations' }}
            renderValue={(v) => (v ? (chats.find((c) => c.id === v)?.title || 'This conversation') : `Earlier conversations (${chats.length})`)}
          >
            <MenuItem value=""><em>New conversation</em></MenuItem>
            {chats.map((c) => (
              <MenuItem key={c.id} value={c.id}>
                <Box sx={{ minWidth: 0 }}>
                  <Typography variant="body2" noWrap>{c.title}</Typography>
                  <Typography variant="caption" sx={{ color: 'text.secondary' }}>
                    {new Date(c.updatedAt).toLocaleString('en-GB', { timeZone: 'Asia/Bangkok', dateStyle: 'medium', timeStyle: 'short' })}
                  </Typography>
                </Box>
              </MenuItem>
            ))}
          </Select>
        </Box>
      )}

      <Box sx={{ flex: 1, overflowY: 'auto', px: 2, py: 2, display: 'flex', flexDirection: 'column', gap: 1.5 }}>
        {opening && <Loading variant="block" label="Opening the conversation…" />}
        {!opening && messages.length === 0 && (
          <Box>
            <Typography variant="body2" sx={{ color: 'text.secondary', mb: 1.5 }}>
              Ask anything about the register, the timeline, the money or the weekly check-ins — in English or Thai.
            </Typography>
            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.75 }}>
              {STARTERS.map((q) => (
                <Button
                  key={q}
                  variant="outlined"
                  onClick={() => send(q)}
                  disabled={busy}
                  sx={{ justifyContent: 'flex-start', textAlign: 'left', fontWeight: 500, color: 'text.primary' }}
                >
                  {q}
                </Button>
              ))}
            </Box>
          </Box>
        )}
        {!opening && messages.map((m, i) => (m.role === 'user' ? (
          <Box
            key={i}
            sx={{
              alignSelf: 'flex-end', maxWidth: '85%', px: 1.5, py: 1, borderRadius: '14px 14px 4px 14px',
              bgcolor: alpha(theme.palette.primary.main, 0.16), border: 1, borderColor: alpha(theme.palette.primary.main, 0.25),
            }}
          >
            <Typography variant="body2" sx={{ whiteSpace: 'pre-wrap' }}>{m.content}</Typography>
          </Box>
        ) : (
          <Box key={i} sx={{ maxWidth: '100%' }}>
            <Markdown text={m.content} dense />
          </Box>
        )))}
        {busy && <Loading label="Reading the plan…" />}
        {error && <Alert severity="error" onClose={() => setError(null)}>{error}</Alert>}
        <div ref={end} />
      </Box>

      <Box sx={{ p: 1.5, borderTop: 1, borderColor: 'divider' }}>
        <Box sx={{ display: 'flex', gap: 1, alignItems: 'flex-end' }}>
          <TextField
            fullWidth
            multiline
            maxRows={6}
            size="small"
            placeholder="Ask a question…"
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send() } }}
            inputProps={{ 'aria-label': 'ask a question' }}
          />
          <IconButton
            color="primary"
            onClick={() => send()}
            disabled={busy || !text.trim()}
            aria-label="send"
            sx={{ bgcolor: 'primary.main', color: '#fff', '&:hover': { bgcolor: 'primary.dark' }, '&.Mui-disabled': { bgcolor: 'action.hover' } }}
          >
            <SendIcon fontSize="small" />
          </IconButton>
        </Box>
        <Typography variant="caption" sx={{ color: 'text.disabled', display: 'block', mt: 0.75 }}>
          Answers come from the app&rsquo;s data, read by AI. Check anything you act on. Your conversations are kept for you only.
        </Typography>
      </Box>
    </Drawer>
  )
}
