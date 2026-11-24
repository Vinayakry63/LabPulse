import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// dev: proxy to the docker-compose load balancer (same shape as the production nginx)
export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/api': { target: 'http://localhost:8080', rewrite: (p) => p.replace(/^\/api/, '') },
      '/socket.io': { target: 'http://localhost:8080', ws: true },
    },
  },
});
