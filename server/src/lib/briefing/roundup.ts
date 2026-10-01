import { BRIEFING } from '../../constants.js';

// 모음 기사 거르기 — "[연합뉴스 이 시각 헤드라인] - 07:30"처럼 서로 상관없는 사건 여럿을 한 페이지에 모은 기사.
// 기사 하나로 다루면 무슨 일·배경·숫자 칸에 다른 사건이 섞이고, 제목도 세 사건을 이어 붙인 모양이 됐다 (2026-10-02 실제 회차).
// 담긴 사건들은 대개 개별 기사로도 들어와 있어서 빼도 잃는 것이 거의 없다. 세 겹으로 거른다:
// ① 제목(수집) ② AI 지시(선별, select.ts) ③ 원문 모양(원문 읽기, body.ts)

const TAG = new RegExp(`\\[[^\\]]*(${BRIEFING.ROUNDUP_TAG_WORDS.map(escape).join('|')})[^\\]]*\\]`);
const PHRASE = new RegExp(BRIEFING.ROUNDUP_TITLE_PHRASES.map(escape).join('|'));

function escape(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** ① 제목으로 — 말머리 안의 모음 낱말, 또는 모음 문구 */
export function isRoundupTitle(title: string): boolean {
  return TAG.test(title) || PHRASE.test(title);
}

/** ③ 원문으로 — "전문보기" 링크나 ■ 소제목이 여럿이면 여러 기사를 모은 페이지다.
    ■는 뽑아낸 본문에서만 센다 — 페이지 전체에는 메뉴·관련 기사 목록의 ■가 섞여 있을 수 있다 */
export function isRoundupPage(html: string, text: string): boolean {
  const count = (s: string, re: RegExp) => s.match(re)?.length ?? 0;
  return count(html, /전문\s?보기/g) >= BRIEFING.ROUNDUP_MIN_SECTIONS || count(text, /■/g) >= BRIEFING.ROUNDUP_MIN_SECTIONS;
}
