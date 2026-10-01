import { and, eq, isNull } from 'drizzle-orm';
import { z } from 'zod';
import { BRIEFING } from '../../constants.js';
import { db } from '../../db/index.js';
import { files, folders } from '../../db/schema.js';
import type { DbOrTx } from '../content.js';
import { findSubByPath, SUBS, subPath, type BriefingSection, type BriefingSub } from './taxonomy.js';

// 수집 목록 — 코드가 아니라 "뉴스 브리핑/수집 목록.json" 문서다. 폰 편집기로 고치고 버전 기록으로 되돌릴 수 있게
// (뉴스 브리핑 설계 "수집 목록"). 문서가 없으면 아래 기본값으로 만든다. 형식이 틀리면 어디가 틀렸는지 알리고 실행을 멈춘다

const httpUrl = z
  .string()
  .url('올바른 주소가 아닙니다')
  .refine((u) => /^https?:\/\//i.test(u), 'http(s) 주소가 아닙니다');

const SourcesSchema = z.object({
  feeds: z
    .array(
      z.object({
        name: z.string().trim().min(1).max(60),
        url: httpUrl,
        region: z.enum(['국내', '세계']),
        /** 화면에 보일 언론사 이름. 없으면 name ("연합뉴스 경제"처럼 섹션이 붙은 이름이 그대로 보인다) */
        publisher: z.string().trim().min(1).max(40).optional(),
      }),
    )
    .default([]),
  searches: z
    .array(
      z.object({
        sub: z.string().refine((p) => findSubByPath(p) !== undefined, '분류표에 없는 분야입니다 (예: "국내/경제/증시")'),
        query: z.string().trim().min(1).max(200),
      }),
    )
    .default([]),
  disabled: z.array(z.string()).default([]),
});
export type SourcesDoc = z.infer<typeof SourcesSchema>;

/** 실제로 받을 출처 하나 — 언론사 피드는 분야를 모르고(region만), 검색은 분야를 안다 */
export type Source = {
  name: string;
  url: string;
  region: BriefingSection;
  /** 기사에 붙일 언론사 이름 — 피드가 항목마다 알려 주면(Google 뉴스) 그쪽이 우선 */
  publisher: string;
  /** 검색으로 온 출처만. 이 출처의 기사는 분류 단계를 건너뛴다 */
  sub: BriefingSub | null;
};

export class SourcesError extends Error {}

/** Google 뉴스 RSS 검색 주소 — 국내 분야는 한국어판, 세계 분야는 영어판. when:1d로 최근 하루만 */
export function googleNewsUrl(query: string, region: BriefingSection): string {
  const q = encodeURIComponent(`${query} when:1d`);
  return region === '국내'
    ? `https://news.google.com/rss/search?q=${q}&hl=ko&gl=KR&ceid=KR:ko`
    : `https://news.google.com/rss/search?q=${q}&hl=en-US&gl=US&ceid=US:en`;
}

export function toSources(doc: SourcesDoc): Source[] {
  const off = new Set(doc.disabled.map((d) => d.trim()));
  const feeds: Source[] = doc.feeds.map((f) => ({ name: f.name, url: f.url, region: f.region, publisher: f.publisher ?? f.name, sub: null }));
  const searches: Source[] = doc.searches.map((s) => {
    const sub = findSubByPath(s.sub)!;
    return { name: `검색: ${s.sub} · ${s.query}`, url: googleNewsUrl(s.query, sub.section), region: sub.section, publisher: 'Google 뉴스', sub };
  });
  return [...feeds, ...searches].filter((s) => !off.has(s.name));
}

/** 문서 글자 → 검증된 목록. 틀리면 "어디가 왜" 틀렸는지 한 줄로 */
export function parseSourcesDoc(text: string): SourcesDoc {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (e) {
    throw new SourcesError(`수집 목록이 JSON 형식이 아닙니다 — ${e instanceof Error ? e.message : String(e)}`);
  }
  const parsed = SourcesSchema.safeParse(raw);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    if (!issue) throw new SourcesError('수집 목록 형식이 맞지 않습니다');
    const where = issue.path.map((p) => (typeof p === 'number' ? `${p + 1}번째` : p)).join(' ');
    throw new SourcesError(`수집 목록 ${where}: ${issue.message}`);
  }
  return parsed.data;
}

// ---- 기본 목록 ----
// 아래 주소는 이 코드를 쓴 작업 환경에서 열어 보지 못했다(외부 뉴스 사이트 차단). 첫 실행의 "실패한 출처"를 보고 고친다.
// Reuters·AP·Bloomberg는 키 없는 공식 RSS가 없어 영어판 Google 뉴스 검색의 site: 조건으로 받는다

const DEFAULT_FEEDS: SourcesDoc['feeds'] = [
  { name: '연합뉴스 정치', url: 'https://www.yna.co.kr/rss/politics.xml', publisher: '연합뉴스', region: '국내' },
  { name: '연합뉴스 북한', url: 'https://www.yna.co.kr/rss/northkorea.xml', publisher: '연합뉴스', region: '국내' },
  { name: '연합뉴스 경제', url: 'https://www.yna.co.kr/rss/economy.xml', publisher: '연합뉴스', region: '국내' },
  { name: '연합뉴스 마켓', url: 'https://www.yna.co.kr/rss/market.xml', publisher: '연합뉴스', region: '국내' },
  { name: '연합뉴스 산업', url: 'https://www.yna.co.kr/rss/industry.xml', publisher: '연합뉴스', region: '국내' },
  { name: '연합뉴스 사회', url: 'https://www.yna.co.kr/rss/society.xml', publisher: '연합뉴스', region: '국내' },
  { name: '연합뉴스 국제', url: 'https://www.yna.co.kr/rss/international.xml', publisher: '연합뉴스', region: '세계' },
  { name: '한국경제 경제', url: 'https://www.hankyung.com/feed/economy', publisher: '한국경제', region: '국내' },
  { name: '한국경제 증권', url: 'https://www.hankyung.com/feed/finance', publisher: '한국경제', region: '국내' },
  { name: '한국경제 IT', url: 'https://www.hankyung.com/feed/it', publisher: '한국경제', region: '국내' },
  { name: '동아일보 정치', url: 'https://rss.donga.com/politics.xml', publisher: '동아일보', region: '국내' },
  { name: '동아일보 경제', url: 'https://rss.donga.com/economy.xml', publisher: '동아일보', region: '국내' },
  { name: '경향신문 전체', url: 'https://www.khan.co.kr/rss/rssdata/total_news.xml', publisher: '경향신문', region: '국내' },
  { name: '전자신문', url: 'https://rss.etnews.com/Section901.xml', region: '국내' },
  { name: 'ZDNet Korea', url: 'https://feeds.feedburner.com/zdkorea', region: '국내' },
  { name: 'BBC World', url: 'https://feeds.bbci.co.uk/news/world/rss.xml', publisher: 'BBC', region: '세계' },
  { name: 'BBC Business', url: 'https://feeds.bbci.co.uk/news/business/rss.xml', publisher: 'BBC', region: '세계' },
  { name: 'BBC Technology', url: 'https://feeds.bbci.co.uk/news/technology/rss.xml', publisher: 'BBC', region: '세계' },
  { name: 'NYT World', url: 'https://rss.nytimes.com/services/xml/rss/nyt/World.xml', publisher: 'New York Times', region: '세계' },
  { name: 'NYT Business', url: 'https://rss.nytimes.com/services/xml/rss/nyt/Business.xml', publisher: 'New York Times', region: '세계' },
  { name: 'NYT Technology', url: 'https://rss.nytimes.com/services/xml/rss/nyt/Technology.xml', publisher: 'New York Times', region: '세계' },
  { name: 'Guardian World', url: 'https://www.theguardian.com/world/rss', publisher: 'The Guardian', region: '세계' },
  { name: 'Al Jazeera', url: 'https://www.aljazeera.com/xml/rss/all.xml', region: '세계' },
  { name: 'CNBC Top News', url: 'https://www.cnbc.com/id/100003114/device/rss/rss.html', publisher: 'CNBC', region: '세계' },
  { name: 'TechCrunch', url: 'https://techcrunch.com/feed/', region: '세계' },
  { name: 'The Verge', url: 'https://www.theverge.com/rss/index.xml', region: '세계' },
  { name: 'Ars Technica', url: 'https://feeds.arstechnica.com/arstechnica/index', region: '세계' },
];

const WIRES = '(site:reuters.com OR site:apnews.com OR site:bloomberg.com)';

/** 세부 분야별 검색어 — 분류표 경로 → 검색어. 국내는 한국어, 세계는 영어 */
const DEFAULT_QUERIES: Record<string, string> = {
  '국내/정치/국회·정당·정부': '국회 OR 대통령실 OR 여당 OR 야당',
  '국내/정치/북한·외교·안보': '북한 OR 외교부 OR 국방부 OR 한미',
  '국내/정치/사법·수사': '검찰 OR 법원 판결 OR 경찰 수사',
  '국내/경제/증시': '코스피 OR 코스닥',
  '국내/경제/환율·금리·통화정책': '환율 OR 한국은행 금리 OR 국고채',
  '국내/경제/부동산': '아파트값 OR 부동산 대책 OR 주택 공급',
  '국내/경제/산업·기업': '삼성 OR 현대차 OR SK OR LG 기업',
  '국내/경제/수출·무역': '수출 OR 무역수지 OR 관세',
  '국내/경제/가상자산·핀테크': '비트코인 OR 가상자산 OR 핀테크',
  '국내/경제/실적·공시': '실적 발표 OR 영업이익 OR 공시',
  '국내/IT·과학/AI·플랫폼': '인공지능 OR 네이버 OR 카카오 AI',
  '국내/IT·과학/반도체·전자': '반도체 OR HBM OR 삼성전자 OR SK하이닉스',
  '국내/IT·과학/통신·모바일': '통신사 OR 5G OR 스마트폰',
  '국내/IT·과학/게임·콘텐츠': '게임사 OR 넥슨 OR 엔씨소프트 OR 웹툰',
  '국내/IT·과학/스타트업·투자': '스타트업 투자 유치 OR 벤처',
  '국내/IT·과학/과학·우주': '과학기술 OR 누리호 OR 우주항공청',
  '국내/IT·과학/바이오·헬스': '바이오 OR 신약 OR 의료',
  '국내/사회/사건·사고': '사고 OR 화재 OR 사건',
  '국내/사회/노동·교육·복지': '노동 OR 교육부 OR 복지',
  '국내/사회/생활·안전': '안전 OR 생활 물가 OR 교통',
  '세계/국제정치/미국': `White House OR Congress ${WIRES}`,
  '세계/국제정치/중국·일본·아시아': `China OR Japan OR Taiwan ${WIRES}`,
  '세계/국제정치/유럽·러시아·우크라이나': `Ukraine OR Russia OR EU ${WIRES}`,
  '세계/국제정치/중동·아프리카·중남미': `Middle East OR Israel OR Iran OR Africa ${WIRES}`,
  '세계/세계경제/미국 증시·기업': 'Wall Street stocks OR S&P 500 OR Nasdaq',
  '세계/세계경제/유럽·아시아 증시': 'European stocks OR Nikkei OR Hang Seng',
  '세계/세계경제/금리·중앙은행·통화': 'Federal Reserve OR ECB OR Bank of Japan rates',
  '세계/세계경제/유가·원자재': 'oil prices OR gold prices OR commodities',
  '세계/세계경제/무역·관세': 'tariffs OR trade deal',
  '세계/세계경제/가상자산': 'bitcoin OR crypto',
  '세계/세계경제/경제지표': 'inflation data OR jobs report OR GDP',
  '세계/테크·과학/AI': 'artificial intelligence OR OpenAI OR Anthropic OR Google AI',
  '세계/테크·과학/빅테크': 'Apple OR Microsoft OR Amazon OR Meta OR Alphabet',
  '세계/테크·과학/반도체': 'Nvidia OR TSMC OR semiconductor OR Micron',
  '세계/테크·과학/스타트업·투자·M&A': 'startup funding OR acquisition tech',
  '세계/테크·과학/규제·정책': 'tech regulation OR antitrust OR AI policy',
  '세계/테크·과학/과학·우주': 'NASA OR SpaceX OR science study',
  '세계/테크·과학/에너지·기후테크': 'clean energy OR battery OR climate tech',
  '세계/사회·재난/재난·기후': 'earthquake OR hurricane OR wildfire OR flood',
  '세계/사회·재난/사회·인권·보건': 'human rights OR WHO OR public health',
};

export function defaultSourcesDoc(): SourcesDoc {
  return {
    feeds: DEFAULT_FEEDS,
    searches: SUBS.map((s) => ({ sub: subPath(s), query: DEFAULT_QUERIES[subPath(s)] ?? s.name })),
    disabled: [],
  };
}

// ---- 문서 찾기·만들기 ----

/** 부모 폴더 아래 이름이 같은 폴더를 찾고, 없으면 만든다 */
export function findOrCreateFolder(tx: DbOrTx, ownerId: number, parentId: number | null, name: string): number {
  const found = tx
    .select({ id: folders.id })
    .from(folders)
    .where(and(eq(folders.ownerId, ownerId), parentId === null ? isNull(folders.parentId) : eq(folders.parentId, parentId), eq(folders.name, name)))
    .get();
  if (found) return found.id;
  const now = Date.now();
  return tx.insert(folders).values({ ownerId, parentId, name, createdAt: now, updatedAt: now }).returning({ id: folders.id }).get().id;
}

/** "뉴스 브리핑" 폴더 — 이름으로 찾는다. 사용자가 이름을 바꾸거나 지우면 다음 실행 때 새로 생긴다 */
export function briefingFolderId(tx: DbOrTx, ownerId: number): number {
  return findOrCreateFolder(tx, ownerId, null, BRIEFING.FOLDER_NAME);
}

/** 수집 목록 문서를 읽는다. 없으면 기본값으로 만든다(지웠어도 다시 생긴다) */
export function loadSources(ownerId: number): { sources: Source[]; fileId: number; created: boolean } {
  return db.transaction((tx) => {
    const folderId = briefingFolderId(tx, ownerId);
    const existing = tx
      .select({ id: files.id, contentText: files.contentText })
      .from(files)
      .where(and(eq(files.ownerId, ownerId), eq(files.folderId, folderId), eq(files.name, BRIEFING.SOURCES_FILE_NAME), isNull(files.deletedAt)))
      .get();
    if (existing) return { sources: toSources(parseSourcesDoc(existing.contentText ?? '')), fileId: existing.id, created: false };

    const doc = defaultSourcesDoc();
    const content = JSON.stringify(doc, null, 2) + '\n';
    const now = Date.now();
    const row = tx
      .insert(files)
      .values({
        ownerId,
        folderId,
        name: BRIEFING.SOURCES_FILE_NAME,
        fileType: 'code',
        mimeType: 'text/plain',
        sizeBytes: Buffer.byteLength(content, 'utf8'),
        contentText: content,
        storagePath: null,
        kind: 'doc',
        createdAt: now,
        updatedAt: now,
      })
      .returning({ id: files.id })
      .get();
    return { sources: toSources(doc), fileId: row.id, created: true };
  });
}
