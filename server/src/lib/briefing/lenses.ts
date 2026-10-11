import { z } from 'zod/v4';
import { BRIEFING } from '../../constants.js';
import { callAndCount, SYSTEM_BASE, type AiCaller, type Usage } from './ai.js';
import { stripMeta } from './clean.js';
import { errorText, mapLimit } from './limit.js';
import type { Written } from './summarize.js';
import { extractNumbers, sameValue } from './verify.js';

// 요약 보기 다시 쓰기 (개선 합의안 4.7, 사용자 결정 2026-10-11) — 글머리표·쉽게·5W는 **우리가 쓴 요약만** 재료로 Haiku가 다시 쓴다.
// 원문은 저장하지 않아 회차를 만든 뒤에는 볼 수 없고, 이 셋은 새 사실이 필요 없는 바꿔 쓰기라 싼 모델로 충분하다.
// 양쪽 시각은 원문이 필요해서 Sonnet 요약 호출 안에서 같이 쓴다(summarize.ts). 다시 쓴 글에 요약에 없는 숫자가 들어오면 그 문장을 지운다

export type Lenses = {
  bullets?: string[];
  easy?: string;
  w5?: { who: string; what: string; when: string; where: string; why: string };
};

const LensSchema = z.object({
  items: z.array(
    z.object({
      k: z.number().describe('기사 번호'),
      bullets: z.array(z.string()).describe('글머리표 3~5줄, 한 줄 40자 안팎'),
      easy: z.string().describe('쉽게 — 어려운 용어를 풀어 다시 쓴 글 3~5문장. 비유 하나 허용. 새 사실·숫자는 넣지 않는다'),
      who: z.string().describe('누가. 요약에 없으면 빈 문자열'),
      what: z.string().describe('무엇을'),
      when: z.string().describe('언제. 없으면 빈 문자열'),
      where: z.string().describe('어디서. 없으면 빈 문자열'),
      why: z.string().describe('왜. 없으면 빈 문자열'),
    }),
  ),
});

/** 우리 요약을 글로 — 다시 쓰기의 유일한 재료 */
export function summaryText(w: Written): string {
  const parts = [w.summary, w.why ? `왜 중요한가: ${w.why}` : ''];
  for (const b of w.blocks) {
    if (b.text) parts.push(b.text);
    if (b.pairs) parts.push(b.pairs.map((p) => `${p.label} ${p.value}`).join(' · '));
    if (b.items) parts.push(b.items.map((i) => `${i.date} ${i.text}`).join('; '));
  }
  return parts.filter(Boolean).join('\n');
}

/** 다시 쓴 글의 숫자가 요약에 없으면 그 문장을 지운다 — 바꿔 쓰기에서 생기는 지어내기를 막는다 */
function keepSupported(text: string, base: string): { text: string; dropped: number } {
  const pool = extractNumbers(base);
  const sentences = text.split(/(?<=[.!?。])\s+/).map((s) => s.trim()).filter(Boolean);
  const kept = sentences.filter((s) => extractNumbers(s).every((n) => pool.some((p) => sameValue(p.value, n.value))));
  return { text: kept.join(' '), dropped: sentences.length - kept.length };
}

/** 열쇠는 written과 같은 picked 위치. 돌려주는 dropped는 실행 기록용(stats.lensDrops) */
export async function writeLenses(
  written: Map<number, Written>,
  ai: AiCaller,
  usage: Usage,
  opts: { signal?: AbortSignal; onProgress?: (done: number, total: number) => void } = {},
): Promise<{ lenses: Map<number, Lenses>; dropped: number }> {
  const idxs = [...written.keys()];
  const batches: number[][] = [];
  for (let i = 0; i < idxs.length; i += BRIEFING.LENS_CHUNK) batches.push(idxs.slice(i, i + BRIEFING.LENS_CHUNK));
  const lenses = new Map<number, Lenses>();
  let dropped = 0;
  let done = 0;
  opts.onProgress?.(0, batches.length);
  const results = await mapLimit(batches, BRIEFING.SELECT_CONCURRENCY, async (batch) => {
    const lines = batch.map((idx, j) => `${j + 1}. ${written.get(idx)!.title}\n${summaryText(written.get(idx)!)}`).join('\n\n');
    const out = await callAndCount(ai, usage, {
      model: BRIEFING.SELECT_MODEL,
      system: SYSTEM_BASE,
      user: [
        '아래 요약 글을 세 가지 보기로 다시 써라. 재료는 이 요약뿐이다 — 요약에 없는 사실·숫자·이름은 절대 넣지 않는다.',
        '- bullets: 핵심을 3~5줄 글머리표로. 한 줄에 하나씩, 짧게.',
        '- easy: 처음 듣는 사람에게 설명하듯 쉬운 말로 3~5문장. 어려운 용어는 풀어 쓰고 비유를 하나까지 써도 된다. 존댓말.',
        '- 5W(who·what·when·where·why): 요약에 있는 것만 짧게. 없는 칸은 빈 문자열로 둔다 — 채우지 않는다.',
        `\n<기사>\n${lines}\n</기사>`,
      ].join('\n'),
      schema: LensSchema,
      maxTokens: BRIEFING.SUMMARY_MAX_OUTPUT_TOKENS,
      signal: opts.signal,
    });
    opts.onProgress?.(++done, batches.length);
    for (const it of out.items) {
      const idx = batch[it.k - 1];
      if (idx === undefined) continue;
      const base = summaryText(written.get(idx)!);
      const bullets = it.bullets
        .map((b) => keepSupported(stripMeta(b), base))
        .map((r) => {
          dropped += r.dropped;
          return r.text;
        })
        .filter(Boolean)
        .slice(0, 5);
      const easy = keepSupported(stripMeta(it.easy), base);
      dropped += easy.dropped;
      const w5 = { who: it.who.trim(), what: it.what.trim(), when: it.when.trim(), where: it.where.trim(), why: it.why.trim() };
      const lens: Lenses = {};
      if (bullets.length >= 2) lens.bullets = bullets;
      if (easy.text.length >= 40) lens.easy = easy.text;
      if (w5.what) lens.w5 = w5;
      if (Object.keys(lens).length > 0) lenses.set(idx, lens);
    }
  });
  const failed = results.find((r) => !r.ok);
  // 보기는 덤이다 — 실패해도 회차는 만들어진다
  if (failed && !failed.ok) console.log(`[briefing] 요약 보기 다시 쓰기 실패: ${errorText(failed.error)}`);
  return { lenses, dropped };
}
