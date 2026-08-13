import fs from 'node:fs';
import path from 'node:path';
import { serve } from '@hono/node-server';
import { serveStatic } from '@hono/node-server/serve-static';
import { Hono } from 'hono';
import { logger } from 'hono/logger';
import { config } from './config.js';
import { initDb } from './db/index.js';
import { seedAdmin } from './db/seed.js';

initDb();
seedAdmin();

const app = new Hono();

app.use(logger());

const api = new Hono();
api.get('/health', (c) => c.json({ status: 'ok', version: '0.1.0' }));

app.route('/api/v1', api);

// SPA 정적 서빙: 빌드 결과물이 있으면 서빙하고, 미지의 경로는 index.html로 폴백(딥링크 지원)
if (fs.existsSync(config.clientDist)) {
  const root = path.relative(process.cwd(), config.clientDist);
  app.use('*', serveStatic({ root }));
  app.get('*', serveStatic({ root, path: 'index.html' }));
} else {
  app.get('/', (c) =>
    c.text('docvault API server. Client build not found — run `npm run build -w client`.'),
  );
}

serve({ fetch: app.fetch, port: config.port }, (info) => {
  console.log(`[docvault] listening on http://localhost:${info.port}`);
  console.log(`[docvault] data dir: ${config.dataDir}`);
});
