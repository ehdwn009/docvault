import type { CardSummary } from './cards.js';

// 카드 내보내기 (API-118) — 용어집 md와 Anki CSV. 둘 다 머리말만 쓰고(제목·별칭·한 줄·주제·태그),
// 본문은 Anki 뒷면에만 앞부분을 붙인다. 학습자료의 `부록/용어집.md`가 정확히 이 모양이라 카드가 그 원천이 된다.

/** 첫 글자를 색인 머리(ㄱ~ㅎ · A~Z · #)로. 쌍자음은 홑자음 칸에 — 용어집이 ㄲ 칸을 따로 갖지 않는다 */
const CHOSEONG = ['ㄱ', 'ㄱ', 'ㄴ', 'ㄷ', 'ㄷ', 'ㄹ', 'ㅁ', 'ㅂ', 'ㅂ', 'ㅅ', 'ㅅ', 'ㅇ', 'ㅈ', 'ㅈ', 'ㅊ', 'ㅋ', 'ㅌ', 'ㅍ', 'ㅎ'];
export function indexHeadOf(title: string): string {
  const ch = title.trim().charAt(0);
  const code = ch.charCodeAt(0);
  if (code >= 0xac00 && code <= 0xd7a3) return CHOSEONG[Math.floor((code - 0xac00) / 588)]!;
  if (/[a-z]/i.test(ch)) return ch.toUpperCase();
  return '#';
}

const sortKo = (a: CardSummary, b: CardSummary) => a.title.localeCompare(b.title, 'ko');

/** 용어집 md — 머리(ㄱ·ㄴ·…·A·B·#)별로 묶고 가나다순. 주제 카드는 뒤에 따로 */
export function buildGlossaryMd(cards: CardSummary[], date: Date): string {
  const concepts = cards.filter((c) => c.kind !== '주제').sort(sortKo);
  const topics = cards.filter((c) => c.kind === '주제').sort(sortKo);
  const ymd = date.toISOString().slice(0, 10);
  const out = [`# 용어집 — ${ymd} · ${concepts.length}장`, '', '배움 카드에서 내보냄. 카드를 고치고 다시 내보내면 이 파일이 갱신됩니다.', ''];
  let head = '';
  for (const c of concepts) {
    const h = indexHeadOf(c.title);
    if (h !== head) {
      if (head) out.push(''); // 목록과 다음 머리 사이 빈 줄 — 붙여 두면 md 파서가 목록에 이어 붙인다
      head = h;
      out.push(`## ${h}`, '');
    }
    const alias = c.aliases.length ? ` (${c.aliases.join(', ')})` : '';
    const topic = c.topic ? ` · ${c.topic}` : '';
    out.push(`- **${c.title}**${alias} — ${c.oneLine}${topic}`);
  }
  if (topics.length) {
    out.push('', '## 주제', '');
    for (const t of topics) out.push(`- **${t.title}** — ${t.oneLine}${t.links.length ? ` (${t.links.join(' · ')})` : ''}`);
  }
  return out.join('\n') + '\n';
}

/** Anki 뒷면에 넣을 본문 길이 — 카드 한 장이 폰 화면에 들어올 만큼 */
const ANKI_BODY_CHARS = 600;
const csvCell = (s: string) => `"${s.replace(/"/g, '""')}"`;

/** Anki CSV — 앞면;뒷면;태그. 머리 두 줄은 Anki가 읽는 가져오기 설정 (구분자·HTML 허용) */
export function buildAnkiCsv(cards: { summary: CardSummary; body: string }[]): string {
  const rows = ['#separator:;', '#html:true', '#columns:앞면;뒷면;태그'];
  for (const { summary: c, body } of [...cards].sort((a, b) => sortKo(a.summary, b.summary))) {
    const front = c.aliases.length ? `${c.title}<br><small>${c.aliases.join(', ')}</small>` : c.title;
    const snippet = body.trim().slice(0, ANKI_BODY_CHARS).replace(/\r?\n/g, '<br>');
    const back = snippet ? `<b>${c.oneLine}</b><br><br>${snippet}` : `<b>${c.oneLine}</b>`;
    const tags = [c.topic, ...c.tags].filter(Boolean).map((t) => t.replace(/\s+/g, '_')).join(' ');
    rows.push([csvCell(front), csvCell(back), csvCell(tags)].join(';'));
  }
  return rows.join('\n') + '\n';
}
