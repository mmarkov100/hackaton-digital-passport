import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import { resolve } from 'node:path'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: { proxy: { '/api': 'http://localhost:8080' } },
  build: { rollupOptions: { input: { main: resolve(import.meta.dirname, 'index.html'), viewer: resolve(import.meta.dirname, 'viewer.html') } } },
})
