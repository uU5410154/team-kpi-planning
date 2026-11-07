import {
  Dialog, DialogTitle, DialogContent, Typography, Button, IconButton, Tooltip,
} from '@mui/material'
import CloseIcon from '@mui/icons-material/Close'
import OpenInFullIcon from '@mui/icons-material/OpenInFull'
import ReceiptLongIcon from '@mui/icons-material/ReceiptLongOutlined'
import Project from '../pages/Project.jsx'

/**
 * A PROJECT'S DETAIL, OVER THE REGISTER.
 *
 * The same page #project/KEY opens, reused rather than copied, so the two
 * can never disagree. Its edits (the active switch, resume) go through the
 * register's own onUpdate. A large dialog (1040) on anything wider than a
 * phone; the whole screen on a phone, its title bar staying put while the
 * body scrolls. Esc closes it.
 */
export default function ProjectDetailDialog({
  projectKey, plan, canWrite, phone, onUpdate, onClose, onCostSheet, onShowTimeline,
}) {
  const p = projectKey == null ? null : plan.projects.find((x) => x.key === projectKey)
  const open = !!projectKey
  return (
    <Dialog
      open={open}
      onClose={onClose}
      fullScreen={phone}
      maxWidth="lg"
      fullWidth
      scroll="paper"
      aria-labelledby="project-detail-title"
      data-project-detail={projectKey || ''}
      // The theme keeps a 12px margin round a dialog on a phone; full screen
      // means full screen. Doubled class, so this outranks the theme's rule.
      PaperProps={{
        sx: phone ? {
          '&&': {
            m: 0, width: '100%', maxWidth: '100%', maxHeight: '100%', height: '100%', borderRadius: 0, border: 0,
          },
        } : undefined,
      }}
    >
      <DialogTitle
        id="project-detail-title"
        component="div"
        sx={{
          display: 'flex', alignItems: 'center', gap: 2, py: 3, pl: 5, pr: 3, borderBottom: 1, borderColor: 'border.subtle',
        }}
      >
        <Typography variant="h2" component="h2" sx={{ fontSize: '1.125rem', lineHeight: '26px', flex: 1, minWidth: 0 }} noWrap>
          {p ? (p.jiraKey || p.key) : 'Project'}
        </Typography>
        {p && (
          <Button
            variant="text"
            component="a"
            href={`#project/${encodeURIComponent(p.key)}`}
            onClick={onClose}
            startIcon={<OpenInFullIcon />}
            sx={{ whiteSpace: 'nowrap' }}
          >
            Open full page
          </Button>
        )}
        <Tooltip title="Close (Esc)">
          <IconButton onClick={onClose} aria-label="close project" sx={{ color: 'text.secondary', width: { xs: 40, sm: 32 }, height: { xs: 40, sm: 32 } }}>
            <CloseIcon fontSize="small" />
          </IconButton>
        </Tooltip>
      </DialogTitle>
      <DialogContent sx={{ p: { xs: 3, sm: 5 }, pt: { xs: '16px !important', sm: '20px !important' } }}>
        {open && (
          <Project
            key={projectKey}
            plan={plan}
            projectKey={projectKey}
            canWrite={canWrite}
            onUpdate={onUpdate}
            onBack={onClose}
            onShowTimeline={(k) => { onClose(); onShowTimeline?.(k) }}
            inDialog
            actions={p && (
              <Button
                variant="text"
                startIcon={<ReceiptLongIcon />}
                onClick={() => onCostSheet(p.key)}
                data-open-cost-sheet
              >
                Cost sheet
              </Button>
            )}
          />
        )}
      </DialogContent>
    </Dialog>
  )
}
