import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Bind dev server to loopback only.
export default defineConfig({
  base: './', // lets the built dist/ folder work from any folder or Live Server
  plugins: [react()],
  test: { environment: 'jsdom', include: ['tests/ui/**/*.test.jsx'], testTimeout: 20000 },
  server: {
    host: 'localhost',
    port: 5173,
    // Forward API calls to the SafeKaki server (npm run server)
    proxy: { '/api': 'http://127.0.0.1:8787' },
  },
})
