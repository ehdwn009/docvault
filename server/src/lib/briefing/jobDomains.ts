import { BRIEFING } from '../../constants.js';
import type { SourcesDoc } from './sourcesDoc.js';

// 완성본 검사용 허용 도메인 (뉴스 브리핑 설계 "구독 생성 방식 — 지시서·검사와 거절", v0.50).
// 검색 보강용 allowedDomainsOf(webfill.ts)와는 **다른 목록**이다 — 그쪽은 검색 도구의 크기 제한 때문에 통신사 + 앞쪽 20곳만 담는데,
// 그 규칙으로 완성본을 검사하면 Google 검색으로 들어온 기사와 21번째 이후 언론사 기사가 전부 떨어져 30% 거절선에 바로 걸린다.
// 여기는 수집 목록 전체 언론사 + 통신사 + news.google.com, 상한 없음. 세션은 검색 보강을 이 안에서만 하고,
// 클라우드 환경의 네트워크 허용 목록도 이 목록으로 맞춘다

/** 피드 주소에 흔한 머리 라벨 — www.hankyung.com·rss.donga.com·feeds.bbci.co.uk는 그 언론사 전체를 뜻한다 */
const FEED_HOST_PREFIX = /^(www|rss|feeds?|m)\./;

/** 두 라벨이 하나의 "접미사"인 공용 2단계 도메인 — co.kr의 등록 도메인은 세 라벨(yna.co.kr)이다 */
const TWO_LABEL_SUFFIX = new Set(['co.kr', 'or.kr', 'go.kr', 'ne.kr', 're.kr', 'pe.kr', 'ac.kr', 'co.uk', 'org.uk', 'ac.uk', 'gov.uk', 'com.au', 'net.au', 'co.jp', 'ne.jp', 'or.jp', 'com.cn', 'com.tw', 'com.hk', 'co.in', 'com.br', 'com.sg']);

/** 피드 주소와 기사 주소의 도메인이 다른 출처 — 피드를 중계 서비스(feedburner 등)로 내는 곳. 1회 시험에서 지디넷코리아 기사 10건이
    피드 주소(feeds.feedburner.com)만 목록에 들어가 주소 검사에 걸렸다 (2026-10-30). 열쇠는 "호스트 + 경로" */
const FEED_ARTICLE_DOMAINS: Record<string, string[]> = {
  'feeds.feedburner.com/zdkorea': ['zdnet.co.kr'],
};

/** 호스트를 비교 가능한 모양으로 — 소문자, 끝 점 제거. URL 객체가 이미 punycode로 바꿔 준다 */
export function normalizeHost(host: string): string {
  return host.toLowerCase().replace(/\.$/, '');
}

/** 등록 도메인 어림 — biz.chosun.com → chosun.com, www.yna.co.kr → yna.co.kr. 모르면 그대로 */
export function registrableDomain(host: string): string {
  const labels = normalizeHost(host).split('.');
  if (labels.length <= 2) return labels.join('.');
  const lastTwo = labels.slice(-2).join('.');
  return TWO_LABEL_SUFFIX.has(lastTwo) ? labels.slice(-3).join('.') : lastTwo;
}

/** 지시서의 allowedDomains — 피드 주소마다 접두어를 벗긴 호스트와 등록 도메인 둘 다 넣는다(biz.chosun.com 피드만 있어도 www.chosun.com 기사가 통과하게) */
/**
 * claude.ai 환경의 네트워크 허용 목록에 붙여 넣을 줄들 — 도메인마다 맨몸(`hankyung.com`)과 별표(`*.hankyung.com`) 둘 다.
 * 허용 목록은 맨몸 도메인으로 하위 도메인(www.·rss.·feeds.)을 열어 주지 않는다 — 첫 실전(2026-10-31)에서 피드 26/67이 "주소를 찾을 수 없음"으로 실패했다.
 * docvault 호스트는 맨몸만(지시서·완성본은 그 호스트 하나)
 */
export function networkAllowlistOf(doc: SourcesDoc, docvaultHost: string): string[] {
  const lines = new Set<string>([docvaultHost]);
  for (const d of checkDomainsOf(doc)) {
    lines.add(d);
    lines.add(`*.${d}`);
  }
  return [...lines];
}

export function checkDomainsOf(doc: SourcesDoc): string[] {
  const set = new Set<string>([...BRIEFING.WEB_FILL_WIRES, ...BRIEFING.SUB_CHECK_EXTRA_DOMAINS]);
  for (const f of doc.feeds) {
    try {
      const u = new URL(f.url);
      const host = normalizeHost(u.hostname);
      set.add(host.replace(FEED_HOST_PREFIX, ''));
      set.add(registrableDomain(host));
      for (const d of FEED_ARTICLE_DOMAINS[`${host}${u.pathname.replace(/\/$/, '')}`] ?? []) set.add(d);
    } catch {
      // 주소가 아니면 건너뛴다 — parseSourcesDoc이 이미 걸렀을 것이다
    }
  }
  return [...set].sort();
}

export type UrlCheck = { ok: true } | { ok: false; reason: 'scheme' | 'userinfo' | 'port' | 'domain' | 'invalid' };

/**
 * 완성본의 주소 하나가 허용되나 — http(s)만, `아이디:비밀번호@` 금지, 포트는 기본만, 호스트가 목록의 도메인과 같거나 `.도메인`으로 끝나야.
 * readUrl은 나중에 서버가 직접 받는 주소라 이 검사가 SSRF 방어선이다 (설계 "검사와 거절")
 */
export function checkUrl(raw: string, allowed: readonly string[]): UrlCheck {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return { ok: false, reason: 'invalid' };
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return { ok: false, reason: 'scheme' };
  // URL 파서는 %40을 username으로 풀어 두므로 둘 다 여기서 걸린다
  if (u.username || u.password) return { ok: false, reason: 'userinfo' };
  if (u.port) return { ok: false, reason: 'port' };
  const host = normalizeHost(u.hostname);
  const hit = allowed.some((d) => {
    const dom = normalizeHost(d);
    return host === dom || host.endsWith(`.${dom}`);
  });
  return hit ? { ok: true } : { ok: false, reason: 'domain' };
}
