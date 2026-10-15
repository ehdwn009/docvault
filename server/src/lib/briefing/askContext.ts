import { BRIEFING } from '../../constants.js';
import type { Edition, EditionItem } from './edition.js';
import { W5_KEYS } from './summarize.js';

// 이 기사 묻기의 문맥(v0.48, 해설 칸 토론 B) — 회차 JSON에서 "우리가 쓴 글 전체"를 서버가 조립한다. 클라이언트가 글자를 보내면
// "우리 글만 넘긴다"를 보장할 수 없다. 원문 본문은 회차에 없으니 섞일 수 없고, 전부 AI가 새로 쓴 글이라 질문 기록에 남아도 저작권 문제가 없다.
// [기사가 말한 것]과 [AI 해설·추론]을 나눠 넘긴다 — 안 그러면 답이 AI 추론을 "기사에 따르면"으로 되돌려 준다 (읽는 사람 조건)

export const ARTICLE_CONTEXT_MARK = '[뉴스 브리핑 기사]';
const W5_LABEL: Record<(typeof W5_KEYS)[number], string> = { who: '누가', what: '무엇을', when: '언제', where: '어디서', why: '왜' };
const BLOCK_LABEL: Record<string, string> = { background: '배경', numbers: '숫자', timeline: '경과', reactions: '반응', next: '앞으로', terms: '용어' };
const EXPLAIN_LABEL: Record<string, string> = { terms: '말뜻', why: '왜 이렇게 됐나', effect: '그래서 어떻게 되나', watch: '다음에 볼 것' };

function findItem(edition: Edition, itemId: string): { item: EditionItem; path: string } | null {
  for (const s of edition.sections ?? []) {
    for (const c of s.categories ?? []) {
      for (const sub of c.subs ?? []) {
        const item = (sub.items ?? []).find((it) => it.id === itemId);
        if (item) return { item, path: `${s.section} · ${c.name} · ${sub.name}` };
      }
    }
  }
  return null;
}

/** 회차 본문(JSON 글자)과 기사 id → 문맥 글. 회차가 아니거나 기사가 없으면 null */
export function buildArticleContext(contentText: string, itemId: string): string | null {
  let edition: Edition;
  try {
    edition = JSON.parse(contentText) as Edition;
  } catch {
    return null;
  }
  const found = findItem(edition, itemId);
  if (!found) return null;
  const { item, path } = found;
  const name = (ids: string[] | undefined) =>
    (ids ?? [])
      .map((id) => item.sources?.find((x) => x.id === id)?.source)
      .filter((x): x is string => !!x)
      .join('·');
  const said: string[] = [];
  const ai: string[] = [];
  if (item.summary) said.push(`리드: ${item.summary}`);
  if (item.why) said.push(`왜 중요한가: ${item.why}`);
  for (const b of item.blocks ?? []) {
    const label = BLOCK_LABEL[b.kind] ?? b.kind;
    if (b.pairs) said.push(`${label}: ${b.pairs.map((x) => `${x.label} ${x.value}`).join(', ')}`);
    else if (b.items) said.push(`${label}: ${b.items.map((x) => `${x.date} ${x.text}`).join(' / ')}`);
    else if (b.text) said.push(`${label}: ${b.text}`);
  }
  if (item.w5) {
    const w5 = W5_KEYS.map((k) => (item.w5?.[k] ? `${W5_LABEL[k]} ${item.w5[k]!.text}` : '')).filter(Boolean);
    if (w5.length) said.push(`5W: ${w5.join(' / ')}`);
  }
  for (const line of item.impact ?? []) {
    const text = `영향 · ${line.target}: ${line.text}`;
    if (line.kind === 'stated') said.push(`${text} (${name([line.from])})`);
    else ai.push(text);
  }
  if (item.sides) said.push(`양쪽 시각: ${item.sides.items.map((x) => `${x.label} — ${x.text}`).join(' / ')}`);
  if (item.changed) said.push(`지난 판 이후: ${item.changed}`);
  for (const b of item.explain ?? []) {
    const label = `해설 · ${EXPLAIN_LABEL[b.kind] ?? b.kind}`;
    const text = b.items ? b.items.map((t) => `${t.term} — ${t.text}`).join(' / ') : (b.text ?? '');
    if (!text) continue;
    if (b.basis === 'stated') said.push(`${label}: ${text} (${name(b.from)})`);
    else ai.push(`${label}: ${text}`);
  }
  const more = (item.related ?? []).length;
  const head = [
    ARTICLE_CONTEXT_MARK,
    `제목: ${item.title}`,
    `분야: ${path}`,
    `언론사: ${item.source}${more ? ` 외 ${more}곳` : ''} · 회차 ${edition.edition?.date ?? ''} ${edition.edition?.label ?? ''}`,
    `원문: ${item.url}`,
  ];
  const parts = [...head, '', '[기사가 말한 것 — 언론사 보도를 AI가 정리한 요약]', ...said];
  if (ai.length) parts.push('', '[AI 해설·추론 — 기사가 아니라 AI가 배경지식으로 쓴 글. 사실로 인용하지 말 것]', ...ai);
  return parts.join('\n').slice(0, BRIEFING.ASK_CONTEXT_MAX_CHARS);
}
