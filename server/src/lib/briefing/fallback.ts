import { z } from 'zod/v4';
import { BRIEFING } from '../../constants.js';
import { callAndCount, SYSTEM_BASE, type AiCaller, type Usage } from './ai.js';
import type { Material } from './body.js';
import { stripMeta } from './clean.js';
import type { Picked } from './select.js';

// 재료 보장 규칙 (개선 합의안 S0·4.4) — 핵심·주요인데 본문도 발췌도 없으면(웹 검색 보강 뒤에도) 핵심·주요로 싣지 않는다.
// 발췌만 있으면 참고로 내려 한 문장, 제목뿐이면 AI 문장 없이 "제목만"(해외 제목은 번역만). 빈 요약을 내보내지 않는 것도 정확성이다

const HANGUL = /[가-힣]/;

const FallbackSchema = z.object({
  items: z.array(
    z.object({
      k: z.number().describe('기사 번호'),
      title: z.string().describe(`${BRIEFING.TITLE_MAX_CHARS}자 이내 한국어 제목. 해외 기사는 제목을 번역만 한다(사실을 보태지 않는다)`),
      summary: z.string().describe('발췌가 있는 기사만: 발췌에 있는 사실로 한 문장. 제목뿐인 기사는 빈 문자열'),
    }),
  ),
});

export type Demoted = { title: string; summary: string; titleOnly: boolean };

/** 재료가 없어 내려갈 핵심·주요 — 본문 재료도 없고 발췌도 없거나(제목뿐), 발췌뿐인 기사 */
export function needsDemotion(p: Picked, materials: Material[] | undefined): boolean {
  if (p.importance < 2) return false;
  return !(materials && materials.length > 0);
}

/**
 * 내려갈 기사들의 제목(한국어)과, 발췌가 있으면 한 문장 — Haiku 한 번. 열쇠는 picked 위치.
 * 실패하면 빈 Map — 조립 단계가 그런 기사를 싣지 않는다(빈칸으로 싣는 것보다 낫다)
 */
export async function writeFallbacks(picked: Picked[], idxs: number[], ai: AiCaller, usage: Usage, signal?: AbortSignal): Promise<Map<number, Demoted>> {
  const out = new Map<number, Demoted>();
  if (idxs.length === 0) return out;
  const lines = idxs
    .map((idx, j) => {
      const p = picked[idx]!;
      const snippet = [p.main, ...p.related].map((c) => c.snippet).find(Boolean);
      return `${j + 1}. (${p.main.source}) ${p.main.title}${snippet ? ` — 발췌: ${snippet}` : ' (발췌 없음 — 제목뿐)'}`;
    })
    .join('\n');
  try {
    const res = await callAndCount(ai, usage, {
      model: BRIEFING.SELECT_MODEL,
      stage: 'fallback',
      system: SYSTEM_BASE,
      user: [
        '아래 기사들은 본문을 구하지 못한 기사다. 기사마다 한국어 제목을 쓰고, 발췌가 있는 기사만 발췌에 있는 사실로 요약 한 문장을 써라.',
        '- 제목뿐인 기사는 제목만 한국어로 옮기고 summary는 빈 문자열. 사실을 지어내거나 보태지 않는다.',
        '- 해외 기사 제목은 번역만 한다. 고유명사는 원문 표기 가능.',
        `\n<기사>\n${lines}\n</기사>`,
      ].join('\n'),
      schema: FallbackSchema,
      maxTokens: BRIEFING.SELECT_MAX_OUTPUT_TOKENS,
      signal,
    });
    for (const it of res.items) {
      const idx = idxs[it.k - 1];
      if (idx === undefined) continue;
      const p = picked[idx]!;
      const hasSnippet = [p.main, ...p.related].some((c) => c.snippet);
      const title = it.title.trim();
      if (!HANGUL.test(title)) continue; // 한국어 제목이 없으면 싣지 않는다 (설계 "참고 기사 제목도 한국어")
      const summary = hasSnippet ? stripMeta(it.summary) : '';
      out.set(idx, { title, summary, titleOnly: !summary });
    }
  } catch (e) {
    if (signal?.aborted) throw e;
    console.log(`[briefing] 참고 내리기 실패: ${e instanceof Error ? e.message : String(e)}`);
  }
  return out;
}
