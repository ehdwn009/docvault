import { z } from 'zod/v4';
import { BRIEFING } from '../../constants.js';
import { callAndCount, SYSTEM_BASE, type AiCaller, type Usage } from './ai.js';
import type { Candidate } from './collect.js';
import { errorText, mapLimit } from './limit.js';
import { findSubById, SUBS, subPath } from './taxonomy.js';

// ② 분류 (Haiku) — 언론사 RSS에서 온, 분야를 모르는 후보만. 검색으로 온 후보는 이미 분야를 안다
// (뉴스 브리핑 설계 "② 분류"). 스포츠·연예·날씨·광고성은 여기서 뺀다

const EXCLUDE = 'exclude';

const ClassifySchema = z.object({
  items: z.array(
    z.object({
      n: z.number().describe('기사 번호'),
      // enum으로 묶지 않는다 — 모델이 목록에 없는 값을 하나만 내도 SDK가 응답 전체를 거부한다(v0.42.0 첫 실행에서 실측).
      // 문자열로 받고 목록에 없는 값은 아래에서 그 기사만 버린다
      sub: z.string().describe(`세부 분야 id(아래 목록 중 하나). 스포츠·연예·문화·날씨·광고·홍보성이거나, 여러 사건을 모은 기사(헤드라인 모음·주요뉴스 정리)면 "${EXCLUDE}"`),
    }),
  ),
});

export const SUB_LIST = SUBS.map((s) => `${s.id} = ${subPath(s)}`).join('\n');

// 국내/세계와 세부 분야를 가르는 기준 — 분류와 선별(분야 옮기기)이 같은 말을 쓴다.
// 실제 회차에서 대통령의 LNG 발언·한국 가상자산 시장이 세계로, 미국 기업 마이크론이 국내 실적으로,
// 지역 행정 소식이 과학·바이오로 갔다 (사용성 평가 2026-10-01)
export const REGION_RULE = [
  '- 국내(kr.*) / 세계(w.*)는 출처가 아니라 "누가 주인공인가"로 가른다.',
  '  · 한국 정부·국회·대통령·한국 기업·한국 시장·한국 사람이 주체이거나, 한국에 미치는 영향이 기사의 중심이면 국내. 해외에서 한 발언·투자라도 한국이 주체면 국내 (예: 대통령의 해외 LNG 발언, 한국 가상자산 시장 규모, 삼성의 미국 공장).',
  '  · 해외에서 일어났고 한국이 주인공이 아니면 세계 (예: 미국 기업 마이크론의 실적, 일본 금리, 중동 분쟁). 한국 언론이 썼어도 세계.',
].join('\n');
export const SUB_RULE = [
  '- 세부 분야는 기사의 중심 주제로 고른다. 낱말 하나에 끌려가지 않는다.',
  '  · 증시 흐름 기사는 증시, 유가·원자재는 원자재 값이 중심일 때만. 실적·공시는 그 지역 기업의 것만.',
  '  · 지자체 행정·기부·행사·학교 입지 같은 지역 소식은 사회(노동·교육·복지 / 생활·안전)로. 과학·바이오에는 연구·기술 자체가 중심인 기사만.',
].join('\n');

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
      user: `아래 기사마다 가장 맞는 세부 분야 id 하나를 골라라.\n${REGION_RULE}\n${SUB_RULE}\n\n분야 목록:\n${SUB_LIST}\n\n<기사>\n${lines}\n</기사>`,
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
