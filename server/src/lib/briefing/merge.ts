import { z } from 'zod/v4';
import { BRIEFING } from '../../constants.js';
import { callAndCount, SYSTEM_BASE, type AiCaller, type Usage } from './ai.js';
import type { Candidate } from './collect.js';
import type { Picked } from './select.js';
import { subPath } from './taxonomy.js';

// ③-2 같은 사건 합치기 (Haiku 1회) — ③ 선별은 세부 분야마다 따로 돌아 분야를 넘는 중복을 못 본다.
// 실제 회차에서 알래스카 LNG가 네 분야에, 같은 9월 수출 기사가 한 분야에 두 줄로 실렸다 (설계 "③-2", 사용성 평가 2026-10-01)

const MergeSchema = z.object({
  groups: z.array(
    z.object({
      items: z.array(z.number()).describe('같은 사건을 다룬 기사 번호들 (2개 이상)'),
      keep: z.number().describe('남길 기사 번호 — 분야가 가장 잘 맞는 것'),
    }),
  ),
});

const IMPORTANCE_LABEL = { 1: '참고', 2: '주요', 3: '핵심' } as const;

function titleOf(p: Picked): string {
  return p.brief?.title || p.main.title;
}

/**
 * 같은 사건 묶음마다 하나만 남긴다. 남는 기사는 묶음의 가장 높은 중요도와 나머지의 링크(related)를 물려받는다.
 * 실패하면 합치지 않고 그대로 돌려준다 — 중복이 남을 뿐 회차는 만들어진다
 */
export async function mergeSameStories(picked: Picked[], ai: AiCaller, usage: Usage, signal?: AbortSignal): Promise<Picked[]> {
  if (picked.length < 2) return picked;
  const lines = picked.map((p, i) => `${i + 1}. [${subPath(p.sub)}] (${IMPORTANCE_LABEL[p.importance]}) ${titleOf(p)}`).join('\n');
  let groups: z.infer<typeof MergeSchema>['groups'];
  try {
    const out = await callAndCount(ai, usage, {
      model: BRIEFING.SELECT_MODEL,
      system: SYSTEM_BASE,
      user: [
        '아래는 브리핑에 실을 기사 목록이다. 분야가 달라도 **같은 사건**을 다룬 기사끼리 묶어라.',
        '- 같은 사건: 같은 발표·발언·사고·수치·결정을 다룬 기사. 표현이 달라도 같은 일이면 묶는다 (예: "9월 수출 1209억 달러 사상 최대"와 "9월 수출 첫 1200억 달러 돌파").',
        '- 같은 주제일 뿐 다른 사건이면 묶지 않는다 (예: 같은 회사의 다른 발표, 같은 날의 다른 증시 기사).',
        '- 묶음마다 남길 기사(keep)는 분야가 그 사건에 가장 잘 맞는 것으로 고른다. 한국 정부·기업·시장의 일은 국내 분야를 남긴다.',
        '- 묶을 것이 없으면 groups를 빈 배열로.',
        `\n<기사>\n${lines}\n</기사>`,
      ].join('\n'),
      schema: MergeSchema,
      maxTokens: BRIEFING.SELECT_MAX_OUTPUT_TOKENS,
      signal,
    });
    groups = out.groups;
  } catch (e) {
    if (signal?.aborted) throw e;
    console.log(`[briefing] 같은 사건 합치기 건너뜀: ${e instanceof Error ? e.message : String(e)}`);
    return picked;
  }

  const result = [...picked];
  const dropped = new Set<number>();
  const used = new Set<number>();
  for (const g of groups) {
    // 목록 밖 번호·이미 다른 묶음에 쓴 번호는 버린다
    const members = [...new Set(g.items.map((n) => Math.round(n)))].filter((n) => picked[n - 1] && !used.has(n));
    if (members.length < 2) continue;
    const keepNo = members.includes(Math.round(g.keep)) ? Math.round(g.keep) : members[0]!;
    members.forEach((n) => used.add(n));
    const keep = picked[keepNo - 1]!;
    const others = members.filter((n) => n !== keepNo).map((n) => picked[n - 1]!);
    const importance = Math.max(keep.importance, ...others.map((o) => o.importance)) as 1 | 2 | 3;
    const links = new Map<string, Candidate>();
    for (const c of [...keep.related, ...others.flatMap((o) => [o.main, ...o.related])]) if (c.url !== keep.main.url) links.set(c.url, c);
    result[keepNo - 1] = {
      ...keep,
      importance,
      related: [...links.values()],
      prevStoryId: keep.prevStoryId ?? others.find((o) => o.prevStoryId)?.prevStoryId ?? null,
      // 참고에서 주요 이상으로 올라가면 ④ 요약이 새로 쓴다 — 선별이 써 둔 짧은 글은 버린다
      brief: importance === 1 ? keep.brief : null,
    };
    for (const n of members) if (n !== keepNo) dropped.add(n);
  }
  if (dropped.size > 0) console.log(`[briefing] 같은 사건 ${dropped.size}건을 합침`);
  return result.filter((_, i) => !dropped.has(i + 1));
}
