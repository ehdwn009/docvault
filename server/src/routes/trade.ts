import { Hono } from 'hono';
import { z } from 'zod';
import { fail } from '../lib/errors.js';
import { startAnalysis } from '../lib/trade/analysis.js';
import { tradeView } from '../lib/trade/view.js';
import type { AppEnv } from '../types.js';

const Period = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/);

// 수출입 동향 — 동향 탭(SCR-195)과 홈의 한 줄이 읽는다 (수출입 동향 설계 3·4단계)
export const tradeRoutes = new Hono<AppEnv>()
  // API-171 — 모든 로그인 계정
  .get('/', (c) => c.json(tradeView(c.get('user'))))
  // API-172 — 그 호의 정리본을 다시 만들게 시킨다. 예약 작업을 켜는 일이라(구독 사용량) 관리자만
  .post('/:period/analysis', async (c) => {
    if (c.get('user').role !== 'admin') return fail(c, 403, 'FORBIDDEN', '관리자 전용입니다');
    const period = Period.safeParse(c.req.param('period'));
    if (!period.success) return fail(c, 400, 'VALIDATION_ERROR', 'period: YYYY-MM 모양이어야 합니다');
    const r = await startAnalysis(period.data, Date.now(), true);
    if (r === 'fired') return c.json({ status: 'started' }, 202);
    if (r === 'no_release') return fail(c, 404, 'NOT_FOUND', '그 호의 원문이 없어요');
    if (r === 'running') return fail(c, 409, 'TRADE_ANALYSIS_RUNNING', '이미 만들고 있어요. 끝나면 알림이 와요');
    if (r === 'no_trigger') return fail(c, 409, 'TRADE_TRIGGER_MISSING', '예약 작업이 연결돼 있지 않아요. 나 › 구독 연결에서 먼저 연결해 주세요');
    return fail(c, 502, 'TRADE_TRIGGER_FAILED', '예약 작업을 켜지 못했어요. 잠시 뒤 다시 눌러 주세요');
  });
