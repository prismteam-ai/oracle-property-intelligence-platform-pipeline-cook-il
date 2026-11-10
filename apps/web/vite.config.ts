import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  root: 'src/ui',
  plugins: [react()],
  build: { outDir: '../../dist/ui', emptyOutDir: true },
  server: {
    port: 5173,
    proxy: {
      '/trpc': 'http://localhost:8080',
      '/mcp': 'http://localhost:8080',
      '/health': 'http://localhost:8080',
    },
  },
});
