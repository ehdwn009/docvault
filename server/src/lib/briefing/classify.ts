import { z } from 'zod/v4';
import { BRIEFING } from '../../constants.js';
import { callAndCount, SYSTEM_BASE, type AiCaller, type Usage } from './ai.js';
import type { Candidate } from './collect.js';
import { errorText, mapLimit } from './limit.js';
import { findSubById, SUBS, subPath } from './taxonomy.js';

// ② 분류 (Haiku) — 언론사 RSS에서 온, 분야를 모르는 후보만. 검색으로 온 후보는 이미 분야를 안다
// (뉴스 브리핑 설계 "② 분류"). 스포츠·연예·날씨·광고성은 여기서 뺀다

const EXCLUDE = 'exclude';
const SUB_IDS = SUBS.map((s) => s.id) as [string, ...string[]];

const ClassifySchema = z.object({
  items: z.array(
    z.object({
      n: z.number().int().describe('기사 번호'),
      sub: z.enum([...SUB_IDS, EXCLUDE]).describe(`세부 분야 id. 스포츠·연예·문화·날씨·광고·홍보성이면 "${EXCLUDE}"`),
    }),
  ),
});

const SUB_LIST = SUBS.map((s) => `${s.id} = ${subPath(s)}`).join('\n');

export async function classify(
  candidates: Candidate[],
  ai: AiCaller,
  usage: Usage,
  opts: { signal?: AbortSignal; onProgress?: (done: number, total: number) => void } = {},
): Promise<Candidate[]> {
  const known = candidates.filter((c) => c.sub !== null);
  const unknown = candidates.filter((c) => c.sub === null);
  const chunks: Candidate[][] = [];
  for (let i = 0; i < unknown.length; i += BRIEFING.CLASSIFY_CHUNK) chunks.push(unknown.slice(i, i + BRIEFING.CLASSIFY_CHUNK));

  let done = 0;
  opts.onProgress?.(0, chunks.length);
  const results = await mapLimit(chunks, BRIEFING.SELECT_CONCURRENCY, async (chunk) => {
    const lines = chunk.map((c, i) => `${i + 1}. [${c.region}] ${c.title}${c.snippet ? ` — ${c.snippet}` : ''}`).join('\n');
    const out = await callAndCount(ai, usage, {
      model: BRIEFING.SELECT_MODEL,
      system: SYSTEM_BASE,
      user: `아래 기사마다 가장 맞는 세부 분야 id 하나를 골라라. [국내]는 국내 분야(kr.*), [세계]는 세계 분야(w.*)를 우선하되, 해외 사건을 다룬 국내 기사는 세계 분야가 맞으면 그쪽으로.\n\n분야 목록:\n${SUB_LIST}\n\n<기사>\n${lines}\n</기사>`,
      schema: ClassifySchema,
      maxTokens: BRIEFING.SELECT_MAX_OUTPUT_TOKENS,
      signal: opts.signal,
    });
    opts.onProgress?.(++done, chunks.length);
    const picked: Candidate[] = [];
    const seen = new Set<number>();
    for (const it of out.items) {
      const c = chunk[it.n - 1];
      // 목록에 없는 번호·같은 번호 두 번은 버린다
      if (!c || seen.has(it.n) || it.sub === EXCLUDE) continue;
      seen.add(it.n);
      const sub = findSubById(it.sub);
      if (sub) picked.push({ ...c, sub });
    }
    return picked;
  });

  const failed = results.find((r) => !r.ok);
  if (failed && !failed.ok) throw new Error(`분류 실패 — ${errorText(failed.error)}`);
  return [...known, ...results.flatMap((r) => (r.ok ? r.value : []))];
}
