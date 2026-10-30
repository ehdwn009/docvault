import { lookup } from 'node:dns/promises';
import { BlockList, isIP } from 'node:net';
import { BRIEFING } from '../../constants.js';
import { errorText, withDeadline } from './limit.js';

// 서버가 밖으로 나가는 요청 — 주소는 관리자가 쓴 수집 목록에서만 오지만, 그래도 사설망은 막는다.
// 클라우드 VM의 메타데이터 주소(169.254.169.254)가 대표적 표적이다 (뉴스 브리핑 설계 — 보안 SSRF)

const MAX_REDIRECTS = 3;

// 사설 범위를 BlockList 하나에 모은다 — 예전엔 v4/v6를 손으로 나눴는데, URL 파서가 IPv4 매핑 주소를 16진수(::ffff:7f00:1)로 내놓아
// 점 표기만 보던 정규식이 빈손이었다(보안 검토 2026-10-30). NAT64(64:ff9b::/96)·6to4(2002::/16)도 v4를 품은 주소라 함께 막는다
const PRIVATE = new BlockList();
for (const [addr, bits] of [
  ['0.0.0.0', 8], ['10.0.0.0', 8], ['127.0.0.0', 8], ['100.64.0.0', 10], ['169.254.0.0', 16],
  ['172.16.0.0', 12], ['192.168.0.0', 16], ['224.0.0.0', 3],
] as const) PRIVATE.addSubnet(addr, bits, 'ipv4');
for (const [addr, bits] of [
  ['::', 128], ['::1', 128], ['64:ff9b::', 96], ['2002::', 16], ['fc00::', 7], ['fe80::', 10],
] as const) PRIVATE.addSubnet(addr, bits, 'ipv6');

/** 사설·루프백·링크로컬 등 "밖"이 아닌 주소인가. IP 형식이 아니면 true(모르는 건 막는다) */
export function isPrivateAddress(ip: string): boolean {
  const addr = ip.replace(/^\[|\]$/g, '');
  const family = isIP(addr);
  if (family === 0) return true;
  // IPv4 매핑 주소(::ffff:…)는 BlockList가 v4 규칙에 대 본다 — 16진수든 점 표기든
  return PRIVATE.check(addr, family === 6 ? 'ipv6' : 'ipv4');
}

/** 신호가 오면 기다리기를 그만둔다 — dns.lookup은 신호를 받지 않아, 응답 없는 이름 하나가 실행 전체를 붙잡았다
    (수집 63/67에서 몇 분째 멈춤, 2026-10-02). 조회 자체는 뒤에서 끝나게 두고 우리만 손을 뗀다 */
function untilAborted<T>(p: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) return Promise.reject(new Error('시간 초과'));
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(new Error('시간 초과'));
    signal.addEventListener('abort', onAbort, { once: true });
    p.then(resolve, reject).finally(() => signal.removeEventListener('abort', onAbort));
  });
}

async function assertPublicUrl(url: URL, signal: AbortSignal): Promise<void> {
  if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new Error('http(s) 주소가 아닙니다');
  const host = url.hostname.replace(/^\[|\]$/g, '');
  const addrs = isIP(host) ? [{ address: host }] : await untilAborted(lookup(host, { all: true }), signal);
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

/** 받는 일이 지금 어디까지 왔나 — 시간 초과·강제 포기의 이유에 붙여 멈춘 지점을 좁힌다 (설계 "멈춤 대책 2차") */
export type FetchPhase = '주소 찾는 중' | '연결 중' | '본문 받는 중';

export type FetchOptions = {
  outer?: AbortSignal;
  /** 없으면 종류별 기본값 (피드 FETCH_TIMEOUT_MS, 원문 BODY_FETCH_TIMEOUT_MS) */
  timeoutMs?: number;
  onPhase?: (phase: FetchPhase, url: URL) => void;
  /** 이 요청을 끊는 손잡이를 돌려준다 — 바깥 마감이 걸리면 기다리던 읽기와 소켓을 실제로 닫는다 */
  onAbortable?: (abort: (reason: Error) => void) => void;
};

/** 피드 하나를 글자로 받는다. 실패는 사람이 읽을 이유와 함께 던진다 */
export function fetchFeedText(rawUrl: string, opts: FetchOptions = {}): Promise<string> {
  return fetchText(rawUrl, { ...opts, accept: FEED_ACCEPT, timeoutMs: opts.timeoutMs ?? BRIEFING.FETCH_TIMEOUT_MS, maxBytes: BRIEFING.FETCH_MAX_BYTES });
}

/** 기사 원문 페이지(HTML)를 받는다 — 핵심 기사 원문 읽기(설계 "③-1 근거 보강"). 같은 안전 장치, 더 짧은 시간 */
export function fetchPageText(rawUrl: string, opts: FetchOptions = {}): Promise<string> {
  return fetchText(rawUrl, { ...opts, accept: PAGE_ACCEPT, timeoutMs: opts.timeoutMs ?? BRIEFING.BODY_FETCH_TIMEOUT_MS, maxBytes: BRIEFING.BODY_FETCH_MAX_BYTES });
}

/**
 * 안쪽 시간 제한 + 바깥 마감 + 단계 기록을 한 번에 — 수집·원문 읽기·점검 스크립트가 같은 방식으로 받는다 (설계 "멈춤 대책 2차").
 * 실패 이유에 멈춘 단계를 붙인다("시간 초과 · 연결 중"). 바깥 마감이 걸리면 안쪽 제한이 또 뚫린 것이라 로그에 남긴다
 */
export async function fetchGuarded(
  kind: 'feed' | 'page',
  rawUrl: string,
  opts: { label: string; timeoutMs: number; signal?: AbortSignal },
): Promise<string> {
  // 클로저 안에서 바뀌는 값이라 객체 칸으로 둔다
  const at: { phase: FetchPhase | '시작 전'; url: string } = { phase: '시작 전', url: rawUrl };
  let abortInner: ((reason: Error) => void) | null = null;
  const get = kind === 'feed' ? fetchFeedText : fetchPageText;
  const inner = get(rawUrl, {
    outer: opts.signal,
    timeoutMs: opts.timeoutMs,
    onPhase: (phase, url) => {
      at.phase = phase;
      at.url = url.href;
    },
    onAbortable: (abort) => {
      abortInner = abort;
    },
  });
  try {
    return await withDeadline(
      inner,
      opts.timeoutMs + BRIEFING.FETCH_DEADLINE_GRACE_MS,
      () => {
        console.log(`[briefing] 강제 포기: ${opts.label} — ${at.phase}에서 ${opts.timeoutMs / 1000}초 제한을 넘겨 멈춤 (${at.url})`);
        const e = new Error(`응답 없음 · ${at.phase}`);
        // 안쪽 일을 "뒤에서 끝나게" 두면 소켓과 읽기가 매달린 채 남는다 — 포기하는 김에 실제로 끊는다 (2026-10-14)
        abortInner?.(e);
        return e;
      },
      opts.signal,
    );
  } catch (e) {
    if (errorText(e) === '시간 초과') throw new Error(`시간 초과 · ${at.phase}`);
    throw e;
  }
}

async function fetchText(rawUrl: string, opts: FetchOptions & { accept: string; timeoutMs: number; maxBytes: number }): Promise<string> {
  const url = new URL(rawUrl);
  // 요청마다 우리 AbortController 하나에 setTimeout으로 제한을 건다. AbortSignal.any([AbortSignal.timeout(), outer]) 조합은
  // timeout 신호가 GC로 사라져 제한이 안 걸리는 버그가 Node에서 반복됐고(nodejs/node #57736 → 22.16에서 수정, #66610은 열려 있음),
  // 10/14 아침판에서 다섯 출처가 "본문 받는 중"에 20초 제한을 지나쳐 바깥 마감에 걸렸다. 타이머와 컨트롤러를 우리가 쥐면 GC와 무관하다
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(new DOMException('시간 초과', 'TimeoutError')), opts.timeoutMs);
  const onOuter = () => ctrl.abort(opts.outer?.reason instanceof Error ? opts.outer.reason : new DOMException('중지', 'AbortError'));
  if (opts.outer?.aborted) onOuter();
  else opts.outer?.addEventListener('abort', onOuter, { once: true });
  opts.onAbortable?.((reason) => ctrl.abort(reason));
  try {
    return await fetchHops(url, ctrl.signal, opts);
  } finally {
    clearTimeout(timer);
    opts.outer?.removeEventListener('abort', onOuter);
  }
}

async function fetchHops(start: URL, signal: AbortSignal, opts: FetchOptions & { accept: string; timeoutMs: number; maxBytes: number }): Promise<string> {
  let url = start;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    opts.onPhase?.('주소 찾는 중', url);
    await assertPublicUrl(url, signal);
    opts.onPhase?.('연결 중', url);
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
    opts.onPhase?.('본문 받는 중', url);
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
