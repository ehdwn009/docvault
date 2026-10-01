import { z } from 'zod/v4';
import { BRIEFING } from '../../constants.js';
import { callAndCount, SYSTEM_BASE, type AiCaller, type Usage } from './ai.js';
import { NO_META_RULE, stripMeta } from './clean.js';
import { errorText, mapLimit } from './limit.js';
import type { Picked } from './select.js';
import { subPath } from './taxonomy.js';

// ④ 요약 (Sonnet) — 핵심·주요 기사만. 대분류 단위로 묶어 부른다 (뉴스 브리핑 설계 "④ 요약").
// 펼침은 칸 구성(무슨 일·배경·숫자로 보면·앞으로)이다 — 요약 한 덩어리는 제목을 되풀이할 뿐이라 읽을 것이 없었다 (사용자 피드백 v0.43)

/** 펼침의 칸 — 쓸 근거가 없는 칸은 빈 문자열이고, 화면은 빈 칸을 숨긴다. summary가 곧 "무슨 일" */
export type Detail = { background: string; numbers: string; next: string };
export type Written = { title: string; summary: string; why: string; detail?: Detail };

const SummarySchema = z.object({
  items: z.array(
    z.object({
      k: z.number().describe('기사 번호'),
      title: z.string().describe(`${BRIEFING.TITLE_MAX_CHARS}자 이내 한국어 제목. 원문 제목을 베끼지 말고 새로 쓴다`),
      what: z.string().describe('무슨 일 — 제목에 없는 구체 사실(언제·어디서·어떻게·규모)로 1~2문장. 제목을 되풀이하지 않는다'),
      background: z.string().describe('배경 — 왜 이런 일이 생겼는지, 그전까지의 경과 1~2문장. 근거가 없으면 빈 문자열'),
      numbers: z.string().describe('숫자로 보면 — 핵심 수치 2~4개를 "항목 값 · 항목 값" 꼴로. 수치가 없으면 빈 문자열'),
      next: z.string().describe('앞으로 — 예정된 일정·후속 조치·전망 1~2문장. 근거가 없으면 빈 문자열'),
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
        '아래 기사마다 브리핑용 제목과 펼침 칸(무슨 일·배경·숫자로 보면·앞으로)·의미를 한국어로 써라. 해외 기사도 한국어로.',
        `- 제목은 ${BRIEFING.TITLE_MAX_CHARS}자 이내. 핵심 수치나 주체가 보이게. 독자는 제목을 먼저 읽고 펼친다.`,
        '- **펼침은 제목 다음 이야기다.** 제목에 이미 쓴 주체·사건·수치를 칸에서 다시 말하지 않는다. "무슨 일" 첫 문장을 제목을 풀어 쓴 문장으로 시작하지 않는다. 칸끼리도 같은 사실을 되풀이하지 않는다.',
        `- 네 칸을 합쳐 ${BRIEFING.DETAIL_MIN_CHARS}~${BRIEFING.DETAIL_MAX_CHARS}자 안팎. 근거가 있는 칸만 채우고, 근거가 없는 칸은 빈 문자열로 둔다 — 길이를 채우려고 일반론을 쓰지 않는다.`,
        '- 숫자로 보면: 주어진 글에 있는 수치만, "유출 2만5000명 · 공격 약 24시간"처럼 짧게.',
        '- 앞으로: 기사에 나온 일정·후속 조치·전망만. 짐작하지 않는다.',
        '- 의미는 왜 중요한지, 시장·정책·생활에 어떤 영향인지 한 줄. 주어진 글에서 근거를 댈 수 있을 때만 쓰고, 일반론("관심이 쏠린다", "트렌드를 반영한다")밖에 안 되면 빈 문자열로 둔다.',
        '- 제목뿐인 기사(발췌 없음)는 제목에 없는 사실을 알 수 없으니 네 칸과 의미를 모두 빈 문자열로 둔다.',
        '- 본문 앞부분이 있는 기사는 그것을 주된 근거로 쓴다. 원문 문장을 베끼지 말고 새로 쓴다.',
        '- 수치·날짜·고유명사는 주어진 글에 있는 것만 쓴다.',
        NO_META_RULE,
        `\n<기사>\n${lines}\n</기사>`,
      ].join('\n'),
      schema: SummarySchema,
      maxTokens: BRIEFING.SUMMARY_MAX_OUTPUT_TOKENS,
      signal: opts.signal,
    });
    opts.onProgress?.(++done, batches.length);
    for (const it of out.items) {
      const idx = batch[it.k - 1];
      if (idx === undefined || !it.title.trim()) continue;
      // 작업 사정이 새어 나온 문장은 지운다 — 한 줄짜리(의미·숫자)는 섞였으면 통째로 비운다
      const oneLine = (t: string) => (stripMeta(t) === t.trim() ? t.trim() : '');
      const detail: Detail = { background: stripMeta(it.background), numbers: oneLine(it.numbers), next: stripMeta(it.next) };
      written.set(idx, {
        title: it.title.trim(),
        summary: stripMeta(it.what),
        why: oneLine(it.why),
        ...(detail.background || detail.numbers || detail.next ? { detail } : {}),
      });
    }
  });
  const failed = results.find((r) => !r.ok);
  if (failed && !failed.ok) throw new Error(`요약 실패 — ${errorText(failed.error)}`);
  return written;
}
