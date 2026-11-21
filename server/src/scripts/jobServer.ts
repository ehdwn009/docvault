// 명령이 아니라 모듈이다 — trade-job·outlook-job이 서버(예약 작업이 부르는 /briefing/jobs/{jobId}…)와 주고받는 공용 부분.
// 열쇠는 네트워크 시크릿이 붙이고, DOCVAULT_TOKEN이 있을 때만 직접 붙인다(값은 어디에도 찍지 않는다). briefing-job.ts와 같은 규칙

export function serverBase(jobId: string): { url: string; headers: Record<string, string> } {
  const base = process.env.DOCVAULT_URL?.replace(/\/+$/, '');
  // https만 — 평문으로 열쇠가 나가면 안 된다. 로컬 시험(같은 기계)만 http를 허용한다
  if (!base || !(base.startsWith('https://') || /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(base))) throw new Error('환경 변수 DOCVAULT_URL(https://…)이 필요합니다');
  const token = process.env.DOCVAULT_TOKEN;
  return { url: `${base}/api/v1/briefing/jobs/${encodeURIComponent(jobId)}`, headers: { accept: 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) } };
}

export async function failure(res: Response): Promise<Error> {
  let text = '';
  try {
    const body = (await res.json()) as { code?: string; message?: string; fatal?: string[]; dropped?: string[] };
    text = `${body.code ?? ''}${body.message ? ` — ${body.message}` : ''}`;
    if (body.fatal?.length) text += `\n${body.fatal.map((f) => `  ! ${f}`).join('\n')}`;
    if (body.dropped?.length) text += `\n뺀 항목 ${body.dropped.length}개`;
  } catch {
    // JSON이 아니면 상태 코드만
  }
  const hint = res.status === 409 ? ' → 실행이 닫혔다. 멈추고 보고한다' : res.status === 401 ? ' → 연결 열쇠(네트워크 시크릿)가 안 붙었다. 우회하지 말고 보고한다' : '';
  return new Error(`서버 ${res.status} ${text}${hint}`);
}

export async function getJson<T>(url: string, headers: Record<string, string>): Promise<T> {
  const res = await fetch(url, { headers, redirect: 'error' });
  if (!res.ok) throw await failure(res);
  return (await res.json()) as T;
}

export async function postJson<T>(url: string, headers: Record<string, string>, body: string): Promise<T> {
  const res = await fetch(url, { method: 'POST', headers: { ...headers, 'content-type': 'application/json' }, body, redirect: 'error' });
  if (!res.ok) throw await failure(res);
  return (await res.json()) as T;
}
