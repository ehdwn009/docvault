import fs from 'node:fs';
import path from 'node:path';
import { serve } from '@hono/node-server';
import { serveStatic } from '@hono/node-server/serve-static';
import { Hono, type Context } from 'hono';
import { logger } from 'hono/logger';
import { APP_VERSION, config } from './config.js';
import { HEALTH_PATH, SLOW_REQUEST_MS, STATIC_ASSET_MAX_AGE_S, TRASH_PURGE_INTERVAL_MS } from './constants.js';
import { initDb } from './db/index.js';
import { seedAdmin } from './db/seed.js';
import { purgeExpiredTrash } from './lib/trash.js';
import { authGuard } from './middleware/auth.js';
import { adminRoutes } from './routes/admin.js';
import { askRoutes, purgeExpiredThreads } from './routes/ask.js';
import { cardRoutes } from './routes/cards.js';
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
// 저장 안 한 질문 대화도 같은 주기로 정리한다 (배움 카드 설계 — 30일 보관)
purgeExpiredThreads();
setInterval(purgeExpiredThreads, TRASH_PURGE_INTERVAL_MS);

const app = new Hono();

// 요청 로그 — /health는 뺀다. 도커 헬스체크가 30초마다 두 줄씩 찍어 진짜 요청이 로그 밖으로 밀려난다
const requestLogger = logger();
app.use(async (c, next) => (c.req.path === HEALTH_PATH ? next() : requestLogger(c, next)));

// 서버가 실제로 일한 시간을 응답 헤더로 — 폰의 시작 시간 표(설정 → 정보)가 "회선 vs 서버"를 가른다.
// 서버 로그는 3ms인데 폰은 3.5초였던 날, 둘을 한 표에서 보려고 넣었다 (IA — 시작 시간 측정)
app.use('/api/*', async (c, next) => {
  const t0 = performance.now();
  await next();
  const ms = performance.now() - t0;
  // 라우트가 부분별 시간을 먼저 붙였을 수 있다(tree.ts) — 덮어쓰지 않고 뒤에 단다
  c.header('Server-Timing', `app;dur=${ms.toFixed(1)}`, { append: true });
  if (ms >= SLOW_REQUEST_MS) console.log(`[slow] ${c.req.method} ${c.req.path} ${c.res.headers.get('Server-Timing')}`);
});

// 보안 헤더. 비용이 거의 0이라 규모와 무관하게 켜 둔다.
// 여기 헤더는 앱 자체에 건다. 앱에는 CSP를 걸지 않는다 — 업로드된 남의 문서 쪽에만
// iframe sandbox와 CSP: sandbox를 따로 씌워 격리한다 (files.ts의 /raw).
app.use('*', async (c, next) => {
  await next();
  c.header('X-Content-Type-Options', 'nosniff'); // 타입 추측으로 스크립트가 실행되는 것 방지
  // 클릭재킹의 실체는 "남의 사이트가 우리를 투명한 액자에 넣는 것"이고, SAMEORIGIN이 그걸 전부 막는다.
  // DENY가 더 막는 것은 우리 자신의 프레임뿐인데 그걸로 지켜지는 게 없다 — 우리 오리진에
  // 페이지를 올릴 수 있는 공격자라면 이미 그보다 큰 걸 가진 뒤다.
  // (v0.19.1에 DENY가 우리 PDF 뷰어의 iframe까지 막아 배포에서 차단된 적이 있다. v0.20.0에
  //  PDF가 canvas로 바뀌어 그 사정은 사라졌지만, 위 이유로 SAMEORIGIN을 그대로 둔다)
  c.header('X-Frame-Options', 'SAMEORIGIN');
  c.header('Referrer-Policy', 'same-origin'); // 외부로 나갈 때 문서 주소(딥링크)를 흘리지 않게
  c.header('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  // HSTS는 https로 들어온 요청에만 — http에 붙이면 무시되고, 개발(localhost)에 붙으면 방해가 된다
  if (config.isProduction) {
    c.header('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  }
});

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
api.route('/ask', askRoutes);
api.route('/cards', cardRoutes);
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
  // 캐시: /assets/*는 파일명에 해시가 있어 내용이 바뀌면 이름도 바뀐다 → 1년 immutable(재방문은 다운로드 0).
  // index.html은 그 해시 이름을 가리키는 입구라 매번 서버에 확인(no-cache) — 새 배포가 바로 보이게
  const cacheHeaders = (filePath: string, c: Context) => {
    if (filePath.includes('/assets/')) c.header('Cache-Control', `public, max-age=${STATIC_ASSET_MAX_AGE_S}, immutable`);
    else if (filePath.endsWith('index.html')) c.header('Cache-Control', 'no-cache');
  };
  app.use('*', serveStatic({ root, onFound: cacheHeaders }));
  app.get('*', serveStatic({ root, path: 'index.html', onFound: cacheHeaders }));
} else {
  app.get('/', (c) =>
    c.text('docvault API server. Client build not found — run `npm run build -w client`.'),
  );
}

serve({ fetch: app.fetch, port: config.port }, (info) => {
  console.log(`[docvault] listening on http://localhost:${info.port}`);
  console.log(`[docvault] data dir: ${config.dataDir}`);
});
