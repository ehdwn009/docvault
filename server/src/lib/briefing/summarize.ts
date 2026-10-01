import { z } from 'zod/v4';
import { BRIEFING } from '../../constants.js';
import { callAndCount, SYSTEM_BASE, type AiCaller, type Usage } from './ai.js';
import { errorText, mapLimit } from './limit.js';
import type { Picked } from './select.js';
import { subPath } from './taxonomy.js';

// ④ 요약 (Sonnet) — 핵심·주요 기사만. 대분류 단위로 묶어 부른다 (뉴스 브리핑 설계 "④ 요약")

export type Written = { title: string; summary: string; why: string };

const SummarySchema = z.object({
  items: z.array(
    z.object({
      k: z.number().describe('기사 번호'),
      title: z.string().describe(`${BRIEFING.TITLE_MAX_CHARS}자 이내 한국어 제목. 원문 제목을 베끼지 말고 새로 쓴다`),
      summary: z.string().describe('무슨 일인지 1~2문장. 원문 문장을 베끼지 말고 새로 쓴다'),
      why: z.string().describe('왜 중요한지, 독자에게 어떤 영향인지 한 줄'),
    }),
  ),
});

/** 기사 한 건을 AI에게 보여 주는 모양 — 근거(본문 앞부분 / 발췌 / 제목뿐)를 밝혀 둔다 (설계 "③-1 근거 보강") */
function describe(p: Picked, k: number, body: string | undefined): string {
  const others = p.related
    .slice(0, 4)
    .map((r) => `   - (${r.source}) ${r.title}${r.snippet ? ` — ${r.snippet}` : ''}`)
    .join('\n');
  const evidence = body
    ? `\n   본문 앞부분: ${body}`
    : p.main.snippet
      ? ` — ${p.main.snippet}`
      : p.related.some((r) => r.snippet)
        ? ''
        : ' (발췌 없음 — 제목뿐)';
  return `${k}. [${subPath(p.sub)}] (${p.main.source}) ${p.main.title}${evidence}${others ? `\n   같은 사건의 다른 보도:\n${others}` : ''}`;
}

/** 핵심·주요 이슈의 제목·요약·의미. 돌려주는 Map의 열쇠는 picked 배열의 위치 */
export async function summarize(
  picked: Picked[],
  bodies: Map<number, string>,
  ai: AiCaller,
  usage: Usage,
  opts: { signal?: AbortSignal; onProgress?: (done: number, total: number) => void } = {},
): Promise<Map<number, Written>> {
  // 대분류(국내 경제, 세계 테크…)끼리 묶어야 모델이 같은 맥락에서 쓴다
  const groups = new Map<string, number[]>();
  picked.forEach((p, i) => {
    if (p.importance < 2) return;
    const key = `${p.sub.section}/${p.sub.category}`;
    groups.set(key, [...(groups.get(key) ?? []), i]);
  });
  const batches: number[][] = [];
  for (const idxs of groups.values()) {
    for (let i = 0; i < idxs.length; i += BRIEFING.SUMMARY_CHUNK) batches.push(idxs.slice(i, i + BRIEFING.SUMMARY_CHUNK));
  }

  const written = new Map<number, Written>();
  let done = 0;
  opts.onProgress?.(0, batches.length);
  const results = await mapLimit(batches, BRIEFING.SUMMARY_CONCURRENCY, async (batch) => {
    const lines = batch.map((idx, j) => describe(picked[idx]!, j + 1, bodies.get(idx))).join('\n');
    const out = await callAndCount(ai, usage, {
      model: BRIEFING.SUMMARY_MODEL,
      system: SYSTEM_BASE,
      user: [
        '아래 기사마다 브리핑용 제목·요약·의미를 한국어로 써라. 해외 기사도 한국어로.',
        `- 제목은 ${BRIEFING.TITLE_MAX_CHARS}자 이내. 핵심 수치나 주체가 보이게.`,
        '- 요약은 무슨 일인지 1~2문장. 원문 문장을 베끼지 말고 새로 쓴다.',
        '- 의미는 왜 중요한지, 시장·정책·생활에 어떤 영향인지 한 줄. 주어진 글에서 근거를 댈 수 있을 때만 쓰고, 일반론("관심이 쏠린다", "트렌드를 반영한다")밖에 안 되면 빈 문자열로 둔다.',
        '- 제목뿐인 기사(발췌 없음)는 요약을 제목을 풀어 쓴 한 문장으로만 쓰고 사실을 덧붙이지 않는다. 의미는 빈 문자열.',
        '- 본문 앞부분이 있는 기사는 그것을 주된 근거로 쓴다.',
        '- 수치·날짜·고유명사는 주어진 글에 있는 것만 쓴다.',
        `\n<기사>\n${lines}\n</기사>`,
      ].join('\n'),
      schema: SummarySchema,
      maxTokens: BRIEFING.SUMMARY_MAX_OUTPUT_TOKENS,
      signal: opts.signal,
    });
    opts.onProgress?.(++done, batches.length);
    for (const it of out.items) {
      const idx = batch[it.k - 1];
      if (idx !== undefined && it.title.trim()) written.set(idx, { title: it.title.trim(), summary: it.summary.trim(), why: it.why.trim() });
    }
  });
  const failed = results.find((r) => !r.ok);
  if (failed && !failed.ok) throw new Error(`요약 실패 — ${errorText(failed.error)}`);
  return written;
}
