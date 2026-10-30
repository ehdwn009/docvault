import fs from 'node:fs';
import path from 'node:path';
import { z } from 'zod/v4';
import { BRIEFING } from '../constants.js';
import { SYSTEM_BASE } from '../lib/briefing/ai.js';
import { basisOf, readBodies, type Material } from '../lib/briefing/body.js';
import { REGION_RULE, SUB_LIST, SUB_RULE } from '../lib/briefing/classify.js';
import { stripMeta } from '../lib/briefing/clean.js';
import { collect, numberSet, type Candidate } from '../lib/briefing/collect.js';
import { needsDemotion } from '../lib/briefing/fallback.js';
import { checkDomainsOf, checkUrl } from '../lib/briefing/jobDomains.js';
import { finalizeBullets, LENS_RULES } from '../lib/briefing/lenses.js';
import { HANGUL, MAX_INPUT_PER_SUB, pickForSelect, selectRules, type Picked, type PrevStory } from '../lib/briefing/select.js';
import { CANDIDATE_FEEDS, defaultSourcesDoc, parseSourcesDoc, toSources, type SourcesDoc } from '../lib/briefing/sourcesDoc.js';
import { describe, evidenceOf, explainEligible, finalizeItem, impactEligible, lengthTarget, SummaryItemSchema, summaryRules, type Evidence, type Written } from '../lib/briefing/summarize.js';
import { findSubById, SUBS, subPath, type BriefingSub } from '../lib/briefing/taxonomy.js';
import { kstParts } from '../lib/briefing/time.js';
import { outletName } from '../lib/briefing/outlets.js';
import { titleOverlap } from '../lib/briefing/verify.js';
import { WEB_TITLE_OVERLAP_MIN } from '../lib/briefing/webfill.js';

// 구독 생성 방식의 "기계가 하는 일" (뉴스 브리핑 설계 "구독 생성 방식", v0.50) — claude.ai 세션이 저장소를 받아 이 명령을 돌린다.
// 수집·선별 입력 자르기·원문 읽기·숫자 검사·건강 숫자는 서버와 **같은 코드**로 하고, 판단과 글쓰기(분류·선별·요약·검수)만 에이전트가 한다.
// DB·API 키 없이 돈다(db/index.ts를 import하지 않는다). 단계마다 파일 하나를 읽고 하나를 쓴다 — 세션의 명령 시간 상한(2~10분) 안에 끝나게.
//
//   npm run briefing:job -w server -- rules                          지시문(분류·요약·글머리표) 출력 — 서버와 같은 글자
//   npm run briefing:job -w server -- instruction <dir> [옵션]        시험용 지시서 만들기 (실전에서는 API-151이 준다)
//   npm run briefing:job -w server -- collect <dir>                   지시서 → candidates.json + classify-NN.txt
//   npm run briefing:job -w server -- group <dir>                     classified.json → groups.json + select/<분야>.txt
//   npm run briefing:job -w server -- read <dir>                      selected.json → materials.json + summarize/*.txt + fallback.txt + webfill-targets.txt
//   npm run briefing:job -w server -- webfill <dir>                   webfill.json(웹 검색으로 찾은 보도) → materials.json에 W 재료 + 요약 입력 다시 쓰기
//   npm run briefing:job -w server -- verify <dir>                    written.json → result.json(완성본, API-153 본문) + verify-report.txt

const [cmd, dirArg, ...rest] = process.argv.slice(2);

function flag(name: string): string | undefined {
  const i = rest.indexOf(`--${name}`);
  return i >= 0 ? rest[i + 1] : undefined;
}

function readJson<T>(file: string, schema: z.ZodType<T>): T {
  const raw: unknown = JSON.parse(fs.readFileSync(file, 'utf8'));
  const r = schema.safeParse(raw);
  if (!r.success) {
    const issue = r.error.issues[0];
    const where = issue?.path.map((p) => String(p)).join('.') ?? '';
    throw new Error(`${path.basename(file)} 형식 오류 — ${where}: ${issue?.message ?? '알 수 없음'}`);
  }
  return r.data;
}

function writeJson(file: string, value: unknown): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(value, null, 2) + '\n');
}

function writeText(file: string, text: string): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text.endsWith('\n') ? text : text + '\n');
}

const pad2 = (n: number) => String(n).padStart(2, '0');

// ---- 파일 형식 — 세션(에이전트)이 쓰는 파일은 zod로 받는다. 틀리면 어디가 틀렸는지 한 줄로 ----

/** 지시서 — API-151 응답과 같은 모양. 시험에서는 instruction 명령이 만든다 */
const InstructionSchema = z.object({
  kind: z.literal('edition'),
  jobId: z.string(),
  slot: z.enum(['morning', 'noon', 'evening', 'adhoc']),
  editionDate: z.string(),
  since: z.number(),
  until: z.number(),
  deadline: z.number(),
  wrapUpBefore: z.number(),
  sources: z.unknown(),
  allowedDomains: z.array(z.string()),
  excludeUrls: z.array(z.string()).default([]),
  prevStories: z.array(z.object({ subId: z.string(), storyId: z.string(), title: z.string(), summary: z.string() })).default([]),
  generator: z.object({ config: z.string().optional() }).default({}),
});
type Instruction = z.infer<typeof InstructionSchema>;

/** 후보 — Candidate에서 sub 객체를 id로 바꾼 저장용 모양. i는 전역 번호(분류·선별·요약 파일이 전부 이 번호로 가리킨다) */
const StoredCandidateSchema = z.object({
  i: z.number(),
  title: z.string(),
  url: z.string(),
  publishedAt: z.number(),
  source: z.string(),
  snippet: z.string(),
  feedText: z.string(),
  region: z.enum(['국내', '세계']),
  subId: z.string().nullable(),
  related: z.array(z.object({ source: z.string(), url: z.string() })),
});
type StoredCandidate = z.infer<typeof StoredCandidateSchema>;

const CandidatesFileSchema = z.object({
  stats: z.object({ sources: z.number(), sourcesFailed: z.number(), failedSources: z.array(z.string()), candidates: z.number(), attached: z.number(), wouldMerge: z.number() }),
  candidates: z.array(StoredCandidateSchema),
});

/** 분류 답 — 분야를 모르는 후보마다 subId. 빈 문자열이면 뺀다(스포츠·연예·광고). 적지 않은 후보도 뺀다 */
const ClassifiedSchema = z.object({ assignments: z.array(z.object({ i: z.number(), subId: z.string() })) });

/** 선별 답 — 전역 번호로 대표(main)와 같은 사건(related)을 가리킨다. 참고(1)만 title·summary·why를 쓴다 */
const SelectedSchema = z.object({
  stories: z.array(
    z.object({
      subId: z.string(),
      main: z.number(),
      related: z.array(z.number()).default([]),
      importance: z.number(),
      prevStoryId: z.string().nullable().default(null),
      title: z.string().default(''),
      summary: z.string().default(''),
      why: z.string().default(''),
    }),
  ),
});

const EvidenceSchema = z.object({ id: z.string(), source: z.string(), url: z.string(), text: z.string(), via: z.enum(['body', 'feed', 'web', 'lede']) });

const MaterialsFileSchema = z.object({
  stats: z.object({ bodiesRead: z.number(), fromFeed: z.number(), extractRejected: z.number(), webFilled: z.number().default(0) }),
  stories: z.array(
    z.object({
      story: z.number(),
      evidence: z.array(EvidenceSchema),
      target: z.tuple([z.number(), z.number()]),
      impact: z.boolean(),
      explain: z.object({ on: z.boolean(), effect: z.boolean() }),
      demoted: z.boolean(),
    }),
  ),
});

/** 요약 답 — 서버의 요약 출력 스키마(SummaryItemSchema)에서 k를 story(선별 번호)로 바꾸고 글머리표를 붙였다 */
const WrittenFileSchema = z.object({
  items: z.array(SummaryItemSchema.omit({ k: true }).extend({ story: z.number(), bullets: z.array(z.string()).default([]) })),
  /** 재료가 없어 참고로 내려간 핵심·주요 — 한국어 제목과(발췌가 있으면) 한 문장. 서버의 writeFallbacks 자리 */
  fallbacks: z.array(z.object({ story: z.number(), title: z.string(), summary: z.string().default('') })).default([]),
});

// ---- 공용 ----

function toStored(c: Candidate, i: number): StoredCandidate {
  return { i, title: c.title, url: c.url, publishedAt: c.publishedAt, source: c.source, snippet: c.snippet, feedText: c.feedText, region: c.region, subId: c.sub?.id ?? null, related: c.related };
}

function toCandidate(s: StoredCandidate): Candidate {
  return { title: s.title, url: s.url, publishedAt: s.publishedAt, source: s.source, snippet: s.snippet, feedText: s.feedText, region: s.region, sub: s.subId ? (findSubById(s.subId) ?? null) : null, related: s.related };
}

function subOrThrow(id: string, where: string): BriefingSub {
  const sub = findSubById(id);
  if (!sub) throw new Error(`${where}: 분류표에 없는 분야 id "${id}"`);
  return sub;
}

/** 선별 답 → Picked[] (서버 selectOne의 뒷부분과 같은 규칙 — 번호가 없거나 겹치면 버린다, 참고 제목에 한글이 없으면 싣지 않는다) */
function toPicked(selected: z.infer<typeof SelectedSchema>, byIndex: Map<number, Candidate>, prevIds: Set<string>): { picked: Picked[]; warnings: string[] } {
  const used = new Set<number>();
  const picked: Picked[] = [];
  const warnings: string[] = [];
  selected.stories.forEach((s, n) => {
    const main = byIndex.get(s.main);
    if (!main || used.has(s.main)) {
      warnings.push(`stories[${n}]: 대표 번호 ${s.main}이(가) 없거나 이미 쓰였음 — 버림`);
      return;
    }
    used.add(s.main);
    const related: Candidate[] = [];
    for (const r of s.related) {
      const c = byIndex.get(r);
      if (c && !used.has(r)) {
        used.add(r);
        related.push(c);
      }
    }
    const importance = Math.min(3, Math.max(1, Math.round(s.importance))) as 1 | 2 | 3;
    const title = s.title.trim() || main.title;
    if (importance === 1 && !HANGUL.test(title)) {
      warnings.push(`stories[${n}]: 참고 기사 제목에 한글이 없음("${title.slice(0, 30)}") — 싣지 않음`);
      return;
    }
    const summary = stripMeta(s.summary);
    picked.push({
      sub: subOrThrow(s.subId, `stories[${n}]`),
      main,
      related,
      importance,
      prevStoryId: s.prevStoryId && prevIds.has(s.prevStoryId) ? s.prevStoryId : null,
      brief: importance === 1 ? { title, summary, why: stripMeta(s.why) === s.why.trim() ? s.why.trim() : '' } : null,
    });
  });
  return { picked, warnings };
}

// ---- 명령 ----

function cmdRules(): void {
  console.log(['# 시스템 지시(모든 단계 공통)', SYSTEM_BASE, '', '# 분류 — 분야를 모르는 후보마다 세부 분야 id 하나', '아래 기사마다 가장 맞는 세부 분야 id 하나를 골라라.', REGION_RULE, SUB_RULE, '', '분야 목록:', SUB_LIST, '', '# 선별 — 분야별 지시문은 select/<분야>.txt 머리에 그대로 들어 있다', '', '# 요약 — 핵심·주요 기사 (summarize/*.txt 머리에도 들어 있다)', ...summaryRules(), '', '# 글머리표 — 요약(리드·왜·칸)만 재료로', ...LENS_RULES].join('\n'));
}

function cmdInstruction(dir: string): void {
  const sourcesFile = flag('sources');
  const base: SourcesDoc = sourcesFile ? parseSourcesDoc(fs.readFileSync(sourcesFile, 'utf8')) : defaultSourcesDoc();
  // --all-candidates: 꺼 둔 후보 출처까지 켠다 — 구독 환경에서 어디가 열리는지 재 보려고(verify 보고에 성공한 후보가 나온다)
  const doc: SourcesDoc = rest.includes('--all-candidates') ? { ...base, disabled: [] } : base;
  const hours = Math.min(24, Math.max(1, Number(flag('hours') ?? 24) || 24));
  const slot = (flag('slot') ?? 'adhoc') as Instruction['slot'];
  const config = flag('config') ?? 'A';
  const now = Date.now();
  // --since/--until(ISO, 예 2026-10-29T06:30+09:00): API 회차와 같은 시간 범위로 비교하려고. 없으면 지금부터 --hours 전까지
  const parseTime = (name: string): number | undefined => {
    const v = flag(name);
    if (v === undefined) return undefined;
    const t = Date.parse(v);
    if (Number.isNaN(t)) throw new Error(`--${name} "${v}"를 시각으로 읽을 수 없습니다 — 예: 2026-10-29T06:30+09:00`);
    return t;
  };
  const until = parseTime('until') ?? now;
  const since = parseTime('since') ?? until - hours * 60 * 60 * 1000;
  if (since >= until || until - since > BRIEFING.MAX_RANGE_MS) throw new Error(`범위가 맞지 않습니다 — since < until, 길이는 ${BRIEFING.MAX_RANGE_MS / 3_600_000}시간 이하`);
  const instruction: Instruction & { taxonomy: unknown; limits: unknown } = {
    kind: 'edition',
    jobId: `test-${new Date(now).toISOString().replace(/[:.]/g, '-')}`,
    slot,
    editionDate: kstParts(now).date,
    since,
    until,
    // 시험에서는 리드 90분이 곧 마감까지의 시간 — 실전은 "회차 시작 + 30분"을 서버가 적어 준다
    deadline: now + BRIEFING.SUB_LEAD_MS,
    wrapUpBefore: BRIEFING.SUB_WRAPUP_BEFORE_MS,
    sources: doc,
    allowedDomains: checkDomainsOf(doc),
    excludeUrls: [],
    prevStories: [],
    generator: { config },
    taxonomy: SUBS.map((s) => ({ id: s.id, path: subPath(s), max: s.wide ? BRIEFING.MAX_ITEMS_WIDE : BRIEFING.MAX_ITEMS_NARROW })),
    limits: { titleMaxChars: BRIEFING.TITLE_MAX_CHARS, blocksMax: BRIEFING.BLOCKS_MAX, relatedMax: BRIEFING.MAX_RELATED, resultMaxBytes: BRIEFING.SUB_RESULT_MAX_BYTES, resendMax: BRIEFING.SUB_RESEND_MAX },
  };
  writeJson(path.join(dir, 'instruction.json'), instruction);
  const k = kstParts(now);
  console.log(`지시서 → ${path.join(dir, 'instruction.json')} — ${slot} · 범위 ${kstParts(since).date} ${kstParts(since).hour}:${pad2(kstParts(since).minute)} ~ ${kstParts(until).date} ${kstParts(until).hour}:${pad2(kstParts(until).minute)} KST · 출처 ${toSources(doc).length}곳 · 허용 도메인 ${instruction.allowedDomains.length}개 · 마감 ${kstParts(instruction.deadline).hour}:${pad2(kstParts(instruction.deadline).minute)} KST (지금 ${k.hour}:${pad2(k.minute)}) · 구성 ${config}`);
}

async function cmdCollect(dir: string): Promise<void> {
  const ins = readJson(path.join(dir, 'instruction.json'), InstructionSchema);
  const doc = parseSourcesDoc(JSON.stringify(ins.sources));
  const sources = toSources(doc);
  console.log(`수집 시작 — 출처 ${sources.length}곳, 범위 ${new Date(ins.since).toISOString()} ~ ${new Date(ins.until).toISOString()}`);
  let shown = 0;
  const got = await collect(sources, {
    since: ins.since,
    until: ins.until,
    excludeUrls: new Set(ins.excludeUrls),
    onProgress: (d, t) => {
      if (d - shown >= 10 || d === t) {
        shown = d;
        console.log(`  ${d}/${t}`);
      }
    },
  });
  const feedFailed = got.failed.filter((f) => f.kind === 'feed').length;
  const stats = { sources: got.sourceCount, sourcesFailed: got.failed.length, failedSources: got.failed.map((f) => f.name), candidates: got.candidates.length, attached: got.attached, wouldMerge: got.wouldMerge };
  writeJson(path.join(dir, 'candidates.json'), { stats, candidates: got.candidates.map(toStored) });

  // 분류 입력 — 분야를 모르는(언론사 피드) 후보만, 서버와 같은 묶음 크기. 번호는 전역 i (서버는 묶음 안 1..n이지만, 사람이 답을 옮겨 적는 일이 없게 전역으로)
  const unknown = got.candidates.map((c, i) => ({ c, i })).filter(({ c }) => c.sub === null);
  const header = ['아래 기사마다 가장 맞는 세부 분야 id 하나를 골라라. 번호는 전역 번호(i)다 — classified.json의 i로 그대로 쓴다.', REGION_RULE, SUB_RULE, '', '분야 목록:', SUB_LIST, ''].join('\n');
  let files = 0;
  for (let k = 0; k < unknown.length; k += BRIEFING.CLASSIFY_CHUNK) {
    const chunk = unknown.slice(k, k + BRIEFING.CLASSIFY_CHUNK);
    const lines = chunk.map(({ c, i }) => `${i}. [${c.region}] ${c.title}${c.snippet ? ` — ${c.snippet}` : ''}`).join('\n');
    writeText(path.join(dir, `classify-${pad2(++files)}.txt`), `${header}\n<기사>\n${lines}\n</기사>`);
  }
  console.log(`수집 끝 — 후보 ${got.candidates.length}건 (분야 아는 것 ${got.candidates.length - unknown.length}, 분류할 것 ${unknown.length} → classify-01~${pad2(files)}.txt)${got.attached ? `, Google 기사 ${got.attached}건 붙임` : ''}${got.failed.length ? `, 못 받은 출처 ${got.failed.length}곳(언론사 ${feedFailed})` : ''}`);
  const feedCount = sources.filter((s) => !s.sub).length;
  if (feedCount > 0 && (feedCount - feedFailed) / feedCount < BRIEFING.MIN_SOURCE_OK_RATIO) console.log(`경고: 언론사 피드 성공 비율이 ${Math.round(((feedCount - feedFailed) / feedCount) * 100)}% — 서버 기준(${BRIEFING.MIN_SOURCE_OK_RATIO * 100}%) 미만. 이 상태로 만든 회차는 직전 회차보다 나쁘다`);
  if (got.failed.length) console.log(got.failed.map((f) => `  못 받음: ${f.name} — ${f.reason}`).join('\n'));
}

function cmdGroup(dir: string): void {
  const ins = readJson(path.join(dir, 'instruction.json'), InstructionSchema);
  const cands = readJson(path.join(dir, 'candidates.json'), CandidatesFileSchema);
  const classified = readJson(path.join(dir, 'classified.json'), ClassifiedSchema);
  const assigned = new Map(classified.assignments.map((a) => [a.i, a.subId.trim()]));
  const bySub = new Map<string, StoredCandidate[]>();
  let excluded = 0;
  for (const s of cands.candidates) {
    const subId = s.subId ?? assigned.get(s.i) ?? '';
    if (!subId) {
      excluded++;
      continue;
    }
    if (!findSubById(subId)) throw new Error(`classified.json: 분류표에 없는 분야 id "${subId}" (i=${s.i})`);
    bySub.set(subId, [...(bySub.get(subId) ?? []), s]);
  }
  const prevBySub = new Map<string, PrevStory[]>();
  for (const p of ins.prevStories) prevBySub.set(p.subId, [...(prevBySub.get(p.subId) ?? []), p]);

  const groups: { subId: string; max: number; input: number[] }[] = [];
  for (const [subId, list] of bySub) {
    const sub = findSubById(subId)!;
    const max = sub.wide ? BRIEFING.MAX_ITEMS_WIDE : BRIEFING.MAX_ITEMS_NARROW;
    // 서버와 같은 입력 자르기 — 다른 보도가 붙은 기사 먼저, 나머지는 범위 전체에서 고르게 (pickForSelect)
    const input = pickForSelect(list.map(toCandidate), MAX_INPUT_PER_SUB, { since: ins.since, until: ins.until });
    const idxOf = new Map(list.map((s) => [s.url, s.i]));
    const indexes = input.map((c) => idxOf.get(c.url)!);
    groups.push({ subId, max, input: indexes });
    const prev = prevBySub.get(subId) ?? [];
    const lines = input.map((c) => `${idxOf.get(c.url)}. (${c.source}) ${c.title}${c.snippet ? ` — ${c.snippet}` : c.feedText ? ` — ${c.feedText.slice(0, BRIEFING.SNIPPET_MAX_CHARS)}` : ' (발췌 없음 — 제목뿐)'}`).join('\n');
    const text = [
      ...selectRules(sub, max),
      '번호는 전역 번호다 — selected.json의 main·related에 그대로 쓴다.',
      `\n분야 목록:\n${SUB_LIST}`,
      `\n직전 회차의 이 분야 이슈:\n${prev.length ? prev.map((p) => `${p.storyId}: ${p.title}`).join('\n') : '(없음)'}`,
      `\n<기사>\n${lines}\n</기사>`,
    ].join('\n');
    writeText(path.join(dir, 'select', `${subId}.txt`), text);
  }
  writeJson(path.join(dir, 'groups.json'), { excluded, groups });
  console.log(`분류 반영 끝 — ${bySub.size}개 분야, 뺀 기사 ${excluded}건 → select/<분야>.txt ${groups.length}개 (분야당 입력 최대 ${MAX_INPUT_PER_SUB}건)`);
}

/** 핵심 기사가 재료를 낸 서로 다른 언론사 수 — 교차 확인 대상(2곳 미만)을 고르는 기준 (설계 "구독 생성 방식 — 정확도") */
function materialOutlets(evidence: Evidence[]): number {
  return new Set(evidence.filter((e) => e.via !== 'lede').map((e) => e.source.trim().toLowerCase())).size;
}

/**
 * materials.json → 요약 입력(summarize/*.txt), 참고로 내려간 기사(fallback.txt), 웹 검색 대상(webfill-targets.txt).
 * read 뒤에, 그리고 webfill로 재료를 더한 뒤에 다시 부른다 — 지난 파일이 남아 섞이지 않게 먼저 지운다
 */
function writeSummarizeInputs(dir: string, ins: Instruction, picked: Picked[], mat: z.infer<typeof MaterialsFileSchema>): void {
  fs.rmSync(path.join(dir, 'summarize'), { recursive: true, force: true });
  fs.rmSync(path.join(dir, 'fallback.txt'), { force: true });
  fs.rmSync(path.join(dir, 'webfill-targets.txt'), { force: true });
  const prevSummary = new Map(ins.prevStories.map((p) => [p.storyId, p.summary]));
  const core: string[] = [];
  const major: string[] = [];
  const fallbackLines: string[] = [];
  const targetLines: string[] = [];
  for (const m of mat.stories) {
    const p = picked[m.story];
    if (!p || p.importance < 2) continue;
    const outlets = materialOutlets(m.evidence);
    // 웹 검색 대상 — ① 재료가 없어 참고로 내려간 핵심·주요(A: 재료 채우기) ② 재료가 2곳 미만인 핵심(D: 교차 확인)
    if (m.demoted || (p.importance === 3 && outlets < 2)) {
      const why = m.demoted ? '재료 없음 — 같은 사건 보도를 찾아 재료로' : `핵심인데 재료 ${outlets}곳 — 다른 언론 보도로 교차 확인`;
      const others = p.related.slice(0, 4).map((r) => `(${r.source}) ${r.title}`).join(' / ');
      targetLines.push(`${m.story}. [${subPath(p.sub)}] 중요도 ${p.importance} · ${why}\n   (${p.main.source}) ${p.main.title}\n   원 주소: ${p.main.url}${others ? `\n   같은 사건 다른 보도 제목: ${others}` : ''}`);
    }
    if (m.demoted) {
      fallbackLines.push(`${m.story}. [${subPath(p.sub)}] (${p.main.source}) ${p.main.title}${p.main.snippet ? ` — 발췌: ${p.main.snippet}` : ' — 발췌 없음(제목만: summary는 빈 문자열, title은 한국어 번역만)'}`);
      continue;
    }
    (p.importance === 3 ? core : major).push(describe(p, m.story, m.evidence, m.target, p.prevStoryId ? prevSummary.get(p.prevStoryId) : undefined, m.impact, m.explain));
  }
  // 요약 입력 — 서버와 같은 묶음 크기(핵심 3·주요 6). 파일 하나가 요약 호출 하나다
  const rulesHead = [...summaryRules(), '번호는 선별 번호(story)다 — written.json의 story에 그대로 쓴다.', ''].join('\n');
  const batch = (list: string[], size: number, name: string) => {
    let n = 0;
    for (let k = 0; k < list.length; k += size) writeText(path.join(dir, 'summarize', `${name}-${pad2(++n)}.txt`), `${rulesHead}\n<기사>\n${list.slice(k, k + size).join('\n')}\n</기사>`);
    return n;
  };
  const coreFiles = batch(core, BRIEFING.SUMMARY_CHUNK_CORE, 'core');
  const majorFiles = batch(major, BRIEFING.SUMMARY_CHUNK, 'major');
  if (fallbackLines.length) writeText(path.join(dir, 'fallback.txt'), ['재료가 없어 참고로 내려간 핵심·주요 기사. 기사마다 한국어 제목(원문을 베끼지 말고 새로)과, 발췌가 있으면 무슨 일인지 한 문장을 쓴다 → written.json의 fallbacks[{story,title,summary}].', ...fallbackLines].join('\n'));
  if (targetLines.length)
    writeText(
      path.join(dir, 'webfill-targets.txt'),
      [
        `웹 검색으로 재료를 붙일 기사 ${targetLines.length}건. 같은 사건을 다룬 보도를 허용 도메인(instruction.json allowedDomains) 안에서만 찾는다.`,
        `범위: ${new Date(ins.since - BRIEFING.WEB_FILL_DATE_SLACK_MS).toISOString().slice(0, 10)} ~ ${new Date(ins.until + BRIEFING.WEB_FILL_DATE_SLACK_MS).toISOString().slice(0, 10)} 사이의 보도만. 같은 발표·결정·사고·수치일 때만 — 비슷한 다른 날 기사는 쓰지 않는다.`,
        'text에는 그 페이지에 적힌 문장을 **그대로 옮겨** 적는다(요약·번역·의견 금지). 결과는 webfill.json의 stories[{story, materials:[{source,url,title,publishedAt?,text}]}].',
        '',
        ...targetLines,
      ].join('\n'),
    );
  const files = (name: string, n: number) => (n === 0 ? '없음' : n === 1 ? `${name}-01.txt` : `${name}-01~${pad2(n)}.txt`);
  console.log(`요약 입력: 핵심 ${core.length}건 → ${files('core', coreFiles)}, 주요 ${major.length}건 → ${files('major', majorFiles)}${fallbackLines.length ? `, 참고로 내려감 ${fallbackLines.length}건 → fallback.txt` : ''}${targetLines.length ? `, 웹 검색 대상 ${targetLines.length}건 → webfill-targets.txt` : ''}`);
}

async function cmdRead(dir: string): Promise<void> {
  const ins = readJson(path.join(dir, 'instruction.json'), InstructionSchema);
  const cands = readJson(path.join(dir, 'candidates.json'), CandidatesFileSchema);
  const selected = readJson(path.join(dir, 'selected.json'), SelectedSchema);
  const byIndex = new Map(cands.candidates.map((s) => [s.i, toCandidate(s)]));
  const { picked, warnings } = toPicked(selected, byIndex, new Set(ins.prevStories.map((p) => p.storyId)));
  warnings.forEach((w) => console.log(`경고: ${w}`));
  const targets = picked.filter((p) => p.importance >= BRIEFING.BODY_FETCH_MIN_IMPORTANCE).length;
  console.log(`원문 읽기 시작 — 선별 ${picked.length}건 중 핵심·주요 ${targets}건`);
  let shown = 0;
  const read = await readBodies(picked, {
    onProgress: (d, t) => {
      if (d - shown >= 10 || d === t) {
        shown = d;
        console.log(`  ${d}/${t}`);
      }
    },
  });
  const stories: z.infer<typeof MaterialsFileSchema>['stories'] = picked.map((p, i) => {
    const materials: Material[] | undefined = read.materials.get(i);
    const evidence = evidenceOf(p, materials);
    // 재료 보장(S0) — 핵심·주요인데 본문도 피드 본문도 없으면 참고로 내린다. 웹 검색(webfill)으로 재료가 붙으면 다시 올라간다
    return { story: i, evidence, target: lengthTarget(p, evidence), impact: impactEligible(p, evidence), explain: explainEligible(p), demoted: needsDemotion(p, materials) };
  });
  const mat = { stats: { bodiesRead: read.materials.size, fromFeed: read.fromFeed, extractRejected: read.rejected, webFilled: 0 }, stories };
  writeJson(path.join(dir, 'materials.json'), mat);
  console.log(`원문 읽기 끝 — 재료 있는 기사 ${read.materials.size}건${read.fromFeed ? ` (피드 본문 ${read.fromFeed})` : ''}${read.rejected ? `, 제목과 안 맞아 버림 ${read.rejected}` : ''}`);
  writeSummarizeInputs(dir, ins, picked, mat);
}

/** 웹 검색 답 — 세션이 웹 검색·읽기 도구로 찾은 같은 사건 보도. text는 페이지 문장을 그대로 옮긴 것이어야 한다 */
const WebfillSchema = z.object({
  stories: z.array(
    z.object({
      story: z.number(),
      materials: z.array(z.object({ source: z.string(), url: z.string(), title: z.string().default(''), publishedAt: z.number().optional(), text: z.string() })).default([]),
    }),
  ),
});

/**
 * 웹 검색 재료 붙이기 (A·D) — 서버의 웹 검색 보강(webfill.ts)과 같은 규칙으로 받는다: 허용 도메인 안, 날짜가 범위 ±24시간,
 * 원 제목 핵심어 겹침 25% 이상. 서버는 검색 도구의 인용(페이지 글 그대로)만 재료로 쓰는데, 세션은 페이지를 직접 받을 수 없는 곳이 많아
 * 에이전트가 옮겨 적은 글을 받는다 — 그래서 기호를 W로 달아 회차에 "웹 검색 보도"로 드러나고(basis web), 검수 에이전트가 다시 본다
 */
function cmdWebfill(dir: string): void {
  const ins = readJson(path.join(dir, 'instruction.json'), InstructionSchema);
  const cands = readJson(path.join(dir, 'candidates.json'), CandidatesFileSchema);
  const selected = readJson(path.join(dir, 'selected.json'), SelectedSchema);
  const mat = readJson(path.join(dir, 'materials.json'), MaterialsFileSchema);
  const fill = readJson(path.join(dir, 'webfill.json'), WebfillSchema);
  const byIndex = new Map(cands.candidates.map((s) => [s.i, toCandidate(s)]));
  const { picked } = toPicked(selected, byIndex, new Set(ins.prevStories.map((p) => p.storyId)));
  const byStory = new Map(mat.stories.map((m) => [m.story, m]));
  const rejected: Record<string, number> = {};
  const reject = (why: string, line: string) => {
    rejected[why] = (rejected[why] ?? 0) + 1;
    console.log(`  버림(${why}): ${line}`);
  };
  let filled = 0;
  let raised = 0;
  for (const f of fill.stories) {
    const m = byStory.get(f.story);
    const p = picked[f.story];
    if (!m || !p) {
      reject('번호', `story ${f.story} — selected.json·materials.json에 없음`);
      continue;
    }
    const maxChars = p.importance === 3 ? BRIEFING.BODY_OTHER_CHARS_CORE : BRIEFING.BODY_OTHER_CHARS_MAJOR;
    const seen = new Set(m.evidence.map((e) => e.url));
    let added = 0;
    for (const w of f.materials) {
      if (m.evidence.filter((e) => e.via === 'web').length >= BRIEFING.SUB_WEB_MATERIALS_MAX) break;
      const text = w.text.trim().slice(0, maxChars);
      const where = `story ${f.story} ${w.url}`;
      if (seen.has(w.url)) continue;
      const u = checkUrl(w.url, ins.allowedDomains);
      if (!u.ok) {
        reject(`주소 ${u.reason}`, where);
        continue;
      }
      if (text.length < BRIEFING.SUB_WEB_TEXT_MIN_CHARS) {
        reject('글이 짧음', where);
        continue;
      }
      if (w.publishedAt !== undefined && (w.publishedAt < ins.since - BRIEFING.WEB_FILL_DATE_SLACK_MS || w.publishedAt > ins.until + BRIEFING.WEB_FILL_DATE_SLACK_MS)) {
        reject('날짜 범위 밖', where);
        continue;
      }
      // 같은 사건인가 — 원 제목의 핵심어가 찾은 글에 있어야 한다 (서버 webfill과 같은 기준)
      if (titleOverlap(p.main.title, `${w.title}\n${text}`) < WEB_TITLE_OVERLAP_MIN) {
        reject('제목과 안 겹침', where);
        continue;
      }
      const n = m.evidence.filter((e) => e.via === 'web').length + 1;
      const host = new URL(w.url).hostname.replace(/^(www|m)\./, '');
      m.evidence.push({ id: `W${n}`, source: outletName(w.source.trim() || host), url: w.url, text, via: 'web' });
      seen.add(w.url);
      added++;
    }
    if (added === 0) continue;
    filled++;
    m.target = lengthTarget(p, m.evidence);
    m.impact = impactEligible(p, m.evidence);
    if (m.demoted) {
      m.demoted = false;
      raised++;
    }
  }
  mat.stats.webFilled = mat.stories.filter((m) => m.evidence.some((e) => e.via === 'web')).length;
  writeJson(path.join(dir, 'materials.json'), mat);
  const rej = Object.entries(rejected);
  console.log(`웹 검색 재료 — ${filled}건에 붙임 (참고에서 다시 올라감 ${raised}건)${rej.length ? `, 버림 ${rej.map(([k, v]) => `${k} ${v}`).join(', ')}` : ''}`);
  writeSummarizeInputs(dir, ins, picked, mat);
}

type ResultItem = {
  subId: string;
  title: string;
  summary: string;
  why: string;
  importance: 1 | 2 | 3;
  source: string;
  url: string;
  publishedAt: number;
  originalTitle: string;
  prevStoryId: string | null;
  related: { source: string; url: string }[];
  basis: 'body' | 'lede' | 'title' | 'web';
  sources: { id: string; source: string; url: string; via: Evidence['via'] }[];
  summaryFrom: string[];
  whyFrom: string[];
  blocks: Written['blocks'];
  sides: Written['sides'] | null;
  lenses: { bullets: string[] } | null;
  w5: Written['w5'] | null;
  impact: Written['impact'] | null;
  explain: Written['explain'] | null;
  readUrl: string | null;
  changed: string | null;
  titleOnly: boolean;
};

function cmdVerify(dir: string): void {
  const ins = readJson(path.join(dir, 'instruction.json'), InstructionSchema);
  const cands = readJson(path.join(dir, 'candidates.json'), CandidatesFileSchema);
  const selected = readJson(path.join(dir, 'selected.json'), SelectedSchema);
  const materials = readJson(path.join(dir, 'materials.json'), MaterialsFileSchema);
  const written = readJson(path.join(dir, 'written.json'), WrittenFileSchema);
  const byIndex = new Map(cands.candidates.map((s) => [s.i, toCandidate(s)]));
  const { picked } = toPicked(selected, byIndex, new Set(ins.prevStories.map((p) => p.storyId)));
  const matOf = new Map(materials.stories.map((s) => [s.story, s]));
  const writtenOf = new Map(written.items.map((w) => [w.story, w]));
  const fallbackOf = new Map(written.fallbacks.map((f) => [f.story, f]));

  const items: ResultItem[] = [];
  const report: string[] = [];
  const counters = { numberDrops: 0, overruns: 0, demoted: 0, impactDrops: 0, explainDrops: 0, titleMismatch: 0, lensDrops: 0, skipped: 0, titleTooLong: 0 };
  const urlDrops: Record<string, number> = {};
  const checkAll = (i: number, urls: string[]) => {
    for (const u of urls) {
      const r = checkUrl(u, ins.allowedDomains);
      if (!r.ok) {
        urlDrops[r.reason] = (urlDrops[r.reason] ?? 0) + 1;
        report.push(`story ${i}: 주소 검사 실패(${r.reason}) ${u} — 서버가 이 기사를 뺀다`);
      }
    }
  };

  picked.forEach((p, i) => {
    const m = matOf.get(i);
    if (!m) {
      report.push(`story ${i}: materials.json에 없음 — read를 다시 돌렸는지 확인. 건너뜀`);
      counters.skipped++;
      return;
    }
    const evidence: Evidence[] = m.evidence;
    const bodyMaterials: Material[] = evidence.filter((e): e is Evidence & { via: Material['via'] } => e.via !== 'lede').map((e) => ({ id: e.id, source: e.source, url: e.url, title: '', text: e.text, via: e.via }));
    const readUrl = evidence.find((e) => e.via === 'body')?.url ?? null;
    const base = {
      subId: p.sub.id,
      source: p.main.source,
      url: p.main.url,
      publishedAt: p.main.publishedAt,
      originalTitle: p.main.title,
      prevStoryId: p.prevStoryId,
      related: p.related.map((r) => ({ source: r.source, url: r.url })),
      basis: basisOf(p, bodyMaterials.length ? bodyMaterials : undefined),
      sources: evidence.map((e) => ({ id: e.id, source: e.source, url: e.url, via: e.via })),
      readUrl,
    };

    // 참고(선별이 쓴 한 문장) 또는 재료 없어 내려간 핵심·주요(에이전트가 fallback으로 쓴 것)
    if (p.importance === 1 || m.demoted) {
      const brief = p.importance === 1 ? p.brief! : fallbackOf.get(i);
      if (!brief) {
        report.push(`story ${i}: 재료가 없어 참고로 내려갔는데 written.json fallbacks에 없음 — 싣지 않음`);
        counters.skipped++;
        return;
      }
      if (m.demoted) counters.demoted++;
      const title = stripMeta(brief.title) || p.main.title;
      if (!HANGUL.test(title)) {
        report.push(`story ${i}: 참고 제목에 한글이 없음 — 싣지 않음`);
        counters.skipped++;
        return;
      }
      const summary = stripMeta(brief.summary);
      const hasSnippet = [p.main, ...p.related].some((c) => c.snippet || c.feedText);
      items.push({ ...base, title, summary, why: p.importance === 1 ? p.brief!.why : '', importance: 1, summaryFrom: [], whyFrom: [], blocks: [], sides: null, lenses: null, w5: null, impact: null, explain: null, changed: null, titleOnly: !summary && !hasSnippet });
      checkAll(i, [p.main.url, ...p.related.map((r) => r.url), ...(readUrl ? [readUrl] : [])]);
      return;
    }

    const it = writtenOf.get(i);
    if (!it) {
      report.push(`story ${i}: written.json에 요약이 없음 — 싣지 않음(핵심·주요는 요약 없이 싣지 않는다)`);
      counters.skipped++;
      return;
    }
    // 서버와 같은 검증 — 근거 기호·숫자 대조·칸 규칙·영향·해설 (finalizeItem), 글머리표는 요약에 없는 숫자가 든 줄 삭제 (finalizeBullets)
    const w = finalizeItem({ ...it, k: i + 1 }, p, evidence, m.target, m.impact, m.explain);
    if (!w) {
      report.push(`story ${i}: 제목이 비어 싣지 않음`);
      counters.skipped++;
      return;
    }
    counters.numberDrops += w.numberDrops;
    counters.impactDrops += w.impactDrops;
    counters.explainDrops += w.explainDrops;
    if (w.overrun) counters.overruns++;
    if (w.numberDrops) report.push(`story ${i}: 숫자 대조에 걸린 문장 ${w.numberDrops}개 (NUMBER_CHECK_MODE=${BRIEFING.NUMBER_CHECK_MODE})`);
    if (w.overrun) report.push(`story ${i}: 목표 길이(${m.target[1]}자)의 ${BRIEFING.LENGTH_OVERRUN_RATIO}배 초과`);
    if (w.title.length > BRIEFING.TITLE_MAX_CHARS) {
      counters.titleTooLong++;
      report.push(`story ${i}: 제목 ${w.title.length}자 — 상한 ${BRIEFING.TITLE_MAX_CHARS}자`);
    }
    if (numberSet(w.title).some((n) => !numberSet(p.main.title).includes(n))) counters.titleMismatch++;
    const lens = finalizeBullets(it.bullets, w);
    counters.lensDrops += lens.dropped;
    if (!lens.bullets && it.bullets.length) report.push(`story ${i}: 글머리표가 2줄 미만으로 남아 보기를 만들지 않음`);
    items.push({
      ...base,
      title: w.title,
      summary: w.summary,
      why: w.why,
      importance: p.importance,
      summaryFrom: w.summaryFrom,
      whyFrom: w.whyFrom,
      blocks: w.blocks,
      sides: w.sides ?? null,
      lenses: lens.bullets ? { bullets: lens.bullets } : null,
      w5: w.w5 ?? null,
      impact: w.impact ?? null,
      explain: w.explain ?? null,
      changed: w.changed ?? null,
      titleOnly: false,
    });
    checkAll(i, [p.main.url, ...p.related.map((r) => r.url), ...(readUrl ? [readUrl] : []), ...evidence.map((e) => e.url)]);
  });

  const generator = { mode: 'subscription', config: ins.generator.config ?? 'A', models: (flag('models') ?? '').split(',').map((s) => s.trim()).filter(Boolean), skillVersion: flag('skill-version') ?? '1' };
  const stats = {
    ...cands.stats,
    bodiesRead: materials.stats.bodiesRead,
    fromFeed: materials.stats.fromFeed,
    extractRejected: materials.stats.extractRejected,
    webFilled: materials.stats.webFilled,
    lensDrops: counters.lensDrops,
    numberDrops: counters.numberDrops,
    demoted: counters.demoted,
    overruns: counters.overruns,
    impactDrops: counters.impactDrops,
    explainDrops: counters.explainDrops,
    titleMismatch: counters.titleMismatch,
  };
  const byImportance = [3, 2, 1].map((n) => items.filter((it) => it.importance === n).length);
  const log = [
    `수집 — 출처 ${stats.sources}곳(못 받음 ${stats.sourcesFailed}), 후보 ${stats.candidates}건`,
    `선별 — ${picked.length}건 (핵심 ${byImportance[0]} · 주요 ${byImportance[1]} · 참고 ${byImportance[2]})`,
    `원문 읽기 — 재료 있는 기사 ${stats.bodiesRead}건, 피드 본문 ${stats.fromFeed}, 버림 ${stats.extractRejected}`,
    `검증 — 숫자 대조 ${stats.numberDrops}, 참고로 내림 ${stats.demoted}, 길이 초과 ${stats.overruns}, 영향 지움 ${stats.impactDrops}, 해설 지움 ${stats.explainDrops}, 글머리표 지움 ${stats.lensDrops}`,
  ].slice(0, BRIEFING.SUB_LOG_MAX_LINES);
  const result = { generator, items, stats, log };
  writeJson(path.join(dir, 'result.json'), result);

  const urlDropTotal = Object.values(urlDrops).reduce((a, b) => a + b, 0);
  // 후보 출처 중 이 환경에서 받아진 것 — 수집 목록 문서의 disabled에서 이 이름들을 지우면 켜진다 (C)
  const doc = parseSourcesDoc(JSON.stringify(ins.sources));
  const failed = new Set(cands.stats.failedSources);
  const candidateNames = new Set(CANDIDATE_FEEDS.map((f) => f.name));
  const triedCandidates = doc.feeds.filter((f) => candidateNames.has(f.name) && !doc.disabled.includes(f.name));
  const okCandidates = triedCandidates.filter((f) => !failed.has(f.name)).map((f) => f.name);
  const candidateLine = triedCandidates.length ? `후보 출처 ${triedCandidates.length}곳 중 받아진 곳 ${okCandidates.length}곳: ${okCandidates.join(', ') || '없음'}` : '';
  const head = [
    `실린 기사 ${items.length}건 (핵심 ${byImportance[0]} · 주요 ${byImportance[1]} · 참고 ${byImportance[2]}), 싣지 않은 것 ${counters.skipped}건`,
    `주소 검사에서 걸린 주소 ${urlDropTotal}개${urlDropTotal ? ` (${Object.entries(urlDrops).map(([k, v]) => `${k} ${v}`).join(', ')}) — 서버는 그 기사를 뺀다. 전체의 ${BRIEFING.SUB_DROP_REJECT_RATIO * 100}%를 넘으면 통째로 거절된다` : ''}`,
    `result.json 크기 ${(Buffer.byteLength(JSON.stringify(result), 'utf8') / 1024).toFixed(0)}KB (상한 ${BRIEFING.SUB_RESULT_MAX_BYTES / 1024 / 1024}MB)`,
    candidateLine,
    '',
  ];
  writeText(path.join(dir, 'verify-report.txt'), [...head, ...report].join('\n'));
  console.log(head.join('\n'));
  console.log(`→ ${path.join(dir, 'result.json')} · 상세는 verify-report.txt (${report.length}줄)`);
}

async function main(): Promise<void> {
  if (cmd === 'rules') return cmdRules();
  if (!dirArg) throw new Error('작업 폴더를 지정하세요 — 예: npm run briefing:job -w server -- collect .briefing-job');
  // `npm run -w server`는 작업 폴더를 server/로 바꾼다 — 명령을 친 곳(INIT_CWD, 보통 저장소 루트) 기준으로 풀어야
  // 스킬의 `.briefing-job`이 루트에 생긴다. 1회 시험에서 server/.briefing-job에 생겨 커밋 경로가 어긋났다 (2026-10-30)
  const dir = path.resolve(process.env.INIT_CWD ?? process.cwd(), dirArg);
  switch (cmd) {
    case 'instruction':
      return cmdInstruction(dir);
    case 'collect':
      return cmdCollect(dir);
    case 'group':
      return cmdGroup(dir);
    case 'read':
      return cmdRead(dir);
    case 'webfill':
      return cmdWebfill(dir);
    case 'verify':
      return cmdVerify(dir);
    default:
      throw new Error(`모르는 명령 "${cmd}" — rules · instruction · collect · group · read · webfill · verify 중 하나`);
  }
}

main().catch((e: unknown) => {
  console.error(`실패: ${e instanceof Error ? e.message : String(e)}`);
  process.exit(1);
});
