import { Box, Paper, Typography, Tooltip } from '@mui/material'
import InfoOutlinedIcon from '@mui/icons-material/InfoOutlined'
import { STATUS } from '../lib/palette.js'

/**
 * A headline number with optional context line. Deliberately not a chart —
 * a single current value reads better as a tile than as a one-bar bar chart.
 */
export default function StatTile({ label, value, unit, context, tone, help, hero = false }) {
  const toneColor =
    tone === 'good' ? STATUS.good : tone === 'critical' ? STATUS.critical : tone === 'warning' ? STATUS.warning : null

  return (
    <Paper
      variant="outlined"
      sx={{
        p: 2,
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'space-between',
        borderColor: 'divider',
      }}
    >
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, mb: 1 }}>
        <Typography variant="subtitle2" sx={{ color: 'text.secondary' }}>
          {label}
        </Typography>
        {help && (
          <Tooltip title={help} arrow placement="top">
            <InfoOutlinedIcon sx={{ fontSize: 14, color: 'text.disabled', cursor: 'help' }} />
          </Tooltip>
        )}
      </Box>
      <Box sx={{ display: 'flex', alignItems: 'baseline', gap: 0.75 }}>
        <Typography
          component="div"
          sx={{
            fontSize: hero ? '2.75rem' : '1.75rem',
            fontWeight: 600,
            lineHeight: 1.05,
            letterSpacing: '-0.02em',
            color: toneColor || 'text.primary',
          }}
        >
          {value}
        </Typography>
        {unit && (
          <Typography variant="body2" sx={{ color: 'text.secondary', fontWeight: 500 }}>
            {unit}
          </Typography>
        )}
      </Box>
      {context && (
        <Typography variant="caption" sx={{ color: 'text.secondary', mt: 1, display: 'block' }}>
          {context}
        </Typography>
      )}
    </Paper>
  )
}
