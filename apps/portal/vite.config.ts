import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Separate port from apps/web (5173) so both dev servers can run at once.
export default defineConfig({
  plugins: [react()],
  server: { port: 5174 },
})
