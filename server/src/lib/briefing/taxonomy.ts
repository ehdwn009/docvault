// 뉴스 브리핑 분류표 — 기획서의 카테고리 구성 그대로 (뉴스 브리핑 설계 "분류표").
// 순서가 곧 화면 순서다. 수집 목록(searches[].sub)은 사람이 읽는 경로("국내/경제/증시")로,
// AI와 회차 JSON은 짧은 id("kr.econ.stock")로 가리킨다

export type BriefingSection = '국내' | '세계';

export type BriefingSub = {
  /** AI 출력·기사 id의 열쇠 */
  id: string;
  section: BriefingSection;
  category: string;
  name: string;
  /** 경제·IT·테크 계열 — 분야당 기사 상한이 더 크다 (BRIEFING.MAX_ITEMS_WIDE) */
  wide: boolean;
};

type CategoryDef = { key: string; name: string; wide: boolean; subs: [key: string, name: string][] };

const TREE: Record<BriefingSection, { key: string; categories: CategoryDef[] }> = {
  국내: {
    key: 'kr',
    categories: [
      { key: 'pol', name: '정치', wide: false, subs: [['gov', '국회·정당·정부'], ['nk', '북한·외교·안보'], ['law', '사법·수사']] },
      {
        key: 'econ', name: '경제', wide: true,
        subs: [['stock', '증시'], ['rate', '환율·금리·통화정책'], ['estate', '부동산'], ['biz', '산업·기업'], ['trade', '수출·무역'], ['crypto', '가상자산·핀테크'], ['earn', '실적·공시']],
      },
      {
        key: 'tech', name: 'IT·과학', wide: true,
        subs: [['ai', 'AI·플랫폼'], ['chip', '반도체·전자'], ['telco', '통신·모바일'], ['game', '게임·콘텐츠'], ['startup', '스타트업·투자'], ['sci', '과학·우주'], ['bio', '바이오·헬스']],
      },
      { key: 'soc', name: '사회', wide: false, subs: [['case', '사건·사고'], ['labor', '노동·교육·복지'], ['life', '생활·안전']] },
    ],
  },
  세계: {
    key: 'w',
    categories: [
      { key: 'pol', name: '국제정치', wide: false, subs: [['us', '미국'], ['asia', '중국·일본·아시아'], ['eu', '유럽·러시아·우크라이나'], ['mea', '중동·아프리카·중남미']] },
      {
        key: 'econ', name: '세계경제', wide: true,
        subs: [['usstock', '미국 증시·기업'], ['stock', '유럽·아시아 증시'], ['cb', '금리·중앙은행·통화'], ['oil', '유가·원자재'], ['trade', '무역·관세'], ['crypto', '가상자산'], ['data', '경제지표']],
      },
      {
        key: 'tech', name: '테크·과학', wide: true,
        subs: [['ai', 'AI'], ['bigtech', '빅테크'], ['chip', '반도체'], ['startup', '스타트업·투자·M&A'], ['reg', '규제·정책'], ['sci', '과학·우주'], ['energy', '에너지·기후테크']],
      },
      { key: 'soc', name: '사회·재난', wide: false, subs: [['disaster', '재난·기후'], ['rights', '사회·인권·보건']] },
    ],
  },
};

export const SECTIONS: BriefingSection[] = ['국내', '세계'];

export const SUBS: BriefingSub[] = SECTIONS.flatMap((section) =>
  TREE[section].categories.flatMap((cat) =>
    cat.subs.map(([key, name]) => ({
      id: `${TREE[section].key}.${cat.key}.${key}`,
      section,
      category: cat.name,
      name,
      wide: cat.wide,
    })),
  ),
);

const byId = new Map(SUBS.map((s) => [s.id, s]));
const byPath = new Map(SUBS.map((s) => [subPath(s), s]));

/** 사람이 읽는 경로 — 수집 목록 문서가 쓰는 모양 */
export function subPath(s: BriefingSub): string {
  return `${s.section}/${s.category}/${s.name}`;
}

export function findSubById(id: string): BriefingSub | undefined {
  return byId.get(id);
}

export function findSubByPath(path: string): BriefingSub | undefined {
  return byPath.get(path.trim());
}

/** 같은 대분류의 세부 분야들 (화면 순서) */
export function categoriesOf(section: BriefingSection): { name: string; subs: BriefingSub[] }[] {
  return TREE[section].categories.map((cat) => ({
    name: cat.name,
    subs: SUBS.filter((s) => s.section === section && s.category === cat.name),
  }));
}
