// 화면의 날짜·시각 표기 한 곳 — 기기 설정에 따라 "10/1/2026, 7:34:31 AM"처럼 영어식으로 나오거나
// 화면마다 달랐다(사용성 평가 2026-10-01). 한국어 "10월 1일 오전 7:34"로 통일한다. 올해가 아니면 연도를 붙인다

function withYear(d: Date): boolean {
  return d.getFullYear() !== new Date().getFullYear();
}

/** "10월 1일 오전 7:34" */
export function formatDateTime(ms: number): string {
  const d = new Date(ms);
  return d.toLocaleString('ko-KR', {
    ...(withYear(d) ? { year: 'numeric' } : {}),
    month: 'long',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

/** "10월 1일" */
export function formatDate(ms: number): string {
  const d = new Date(ms);
  return d.toLocaleDateString('ko-KR', { ...(withYear(d) ? { year: 'numeric' } : {}), month: 'long', day: 'numeric' });
}
