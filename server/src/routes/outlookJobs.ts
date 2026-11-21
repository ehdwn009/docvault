import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { z } from 'zod';
import { OUTLOOK } from '../constants.js';
import { JobError } from '../lib/briefing/subscription.js';
import { fail } from '../lib/errors.js';
import { acceptOutlookResult, outlookGrab, outlookInstruction, outlookJobByJobId } from '../lib/outlook/job.js';
import { jsonBody } from '../lib/validate.js';
import type { AppEnv } from '../types.js';

// API-151(kind=outlook)·177·178 — claude.ai 예약 작업이 세계 전망을 위해 부르는 주소들 (세계전망 설계 출시 2단계).
// 브리핑·수출입 일감과 같은 접두어(/briefing/jobs/) — 클라우드 환경의 네트워크 시크릿이 그 접두어에만 연결 열쇠를 붙여 주므로.
// index.ts에서 tradeJobRoutes 다음, briefingJobRoutes보다 먼저 등록하고, 세계 전망 일감이 아니면 next()로 넘긴다

const GrabBody = z.object({
  url: z
    .string()
    .max(600)
    .url()
    .refine((u) => /^https?:\/\//i.test(u), { message: 'http(s) 주소여야 합니다' }),
});

/** job 주인 검사 — 공용 함수 하나 (CLAUDE.md 보안) */
function assertOutlookJobAccess(jobId: string | undefined, userId: number) {
  if (!jobId || jobId.length > 80) return null;
  const job = outlookJobByJobId(jobId);
  return job && job.ownerId === userId ? job : null;
}

function onJobError(c: Parameters<typeof fail>[0], e: unknown) {
  if (e instanceof JobError) return c.json({ code: e.code, message: e.message, ...e.extra }, e.status);
  throw e;
}

export const outlookJobRoutes = new Hono<AppEnv>()
  // 인증 미들웨어의 접두어 분기와 등록 순서가 어긋나도 쿠키 세션이 여기로 못 오게 (briefingJobs.ts의 tokenOnly와 같은 뜻)
  .use('*', async (c, next) => {
    if (c.get('authKind') !== 'token') return fail(c, 401, 'BRIEFING_TOKEN_INVALID', '연결 열쇠로만 들어올 수 있습니다');
    return next();
  })

  // API-151: 지시서 — 세계 전망 일감이면 kind: "outlook". 아니면 브리핑 쪽이 답한다
  .get('/:jobId', (c, next) => {
    const job = assertOutlookJobAccess(c.req.param('jobId'), c.get('user').id);
    if (!job) return next();
    try {
      return c.json(outlookInstruction(job));
    } catch (e) {
      return onJobError(c, e);
    }
  })

  // API-177: 원문 받기 — 서버가 받아 글을 돌려준다(세션의 네트워크가 좁아서). 내부망 주소는 받지 않는다(lib/outlook/sources.ts)
  .post('/:jobId/outlook/grab', jsonBody(GrabBody), async (c) => {
    const job = assertOutlookJobAccess(c.req.param('jobId'), c.get('user').id);
    if (!job) return fail(c, 404, 'NOT_FOUND', '그런 세계 전망 실행이 없어요');
    try {
      return c.json(await outlookGrab(job, c.req.valid('json').url));
    } catch (e) {
      return onJobError(c, e);
    }
  })

  // API-178: 완성본 — 모양 검사는 zod(OutlookDataSchema), 내용은 원문 대조. 거절이면 고쳐 다시 보낼 수 있다
  .post(
    '/:jobId/outlook/result',
    bodyLimit({ maxSize: OUTLOOK.RESULT_MAX_BYTES, onError: (c) => fail(c, 413, 'PAYLOAD_TOO_LARGE', '완성본이 너무 커요') }),
    async (c) => {
      const job = assertOutlookJobAccess(c.req.param('jobId'), c.get('user').id);
      if (!job) return fail(c, 404, 'NOT_FOUND', '그런 세계 전망 실행이 없어요');
      let body: unknown;
      try {
        body = await c.req.json();
      } catch {
        return fail(c, 400, 'VALIDATION_ERROR', '본문이 JSON이 아닙니다');
      }
      try {
        return c.json(await acceptOutlookResult(job, body));
      } catch (e) {
        return onJobError(c, e);
      }
    },
  );
