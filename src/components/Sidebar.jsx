import { useState } from 'react'
import {
  Box, Drawer, Typography, Tooltip, IconButton, ButtonBase, Avatar, Switch, Menu, MenuItem, ListItemIcon, ListItemText, Divider,
} from '@mui/material'
import ChevronLeftIcon from '@mui/icons-material/ChevronLeft'
import MenuOpenIcon from '@mui/icons-material/MenuOpen'
import MenuIcon from '@mui/icons-material/Menu'
import CloseIcon from '@mui/icons-material/Close'
import LogoutIcon from '@mui/icons-material/Logout'
import MoreHorizIcon from '@mui/icons-material/MoreHoriz'
import PreviewIcon from '@mui/icons-material/VisibilityOutlined'
import DarkModeIcon from '@mui/icons-material/DarkModeOutlined'
import LightModeIcon from '@mui/icons-material/LightModeOutlined'
import { displayName as nameOf } from './Brand.jsx'

/*
 * THE SIDE MENU (docs/DESIGN.md §2).
 *
 * Full height and flush to the left edge: the app's name at the top, the
 * pages as a column of quiet rows, where the year stands, and the person
 * signed in at the foot with their own menu (view as a team member, light or
 * dark, sign out).
 *
 * Three shapes:
 *   - wide on a computer (232px): icon and name for every page;
 *   - folded (64px): icons only, the name on hover — the Timeline and the
 *     register want every pixel of width they can get. A tablet starts here
 *     and opens the wide menu OVER the page rather than beside it;
 *   - on a phone: hidden, and slid in over the page from the ☰ button.
 *
 * The pages are a real tab list (role="tab", aria-selected): a screen reader
 * announces them as such, and the browser checks that find a page by its tab
 * keep working.
 */

export const NAV_W = 232
export const NAV_W_MINI = 64
// Pages an administrator alone has: under a divider at the foot of the list.
const ADMIN_PAGES = new Set(['settings', 'users'])

/*
 * THE APP'S MARK: "FA" set in the interface's own type on a quiet tile. Not a
 * logo and not a colour, just a deliberate sign that this is the F&A Tech
 * tool; the side menu shows it at 24px and the sign-in card at 32px.
 */
export function AppMark({ size = 24 }) {
  const big = size >= 32
  return (
    <Box
      aria-hidden
      sx={{
        width: size,
        height: size,
        flexShrink: 0,
        display: 'grid',
        placeItems: 'center',
        borderRadius: '6px',
        bgcolor: 'bg.subtle',
        border: 1,
        borderColor: 'border.subtle',
        color: 'text.secondary',
        fontSize: big ? '0.875rem' : '0.75rem',
        lineHeight: 1,
        fontWeight: 600,
        letterSpacing: 0,
        userSelect: 'none',
      }}
    >
      FA
    </Box>
  )
}

const displayName = (email) => nameOf(email)
const initials = (email) => displayName(email).split(' ').map((w) => w[0]).slice(0, 2).join('')

function NavItem({
  item, selected, mini, onClick,
}) {
  const Icon = item.icon
  const button = (
    <ButtonBase
      role="tab"
      aria-selected={selected}
      onClick={onClick}
      sx={{
        width: '100%',
        height: 36,
        flexShrink: 0,
        justifyContent: mini ? 'center' : 'flex-start',
        gap: 3,
        px: mini ? 0 : 2.5,
        borderRadius: '6px',
        color: selected ? 'text.primary' : 'text.secondary',
        bgcolor: selected ? 'primary.tint' : 'transparent',
        fontSize: '0.875rem',
        fontWeight: 500,
        lineHeight: '20px',
        transition: 'background-color 120ms, color 120ms',
        '& .nav-icon': { fontSize: 20, color: selected ? 'primary.text' : 'text.secondary', flexShrink: 0 },
        ...(!selected && { '&:hover': { bgcolor: 'action.hover', color: 'text.primary', '& .nav-icon': { color: 'text.primary' } } }),
      }}
    >
      {Icon && <Icon className="nav-icon" aria-hidden />}
      {/* Kept in the page when folded, only hidden: the tab still has its name
          for a screen reader and for anything that finds it by its text. */}
      <Box component="span" sx={{ display: mini ? 'none' : 'block', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{item.label}</Box>
    </ButtonBase>
  )
  return mini ? <Tooltip title={item.label} placement="right">{button}</Tooltip> : button
}

/* The person signed in, and their menu. */
function UserRow({
  me, mini, previewing, onToggleView, onSignOut, mode, onToggleMode,
}) {
  const [at, setAt] = useState(null)
  const roleWord = me?.local ? 'Local copy'
    : previewing ? 'Viewing as a member'
      : me?.role === 'admin' ? 'Administrator' : 'Team member'
  const name = me?.local ? 'No accounts' : displayName(me?.email)
  const avatar = (
    <Avatar sx={{ width: 28, height: 28, fontSize: '0.75rem', fontWeight: 500 }}>
      {me?.local ? 'L' : initials(me?.email)}
    </Avatar>
  )
  const open = (e) => setAt(e.currentTarget)
  return (
    <>
      {mini ? (
        <Tooltip title={`${name}, ${roleWord.toLowerCase()}`} placement="right">
          <IconButton onClick={open} aria-label="account menu" aria-haspopup="menu" sx={{ alignSelf: 'center', p: 0.5 }}>
            {avatar}
          </IconButton>
        </Tooltip>
      ) : (
        <ButtonBase
          onClick={open}
          aria-label="account menu"
          aria-haspopup="menu"
          sx={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'flex-start',
            textAlign: 'left',
            gap: 2,
            width: '100%',
            minHeight: 44,
            px: 1,
            borderRadius: '6px',
            transition: 'background-color 120ms',
            '&:hover': { bgcolor: 'action.hover' },
          }}
        >
          {avatar}
          <Box sx={{ minWidth: 0, flex: 1 }}>
            <Typography noWrap sx={{ fontSize: '0.8125rem', lineHeight: '18px', fontWeight: 500 }}>{name}</Typography>
            <Typography variant="caption" noWrap component="div" sx={{ color: 'text.secondary' }}>{roleWord}</Typography>
          </Box>
          <MoreHorizIcon aria-hidden sx={{ fontSize: 18, color: 'text.secondary', flexShrink: 0 }} />
        </ButtonBase>
      )}
      {/* Mounted while closed: the switch and Sign out are always in the page,
          for a keyboard shortcut or a check that reaches for them by name. */}
      <Menu
        anchorEl={at}
        open={!!at}
        onClose={() => setAt(null)}
        keepMounted
        // Closed, it takes no room at all: a hidden menu left in the layout
        // can widen a phone's page.
        sx={{ '&.MuiModal-hidden': { display: 'none' } }}
        anchorOrigin={{ vertical: 'top', horizontal: mini ? 'right' : 'left' }}
        transformOrigin={{ vertical: 'bottom', horizontal: 'left' }}
        slotProps={{ paper: { sx: { minWidth: 240, mt: -1 } } }}
      >
        {onToggleView && !me?.local && (
          <MenuItem
            component="label"
            data-view-as-toggle
            sx={{ pr: 2 }}
          >
            <ListItemIcon><PreviewIcon fontSize="small" /></ListItemIcon>
            <ListItemText primary="View as a team member" />
            <Switch
              size="small"
              checked={!!previewing}
              onChange={(e) => { onToggleView(e.target.checked); setAt(null) }}
              inputProps={{ 'aria-label': 'view as a team member' }}
            />
          </MenuItem>
        )}
        {onToggleMode && (
          <MenuItem onClick={() => { onToggleMode(); setAt(null) }}>
            <ListItemIcon>{mode === 'dark' ? <LightModeIcon fontSize="small" /> : <DarkModeIcon fontSize="small" />}</ListItemIcon>
            <ListItemText primary={mode === 'dark' ? 'Light mode' : 'Dark mode'} />
          </MenuItem>
        )}
        {!me?.local && onSignOut && <Divider />}
        {/* Nothing to sign out of when there are no accounts. */}
        {!me?.local && onSignOut && (
          <MenuItem
            component="button"
            onClick={() => { setAt(null); onSignOut() }}
            aria-label="Sign out"
            sx={{ width: '100%', textAlign: 'left' }}
          >
            <ListItemIcon><LogoutIcon fontSize="small" /></ListItemIcon>
            <ListItemText primary="Sign out" />
          </MenuItem>
        )}
      </Menu>
    </>
  )
}

/* Where the team (or, for a member, the person) stands against the year. */
function Coverage({ coverage }) {
  const tone = coverage.tone === 'error' ? 'danger' : coverage.tone || 'success'
  return (
    <Box sx={{ px: 1, pt: 1 }}>
      <Typography variant="caption" component="div" sx={{ color: 'text.secondary' }}>{coverage.label || 'Saving hours, committed'}</Typography>
      <Typography component="div" sx={{ fontSize: '0.875rem', lineHeight: '20px', fontWeight: 600, mt: 0.5, fontVariantNumeric: 'tabular-nums' }}>
        {coverage.total.toLocaleString()}
        <Box component="span" sx={{ color: 'text.secondary', fontWeight: 400, fontSize: '0.75rem', ml: 1 }}>
          / {coverage.target.toLocaleString()} {coverage.unit || 'hrs'}
        </Box>
      </Typography>
      <Box
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(Math.min(100, coverage.share * 100))}
        aria-label={coverage.label || 'Saving hours, committed'}
        sx={{
          mt: 1.5, height: 4, borderRadius: '2px', bgcolor: 'bg.subtle', overflow: 'hidden',
        }}
      >
        <Box sx={(t) => ({
          height: '100%', width: `${Math.min(100, coverage.share * 100)}%`, bgcolor: t.palette.tone[tone]?.solid || t.palette.tone.success.solid, borderRadius: '2px',
        })}
        />
      </Box>
      <Typography variant="caption" component="div" sx={{ color: 'text.tertiary', mt: 1 }}>
        {coverage.note || `${Math.round(coverage.share * 100)}% of the year’s target`}
      </Typography>
    </Box>
  )
}

function NavBody({
  tabs, tab, onTab, mini, onFold, phone, onClose, me, onSignOut, coverage, previewing, onToggleView, mode, onToggleMode, overlay,
}) {
  const main = tabs.filter((t) => !ADMIN_PAGES.has(t.id))
  const admin = tabs.filter((t) => ADMIN_PAGES.has(t.id))
  return (
    <Box sx={{
      height: '100%', display: 'flex', flexDirection: 'column', overflowY: 'auto', overflowX: 'hidden',
    }}
    >
      {/* The app, and the fold. As tall as the top bar so their edges meet. */}
      <Box sx={{
        display: 'flex', alignItems: 'center', gap: 2.5, height: 56, flexShrink: 0, px: mini ? 0 : 4, justifyContent: mini ? 'center' : 'flex-start',
      }}
      >
        {!mini && (
          <>
            <AppMark />
            <Box sx={{ minWidth: 0, flex: 1 }}>
              <Typography noWrap sx={{ fontSize: '0.875rem', lineHeight: '18px', fontWeight: 600 }}>F&amp;A Tech KPI</Typography>
              <Typography noWrap variant="caption" component="div" sx={{ color: 'text.secondary', lineHeight: '14px' }}>2026 plan</Typography>
            </Box>
          </>
        )}
        {phone ? (
          <IconButton onClick={onClose} aria-label="close menu" sx={{ width: 40, height: 40, mr: -1 }}><CloseIcon fontSize="small" /></IconButton>
        ) : (
          <Tooltip title={mini ? 'Open the menu' : 'Fold the menu'} placement="right">
            <IconButton
              onClick={onFold}
              aria-label={mini ? 'expand menu' : 'collapse menu'}
              aria-expanded={!mini}
              sx={{
                width: 28, height: 28, color: 'text.secondary', mr: mini ? 0 : -1, '&:hover': { color: 'text.primary' },
              }}
            >
              {mini ? <MenuIcon sx={{ fontSize: 18 }} /> : overlay ? <ChevronLeftIcon sx={{ fontSize: 18 }} /> : <MenuOpenIcon sx={{ fontSize: 18 }} />}
            </IconButton>
          </Tooltip>
        )}
      </Box>

      <Box
        role="tablist"
        aria-orientation="vertical"
        aria-label="Pages"
        sx={{
          display: 'flex', flexDirection: 'column', gap: 0.5, px: mini ? 3 : 3, pt: 2,
        }}
      >
        {main.map((t) => (
          <NavItem key={t.id} item={t} selected={t.id === tab} mini={mini} onClick={() => onTab(t.id)} />
        ))}
        {admin.length > 0 && <Divider sx={{ my: 2, mx: mini ? 0 : 2 }} role="presentation" />}
        {admin.map((t) => (
          <NavItem key={t.id} item={t} selected={t.id === tab} mini={mini} onClick={() => onTab(t.id)} />
        ))}
      </Box>

      <Box sx={{ flex: 1, minHeight: 16 }} />

      {coverage && !mini && (
        <Box sx={{ px: 3, pb: 3 }}>
          <Coverage coverage={coverage} />
        </Box>
      )}

      <Box sx={{
        borderTop: 1, borderColor: 'border.subtle', px: mini ? 0 : 2, py: 2, display: 'flex', flexDirection: 'column',
      }}
      >
        <UserRow
          me={me}
          mini={mini}
          previewing={previewing}
          onToggleView={onToggleView}
          onSignOut={onSignOut}
          mode={mode}
          onToggleMode={onToggleMode}
        />
      </Box>
    </Box>
  )
}

/*
 * `overlay`: the tablet's wide menu, laid over the page from the folded rail
 * rather than pushing it aside. `onDismiss` closes it.
 */
export default function Sidebar(props) {
  const {
    phone, open, onClose, mini, overlay, onDismiss,
  } = props

  if (phone) {
    return (
      <Drawer
        variant="temporary"
        open={open}
        onClose={onClose}
        // Mounted while closed, so the pages are in the document for anything
        // that looks for them, and the menu opens without a rebuild.
        ModalProps={{ keepMounted: true }}
        sx={{ '&.MuiModal-hidden': { display: 'none' } }}
        PaperProps={{
          sx: {
            width: 280, maxWidth: '85vw', bgcolor: 'bg.sidebar', borderRight: 1, borderColor: 'border.subtle', boxShadow: 'none',
          },
        }}
      >
        <NavBody {...props} mini={false} />
      </Drawer>
    )
  }

  const wide = overlay || !mini
  return (
    <>
      {overlay && (
        <Box
          onClick={onDismiss}
          aria-hidden
          sx={{
            position: 'fixed', inset: 0, zIndex: (t) => t.zIndex.appBar + 1, bgcolor: (t) => (t.palette.mode === 'dark' ? 'rgba(5,8,12,.45)' : 'rgba(16,24,40,.2)'),
          }}
        />
      )}
      <Box
        component="nav"
        aria-label="Main"
        sx={{
          position: 'fixed',
          top: 0,
          bottom: 0,
          left: 0,
          width: wide ? NAV_W : NAV_W_MINI,
          zIndex: (t) => t.zIndex.appBar + 2,
          transition: 'width 200ms ease-out',
          bgcolor: 'bg.sidebar',
          borderRight: 1,
          borderColor: 'border.subtle',
          ...(overlay && { boxShadow: (t) => (t.palette.mode === 'dark' ? '0 8px 24px rgba(0,0,0,.45)' : '0 8px 24px rgba(16,24,40,.12)') }),
        }}
      >
        <NavBody {...props} mini={!wide} />
      </Box>
    </>
  )
}
