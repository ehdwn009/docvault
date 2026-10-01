import { BRIEFING } from '../../constants.js';

// 도는 실행의 실시간 사정 — 진행 기록 몇 줄과 지금 받는 중인 출처. 서버 메모리에만 둔다(설계 "실행 관리 — 진행 기록").
// 스트리밍(SSE)으로 흘려보내지 않고 상태 API(2초 폴링)에 실어 보낸다 — 화면을 닫았다 열어도, 폰과 PC가 같은 것을 본다.
// 서버가 재시작되면 사라지지만, 그때는 실행도 끝난다(recoverStaleRuns)

type Live = {
  controller: AbortController;
  log: { at: number; text: string }[];
  /** 받는 중인 일 — 이름마다 시작 시각 (같은 이름이 둘이면 뒤의 것이 덮는다, 화면 표시용이라 충분하다) */
  inflight: Map<string, number>;
};

const lives = new Map<number, Live>();

export function openLive(runId: number, controller: AbortController): Live {
  const live: Live = { controller, log: [], inflight: new Map() };
  lives.set(runId, live);
  return live;
}

export function closeLive(runId: number): void {
  lives.delete(runId);
}

export function abortLive(runId: number): void {
  lives.get(runId)?.controller.abort();
}

export function addLog(live: Live, text: string, now = Date.now()): void {
  live.log.push({ at: now, text });
  if (live.log.length > BRIEFING.LIVE_LOG_MAX) live.log.shift();
}

export function track(live: Live, name: string, now = Date.now()): () => void {
  live.inflight.set(name, now);
  return () => {
    live.inflight.delete(name);
  };
}

/** 화면용 — 진행 기록과, LIVE_SLOW_MS 넘게 기다리는 일(오래된 것부터 몇 개) */
export function liveView(runId: number, now = Date.now()): { log: { at: number; text: string }[]; waiting: { name: string; seconds: number }[] } | null {
  const live = lives.get(runId);
  if (!live) return null;
  const waiting = [...live.inflight.entries()]
    .filter(([, since]) => now - since >= BRIEFING.LIVE_SLOW_MS)
    .sort((a, b) => a[1] - b[1])
    .slice(0, BRIEFING.LIVE_WAITING_MAX)
    .map(([name, since]) => ({ name, seconds: Math.round((now - since) / 1000) }));
  return { log: [...live.log], waiting };
}
