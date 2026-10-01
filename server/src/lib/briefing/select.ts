import { z } from 'zod/v4';
import { BRIEFING } from '../../constants.js';
import { callAndCount, SYSTEM_BASE, type AiCaller, type Usage } from './ai.js';
import { isAggregator, spreadPick, type Candidate } from './collect.js';
import { NO_META_RULE, stripMeta } from './clean.js';
import { errorText, mapLimit } from './limit.js';
import { findSubById, subPath, type BriefingSub } from './taxonomy.js';
import { REGION_RULE, SUB_LIST, SUB_RULE } from './classify.js';

// ③ 선별 (Haiku) — 세부 분야마다 한 번: 같은 사건 묶기 · 중요도 · new/updated · 분야당 상한.
// 참고(1) 기사는 여기서 제목·요약·의미까지 쓴다 — 참고 기사에 Sonnet을 쓰지 않는 것이 비용 설계의 핵심 (설계 "③ 선별")

/** 한 분야에 한 번에 보여 주는 후보 상한 — 검색 하나가 100건을 가져와도 범위 전체에서 고르게 이만큼 */
const MAX_INPUT_PER_SUB = 60;

const HANGUL = /[가-힣]/;

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
      moveTo: z.string().describe('이 분야보다 확실히 맞는 분야가 있으면 그 id(분야 목록 중 하나), 아니면 빈 문자열'),
      title: z.string().describe(`참고(1)만: ${BRIEFING.TITLE_MAX_CHARS}자 이내 한국어 제목, 원문 제목을 베끼지 말고 새로 쓴다. 핵심·주요는 빈 문자열`),
      summary: z.string().describe('참고(1)만: 무슨 일인지 1~2문장, 새로 쓴다. 핵심·주요는 빈 문자열'),
      why: z.string().describe('참고(1)만: 왜 중요한지 한 줄. 핵심·주요는 빈 문자열'),
    }),
  ),
});

// 실제 회차에서 모태펀드 행사 정례화·지방간 연구 하나가 핵심, 미군 이라크 철수가 주요에 그쳤다 (사용성 평가 2026-10-01) —
// 무엇을 올리고 무엇을 내리는지 예로 못 박는다
const IMPORTANCE_RULES = [
  '중요도 기준 (회차마다 들쭉날쭉하지 않게 고정):',
  '- 3 핵심: 나라·시장 전체에 바로 영향이 있는 뉴스 — 정책·법안 결정, 금리·환율 결정, 전쟁·안보·외교의 큰 변화, 대형 사고·재난, 지수 급변, 대기업의 대규모 투자·실적. 분야당 많아야 2건, 없으면 0건',
  '- 2 주요: 흐름을 이해하는 데 필요한 뉴스, 진행 중인 이슈의 새 국면, 업계 판도를 바꿀 만한 일',
  '- 1 참고: 관심 있으면 볼 뉴스, 개별 기업·지역 소식',
  '- 핵심으로 올리지 않는 것: 행사·포럼·간담회 개최나 정례화, MOU·업무협약, 수상·기부, 연구 결과 하나(논문·실험 한 건), 보도자료성 신제품 소개, 인사·일정 소식. 대개 참고, 파장이 클 때만 주요',
  '- 해외 기사는 다른 보도가 적다는 이유로 낮추지 않는다. 그 나라와 세계 시장에서의 무게로 판단한다',
].join('\n');

async function selectOne(sub: BriefingSub, cands: Candidate[], prev: PrevStory[], range: { since: number; until: number }, ai: AiCaller, usage: Usage, signal?: AbortSignal): Promise<Picked[]> {
  const input = spreadPick(cands, MAX_INPUT_PER_SUB, range.since, range.until);
  const max = sub.wide ? BRIEFING.MAX_ITEMS_WIDE : BRIEFING.MAX_ITEMS_NARROW;
  const lines = input.map((c, i) => `${i + 1}. (${c.source}) ${c.title}${c.snippet ? ` — ${c.snippet}` : ' (발췌 없음 — 제목뿐)'}`).join('\n');
  const prevLines = prev.length ? prev.map((p) => `${p.storyId}: ${p.title}`).join('\n') : '(없음)';
  const out = await callAndCount(ai, usage, {
    model: BRIEFING.SELECT_MODEL,
    system: SYSTEM_BASE,
    user: [
      `분야 "${subPath(sub)}"의 기사들이다. 브리핑에 실을 이슈를 최대 ${max}개 골라라.`,
      '- 같은 사건을 다룬 기사는 하나로 묶는다: 가장 정보가 많은 것을 main, 나머지를 related로.',
      '- 이 분야에 맞지 않는 기사, 스포츠·연예·광고·홍보성 기사는 고르지 않는다.',
      // 모음 기사 ② (roundup.ts) — 제목 거르기를 빠져나온 새 이름의 모음 기사를 잡는다
      '- 서로 다른 사건 여럿을 한데 모은 기사(헤드라인 모음·주요뉴스 정리·뉴스 요약·브리핑 모음)는 고르지 않는다. 사건 하나를 다룬 기사만 고른다.',
      '- 직전 회차에 같은 이슈가 있었으면 prevStoryId에 그 id를 적는다(새 국면이 있을 때만 고른다).',
      '- 참고(1) 이슈만 title·summary·why를 한국어로 새로 쓴다. 해외 기사도 제목까지 반드시 한국어로 옮긴다(고유명사는 원문 표기 가능).',
      '- 이 분야보다 확실히 맞는 분야가 있는 기사는 그래도 고르되 moveTo에 그 분야 id를 적는다. 애매하면 빈 문자열.',
      REGION_RULE,
      SUB_RULE,
      '- 발췌 없이 제목뿐인 기사는 summary를 제목을 풀어 쓴 한 문장으로만 쓰고 사실을 덧붙이지 않는다. why는 주어진 글에서 근거를 댈 수 있을 때만 쓰고, 일반론이면 빈 문자열.',
      NO_META_RULE,
      IMPORTANCE_RULES,
      `\n분야 목록:\n${SUB_LIST}`,
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
    const briefSummary = stripMeta(s.summary);
    // 참고 기사인데 요약이 없으면 싣지 않는다 — 원문 제목(영어 그대로일 때도)만 덩그러니 실리던 것 (사용성 평가 2026-10-01)
    if (importance === 1 && !briefSummary) continue;
    // 참고는 제목을 안 썼으면 원문 제목으로 싣는데, 그게 한글이 없는 외국어 제목이면 싣지 않는다 (설계 "해외 기사도 한국어로")
    const briefTitle = s.title.trim() || main.title;
    if (importance === 1 && !HANGUL.test(briefTitle)) continue;
    // 검색 결과가 엉뚱한 분야로 들어온 기사는 맞는 분야로 옮긴다 — 같은 사건이 옮긴 분야에 또 있으면 ③-2 합치기가 하나로 만든다
    const target = s.moveTo ? findSubById(s.moveTo.trim()) : undefined;
    // 발췌가 있고 포털 재게재 주소가 아닌 기사를 대표로 — 요약의 근거와 화면의 출처가 둘 다 나아진다 (설계 "③-1 근거 보강")
    const pool = [main, ...related];
    const score = (c: Candidate) => (c.snippet ? 2 : 0) + (isAggregator(c.source) ? 0 : 1);
    const lead = pool.reduce((a, b) => (score(b) > score(a) ? b : a));
    picked.push({
      sub: target ?? sub,
      main: lead,
      related: pool.filter((c) => c !== lead),
      importance,
      prevStoryId: s.prevStoryId && prevIds.has(s.prevStoryId) ? s.prevStoryId : null,
      // 참고인데 제목을 안 썼으면 원문 제목으로 싣는다. 의미에 작업 사정이 섞였으면 통째로 비운다
      brief: importance === 1 ? { title: briefTitle, summary: briefSummary, why: stripMeta(s.why) === s.why.trim() ? s.why.trim() : '' } : null,
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
  opts: { since: number; until: number; signal?: AbortSignal; onProgress?: (done: number, total: number) => void },
): Promise<Picked[]> {
  const entries = [...bySub.entries()].filter(([, list]) => list.length > 0);
  let done = 0;
  opts.onProgress?.(0, entries.length);
  const results = await mapLimit(entries, BRIEFING.SELECT_CONCURRENCY, async ([sub, list]) => {
    const r = await selectOne(sub, list, prevBySub.get(sub.id) ?? [], opts, ai, usage, opts.signal);
    opts.onProgress?.(++done, entries.length);
    return r;
  });
  const failed = results.find((r) => !r.ok);
  if (failed && !failed.ok) throw new Error(`선별 실패 — ${errorText(failed.error)}`);
  return results.flatMap((r) => (r.ok ? r.value : []));
}
