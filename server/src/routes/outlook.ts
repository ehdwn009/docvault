import { Hono, type Context } from 'hono';
import { fail } from '../lib/errors.js';
import { manualPlan, startOutlookJob } from '../lib/outlook/job.js';
import { editionById, setEditionStatus } from '../lib/outlook/store.js';
import { outlookView } from '../lib/outlook/view.js';
import { parseId } from '../lib/validate.js';
import type { AppEnv } from '../types.js';

// 세계 전망 — 동향 탭(SCR-195)의 "세계 전망" 칸이 읽는다 (세계전망 설계 출시 2단계). 읽기는 모든 로그인 계정, 만들기·내리기는 관리자

/** 내리기·다시 올리기 — 판이 없으면 404 */
function changeStatus(c: Context<AppEnv>, status: 'published' | 'hidden') {
  if (c.get('user').role !== 'admin') return fail(c, 403, 'FORBIDDEN', '관리자 전용입니다');
  const id = parseId(c.req.param('id'));
  if (id === null || !editionById(id)) return fail(c, 404, 'NOT_FOUND', '그런 판이 없어요');
  setEditionStatus(id, status);
  return c.json({ status });
}

export const outlookRoutes = new Hono<AppEnv>()
  // API-173 — 모든 로그인 계정
  .get('/', (c) => c.json(outlookView(c.get('user'))))
  // API-174 — 수동 작은 판. 예약 작업을 켜는 일이라(구독 사용량) 관리자만
  .post('/run', async (c) => {
    if (c.get('user').role !== 'admin') return fail(c, 403, 'FORBIDDEN', '관리자 전용입니다');
    const plan = manualPlan();
    const r = await startOutlookJob(plan);
    if (r === 'fired') return c.json({ status: 'started', label: plan.label }, 202);
    if (r === 'running') return fail(c, 409, 'OUTLOOK_RUNNING', '이미 만들고 있어요. 끝나면 알림이 와요');
    if (r === 'no_trigger') return fail(c, 409, 'OUTLOOK_TRIGGER_MISSING', '예약 작업이 연결돼 있지 않아요. 나 › 구독 연결에서 먼저 연결해 주세요');
    if (r === 'nothing') return fail(c, 409, 'OUTLOOK_NOTHING_TO_READ', '새로 읽을 기간이 없어요 — 오늘까지 나온 글은 이미 판에 담겼어요');
    return fail(c, 502, 'OUTLOOK_TRIGGER_FAILED', '예약 작업을 켜지 못했어요. 잠시 뒤 다시 눌러 주세요');
  })
  // API-175·176 — 내리기는 목록에서만 감춘다(파일 읽기는 막지 않는다)
  .post('/editions/:id/hide', (c) => changeStatus(c, 'hidden'))
  .post('/editions/:id/show', (c) => changeStatus(c, 'published'));
