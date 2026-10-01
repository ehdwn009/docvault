import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import { BRIEFING } from '../../constants.js';

// 서버가 밖으로 나가는 요청 — 주소는 관리자가 쓴 수집 목록에서만 오지만, 그래도 사설망은 막는다.
// 클라우드 VM의 메타데이터 주소(169.254.169.254)가 대표적 표적이다 (뉴스 브리핑 설계 — 보안 SSRF)

const MAX_REDIRECTS = 3;

/** 사설·루프백·링크로컬 등 "밖"이 아닌 주소인가 */
export function isPrivateAddress(ip: string): boolean {
  const mapped = ip.toLowerCase().match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  if (mapped?.[1]) return isPrivateAddress(mapped[1]);
  if (isIP(ip) === 4) {
    const [a = 0, b = 0] = ip.split('.').map(Number);
    return (
      a === 0 || a === 10 || a === 127 ||
      (a === 100 && b >= 64 && b <= 127) || // CGNAT
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      a >= 224 // 멀티캐스트·예약
    );
  }
  const v6 = ip.toLowerCase();
  return v6 === '::' || v6 === '::1' || v6.startsWith('fc') || v6.startsWith('fd') || v6.startsWith('fe8') || v6.startsWith('fe9') || v6.startsWith('fea') || v6.startsWith('feb');
}

async function assertPublicUrl(url: URL): Promise<void> {
  if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new Error('http(s) 주소가 아닙니다');
  const host = url.hostname.replace(/^\[|\]$/g, '');
  const addrs = isIP(host) ? [{ address: host }] : await lookup(host, { all: true });
  if (addrs.length === 0 || addrs.some((a) => isPrivateAddress(a.address))) throw new Error('내부망 주소는 받을 수 없습니다');
}

/** Content-Type, XML 선언, HTML의 meta charset 순으로 문자 인코딩 — 국내 피드·기사 일부는 아직 EUC-KR이다 */
function detectCharset(contentType: string | null, head: Uint8Array): string {
  const fromHeader = contentType?.match(/charset=["']?([\w-]+)/i)?.[1];
  if (fromHeader) return fromHeader.toLowerCase();
  const start = new TextDecoder('latin1').decode(head.subarray(0, 2048));
  const decl = start.match(/encoding=["']([\w-]+)["']/i)?.[1] ?? start.match(/<meta[^>]+charset=["']?([\w-]+)/i)?.[1];
  return decl?.toLowerCase() ?? 'utf-8';
}

/** 크기 상한까지만 읽는다 — 넘치면 거기서 자른다(RSS 앞부분이 최신이라 잘려도 쓸모가 있다) */
async function readCapped(res: Response, maxBytes: number): Promise<Uint8Array> {
  if (!res.body) return new Uint8Array();
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (total < maxBytes) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    total += value.byteLength;
  }
  await reader.cancel().catch(() => {});
  const out = new Uint8Array(Math.min(total, maxBytes));
  let offset = 0;
  for (const c of chunks) {
    const take = Math.min(c.byteLength, out.byteLength - offset);
    out.set(c.subarray(0, take), offset);
    offset += take;
    if (offset >= out.byteLength) break;
  }
  return out;
}

const FEED_ACCEPT = 'application/rss+xml, application/atom+xml, application/xml, text/xml;q=0.9, */*;q=0.5';
const PAGE_ACCEPT = 'text/html, application/xhtml+xml;q=0.9, */*;q=0.5';

/** 피드 하나를 글자로 받는다. 실패는 사람이 읽을 이유와 함께 던진다 */
export function fetchFeedText(rawUrl: string, outer?: AbortSignal): Promise<string> {
  return fetchText(rawUrl, { accept: FEED_ACCEPT, timeoutMs: BRIEFING.FETCH_TIMEOUT_MS, maxBytes: BRIEFING.FETCH_MAX_BYTES, outer });
}

/** 기사 원문 페이지(HTML)를 받는다 — 핵심 기사 원문 읽기(설계 "③-1 근거 보강"). 같은 안전 장치, 더 짧은 시간 */
export function fetchPageText(rawUrl: string, outer?: AbortSignal): Promise<string> {
  return fetchText(rawUrl, { accept: PAGE_ACCEPT, timeoutMs: BRIEFING.BODY_FETCH_TIMEOUT_MS, maxBytes: BRIEFING.BODY_FETCH_MAX_BYTES, outer });
}

async function fetchText(rawUrl: string, opts: { accept: string; timeoutMs: number; maxBytes: number; outer?: AbortSignal }): Promise<string> {
  let url = new URL(rawUrl);
  const signal = AbortSignal.any([AbortSignal.timeout(opts.timeoutMs), ...(opts.outer ? [opts.outer] : [])]);
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    await assertPublicUrl(url);
    const res = await fetch(url, {
      redirect: 'manual', // 넘어가는 곳도 매번 검사하려고 직접 따라간다
      signal,
      headers: { 'user-agent': 'docvault-briefing/1 (+personal RSS reader)', accept: opts.accept },
    });
    if (res.status >= 300 && res.status < 400) {
      const loc = res.headers.get('location');
      if (!loc) throw new Error(`리디렉트 주소 없음 (${res.status})`);
      url = new URL(loc, url);
      continue;
    }
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const bytes = await readCapped(res, opts.maxBytes);
    const charset = detectCharset(res.headers.get('content-type'), bytes);
    try {
      return new TextDecoder(charset).decode(bytes);
    } catch {
      return new TextDecoder('utf-8').decode(bytes);
    }
  }
  throw new Error('리디렉트가 너무 많습니다');
}
