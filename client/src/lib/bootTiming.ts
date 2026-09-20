/**
 * 앱 시작 시간 측정 — "첫 로딩이 왜 긴가"를 감이 아니라 숫자로 보기 위해.
 * 단계마다 걸린 ms를 모아 두고 설정 → 정보에서 보여 준다. 서버로 보내지 않는다(개인 기기 사정).
 *
 * 단계는 실제 요청 순서다: 서버 첫 응답(TTFB) → 앱 파일 다운로드 → 로그인 확인(/auth/me) →
 * 트리·태그 → 설정 → (딥링크면) 문서 본문. 어느 칸이 크냐에 따라 처방이 다르다:
 * TTFB가 크면 서버(콜드 스타트), 다운로드가 크면 번들·압축, 요청 칸들이 크면 왕복 수·응답 크기.
 */

export type BootStep = { name: string; ms: number };

const KEY = 'dv_boot';
const steps: BootStep[] = [];
let finished = false;

/** 비동기 단계 하나를 재서 기록한다. 시작 이후(finished)의 호출은 무시 — 재방문 클릭까지 섞이지 않게 */
export async function timed<T>(name: string, run: () => Promise<T>): Promise<T> {
  const t0 = performance.now();
  try {
    return await run();
  } finally {
    // 같은 이름은 마지막 값으로 — 개발 모드의 StrictMode가 효과를 두 번 돌려 같은 요청이 두 줄 찍히지 않게
    if (!finished) {
      const ms = Math.round(performance.now() - t0);
      const at = steps.findIndex((st) => st.name === name);
      if (at === -1) steps.push({ name, ms });
      else steps[at] = { name, ms };
    }
  }
}

/** 첫 화면이 다 그려졌을 때 한 번 — 브라우저가 잰 네비게이션 시간을 앞에 붙이고 저장한다 */
export function finishBoot() {
  if (finished) return;
  finished = true;
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
  const total = Math.round(performance.now());
  const record = { at: Date.now(), total, jsFiles: js.length, jsKB: Math.round(bytes / 1024), steps: [...head, ...steps] };
  try {
    sessionStorage.setItem(KEY, JSON.stringify(record));
  } catch {
    /* 사생활 모드 등 — 그냥 안 남긴다 */
  }
}

export type BootRecord = { at: number; total: number; jsFiles: number; jsKB: number; steps: BootStep[] };

export function readBoot(): BootRecord | null {
  try {
    const raw = sessionStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as BootRecord) : null;
  } catch {
    return null;
  }
}
