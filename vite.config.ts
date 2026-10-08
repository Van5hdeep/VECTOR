import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/api': {
        // The server binds to IPv4 loopback only; avoid localhost resolving to ::1
        target: `http://127.0.0.1:${process.env.VECTOR_PORT || 3001}`,
        changeOrigin: true,
      },
    },
  },
})
