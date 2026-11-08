import {
  Dialog, DialogTitle, DialogContent, Box, Typography, Button, IconButton, Tooltip,
} from '@mui/material'
import CloseIcon from '@mui/icons-material/Close'
import OpenInNewIcon from '@mui/icons-material/OpenInNew'
import ReceiptLongIcon from '@mui/icons-material/ReceiptLong'
import Project from '../pages/Project.jsx'

/**
 * A PROJECT'S DETAIL, OVER THE REGISTER.
 *
 * The same page #project/KEY opens — reused, not copied — so the two can
 * never disagree. Its edits (the active switch, resume) go through the
 * register's own onUpdate. The whole screen on a phone; large on anything
 * wider. Esc closes it.
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
          '&&': { m: 0, width: '100%', maxWidth: '100%', maxHeight: '100%', height: '100%', borderRadius: 0, border: 0 },
        } : undefined,
      }}
    >
      <DialogTitle
        id="project-detail-title"
        component="div"
        sx={{ display: 'flex', alignItems: 'center', gap: 1, py: 1.25, pr: 1.25, borderBottom: 1, borderColor: 'divider' }}
      >
        <Typography variant="subtitle2" sx={{ color: 'text.secondary', flex: 1, minWidth: 0 }} noWrap>
          Project{p?.jiraKey ? ` · ${p.jiraKey}` : ''}
        </Typography>
        {p && (
          <Button
            size="small"
            component="a"
            href={`#project/${encodeURIComponent(p.key)}`}
            onClick={onClose}
            endIcon={<OpenInNewIcon sx={{ fontSize: '16px !important' }} />}
            sx={{ color: 'text.secondary', whiteSpace: 'nowrap' }}
          >
            {phone ? 'Full page' : 'Open full page'}
          </Button>
        )}
        <Tooltip title="Close (Esc)">
          <IconButton size="small" onClick={onClose} aria-label="close project">
            <CloseIcon fontSize="small" />
          </IconButton>
        </Tooltip>
      </DialogTitle>
      <DialogContent sx={{ p: { xs: 1.5, sm: 2.5 }, pt: { xs: '12px !important', sm: '20px !important' } }}>
        {open && (
          <Box>
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
                  size="small"
                  startIcon={<ReceiptLongIcon />}
                  onClick={() => onCostSheet(p.key)}
                  data-open-cost-sheet
                >
                  Cost sheet
                </Button>
              )}
            />
          </Box>
        )}
      </DialogContent>
    </Dialog>
  )
}
