import { z } from 'zod';
import { findSubByPath, SUBS, subPath, type BriefingSection, type BriefingSub } from './taxonomy.js';

// 수집 목록의 "형식과 기본값" — DB를 모르는 순수 부분. 서버(sources.ts의 loadSources)와 구독 생성 방식의 세션(scripts/briefing-job.ts)이
// 같은 코드로 문서를 검증하고 출처 목록으로 바꾼다 (뉴스 브리핑 설계 "구독 생성 방식 — 지시서"). db/index.ts는 import 시점에
// SQLite를 열기 때문에, 세션에서 쓰려면 이 부분이 DB에서 떨어져 있어야 한다 (v0.50)

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

// ---- 후보 출처 (개선 합의안 S5, 2026-10-11) — 직접 RSS를 약 70곳으로 넓히기 위한 후보. 이 코드를 쓴 환경에서는 주소를 열어 보지 못했다.
// 그래서 기본 목록에 넣되 **꺼진 상태(disabled)**로 둔다. 서버에서 `npm run briefing:check -w server`로 살아 있는 것을 확인한 뒤
// 수집 목록 문서의 disabled에서 이름을 지우면 켜진다. 이미 수집 목록 문서가 있는 사람은 이 후보가 저절로 들어가지 않는다 —
// 문서를 지우면 다음 생성 때 기본값(후보 포함)으로 다시 생긴다. 기본 목록 27곳 + 후보 43곳 = 70곳

export const CANDIDATE_FEEDS: SourcesDoc['feeds'] = [
  { name: '연합뉴스 전체', url: 'https://www.yna.co.kr/rss/news.xml', publisher: '연합뉴스', region: '국내' },
  { name: '한국경제 정치', url: 'https://www.hankyung.com/feed/politics', publisher: '한국경제', region: '국내' },
  { name: '한국경제 국제', url: 'https://www.hankyung.com/feed/international', publisher: '한국경제', region: '세계' },
  { name: '한국경제 부동산', url: 'https://www.hankyung.com/feed/realestate', publisher: '한국경제', region: '국내' },
  { name: '매일경제 경제', url: 'https://www.mk.co.kr/rss/30100041/', publisher: '매일경제', region: '국내' },
  { name: '매일경제 증권', url: 'https://www.mk.co.kr/rss/50200011/', publisher: '매일경제', region: '국내' },
  { name: '매일경제 기업', url: 'https://www.mk.co.kr/rss/50100032/', publisher: '매일경제', region: '국내' },
  { name: '매일경제 IT', url: 'https://www.mk.co.kr/rss/50300009/', publisher: '매일경제', region: '국내' },
  { name: '머니투데이', url: 'https://rss.mt.co.kr/mt_news.xml', publisher: '머니투데이', region: '국내' },
  { name: '이데일리 경제', url: 'https://www.edaily.co.kr/rss/economy.xml', publisher: '이데일리', region: '국내' },
  { name: '서울경제', url: 'https://www.sedaily.com/RSS/S1N1.xml', publisher: '서울경제', region: '국내' },
  { name: '아시아경제', url: 'https://www.asiae.co.kr/rss/economy.htm', publisher: '아시아경제', region: '국내' },
  { name: '조선일보', url: 'https://www.chosun.com/arc/outboundfeeds/rss/?outputType=xml', publisher: '조선일보', region: '국내' },
  { name: '조선비즈', url: 'https://biz.chosun.com/arc/outboundfeeds/rss/?outputType=xml', publisher: '조선비즈', region: '국내' },
  { name: '중앙일보', url: 'https://rss.joins.com/joins_news_list.xml', publisher: '중앙일보', region: '국내' },
  { name: '한겨레', url: 'https://www.hani.co.kr/rss/', publisher: '한겨레', region: '국내' },
  { name: '경향신문 경제', url: 'https://www.khan.co.kr/rss/rssdata/economy_news.xml', publisher: '경향신문', region: '국내' },
  { name: '동아일보 국제', url: 'https://rss.donga.com/international.xml', publisher: '동아일보', region: '세계' },
  { name: 'SBS 뉴스', url: 'https://news.sbs.co.kr/news/newsflashRssFeed.do?plink=RSSREADER', publisher: 'SBS', region: '국내' },
  { name: 'KBS 뉴스', url: 'https://news.kbs.co.kr/rss/news.xml', publisher: 'KBS', region: '국내' },
  { name: 'MBC 뉴스', url: 'https://imnews.imbc.com/rss/news/news_00.xml', publisher: 'MBC', region: '국내' },
  { name: 'YTN', url: 'https://www.ytn.co.kr/_comm/rss.php?mcd=0102', publisher: 'YTN', region: '국내' },
  { name: '뉴시스 경제', url: 'https://newsis.com/RSS/economy.xml', publisher: '뉴시스', region: '국내' },
  { name: '뉴스1 경제', url: 'https://www.news1.kr/rss/economy.xml', publisher: '뉴스1', region: '국내' },
  { name: '디지털데일리', url: 'https://www.ddaily.co.kr/rss/S1N1.xml', publisher: '디지털데일리', region: '국내' },
  { name: '아이뉴스24', url: 'https://www.inews24.com/rss/news.xml', publisher: '아이뉴스24', region: '국내' },
  { name: '블로터', url: 'https://www.bloter.net/rss/allArticle.xml', publisher: '블로터', region: '국내' },
  { name: 'Guardian Business', url: 'https://www.theguardian.com/uk/business/rss', publisher: 'The Guardian', region: '세계' },
  { name: 'Guardian Technology', url: 'https://www.theguardian.com/uk/technology/rss', publisher: 'The Guardian', region: '세계' },
  { name: 'NPR News', url: 'https://feeds.npr.org/1001/rss.xml', publisher: 'NPR', region: '세계' },
  { name: 'DW', url: 'https://rss.dw.com/rdf/rss-en-all', publisher: 'DW', region: '세계' },
  { name: 'France 24', url: 'https://www.france24.com/en/rss', publisher: 'France 24', region: '세계' },
  { name: 'SCMP', url: 'https://www.scmp.com/rss/91/feed', publisher: 'South China Morning Post', region: '세계' },
  { name: 'Japan Times', url: 'https://www.japantimes.co.jp/feed/', publisher: 'The Japan Times', region: '세계' },
  { name: 'Nikkei Asia', url: 'https://asia.nikkei.com/rss/feed/nar', publisher: 'Nikkei Asia', region: '세계' },
  { name: 'Axios', url: 'https://api.axios.com/feed/', publisher: 'Axios', region: '세계' },
  { name: 'Politico', url: 'https://rss.politico.com/politics-news.xml', publisher: 'Politico', region: '세계' },
  { name: 'CNBC World', url: 'https://www.cnbc.com/id/100727362/device/rss/rss.html', publisher: 'CNBC', region: '세계' },
  { name: 'CNBC Technology', url: 'https://www.cnbc.com/id/19854910/device/rss/rss.html', publisher: 'CNBC', region: '세계' },
  { name: 'BBC Science', url: 'https://feeds.bbci.co.uk/news/science_and_environment/rss.xml', publisher: 'BBC', region: '세계' },
  { name: 'NYT Science', url: 'https://rss.nytimes.com/services/xml/rss/nyt/Science.xml', publisher: 'New York Times', region: '세계' },
  { name: 'The Register', url: 'https://www.theregister.com/headlines.atom', publisher: 'The Register', region: '세계' },
  { name: 'Wired', url: 'https://www.wired.com/feed/rss', publisher: 'Wired', region: '세계' },
  { name: 'MIT Technology Review', url: 'https://www.technologyreview.com/feed/', publisher: 'MIT Technology Review', region: '세계' },
];

export function defaultSourcesDoc(): SourcesDoc {
  return {
    feeds: [...DEFAULT_FEEDS, ...CANDIDATE_FEEDS],
    searches: SUBS.map((s) => ({ sub: subPath(s), query: DEFAULT_QUERIES[subPath(s)] ?? s.name })),
    // 후보는 꺼진 채로 — 점검 명령으로 확인한 뒤 켠다
    disabled: CANDIDATE_FEEDS.map((f) => f.name),
  };
}

