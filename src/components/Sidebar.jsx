import {
  Box, Drawer, Typography, Tooltip, IconButton, Button, LinearProgress, ButtonBase, Avatar, Switch,
} from '@mui/material'
import PreviewIcon from '@mui/icons-material/VisibilityOutlined'
import { alpha, useTheme } from '@mui/material/styles'
import ChevronLeftIcon from '@mui/icons-material/ChevronLeft'
import ChevronRightIcon from '@mui/icons-material/ChevronRight'
import CloseIcon from '@mui/icons-material/Close'
import LogoutIcon from '@mui/icons-material/Logout'
import { SURFACE } from '../theme.js'
import { IconTile, PAGE_COLOR, displayName as nameOf } from './Brand.jsx'

/*
 * THE SIDE MENU.
 *
 * Replaces the tab strip that ran across the top. Nine pages in one row did
 * not fit a laptop without scrolling and did not fit a phone at all; a column
 * holds them with room to spare and says where you are at a glance.
 *
 * Three shapes:
 *   - wide on a computer: icon and name for every page;
 *   - folded on a computer: icons only, the name on hover — for the Timeline
 *     and the register, which want every pixel of width they can get;
 *   - on a phone: hidden, and slid in over the page from the ☰ button.
 *
 * The pages are a real tab list (role="tab", aria-selected), as the top strip
 * was: a screen reader announces them the same way, and the browser checks
 * that find a page by its tab keep working.
 */

export const NAV_W = 252
export const NAV_W_MINI = 76

const displayName = (email) => nameOf(email)

const initials = (email) => displayName(email).split(' ').map((w) => w[0]).slice(0, 2).join('')

function NavItem({
  item, selected, mini, onClick,
}) {
  const theme = useTheme()
  const blue = theme.palette.primary.main
  const button = (
    <ButtonBase
      role="tab"
      aria-selected={selected}
      onClick={onClick}
      sx={{
        width: '100%',
        justifyContent: mini ? 'center' : 'flex-start',
        gap: 1.5,
        px: mini ? 0 : 1,
        py: mini ? 0.75 : 0.75,
        borderRadius: '12px',
        color: selected ? 'text.primary' : 'text.secondary',
        fontWeight: selected ? 650 : 500,
        fontSize: '0.875rem',
        transition: 'background-color .15s, color .15s',
        ...(selected
          ? {
            // A quiet wash and a thin bar at the edge: where you are is
            // plain, without the menu shouting it.
            bgcolor: alpha(blue, 0.14),
            boxShadow: `inset 3px 0 0 ${blue}`,
          }
          : { '&:hover': { bgcolor: 'action.hover', color: 'text.primary' } }),
      }}
    >
      {/* Each page has its colour, as the reference gives each project
          one: the eye finds Timeline by its cyan before it reads the word. */}
      <IconTile icon={item.icon} color={PAGE_COLOR[item.id]} size={30} />
      {/* Kept in the page when folded, only hidden: the tab still has its name
          for a screen reader and for anything that finds it by its text. */}
      <Box component="span" sx={{ display: mini ? 'none' : 'block', whiteSpace: 'nowrap' }}>{item.label}</Box>
    </ButtonBase>
  )
  return mini ? <Tooltip title={item.label} placement="right">{button}</Tooltip> : button
}

function NavBody({
  tabs, tab, onTab, mini, onFold, phone, onClose, me, onSignOut, coverage, previewing, onToggleView,
}) {
  const theme = useTheme()
  const roleWord = me?.local ? 'Local copy'
    : previewing ? 'Admin · as a member'
      : me?.role === 'admin' ? 'Administrator' : 'Team member'

  return (
    <Box sx={{
      height: '100%', display: 'flex', flexDirection: 'column', p: mini ? 1.25 : 2, gap: 2, overflowY: 'auto', overflowX: 'hidden',
    }}
    >
      {/* Who is signed in. On a shared machine the first thing worth knowing
          is whose session it is, so it heads the menu. */}
      <Box sx={{
        display: 'flex', alignItems: 'center', gap: 1.25, pb: 2, borderBottom: 1, borderColor: 'divider',
        flexDirection: mini ? 'column' : 'row',
      }}
      >
        <Avatar sx={{
          width: 40, height: 40, fontSize: '0.85rem', fontWeight: 700,
          color: theme.palette.primary.light,
          bgcolor: alpha(theme.palette.primary.main, 0.16),
          border: `1px solid ${alpha(theme.palette.primary.main, 0.3)}`,
        }}
        >
          {me?.local ? 'L' : initials(me?.email)}
        </Avatar>
        {!mini && (
          <Box sx={{ minWidth: 0, flex: 1 }}>
            <Typography variant="body2" noWrap sx={{ fontWeight: 700 }}>
              {me?.local ? 'No accounts' : displayName(me?.email)}
            </Typography>
            <Typography variant="caption" noWrap sx={{ color: 'text.secondary', display: 'block', letterSpacing: '0.04em', textTransform: 'uppercase', fontSize: '0.65rem' }}>
              {roleWord}
            </Typography>
          </Box>
        )}
        {phone ? (
          <IconButton size="small" onClick={onClose} aria-label="close menu"><CloseIcon fontSize="small" /></IconButton>
        ) : (
          <Tooltip title={mini ? 'Open the menu' : 'Fold the menu'} placement="right">
            <IconButton
              size="small"
              onClick={onFold}
              aria-label={mini ? 'expand menu' : 'collapse menu'}
              sx={{
                color: 'text.secondary', width: 28, height: 28, borderRadius: '50%', border: 1, borderColor: 'divider',
                '&:hover': { color: 'text.primary', bgcolor: 'action.hover' },
              }}
            >
              {mini ? <ChevronRightIcon sx={{ fontSize: 18 }} /> : <ChevronLeftIcon sx={{ fontSize: 18 }} />}
            </IconButton>
          </Tooltip>
        )}
      </Box>

      {/*
        * An administrator who is also on the team can see the app as the
        * team does — to try a page as a member would, or to fill in their own
        * week without the administrator's view around it.
        */}
      {onToggleView && !me?.local && (mini ? (
        <Tooltip title={previewing ? 'Back to the administrator view' : 'View as a team member'} placement="right">
          <IconButton
            onClick={() => onToggleView(!previewing)}
            aria-label="view as a team member"
            aria-pressed={previewing}
            sx={{ alignSelf: 'center', color: previewing ? 'primary.light' : 'text.secondary', bgcolor: previewing ? alpha(theme.palette.primary.main, 0.14) : undefined }}
          >
            <PreviewIcon fontSize="small" />
          </IconButton>
        </Tooltip>
      ) : (
        <Box
          component="label"
          sx={{
            display: 'flex', alignItems: 'center', gap: 1, px: 1.25, py: 0.5, mt: -0.5, borderRadius: '12px', cursor: 'pointer',
            border: 1, borderColor: previewing ? alpha(theme.palette.primary.main, 0.4) : 'divider',
            bgcolor: previewing ? alpha(theme.palette.primary.main, 0.1) : 'transparent',
          }}
        >
          <PreviewIcon sx={{ fontSize: 18, color: previewing ? 'primary.light' : 'text.secondary' }} />
          <Box sx={{ flex: 1, minWidth: 0 }}>
            <Typography variant="body2" sx={{ fontWeight: 600, lineHeight: 1.3 }}>View as a team member</Typography>
            <Typography variant="caption" sx={{ color: 'text.secondary', lineHeight: 1.3, display: 'block' }}>
              {previewing ? 'On — what your team sees' : 'See the app as your team does'}
            </Typography>
          </Box>
          <Switch
            size="small"
            checked={!!previewing}
            onChange={(e) => onToggleView(e.target.checked)}
            inputProps={{ 'aria-label': 'view as a team member' }}
          />
        </Box>
      ))}

      <Box>
        {!mini && (
          <Typography variant="subtitle2" sx={{ color: 'text.disabled', fontSize: '0.65rem', px: 1, mb: 1, display: 'block' }}>
            F&amp;A Tech · 2026 plan
          </Typography>
        )}
        <Box role="tablist" aria-orientation="vertical" aria-label="Pages" sx={{ display: 'flex', flexDirection: 'column', gap: 0.5 }}>
          {tabs.map((t) => (
            <NavItem key={t.id} item={t} selected={t.id === tab} mini={mini} onClick={() => onTab(t.id)} />
          ))}
        </Box>
      </Box>

      <Box sx={{ flex: 1 }} />

      {/* Where the team stands against the year, always in view — what the
          old top bar's hours chip said, given room to say it properly. */}
      {coverage && !mini && (
        <Box sx={{
          p: 2, borderRadius: '16px', border: 1, borderColor: 'divider',
          bgcolor: alpha(theme.palette.text.primary, 0.025),
        }}
        >
          <Typography variant="caption" sx={{ color: 'text.secondary', display: 'block' }}>{coverage.label || 'Saving hours, committed'}</Typography>
          <Typography variant="h3" sx={{ fontVariantNumeric: 'tabular-nums', mt: 0.25 }}>
            {coverage.total.toLocaleString()}
            <Typography component="span" variant="caption" sx={{ color: 'text.secondary', ml: 0.75 }}>
              / {coverage.target.toLocaleString()} {coverage.unit || 'hrs'}
            </Typography>
          </Typography>
          <LinearProgress
            variant="determinate"
            value={Math.min(100, coverage.share * 100)}
            color={coverage.tone}
            sx={{ mt: 1, height: 6, bgcolor: alpha(theme.palette.text.primary, 0.08) }}
          />
          <Typography variant="caption" sx={{ color: 'text.secondary', display: 'block', mt: 0.75 }}>
            {coverage.note || `${Math.round(coverage.share * 100)}% of the year’s target`}
          </Typography>
        </Box>
      )}

      {/* Nothing to sign out of when there are no accounts. */}
      {!me?.local && (
        mini ? (
          <Tooltip title="Sign out" placement="right">
            <IconButton onClick={onSignOut} aria-label="Sign out" sx={{ alignSelf: 'center' }}>
              <LogoutIcon fontSize="small" />
            </IconButton>
          </Tooltip>
        ) : (
          <Button
            onClick={onSignOut}
            startIcon={<LogoutIcon fontSize="small" />}
            sx={{ color: 'text.secondary', justifyContent: 'flex-start', px: 1.75 }}
          >
            Sign out
          </Button>
        )
      )}
    </Box>
  )
}

export default function Sidebar(props) {
  const { phone, open, onClose, mini } = props
  const theme = useTheme()
  const s = SURFACE[theme.palette.mode === 'dark' ? 'dark' : 'light']

  if (phone) {
    return (
      <Drawer
        variant="temporary"
        open={open}
        onClose={onClose}
        // Mounted while closed, so the pages are in the document for anything
        // that looks for them, and the menu opens without a rebuild.
        ModalProps={{ keepMounted: true }}
        PaperProps={{ sx: { width: Math.min(NAV_W, 300), bgcolor: s.rail, borderRight: 1, borderColor: 'divider' } }}
      >
        <NavBody {...props} mini={false} />
      </Drawer>
    )
  }

  const width = mini ? NAV_W_MINI : NAV_W
  return (
    <Box
      component="nav"
      sx={{
        position: 'fixed',
        top: 12,
        bottom: 12,
        left: 12,
        width,
        zIndex: (t) => t.zIndex.appBar + 1,
        transition: 'width .2s ease',
        bgcolor: alpha(s.rail, theme.palette.mode === 'dark' ? 0.86 : 0.95),
        backdropFilter: 'blur(14px)',
        border: 1,
        borderColor: 'divider',
        borderRadius: '22px',
      }}
    >
      <NavBody {...props} />
    </Box>
  )
}
