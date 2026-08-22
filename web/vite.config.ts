import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  base: './',
  server: {
    port: 5173,
    host: true,
  },
  build: {
    // 避免在沙箱环境触发 safe-delete bulk guard
    emptyOutDir: false,
  },
})
