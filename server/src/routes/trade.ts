import { Hono } from 'hono';
import { tradeView } from '../lib/trade/view.js';
import type { AppEnv } from '../types.js';

// API-171 — 수출입 동향. 동향 탭(SCR-195)과 홈의 한 줄이 읽는다. 모든 로그인 계정 (수출입 동향 설계 3단계)
export const tradeRoutes = new Hono<AppEnv>().get('/', (c) => c.json(tradeView(c.get('user'))));
