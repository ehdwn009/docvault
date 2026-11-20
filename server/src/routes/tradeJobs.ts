import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { TRADE } from '../constants.js';
import { JobError } from '../lib/briefing/subscription.js';
import { fail } from '../lib/errors.js';
import { acceptTradeResult, tradeInstruction, tradeJobByJobId, tradePages } from '../lib/trade/analysis.js';
import type { AppEnv } from '../types.js';

// API-151(kind=trade)·157·158 — claude.ai 예약 작업이 수출입 동향 정리본을 위해 부르는 주소들 (수출입 동향 설계 2단계).
// 브리핑 일감과 같은 접두어(/briefing/jobs/) 아래에 둔다 — 클라우드 환경의 네트워크 시크릿이 그 접두어에만 연결 열쇠를 붙여 주므로,
// 새 접두어를 만들면 사용자가 열쇠를 다시 발급해 환경을 고쳐야 한다. 지시서의 kind가 일감 종류를 가른다.
// index.ts에서 briefingJobRoutes보다 먼저 등록하고, 수출입 일감이 아니면 next()로 넘긴다

/** job 주인 검사 — 공용 함수 하나 (CLAUDE.md 보안) */
function assertTradeJobAccess(jobId: string | undefined, userId: number) {
  if (!jobId || jobId.length > 80) return null;
  const job = tradeJobByJobId(jobId);
  return job && job.ownerId === userId ? job : null;
}

function onJobError(c: Parameters<typeof fail>[0], e: unknown) {
  if (e instanceof JobError) return c.json({ code: e.code, message: e.message, ...e.extra }, e.status);
  throw e;
}

export const tradeJobRoutes = new Hono<AppEnv>()
  // 인증 미들웨어의 접두어 분기와 등록 순서가 어긋나도 쿠키 세션이 여기로 못 오게 (briefingJobs.ts의 tokenOnly와 같은 뜻)
  .use('*', async (c, next) => {
    if (c.get('authKind') !== 'token') return fail(c, 401, 'BRIEFING_TOKEN_INVALID', '연결 열쇠로만 들어올 수 있습니다');
    return next();
  })

  // API-151: 지시서 — 수출입 일감이면 kind: "trade". 아니면 브리핑 쪽이 답한다
  .get('/:jobId', (c, next) => {
    const job = assertTradeJobAccess(c.req.param('jobId'), c.get('user').id);
    if (!job) return next();
    try {
      return c.json(tradeInstruction(job));
    } catch (e) {
      return onJobError(c, e);
    }
  })

  // API-157: 원문 쪽별 텍스트 — doc=cur(이번 호)|prev(전월 호). 세션은 산업통상부 사이트에 접속하지 않는다
  .get('/:jobId/trade/pages', async (c) => {
    const job = assertTradeJobAccess(c.req.param('jobId'), c.get('user').id);
    if (!job) return fail(c, 404, 'NOT_FOUND', '그런 정리본 실행이 없어요');
    const doc = c.req.query('doc');
    if (doc !== 'cur' && doc !== 'prev') return fail(c, 400, 'VALIDATION_ERROR', 'doc: cur 또는 prev');
    try {
      return c.json(await tradePages(job, doc));
    } catch (e) {
      return onJobError(c, e);
    }
  })

  // API-158: 완성본 — 모양 검사는 zod(TradeDataSchema), 내용은 원문 대조. 거절이면 고쳐 다시 보낼 수 있다
  .post(
    '/:jobId/trade/result',
    bodyLimit({ maxSize: TRADE.RESULT_MAX_BYTES, onError: (c) => fail(c, 413, 'PAYLOAD_TOO_LARGE', '완성본이 너무 커요') }),
    async (c) => {
      const job = assertTradeJobAccess(c.req.param('jobId'), c.get('user').id);
      if (!job) return fail(c, 404, 'NOT_FOUND', '그런 정리본 실행이 없어요');
      let body: unknown;
      try {
        body = await c.req.json();
      } catch {
        return fail(c, 400, 'VALIDATION_ERROR', '본문이 JSON이 아닙니다');
      }
      try {
        return c.json(await acceptTradeResult(job, body));
      } catch (e) {
        return onJobError(c, e);
      }
    },
  );
