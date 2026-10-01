import { z } from 'zod/v4';
import { BRIEFING } from '../../constants.js';
import { callAndCount, SYSTEM_BASE, type AiCaller, type Usage } from './ai.js';
import type { Candidate } from './collect.js';
import { errorText, mapLimit } from './limit.js';
import { subPath, type BriefingSub } from './taxonomy.js';

// ③ 선별 (Haiku) — 세부 분야마다 한 번: 같은 사건 묶기 · 중요도 · new/updated · 분야당 상한.
// 참고(1) 기사는 여기서 제목·요약·의미까지 쓴다 — 참고 기사에 Sonnet을 쓰지 않는 것이 비용 설계의 핵심 (설계 "③ 선별")

/** 한 분야에 한 번에 보여 주는 후보 상한 — 검색 하나가 100건을 가져와도 최신 것부터 이만큼 */
const MAX_INPUT_PER_SUB = 60;

export type PrevStory = { storyId: string; title: string };

export type Picked = {
  sub: BriefingSub;
  main: Candidate;
  related: Candidate[];
  importance: 1 | 2 | 3;
  /** 직전 회차의 이슈를 이어받았으면 그 id, 아니면 null(새 id는 조립 단계가 붙인다) */
  prevStoryId: string | null;
  /** 참고(1)만 채워진다. 핵심·주요는 ④ 요약이 쓴다 */
  brief: { title: string; summary: string; why: string } | null;
};

const SelectSchema = z.object({
  stories: z.array(
    z.object({
      main: z.number().describe('대표 기사 번호'),
      related: z.array(z.number()).describe('같은 사건을 다룬 나머지 기사 번호'),
      // 범위 제약을 스키마에 두지 않는다 — 벗어난 값 하나로 응답 전체가 거부된다. 아래에서 1~3으로 자른다
      importance: z.number().describe('3=핵심 2=주요 1=참고'),
      prevStoryId: z.string().nullable().describe('직전 회차 이슈 목록에 같은 이슈가 있으면 그 id, 없으면 null'),
      title: z.string().describe(`참고(1)만: ${BRIEFING.TITLE_MAX_CHARS}자 이내 한국어 제목, 원문 제목을 베끼지 말고 새로 쓴다. 핵심·주요는 빈 문자열`),
      summary: z.string().describe('참고(1)만: 무슨 일인지 1~2문장, 새로 쓴다. 핵심·주요는 빈 문자열'),
      why: z.string().describe('참고(1)만: 왜 중요한지 한 줄. 핵심·주요는 빈 문자열'),
    }),
  ),
});

const IMPORTANCE_RULES = [
  '중요도 기준 (회차마다 들쭉날쭉하지 않게 고정):',
  '- 3 핵심: 여러 주요 언론이 머리기사로 다루거나, 시장·정책·안보에 즉시 영향이 있는 뉴스. 분야당 1~2건',
  '- 2 주요: 흐름을 이해하는 데 필요한 뉴스. 진행 중인 이슈의 새 국면 포함',
  '- 1 참고: 관심 있으면 볼 뉴스, 개별 기업·지역 소식',
].join('\n');

async function selectOne(sub: BriefingSub, cands: Candidate[], prev: PrevStory[], ai: AiCaller, usage: Usage, signal?: AbortSignal): Promise<Picked[]> {
  const input = [...cands].sort((a, b) => b.publishedAt - a.publishedAt).slice(0, MAX_INPUT_PER_SUB);
  const max = sub.wide ? BRIEFING.MAX_ITEMS_WIDE : BRIEFING.MAX_ITEMS_NARROW;
  const lines = input.map((c, i) => `${i + 1}. (${c.source}) ${c.title}${c.snippet ? ` — ${c.snippet}` : ''}`).join('\n');
  const prevLines = prev.length ? prev.map((p) => `${p.storyId}: ${p.title}`).join('\n') : '(없음)';
  const out = await callAndCount(ai, usage, {
    model: BRIEFING.SELECT_MODEL,
    system: SYSTEM_BASE,
    user: [
      `분야 "${subPath(sub)}"의 기사들이다. 브리핑에 실을 이슈를 최대 ${max}개 골라라.`,
      '- 같은 사건을 다룬 기사는 하나로 묶는다: 가장 정보가 많은 것을 main, 나머지를 related로.',
      '- 이 분야에 맞지 않는 기사, 스포츠·연예·광고·홍보성 기사는 고르지 않는다.',
      '- 직전 회차에 같은 이슈가 있었으면 prevStoryId에 그 id를 적는다(새 국면이 있을 때만 고른다).',
      '- 참고(1) 이슈만 title·summary·why를 한국어로 새로 쓴다. 해외 기사도 한국어로.',
      IMPORTANCE_RULES,
      `\n직전 회차의 이 분야 이슈:\n${prevLines}`,
      `\n<기사>\n${lines}\n</기사>`,
    ].join('\n'),
    schema: SelectSchema,
    maxTokens: BRIEFING.SELECT_MAX_OUTPUT_TOKENS,
    signal,
  });

  const prevIds = new Set(prev.map((p) => p.storyId));
  const used = new Set<number>();
  const picked: Picked[] = [];
  for (const s of out.stories) {
    const main = input[s.main - 1];
    if (!main || used.has(s.main)) continue; // 목록에 없거나 이미 쓴 번호는 버린다
    used.add(s.main);
    const related: Candidate[] = [];
    for (const n of s.related) {
      const r = input[n - 1];
      if (r && !used.has(n)) {
        used.add(n);
        related.push(r);
      }
    }
    const importance = Math.min(3, Math.max(1, Math.round(s.importance))) as 1 | 2 | 3;
    picked.push({
      sub,
      main,
      related,
      importance,
      prevStoryId: s.prevStoryId && prevIds.has(s.prevStoryId) ? s.prevStoryId : null,
      // 참고인데 글을 안 썼으면 원문 제목으로라도 싣는다 — 요약 칸은 비워 둔다
      brief: importance === 1 ? { title: s.title.trim() || main.title, summary: s.summary.trim(), why: s.why.trim() } : null,
    });
    if (picked.length >= max) break;
  }
  return picked;
}

export async function select(
  bySub: Map<BriefingSub, Candidate[]>,
  prevBySub: Map<string, PrevStory[]>,
  ai: AiCaller,
  usage: Usage,
  opts: { signal?: AbortSignal; onProgress?: (done: number, total: number) => void } = {},
): Promise<Picked[]> {
  const entries = [...bySub.entries()].filter(([, list]) => list.length > 0);
  let done = 0;
  opts.onProgress?.(0, entries.length);
  const results = await mapLimit(entries, BRIEFING.SELECT_CONCURRENCY, async ([sub, list]) => {
    const r = await selectOne(sub, list, prevBySub.get(sub.id) ?? [], ai, usage, opts.signal);
    opts.onProgress?.(++done, entries.length);
    return r;
  });
  const failed = results.find((r) => !r.ok);
  if (failed && !failed.ok) throw new Error(`선별 실패 — ${errorText(failed.error)}`);
  return results.flatMap((r) => (r.ok ? r.value : []));
}
