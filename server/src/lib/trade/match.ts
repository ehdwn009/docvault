// 게시판 줄 하나가 「월간 수출입 동향」인지, 몇 월 호인지 판정한다 (수출입 동향 설계 "제목 판정").
// 수집 실험에서 게시판 597줄 전부로 검증한 규칙 그대로 — 2015-12~2026-10 정규 게시 131개월, 빈틈·중복·대상월 불일치 0 (2026-11-20)

export type BoardRow = {
  articleId: string;
  title: string;
  dept: string | null;
  /** 'YYYY-MM-DD' */
  date: string;
};

const MUST = /수출입\s*동향/;
// 같은 검색에 걸리는 다른 보도자료 — 「정보통신산업(ICT) 수출입 동향」(같은 달 중순), 「전략물자 수출입고시」 등
const EXCLUDE = /ICT|정보통신|디지털|IT산업|서비스|에너지|지역별|전략물자|점검|고시|물류|비교|대책|상정|경쟁국|안전인증/;
// 2026년 10월 / '26년 10월 / ‘26. 10월 / 2025년 연간 및 12월 / 상반기 및 6월
const YEAR_MONTH = /(?:(\d{4})|['‘’]?(\d{2}))\s*(?:년도?|\.)\s*\(?\s*(?:연간\s*및\s*|상반기\s*및\s*)?(\d{1,2})\s*월/;
/** 1997~2015년 글이 이날로 일괄 이관됐다(대부분 HWP) — 정규 게시가 아니다 */
const MIGRATED_DATE = '2016-12-09';

/** 'YYYY-MM'의 전월 */
export function previousMonth(month: string): string {
  const [y, m] = month.split('-').map(Number) as [number, number];
  return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, '0')}`;
}

/** 'YYYY-MM'에 n달 더하기(음수 가능) */
export function addMonths(month: string, n: number): string {
  const [y, m] = month.split('-').map(Number) as [number, number];
  const idx = y * 12 + (m - 1) + n;
  return `${Math.floor(idx / 12)}-${String((idx % 12) + 1).padStart(2, '0')}`;
}

/** 이 줄이 월간 수출입 동향이면 다루는 달('YYYY-MM'), 아니면 null */
export function periodOf(row: BoardRow): string | null {
  const title = row.title.normalize('NFKC').replace(/\s+/g, ' ').trim();
  if (row.date === MIGRATED_DATE || row.date < '2016') return null;
  if (!MUST.test(title) || EXCLUDE.test(title)) return null;
  // 게시는 다룬 달의 다음 달 초 — 등록월의 전월이 기대하는 달
  const expected = previousMonth(row.date.slice(0, 7));
  const m = YEAR_MONTH.exec(title);
  if (m) {
    const year = m[1] ? Number(m[1]) : 2000 + Number(m[2]);
    const month = Number(m[3]);
    if (month < 1 || month > 12) return null;
    const period = `${year}-${String(month).padStart(2, '0')}`;
    return period === expected ? period : null;
  }
  // 제목에 연월이 없는 드문 경우(실측 2건) — 수출입과가 1~3일에 올린 글이면 전월 호로 본다
  const day = Number(row.date.slice(8, 10));
  return row.dept === '수출입과' && day <= 3 ? expected : null;
}

/** 'YYYY-MM' → '2026년 10월' */
export function periodLabel(period: string): string {
  const [y, m] = period.split('-').map(Number) as [number, number];
  return `${y}년 ${m}월`;
}
