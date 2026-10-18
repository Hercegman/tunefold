import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { defineConfig } from 'vite'

const host = process.env.TAURI_DEV_HOST

export default defineConfig({
  plugins: [react(), tailwindcss()],
  clearScreen: false,
  server: {
    port: 5173,
    strictPort: true,
    host: host || false,
  },
  envPrefix: ['VITE_', 'TAURI_ENV_*'],
  build: {
    target: 'chrome105',
    sourcemap: false,
  },
})
