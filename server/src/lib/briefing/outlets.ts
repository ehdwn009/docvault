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

/**
 * 표(OUTLETS) 밖인데 언론으로 아는 곳 — Google 뉴스 검색 후보의 출처 허용 목록에 더해진다 (2026-11-01 사용자 결정).
 * 11/1 06:00 회차에 브런치(블로그)·증권 브로커·개인 매체가 참고 기사로 섞여, 검색 후보는 **아는 언론사만** 받기로 했다.
 * 여기 없는 출처가 버려지면 실행 기록에 이름과 건수가 남는다 — 진짜 언론이면 여기에 더하거나 수집 목록 문서에 피드로 넣는다
 */
const KNOWN_OUTLET_NAMES = [
  // 국내 종합·경제·지역지
  '국제신문', '부산일보', '매일신문', '영남일보', '경북매일', '경북일보', '대구일보', '대전일보', '중도일보', '충청투데이', '충청일보', '전남일보', '광주일보', '전북일보', '전북도민일보', '전민일보',
  '강원일보', '강원도민일보', '경인일보', '중부일보', '인천일보', '경남신문', '경남일보', '울산매일', '제주일보', '제민일보', '한라일보', '서울일보',
  '더팩트', '위키트리', '뉴데일리', '데일리안', '미디어오늘', '민중의소리', '오마이뉴스', '프레시안', '한국경제TV', '매일경제TV', '이투데이', '뉴스토마토', '더벨', '인베스트조선', '조세일보',
  '더스쿠프', '시사인', '시사위크', '일요신문', '주간조선', '주간동아', '한겨레21', '중앙선데이', '신동아', '월간조선',
  // 국내 IT·산업·전문지
  '아이티데일리', '데이터넷', '보안뉴스', '데일리시큐', '테크M', '바이라인네트워크', '더구루', '뉴스핌', '데일리팜', '약업신문', '메디게이트뉴스', '청년의사', '메디칼타임즈', '히트뉴스', '팜이데일리',
  '연합인포맥스', '이코노미스트', 'AI타임스', '브릿지경제', '메트로신문', '한국금융신문', '금융신문',
  '전기신문', '에너지경제', '에너지경제신문', '에너지신문', '건설경제', '대한경제', '물류신문', '교통신문', '한국농어민신문', '농민신문', '코인데스크코리아', '디지털애셋', '블록미디어', '디지털투데이', '테크홀릭',
  // 방송·통신
  'KBS', 'MBC', 'SBS', 'JTBC', 'YTN', 'MBN', '채널A', 'TV조선', '연합뉴스TV', '뉴스1', '뉴시스', 'OBS', 'KNN', 'TBC', 'KBC', 'JTV', 'G1', 'CJB', 'TJB', 'UBC', 'JIBS',
  // 해외
  'Reuters', 'AP', 'AP News', 'AFP', 'Bloomberg', 'Financial Times', 'The Wall Street Journal', 'The New York Times', 'New York Times', 'The Washington Post', 'Washington Post', 'BBC', 'BBC News', 'CNBC', 'CNN', 'NBC News', 'CBS News', 'ABC News', 'NPR', 'PBS',
  'The Guardian', 'The Economist', 'The Times', 'The Telegraph', 'Politico', 'Axios', 'Semafor', 'The Hill', 'USA Today', 'Los Angeles Times', 'The Atlantic', 'Time', 'Fortune', 'Forbes', 'Business Insider', 'MarketWatch', "Barron's", 'Yahoo Finance', 'Nikkei Asia', 'Nikkei', 'Kyodo News', 'Japan Wire by Kyodo News', 'NHK', 'South China Morning Post', 'The Straits Times', 'Channel NewsAsia', 'Al Jazeera', 'DW', 'France 24', 'Le Monde', 'Der Spiegel', 'ABC News & Headlines – Australian Broadcasting Corporation', 'Sydney Morning Herald',
  'TechCrunch', 'The Verge', 'Ars Technica', 'Wired', 'Engadget', 'The Register', 'ZDNet', 'ZDNet Korea', 'Tom\'s Hardware', 'AnandTech', 'MIT Technology Review', 'Nature', 'Science', 'Scientific American', 'New Scientist', 'Space.com', 'STAT', 'The Information', 'Mashable', 'The Economic Times', 'Livemint', 'Moneycontrol.com', 'NDTV', 'The Times of India', 'The Hindu',
];
const KNOWN_LOWER = new Set([...Object.values(OUTLETS), ...KNOWN_OUTLET_NAMES].map((n) => n.toLowerCase()));

/**
 * 아는 언론사인가 — 표의 이름·주소, 위 목록, 호출자가 준 이름(수집 목록 피드의 name·publisher), 그리고 **언론사 주소**(Google 뉴스 <source url>)가
 * 표의 주소나 수집 목록 피드의 주소(extraHosts)와 같은 곳. 이름만 보면 "KBS 뉴스"·"Chosunbiz"·"DongA Science"·"에너지경제신문"처럼
 * 표기가 흔들려 아는 곳을 버렸다(11/1 14:35 회차에서 183건) — 주소가 더 믿을 만하다
 */
export function isKnownOutlet(source: string, extra: ReadonlySet<string>, sourceUrl: string | null = null, extraHosts: ReadonlySet<string> = EMPTY): boolean {
  const name = source.trim().toLowerCase();
  if (name && (KNOWN_LOWER.has(name) || extra.has(name))) return true;
  // 주소로 온 출처는 표에 있는 주소(하위 → 상위)일 때만 — 표 밖 주소는 맨몸 주소로 줄어들 뿐 아는 곳이 아니다
  return hostKnown(hostOf(name), extraHosts) || hostKnown(hostOf(sourceUrl ?? ''), extraHosts);
}

const EMPTY: ReadonlySet<string> = new Set();

function hostKnown(host: string | null, extraHosts: ReadonlySet<string>): boolean {
  if (!host) return false;
  const labels = host.split('.');
  for (let i = 0; i < labels.length - 1; i++) {
    const h = labels.slice(i).join('.');
    if (OUTLETS[h] || extraHosts.has(h)) return true;
  }
  return false;
}

/** 주소의 호스트(www.·m. 뗀 것) — 수집 목록 피드 주소를 "아는 언론사 주소"로 쓸 때 */
export function outletHost(url: string): string | null {
  return hostOf(url);
}

/** 이름 자리에 온 것이 주소처럼 생겼을 때만 표를 찾는다 (공백 없음 + 점 포함). "https://www.x.co.kr/"처럼 주소 전체가 오기도 한다 */
const DOMAIN = /^[a-z0-9-]+(\.[a-z0-9-]+)+$/;
function hostOf(source: string): string | null {
  const host = source.trim().toLowerCase().replace(/^https?:\/\//, '').replace(/[/?#].*$/, '').replace(/^(www|m)\./, '');
  return DOMAIN.test(host) ? host : null;
}

/** 주소면 언론사 이름으로. 하위 주소(biz.chosun.com)를 먼저 찾고, 없으면 상위(chosun.com)로 올라간다.
    표에 없으면 맨몸 주소(seoulilbo.co.kr)로 — 틀린 이름보다 주소가 낫지만 "https://www…/" 전체보다는 짧은 쪽이 읽힌다 */
export function outletName(source: string): string {
  const host = hostOf(source);
  if (!host) return source;
  const labels = host.split('.');
  for (let i = 0; i < labels.length - 1; i++) {
    const name = OUTLETS[labels.slice(i).join('.')];
    if (name) return name;
  }
  return host;
}
