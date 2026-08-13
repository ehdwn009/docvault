import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    // dev에서는 Vite(5173)가 API 요청을 Hono 서버(3000)로 프록시한다.
    // 배포에서는 동일 오리진이므로 프록시가 필요 없다.
    proxy: {
      '/api': 'http://localhost:3000',
    },
  },
});
