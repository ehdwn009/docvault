import fs from 'node:fs';
import path from 'node:path';
import { serve } from '@hono/node-server';
import { serveStatic } from '@hono/node-server/serve-static';
import { Hono } from 'hono';
import { logger } from 'hono/logger';
import { APP_VERSION, config } from './config.js';
import { TRASH_PURGE_INTERVAL_MS } from './constants.js';
import { initDb } from './db/index.js';
import { seedAdmin } from './db/seed.js';
import { purgeExpiredTrash } from './lib/trash.js';
import { authGuard } from './middleware/auth.js';
import { adminRoutes } from './routes/admin.js';
import { shareTargetRoutes } from './routes/share-target.js';
import { authRoutes } from './routes/auth.js';
import { fileRoutes } from './routes/files.js';
import { folderRoutes } from './routes/folders.js';
import { meRoutes } from './routes/me.js';
import { searchRoutes } from './routes/search.js';
import { sharedRoutes } from './routes/shared.js';
import { tagRoutes } from './routes/tags.js';
import { treeRoutes } from './routes/tree.js';
import type { AppEnv } from './types.js';

initDb();
seedAdmin();

// 휴지통 자동 비움 — 기동 시 1회 + 하루 주기 (IA — 휴지통 30일 보관)
purgeExpiredTrash();
setInterval(purgeExpiredTrash, TRASH_PURGE_INTERVAL_MS);

const app = new Hono();

app.use(logger());

const api = new Hono<AppEnv>();
api.use('*', authGuard);
api.get('/health', (c) => c.json({ status: 'ok', version: APP_VERSION }));
// 업데이트 기록 (SCR-144) — 저장소 루트의 CHANGELOG.md를 그대로 내려준다 (렌더링은 클라이언트 md 렌더러가)
api.get('/changelog', (c) => {
  let content = '';
  try {
    content = fs.readFileSync(path.join(config.appRoot, 'CHANGELOG.md'), 'utf8');
  } catch {
    // 파일이 없어도 화면이 죽지 않게 빈 내용으로
  }
  return c.json({ version: APP_VERSION, content });
});
api.route('/admin', adminRoutes);
api.route('/auth', authRoutes);
api.route('/tree', treeRoutes);
api.route('/files', fileRoutes);
api.route('/folders', folderRoutes);
api.route('/me', meRoutes);
api.route('/search', searchRoutes);
api.route('/shared', sharedRoutes);
api.route('/tags', tagRoutes);

app.route('/api/v1', api);
// PWA 공유 시트 수신. deny by default의 유일한 예외 — 매니페스트 share_target이 고정 주소를
// 요구해 /api/v1 밖에 두었고, 그래서 라우트가 resolveSessionUser로 인증을 직접 검사한다.
app.route('/share-target', shareTargetRoutes);

// SPA 정적 서빙: 빌드 결과물이 있으면 서빙하고, 미지의 경로는 index.html로 폴백(딥링크 지원)
if (fs.existsSync(config.clientDist)) {
  const root = path.relative(process.cwd(), config.clientDist);
  // 폰트는 CORS 필수 자원 — HTML 문서 iframe(격리 오리진)에서도 가져갈 수 있게 허용
  app.use('/fonts/*', async (c, next) => {
    await next();
    c.header('Access-Control-Allow-Origin', '*');
  });
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
