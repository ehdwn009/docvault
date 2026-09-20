/**
 * 앱 시작 시간 측정 — "첫 로딩이 왜 긴가"를 감이 아니라 숫자로 보기 위해.
 * 단계마다 걸린 ms를 모아 두고 설정 → 정보에서 보여 준다. 서버로 보내지 않는다(개인 기기 사정).
 *
 * 단계는 실제 요청 순서다: 서버 첫 응답(TTFB) → 앱 파일 다운로드 → 로그인 확인(/auth/me) →
 * 트리·태그 → 설정 → (딥링크면) 문서 본문. 어느 칸이 크냐에 따라 처방이 다르다:
 * TTFB가 크면 서버(콜드 스타트), 다운로드가 크면 번들·압축, 요청 칸들이 크면 왕복 수·응답 크기.
 *
 * 요청 하나는 다시 넷으로 쪼갠다(브라우저의 Resource Timing): 보내기 전 대기 → 응답 기다림(회선 + 서버) →
 * 받기 → 받은 뒤 처리(폰이 바빠서 응답을 못 챙긴 시간). 서버가 일한 시간은 응답의 Server-Timing 헤더로
 * 따로 오므로, "응답 기다림 − 서버"가 곧 회선이다. 서버 로그는 3ms인데 폰은 3.5초였던 날의 교훈.
 */

export type BootStep = { name: string; ms: number };

/** 요청 하나의 시간 분해. 전부 ms. serverMs는 헤더가 없으면(개발 프록시 밖 등) null */
export type BootRequest = {
  path: string;
  /** 요청 시작 시각 — 페이지 열기 기준 ms. 어떤 요청이 동시에 나갔는지 보인다 */
  startAt: number;
  beforeMs: number;
  waitMs: number;
  downloadMs: number;
  serverMs: number | null;
  /** 응답이 다 온 뒤 단계가 끝나기까지. 단계와 짝지어진 요청에만 있다 */
  afterMs: number | null;
};

export type BootRecord = { at: number; total: number; jsFiles: number; jsKB: number; steps: BootStep[]; requests: BootRequest[] };

const KEY = 'dv_boot';
const API_PREFIX = '/api/v1';
const steps: (BootStep & { endAt: number; paths: string[] })[] = [];
/** finishBoot가 불린 시각(페이지 열기 기준 ms). null이면 아직 시작 중 */
let finishedAt: number | null = null;
let record: BootRecord | null = null;

/**
 * 비동기 단계 하나를 재서 기록한다. 시작이 끝난 뒤에 시작된 호출은 무시 — 재방문 클릭까지 섞이지 않게.
 * 시작 중에 출발했지만 첫 화면 뒤에 끝난 단계(설정이 트리보다 늦는 날)는 기록에 덧붙인다.
 * paths: 이 단계가 보내는 API 경로들(/api/v1 뒤). 요청별 분해에서 "받은 뒤 처리"를 계산할 때 짝짓는다
 */
export async function timed<T>(name: string, run: () => Promise<T>, paths: string[] = []): Promise<T> {
  const t0 = performance.now();
  try {
    return await run();
  } finally {
    if (finishedAt === null || t0 < finishedAt) {
      // 같은 이름은 마지막 값으로 — 개발 모드의 StrictMode가 효과를 두 번 돌려 같은 요청이 두 줄 찍히지 않게
      const endAt = performance.now();
      const step = { name, ms: Math.round(endAt - t0), endAt, paths };
      const at = steps.findIndex((st) => st.name === name);
      if (at === -1) steps.push(step);
      else steps[at] = step;
      // 첫 화면 뒤에 끝난 단계 — 이미 저장한 기록의 앞부분(네비게이션)은 두고 단계·요청만 다시 쓴다
      if (record && finishedAt !== null) {
        const head = record.steps.filter((st) => !steps.some((x) => x.name === st.name));
        save({ ...record, steps: [...head, ...steps.map(({ name: n, ms }) => ({ name: n, ms }))], requests: collectRequests(finishedAt) });
      }
    }
  }
}

function save(rec: BootRecord) {
  record = rec;
  try {
    sessionStorage.setItem(KEY, JSON.stringify(rec));
  } catch {
    /* 사생활 모드 등 — 그냥 안 남긴다 */
  }
}

function apiPathOf(entry: PerformanceResourceTiming): string | null {
  try {
    const p = new URL(entry.name).pathname;
    return p.startsWith(API_PREFIX) ? p.slice(API_PREFIX.length) : null;
  } catch {
    return null;
  }
}

/** 시작 중에 나간 API 요청들을 넷으로 쪼갠다. 같은 경로가 두 번이면(StrictMode) 마지막 것만 */
function collectRequests(until: number): BootRequest[] {
  const byPath = new Map<string, PerformanceResourceTiming>();
  for (const r of performance.getEntriesByType('resource')) {
    if (!(r instanceof PerformanceResourceTiming) || r.startTime > until) continue;
    const path = apiPathOf(r);
    if (path) byPath.set(path, r);
  }
  return [...byPath.entries()]
    .sort((a, b) => a[1].startTime - b[1].startTime)
    .map(([path, r]) => {
      const step = steps.find((st) => st.paths.includes(path));
      // 단계에 요청이 여럿이면(트리+태그) 마지막에 끝난 요청에만 "받은 뒤"를 적는다 — 그 뒤가 곧 화면 그리기다
      const lastInStep = step ? Math.max(...step.paths.map((p) => byPath.get(p)?.responseEnd ?? 0)) : 0;
      const serverTiming = (r as PerformanceResourceTiming & { serverTiming?: { name: string; duration: number }[] }).serverTiming ?? [];
      const app = serverTiming.find((s) => s.name === 'app');
      return {
        path,
        startAt: Math.round(r.startTime),
        beforeMs: Math.round(r.requestStart - r.startTime),
        waitMs: Math.round(r.responseStart - r.requestStart),
        downloadMs: Math.round(r.responseEnd - r.responseStart),
        serverMs: app ? Math.round(app.duration) : null,
        afterMs: step && r.responseEnd === lastInStep ? Math.round(step.endAt - r.responseEnd) : null,
      };
    });
}

/** 첫 화면이 다 그려졌을 때 한 번 — 브라우저가 잰 네비게이션 시간을 앞에 붙이고 저장한다 */
export function finishBoot() {
  if (finishedAt !== null) return;
  finishedAt = performance.now();
  const nav = performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming | undefined;
  const head: BootStep[] = [];
  if (nav) {
    head.push({ name: '서버 첫 응답 (TTFB)', ms: Math.round(nav.responseStart - nav.startTime) });
    head.push({ name: 'HTML·JS 다운로드', ms: Math.round(nav.domContentLoadedEventEnd - nav.responseStart) });
  }
  const js = performance
    .getEntriesByType('resource')
    .filter((r): r is PerformanceResourceTiming => r instanceof PerformanceResourceTiming && (r.initiatorType === 'script' || /\.[cm]?js(\?|$)/.test(r.name)));
  const bytes = js.reduce((s, r) => s + (r.transferSize || 0), 0);
  save({
    at: Date.now(),
    total: Math.round(finishedAt),
    jsFiles: js.length,
    jsKB: Math.round(bytes / 1024),
    steps: [...head, ...steps.map(({ name, ms }) => ({ name, ms }))],
    requests: collectRequests(finishedAt),
  });
}

export function readBoot(): BootRecord | null {
  try {
    const raw = sessionStorage.getItem(KEY);
    if (!raw) return null;
    const rec = JSON.parse(raw) as Partial<BootRecord>;
    return { ...rec, requests: rec.requests ?? [] } as BootRecord;
  } catch {
    return null;
  }
}
