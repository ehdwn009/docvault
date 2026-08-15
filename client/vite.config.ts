import fs from 'node:fs';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// 버전의 단일 출처는 루트 package.json — 빌드 시점에 상수로 박아 넣는다
const rootPkg = JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as {
  version?: string;
};

export default defineConfig({
  plugins: [react(), tailwindcss()],
  define: {
    __APP_VERSION__: JSON.stringify(rootPkg.version ?? '0.0.0'),
    __BUILD_DATE__: JSON.stringify(new Date().toISOString().slice(0, 10)),
  },
  server: {
    // dev에서는 Vite(5173)가 API 요청을 Hono 서버(3000)로 프록시한다.
    // 배포에서는 동일 오리진이므로 프록시가 필요 없다.
    proxy: {
      '/api': 'http://localhost:3000',
    },
    // 폰트는 CORS 필수 자원 — 격리 오리진(HTML 문서 iframe)에서도 /fonts를 가져갈 수 있게 허용
    headers: {
      'Access-Control-Allow-Origin': '*',
    },
  },
});
