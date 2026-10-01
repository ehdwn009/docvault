import { XMLParser } from 'fast-xml-parser';
import { BRIEFING } from '../../constants.js';

// RSS 2.0 · RSS 1.0(RDF) · Atom을 한 모양(FeedItem)으로 읽는다. 라이브러리는 XML을 객체로만 바꾸고,
// 피드마다 다른 칸 이름(pubDate/dc:date/updated, description/summary…)을 고르는 일은 여기서 한다

export type FeedItem = {
  title: string;
  link: string;
  /** unix ms. 발행 시각을 모르면 null — 범위를 판정할 수 없어 수집 단계에서 버린다 */
  publishedAt: number | null;
  /** 피드가 알려 준 언론사 (Google 뉴스의 <source>). 없으면 null — 피드 이름을 쓴다 */
  source: string | null;
  /** HTML을 벗긴 발췌. AI에게 보여 주는 데만 쓰고 저장하지 않는다 */
  snippet: string;
};

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  textNodeName: '#text',
  processEntities: true,
  htmlEntities: true,
  // 하나뿐이어도 배열로 — 항목이 1개인 피드에서 모양이 달라지지 않게
  isArray: (name) => name === 'item' || name === 'entry' || name === 'link',
});

/** 텍스트 노드는 문자열이거나 {#text, @_속성}이거나 숫자다 */
function text(node: unknown): string {
  if (node == null) return '';
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  if (Array.isArray(node)) return text(node[0]);
  if (typeof node === 'object' && '#text' in node) return text((node as Record<string, unknown>)['#text']);
  return '';
}

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', middot: '·', hellip: '…' };

/** 발췌 안의 HTML(이스케이프되어 들어온 것 포함)을 벗겨 한 줄 글로 */
export function plainText(raw: string): string {
  return raw
    .replace(/<!\[CDATA\[|\]\]>/g, '')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&(#x?[0-9a-f]+|\w+);/gi, (m, code: string) => {
      if (code.startsWith('#')) {
        const n = code[1]?.toLowerCase() === 'x' ? parseInt(code.slice(2), 16) : parseInt(code.slice(1), 10);
        return Number.isFinite(n) ? String.fromCodePoint(n) : m;
      }
      return ENTITIES[code.toLowerCase()] ?? m;
    })
    .replace(/\s+/g, ' ')
    .trim();
}

/** 날짜 파싱. 시간대가 없는 "2026-10-01 14:23" 꼴은 국내 피드의 관행대로 한국시간으로 본다 */
export function parseDate(raw: string): number | null {
  const s = raw.trim();
  if (!s) return null;
  if (/^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}(:\d{2})?$/.test(s)) {
    const t = Date.parse(s.replace(' ', 'T') + '+09:00');
    return Number.isNaN(t) ? null : t;
  }
  const t = Date.parse(s);
  return Number.isNaN(t) ? null : t;
}

/** Atom의 <link>는 여럿일 수 있다 — rel=alternate(또는 rel 없음)인 것이 기사 주소 */
function atomLink(links: unknown): string {
  if (!Array.isArray(links)) return text(links);
  for (const l of links) {
    if (typeof l === 'object' && l !== null) {
      const rec = l as Record<string, unknown>;
      const rel = rec['@_rel'];
      if ((rel === undefined || rel === 'alternate') && typeof rec['@_href'] === 'string') return rec['@_href'];
    } else if (typeof l === 'string' && l.trim()) {
      return l;
    }
  }
  return '';
}

function snippetOf(...candidates: unknown[]): string {
  for (const c of candidates) {
    const s = plainText(text(c));
    if (s) return s.slice(0, BRIEFING.SNIPPET_MAX_CHARS);
  }
  return '';
}

/** 피드 글자 → 항목 목록. 피드로 읽을 수 없으면 던진다 */
export function parseFeed(xml: string): FeedItem[] {
  let doc: Record<string, unknown>;
  try {
    doc = parser.parse(xml) as Record<string, unknown>;
  } catch {
    throw new Error('XML로 읽을 수 없습니다');
  }
  const rss = doc.rss as Record<string, unknown> | undefined;
  const rdf = doc['rdf:RDF'] as Record<string, unknown> | undefined;
  const feed = doc.feed as Record<string, unknown> | undefined;

  if (rss || rdf) {
    const channel = (rss?.channel ?? rdf?.channel) as Record<string, unknown> | undefined;
    // RSS 2.0은 item이 channel 안, RSS 1.0(RDF)은 channel과 나란히
    const items = ((channel?.item ?? rdf?.item) as Record<string, unknown>[] | undefined) ?? [];
    return items.map((it) => ({
      title: plainText(text(it.title)),
      link: text(it.link).trim() || text(it.guid).trim(),
      publishedAt: parseDate(text(it.pubDate) || text(it['dc:date'])),
      source: plainText(text(it.source)) || null,
      snippet: snippetOf(it.description, it['content:encoded']),
    }));
  }
  if (feed) {
    const entries = (feed.entry as Record<string, unknown>[] | undefined) ?? [];
    return entries.map((e) => ({
      title: plainText(text(e.title)),
      link: atomLink(e.link).trim(),
      publishedAt: parseDate(text(e.published) || text(e.updated)),
      source: null,
      snippet: snippetOf(e.summary, e.content),
    }));
  }
  throw new Error('RSS·Atom 형식이 아닙니다');
}
