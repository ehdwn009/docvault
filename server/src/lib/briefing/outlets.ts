// 언론사 이름 표 — Google 뉴스가 <source>에 이름 대신 주소(futurechosun.com, zdnet.co.kr…)를 줄 때가 있다.
// 실제 회차에서 8건이 주소로 실렸고, 핵심 기사의 대표 출처도 "futurechosun.com"이었다 (사용성 평가 2026-10-01).
// 표에 없는 주소는 그대로 둔다 — 틀린 이름을 붙이느니 주소가 낫다. 포털 재게재 주소는 isAggregator가 따로 본다

const OUTLETS: Record<string, string> = {
  // 종합·경제지
  'chosun.com': '조선일보',
  'biz.chosun.com': '조선비즈',
  'futurechosun.com': '더나은미래',
  'joongang.co.kr': '중앙일보',
  'donga.com': '동아일보',
  'dongascience.com': '동아사이언스',
  'hani.co.kr': '한겨레',
  'khan.co.kr': '경향신문',
  'hankookilbo.com': '한국일보',
  'kmib.co.kr': '국민일보',
  'seoul.co.kr': '서울신문',
  'segye.com': '세계일보',
  'munhwa.com': '문화일보',
  'mk.co.kr': '매일경제',
  'hankyung.com': '한국경제',
  'sedaily.com': '서울경제',
  'edaily.co.kr': '이데일리',
  'mt.co.kr': '머니투데이',
  'fnnews.com': '파이낸셜뉴스',
  'asiae.co.kr': '아시아경제',
  'heraldcorp.com': '헤럴드경제',
  'ajunews.com': '아주경제',
  'g-enews.com': '글로벌이코노믹',
  'businesspost.co.kr': '비즈니스포스트',
  'news.bizwatch.co.kr': '비즈워치',
  'news2day.co.kr': '뉴스투데이',
  'newspim.com': '뉴스핌',
  'sisajournal.com': '시사저널',
  // 통신·방송
  'yna.co.kr': '연합뉴스',
  'yonhapnewstv.co.kr': '연합뉴스TV',
  'news1.kr': '뉴스1',
  'newsis.com': '뉴시스',
  'nocutnews.co.kr': '노컷뉴스',
  'ohmynews.com': '오마이뉴스',
  'pressian.com': '프레시안',
  'news.kbs.co.kr': 'KBS',
  'imnews.imbc.com': 'MBC',
  'news.sbs.co.kr': 'SBS',
  'jtbc.co.kr': 'JTBC',
  'ytn.co.kr': 'YTN',
  'mbn.co.kr': 'MBN',
  // IT·과학
  'zdnet.co.kr': '지디넷코리아',
  'etnews.com': '전자신문',
  'dt.co.kr': '디지털타임스',
  'ddaily.co.kr': '디지털데일리',
  'inews24.com': '아이뉴스24',
  'bloter.net': '블로터',
  'thelec.kr': '디일렉',
  'hellodd.com': '헬로디디',
  // 해외
  'reuters.com': 'Reuters',
  'bloomberg.com': 'Bloomberg',
  'apnews.com': 'AP',
  'ft.com': 'Financial Times',
  'wsj.com': 'The Wall Street Journal',
  'nytimes.com': 'The New York Times',
  'bbc.com': 'BBC',
  'bbc.co.uk': 'BBC',
  'cnbc.com': 'CNBC',
  'theguardian.com': 'The Guardian',
  'techcrunch.com': 'TechCrunch',
  'theverge.com': 'The Verge',
};

/** 이름 자리에 온 것이 주소처럼 생겼을 때만 표를 찾는다 (공백 없음 + 점 포함) */
const DOMAIN = /^[a-z0-9-]+(\.[a-z0-9-]+)+$/;

/** 주소면 언론사 이름으로. 하위 주소(biz.chosun.com)를 먼저 찾고, 없으면 상위(chosun.com)로 올라간다 */
export function outletName(source: string): string {
  const host = source.trim().toLowerCase().replace(/^(www|m)\./, '');
  if (!DOMAIN.test(host)) return source;
  const labels = host.split('.');
  for (let i = 0; i < labels.length - 1; i++) {
    const name = OUTLETS[labels.slice(i).join('.')];
    if (name) return name;
  }
  return source;
}
