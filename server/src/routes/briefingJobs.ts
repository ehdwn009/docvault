import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { createMiddleware } from 'hono/factory';
import { z } from 'zod';
import { BRIEFING } from '../constants.js';
import { SelectedSchema } from '../lib/briefing/jobCandidates.js';
import { candidatesView, MaterialsError, materialsView, startRead } from '../lib/briefing/jobMaterials.js';
import { acceptResult, instructionFor, jobByJobId, JobError, prevStoryIdsOf, recordProgress, resolvePing } from '../lib/briefing/subscription.js';
import { fail } from '../lib/errors.js';
import { jsonBody } from '../lib/validate.js';
import type { AppEnv } from '../types.js';

// API-151~156 — claude.ai 예약 작업이 연결 열쇠(Bearer)로 부르는 주소들. 사람(쿠키)은 들어올 수 없다.
// 154~156(후보·원문 읽기·재료)은 "재료는 서버가"(v0.59) — 세션이 수집·원문 읽기를 서버에 맡기는 길. 서버가 가진 것이 없으면 세션이 직접 한다
// 이 접두어(/briefing/jobs/) 아래에 쿠키 라우트를 두지 않는다 — 인증 미들웨어가 접두어로 Bearer를 가른다 (뉴스 브리핑 설계 "보안 — 구독 연결 열쇠").
// index.ts에서 /briefing보다 먼저 등록한다 — briefingRoutes의 가드는 쿠키 user를 요구한다

/** 열쇠로 들어왔는지 한 번 더 — 미들웨어의 접두어 분기와 라우트 등록 순서가 어긋나도 쿠키 세션이 여기로 못 오게 */
const tokenOnly = createMiddleware<AppEnv>(async (c, next) => {
  if (c.get('authKind') !== 'token') return fail(c, 401, 'BRIEFING_TOKEN_INVALID', '연결 열쇠로만 들어올 수 있습니다');
  return next();
});

/** job 주인 검사 — 공용 함수 하나 (CLAUDE.md 보안). jobId는 uuid라 추측은 어렵지만 원칙은 지킨다 */
function assertJobAccess(jobId: string | undefined, userId: number) {
  if (!jobId || jobId.length > 80) return null;
  const run = jobByJobId(jobId);
  return run && run.ownerId === userId ? run : null;
}

function onJobError(c: Parameters<typeof fail>[0], e: unknown) {
  if (e instanceof JobError) return c.json({ code: e.code, message: e.message, ...e.extra }, e.status);
  throw e;
}

export const briefingJobRoutes = new Hono<AppEnv>()
  .use('*', tokenOnly)

  // API-151: 지시서 — ping이면 kind만. 두 번 받아도 같은 지시서
  .get('/:jobId', (c) => {
    const jobId = c.req.param('jobId');
    const userId = c.get('user').id;
    if (jobId.startsWith(BRIEFING.SUB_PING_ID_PREFIX)) {
      if (!resolvePing(jobId, userId)) return fail(c, 404, 'NOT_FOUND', '연결 확인이 없거나 만료됐어요');
      return c.json({ kind: 'ping', jobId });
    }
    const run = assertJobAccess(jobId, userId);
    if (!run) return fail(c, 404, 'NOT_FOUND', '그런 구독 실행이 없어요');
    try {
      return c.json(instructionFor(run));
    } catch (e) {
      return onJobError(c, e);
    }
  })

  // API-152: 진행 보고 한 줄 — 화면 [진행 기록]에 실시간. job당 분당 상한
  .post(
    '/:jobId/progress',
    bodyLimit({ maxSize: BRIEFING.SUB_PROGRESS_MAX_BYTES, onError: (c) => fail(c, 413, 'PAYLOAD_TOO_LARGE', '진행 보고가 너무 커요') }),
    jsonBody(
      z.object({
        text: z.string().max(BRIEFING.SUB_PROGRESS_MAX_CHARS * 4),
        stage: z.enum(['collect', 'classify', 'select', 'read', 'fill', 'summarize', 'lens', 'verify']).optional(),
        done: z.number().int().min(0).optional(),
        total: z.number().int().min(0).optional(),
      }),
    ),
    (c) => {
      const run = assertJobAccess(c.req.param('jobId'), c.get('user').id);
      if (!run) return fail(c, 404, 'NOT_FOUND', '그런 구독 실행이 없어요');
      const wait = hitProgress(run.id);
      if (wait !== null) {
        c.header('Retry-After', String(wait));
        return fail(c, 429, 'TOO_MANY_ATTEMPTS', `진행 보고가 너무 잦아요 (${wait}초 뒤)`);
      }
      try {
        recordProgress(run, c.req.valid('json'));
        return c.body(null, 204);
      } catch (e) {
        return onJobError(c, e);
      }
    },
  )

  // API-153: 완성본 — 크기 상한(1GB 서버 보호) → 검사 → 조립 → 저장. 거절은 응답만, 실행은 running 그대로
  .post(
    '/:jobId/result',
    bodyLimit({ maxSize: BRIEFING.SUB_RESULT_MAX_BYTES, onError: (c) => fail(c, 413, 'PAYLOAD_TOO_LARGE', `완성본이 ${BRIEFING.SUB_RESULT_MAX_BYTES / 1024 / 1024}MB를 넘어요`) }),
    async (c) => {
      const run = assertJobAccess(c.req.param('jobId'), c.get('user').id);
      if (!run) return fail(c, 404, 'NOT_FOUND', '그런 구독 실행이 없어요');
      let body: unknown;
      try {
        body = await c.req.json();
      } catch {
        return fail(c, 400, 'VALIDATION_ERROR', 'JSON 본문이 아니에요');
      }
      try {
        const r = acceptResult(run, body);
        return c.json({ fileId: r.fileId, itemCount: r.itemCount, dropped: r.dropped, already: r.already });
      } catch (e) {
        return onJobError(c, e);
      }
    },
  );

/** 재료 주소 셋 공통 — 닫힌 실행은 409. 지시서를 받아 간 뒤에만(완성본과 같은 규칙 — 열쇠만 가진 쪽이 재료를 끌어가지 못하게) */
function openRunOr409(c: Parameters<typeof fail>[0], jobId: string) {
  const run = assertJobAccess(jobId, c.get('user').id);
  if (!run) return { res: fail(c, 404, 'NOT_FOUND', '그런 구독 실행이 없어요') };
  if (run.status !== 'running') return { res: fail(c, 409, 'BRIEFING_JOB_CLOSED', '이 구독 실행은 이미 닫혔어요') };
  if (!run.remoteStartedAt) return { res: fail(c, 409, 'BRIEFING_JOB_CLOSED', '지시서를 먼저 받아 가세요') };
  return { run };
}

const materialsRoutes = new Hono<AppEnv>()
  // API-154: 후보 — 서버가 트리거 때 수집해 둔 것. 수집 중이면 202, 없으면(재시작·실패) 404 BRIEFING_MATERIALS_UNAVAILABLE → 세션이 직접 수집
  .get('/:jobId/candidates', (c) => {
    const got = openRunOr409(c, c.req.param('jobId'));
    if (got.res) return got.res;
    const view = candidatesView(got.run.id);
    if (!view) return fail(c, 404, 'BRIEFING_MATERIALS_UNAVAILABLE', '서버가 가진 후보가 없어요 — 직접 수집하세요');
    if (view.status === 'collecting') return c.json({ status: 'collecting', done: view.done, total: view.total }, 202);
    return c.json(view.file);
  })

  // API-155: 원문 읽기 시작 — 본문은 selected.json 그대로. 바로 202, 결과는 API-156
  .post(
    '/:jobId/read',
    bodyLimit({ maxSize: BRIEFING.SUB_READ_MAX_BYTES, onError: (c) => fail(c, 413, 'PAYLOAD_TOO_LARGE', '선별 답이 너무 커요') }),
    async (c) => {
      const got = openRunOr409(c, c.req.param('jobId'));
      if (got.res) return got.res;
      let body: unknown;
      try {
        body = await c.req.json();
      } catch {
        return fail(c, 400, 'VALIDATION_ERROR', 'JSON 본문이 아니에요');
      }
      const parsed = SelectedSchema.safeParse(body);
      if (!parsed.success) {
        const issue = parsed.error.issues[0];
        return fail(c, 400, 'VALIDATION_ERROR', `${issue?.path.map((p) => String(p)).join('.') ?? ''}: ${issue?.message ?? '형식 오류'}`);
      }
      if (parsed.data.stories.length > BRIEFING.SUB_ITEMS_MAX) return fail(c, 400, 'VALIDATION_ERROR', `stories: ${BRIEFING.SUB_ITEMS_MAX}건을 넘어요`);
      try {
        const st = startRead(got.run.id, parsed.data, prevStoryIdsOf(got.run.ownerId));
        return c.json({ status: 'reading', done: st.done, total: st.total }, 202);
      } catch (e) {
        if (!(e instanceof MaterialsError)) throw e;
        if (e.kind === 'no_candidates') return fail(c, 404, 'BRIEFING_MATERIALS_UNAVAILABLE', e.message);
        if (e.kind === 'collecting') return fail(c, 409, 'BRIEFING_MATERIALS_NOT_READY', e.message);
        return fail(c, 400, 'VALIDATION_ERROR', e.message);
      }
    },
  )

  // API-156: 읽은 재료 — 읽는 중이면 202, 끝났으면 200. 시작한 적 없거나 실패면 404
  .get('/:jobId/materials', (c) => {
    const got = openRunOr409(c, c.req.param('jobId'));
    if (got.res) return got.res;
    const view = materialsView(got.run.id);
    if (!view || view.status === 'failed') return fail(c, 404, 'BRIEFING_MATERIALS_UNAVAILABLE', view ? `서버 원문 읽기가 실패했어요 — ${view.reason}` : '원문 읽기를 시작한 적이 없어요');
    if (view.status === 'reading') return c.json({ status: 'reading', done: view.done, total: view.total }, 202);
    return c.json(view.result);
  });

briefingJobRoutes.route('/', materialsRoutes);

// 진행 보고 상한 — job당 분당 SUB_PROGRESS_PER_MINUTE건. 메모리 고정 창(로그인 제한과 같은 방식, 열어 둔 주소라 "없음"은 안 된다)
const progressBuckets = new Map<number, { count: number; resetAt: number }>();
function hitProgress(runId: number, now = Date.now()): number | null {
  if (progressBuckets.size > BRIEFING.SUB_PROGRESS_BUCKETS_SWEEP) for (const [id, bk] of progressBuckets) if (bk.resetAt <= now) progressBuckets.delete(id);
  const b = progressBuckets.get(runId);
  if (!b || b.resetAt <= now) {
    progressBuckets.set(runId, { count: 1, resetAt: now + 60_000 });
    return null;
  }
  b.count++;
  return b.count > BRIEFING.SUB_PROGRESS_PER_MINUTE ? Math.ceil((b.resetAt - now) / 1000) : null;
}
