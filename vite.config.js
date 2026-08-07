import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  build: {
    outDir: 'dist',
    // xlsx and the MUI surface are both large; split them so the initial
    // paint is not blocked by the export path.
    rollupOptions: {
      output: {
        manualChunks: {
          mui: ['@mui/material', '@mui/icons-material'],
          xlsx: ['xlsx'],
        },
      },
    },
  },
  server: { port: 5173 },
})
