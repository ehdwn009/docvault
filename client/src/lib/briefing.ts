// 뉴스 브리핑 — 회차 JSON의 모양(서버 lib/briefing/edition.ts와 같아야 한다)과 패널이 쓰는 API 응답 모양.
// 설계: docs/design/뉴스브리핑_docvault_20261001.md

/** 서버 BRIEFING.EDITION_VERSION과 같아야 한다 — 모르는 버전이면 코드 뷰어로 연다 */
export const BRIEFING_EDITION_VERSION = 1;
/** 오늘의 핵심 기사 수 — 서버 BRIEFING.LEAD_COUNT와 같아야 한다 (옛 회차는 화면이 계산한다) */
export const BRIEFING_LEAD_COUNT = 6;
/** 오늘의 핵심 중 세계 몫 — 서버 BRIEFING.LEAD_WORLD_MIN과 같아야 한다 */
export const BRIEFING_LEAD_WORLD_MIN = 2;
/** 회차 화면에서 기사를 읽었다 — 패널이 듣고 읽음 상태를 다시 받는다 */
export const BRIEFING_READ_EVENT = 'dv:briefing-read';
/** 브리핑 폴더·수집 목록 문서 이름 — 서버 BRIEFING.FOLDER_NAME·SOURCES_FILE_NAME과 같아야 한다 */
export const BRIEFING_FOLDER_NAME = '뉴스 브리핑';
export const BRIEFING_SOURCES_FILE_NAME = '수집 목록.json';
/** 실행 중 상태를 다시 읽는 주기 — 서버 BRIEFING.STATUS_POLL_MS와 같은 값 */
export const BRIEFING_STATUS_POLL_MS = 2000;
/** 구독 실행(예약 작업이 일하는 중)은 한두 시간 돌고 진행 보고도 단계마다 한 줄이라 2초는 과하다 — 15초 (v0.50) */
export const BRIEFING_REMOTE_POLL_MS = 15_000;
/** [연결 확인] 결과를 다시 읽는 주기와 기다리는 한도 — 서버 SUB_PING_NO_REQUEST_MS(5분) 뒤에는 "아직 연결 기록 없음"으로 굳는다 */
export const BRIEFING_PING_POLL_MS = 5000;
export const BRIEFING_PING_WAIT_MS = 6 * 60 * 1000;

export type Importance = 1 | 2 | 3;

/** 골라 쓰는 칸 — 서버 summarize.ts의 Block과 같아야 한다 (v0.45) */
export type BlockKind = 'background' | 'numbers' | 'timeline' | 'reactions' | 'next' | 'terms';
export type Block = { kind: BlockKind; text?: string; pairs?: { label: string; value: string }[]; items?: { date: string; text: string }[]; from: string[] };
export type Sides = { kind: 'dispute' | 'emphasis'; items: { label: string; text: string; from: string }[] };
/** 글머리표. easy·w5는 v0.45 회차에만 남아 있다 — "쉽게"는 v0.46에서 내렸고(화면에 안 보인다), 옛 w5는 근거 없는 글자 모양 */
export type Lenses = { bullets?: string[]; easy?: string; w5?: { who: string; what: string; when: string; where: string; why: string } };
/** 5W(v0.46) — 원문을 읽은 요약 호출이 쓴 것, 칸마다 근거 기호. 없는 칸은 "기사에 없음" */
export type W5Field = { text: string; from: string[] };
export type W5 = { who?: W5Field; what?: W5Field; when?: W5Field; where?: W5Field; why?: W5Field };
export const W5_KEYS = ['who', 'what', 'when', 'where', 'why'] as const;
export const W5_LABEL: Record<(typeof W5_KEYS)[number], string> = { who: '누가', what: '무엇을', when: '언제', where: '어디서', why: '왜' };
/** 영향 줄(v0.46) — stated: 기사가 말한 것(낱말 붙음) · inferred: AI가 짚은 것("AI 추론") */
export type ImpactLine = { target: string; direction: 'up' | 'down' | 'mixed' | 'unclear'; kind: 'stated' | 'inferred'; text: string; from: string };
export const IMPACT_WORD: Record<ImpactLine['direction'], string> = { up: '기회', down: '부담', mixed: '갈림', unclear: '' };
/** 해설 상자(v0.48, 해설 칸 토론) — 서버 summarize.ts의 ExplainBlock과 같아야 한다. basis: stated(기사가 말함) · inferred(재료에서 AI가 짚음) · outside(기사 밖 지식) */
export type ExplainKind = 'terms' | 'why' | 'effect' | 'watch';
export type ExplainBlock = { kind: ExplainKind; text?: string; items?: { term: string; text: string }[]; from: string[]; basis: 'stated' | 'inferred' | 'outside' };
export const EXPLAIN_LABEL: Record<ExplainKind, string> = { terms: '말뜻', why: '왜 이렇게 됐나', effect: '그래서 어떻게 되나', watch: '다음에 볼 것' };
export type ItemSource = { id: string; source: string; url: string; via: 'body' | 'feed' | 'lede' | 'web' };

export type EditionItem = {
  id: string;
  title: string;
  summary: string;
  why: string;
  importance: Importance;
  source: string;
  url: string;
  publishedAt: number;
  storyId: string;
  status: 'new' | 'updated';
  related: { source: string; url: string }[];
  /** 요약의 근거 — body(원문·피드 본문) · lede(발췌) · title(제목뿐) · web(웹 검색 보도). 옛 회차에는 없다 */
  basis?: 'body' | 'lede' | 'title' | 'web';
  /** 이 사건을 다룬 서로 다른 언론사 수(대표 포함). 옛 회차에는 없다 — outletsOf로 센다 */
  outlets?: number;
  /** v0.43의 펼침 칸 — v0.45부터는 blocks. 옛 회차용 */
  detail?: { background: string; numbers: string; next: string };
  // ---- v0.45 (개선 합의안 5.1) — 모두 없어도 되는 칸 ----
  originalTitle?: string;
  sources?: ItemSource[];
  summaryFrom?: string[];
  whyFrom?: string[];
  blocks?: Block[];
  sides?: Sides;
  lenses?: Lenses;
  // ---- v0.46 ----
  w5?: W5;
  impact?: ImpactLine[];
  // ---- v0.48 ----
  explain?: ExplainBlock[];
  /** 앱 안 원문으로 받을 주소가 있다 — 회차를 만들 때 본문 받기에 성공한 기사 */
  readUrl?: string;
  changed?: string;
  /** 재료가 없어 제목만 실은 참고 — 누르면 펼치지 않고 바로 원문으로 */
  titleOnly?: boolean;
};

/** 요약 보기 — 기본·글머리표·5W·양쪽 시각 (v0.45, v0.46에서 "쉽게" 제거). 기기가 마지막 선택을 기억한다 */
export type LensKey = 'base' | 'bullets' | 'w5' | 'sides';
export const LENS_LABEL: Record<LensKey, string> = { base: '기본', bullets: '글머리표', w5: '5W', sides: '양쪽 시각' };
export const BLOCK_LABEL: Record<BlockKind, string> = { background: '배경', numbers: '숫자', timeline: '경과', reactions: '반응', next: '앞으로', terms: '용어' };

/** API-138 앱 안 원문 */
export type ReaderResult = { title: string; byline: string | null; source: string; url: string; paragraphs: string[] };
export type FlagReason = 'number' | 'mixed' | 'overstated' | 'impact' | 'explain' | 'other';
export const FLAG_LABEL: Record<FlagReason, string> = { number: '숫자가 틀림', mixed: '다른 사건이 섞임', overstated: '제목이 과장됨', impact: '영향 판단이 이상함', explain: '해설이 이상함', other: '기타' };

export type Edition = {
  version: number;
  edition: { date: string; slot: 'morning' | 'noon' | 'evening' | 'adhoc'; label: string; since: number; until: number; createdAt: number };
  stats: { sources: number; sourcesFailed: number; candidates: number; items: number; basis?: { body: number; lede: number; title: number; web: number }; webFilled?: number; demoted?: number };
  cost: { usd: number };
  /** 영향 칸을 그리나 (v0.46). 없으면(옛 회차) 그리지 않는다 */
  impactVisible?: boolean;
  /** 해설 상자를 그리나 (v0.48) */
  explainVisible?: boolean;
  /** 오늘의 핵심 기사 id. v0.43부터 — 없으면 leadIdsOf로 계산한다 */
  lead?: string[];
  sections: { section: '국내' | '세계'; categories: { name: string; subs: { id: string; name: string; items: EditionItem[] }[] }[] }[];
};

/** 본문 → 회차. 형식이 아니면 null — 뷰어가 코드로 보여 준다 */
export function parseEdition(content: string): Edition | null {
  try {
    const e = JSON.parse(content) as Partial<Edition>;
    if (e.version !== BRIEFING_EDITION_VERSION || !e.edition || !Array.isArray(e.sections)) return null;
    for (const s of e.sections) {
      if (!Array.isArray(s.categories)) return null;
      for (const c of s.categories) {
        if (!Array.isArray(c.subs)) return null;
        for (const sub of c.subs) if (!Array.isArray(sub.items)) return null;
      }
    }
    return e as Edition;
  } catch {
    return null;
  }
}

/** 링크로 만들어도 되는 주소인가 — javascript: 같은 주소는 글자로만 둔다 (설계 — 보안 XSS) */
export function isSafeUrl(url: string): boolean {
  return /^https?:\/\//i.test(url);
}

const KST_OFFSET_MS = 9 * 60 * 60 * 1000;

/** 한국시간 "10/1 15:40" — 브리핑은 한국 뉴스 기준이라 기기 시간대와 상관없이 한국시간으로 보여 준다 */
export function kstTime(ms: number, withDate = true): string {
  const d = new Date(ms + KST_OFFSET_MS);
  const hm = `${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}`;
  return withDate ? `${d.getUTCMonth() + 1}/${d.getUTCDate()} ${hm}` : hm;
}

const WEEKDAY = ['일', '월', '화', '수', '목', '금', '토'];
type Slot = Edition['edition']['slot'];

/** "2026-10-01" → { m: 10, d: 1, wd: '수' } — 날짜 글자만으로 계산해 기기 시간대와 상관없다 */
function dateParts(date: string): { m: number; d: number; wd: string } {
  const [y = 0, m = 1, d = 1] = date.split('-').map(Number);
  return { m, d, wd: WEEKDAY[new Date(Date.UTC(y, m - 1, d)).getUTCDay()] ?? '' };
}

/** 회차 이름 — 정기판 "저녁판", 수시판 "14:53 수시판" (서버 label은 "저녁" · "14시 53분") */
export function slotName(slot: Slot, label: string): string {
  if (slot !== 'adhoc') return `${label}판`;
  const m = /(\d+)시 (\d+)분/.exec(label);
  return m ? `${m[1]!.padStart(2, '0')}:${m[2]} 수시판` : `${label} 수시판`;
}

/** 칩에 들어가는 짧은 이름 — 아침·점심·저녁·수시 */
export const SLOT_SHORT: Record<Slot, string> = { morning: '아침', noon: '점심', evening: '저녁', adhoc: '수시' };

/** "9/30 (화)" */
export function shortDate(date: string): string {
  const { m, d, wd } = dateParts(date);
  return `${m}/${d} (${wd})`;
}

/** "10월 1일 (수)" */
export function longDate(date: string): string {
  const { m, d, wd } = dateParts(date);
  return `${m}월 ${d}일 (${wd})`;
}

/** 탭·머리·검색 결과에 보이는 이름 "10/1 (수) 저녁판" */
export function editionDisplayName(date: string, slot: Slot, label: string): string {
  return `${shortDate(date)} ${slotName(slot, label)}`;
}

/** 파일 이름("뉴스 브리핑 2026-10-01 저녁.json")에서 화면 이름을 만든다 — 회차 JSON을 열기 전(탭·검색 결과)에 쓴다.
    이름이 규칙에서 벗어나면(사용자가 바꿈) null — 이름을 그대로 보인다 */
export function briefingNameFromFile(name: string): string | null {
  const m = /(\d{4}-\d{2}-\d{2}) (.+?)(?: \(\d+\))?\.json$/.exec(name);
  if (!m) return null;
  const label = m[2]!;
  const slot = (Object.entries(SLOT_SHORT).find(([, v]) => v === label)?.[0] as Slot | undefined) ?? 'adhoc';
  return editionDisplayName(m[1]!, slot, label);
}

/** 화면에 보일 파일 이름 — 브리핑 회차만 "10/1 (수) 저녁판", 나머지는 이름 그대로 (탭·뷰어 머리·검색 결과) */
export function fileLabel(f: { name: string; kind?: string }): string {
  return f.kind === 'briefing' ? (briefingNameFromFile(f.name) ?? f.name) : f.name;
}

/** 포털 재게재 주소 — 서버 collect.ts의 AGGREGATORS와 같아야 한다 */
const AGGREGATORS = new Set(['v.daum.net', 'news.v.daum.net', 'n.news.naver.com', 'news.naver.com', 'm.news.naver.com']);

/** 이 사건을 다룬 서로 다른 언론사 수(대표 포함). 옛 회차는 related에 같은 언론사가 겹쳐 있어 직접 센다 */
export function outletsOf(it: EditionItem): number {
  if (it.outlets !== undefined) return it.outlets;
  const main = it.source.trim().toLowerCase();
  return 1 + new Set((it.related ?? []).map((r) => r.source.trim().toLowerCase()).filter((s) => s !== main && !AGGREGATORS.has(s))).size;
}

/** 오늘의 핵심 — 서버 leadIdsOf와 같은 규칙(lead가 없는 옛 회차용): 핵심(3)을 언론사 수 많은 순, 같으면 최신순.
    세계 핵심이 있으면 최소 BRIEFING_LEAD_WORLD_MIN자리는 세계에 */
export function leadIdsOf(e: Edition): string[] {
  if (e.lead) return e.lead;
  const top: { it: EditionItem; world: boolean }[] = [];
  for (const s of e.sections) for (const c of s.categories) for (const sub of c.subs) for (const it of sub.items) if (it.importance === 3) top.push({ it, world: s.section === '세계' });
  const ranked = top.sort((a, b) => outletsOf(b.it) - outletsOf(a.it) || b.it.publishedAt - a.it.publishedAt);
  const world = ranked.filter((x) => x.world).slice(0, BRIEFING_LEAD_WORLD_MIN);
  const rest = ranked.filter((x) => !world.includes(x)).slice(0, Math.max(0, BRIEFING_LEAD_COUNT - world.length));
  const chosen = new Set([...world, ...rest]);
  return ranked.filter((x) => chosen.has(x)).map((x) => x.it.id);
}

/** 한국시간 몇 시 */
export function kstHour(ms: number): number {
  return new Date(ms + KST_OFFSET_MS).getUTCHours();
}

/** 한국시간 오늘 "YYYY-MM-DD" */
export function kstToday(now = Date.now()): string {
  return new Date(now + KST_OFFSET_MS).toISOString().slice(0, 10);
}

// ---- 패널(SCR-190) API 응답 ----

/** 구독 실행의 세부 단계 — 예약 작업이 진행 보고(API-152)로 알린 것. 서버 live.ts의 RemoteStage와 같아야 한다 (v0.50) */
export type RemoteStage = 'collect' | 'classify' | 'select' | 'read' | 'fill' | 'summarize' | 'lens' | 'verify';

export type BriefingRun = {
  id: number;
  /** subscription = 서버가 켠 claude.ai 예약 작업이 만든 회차 (v0.50) */
  trigger: 'manual' | 'auto' | 'subscription';
  slot: Edition['edition']['slot'];
  editionDate: string;
  /** missing = 구독 실행이 마감까지 안 옴 (v0.50) */
  status: 'running' | 'ok' | 'error' | 'skipped' | 'cancelled' | 'missing';
  /** remote = 예약 작업이 일하는 중 — 세부 단계는 live.remote에 (v0.50) */
  stage: 'collect' | 'classify' | 'select' | 'read' | 'fill' | 'summarize' | 'lens' | 'save' | 'remote' | null;
  progressDone: number;
  progressTotal: number;
  sinceAt: number;
  untilAt: number;
  fileId: number | null;
  fileName: string | null;
  sourceCount: number;
  failedSources: string[];
  candidateCount: number;
  itemCount: number | null;
  costUsd: number;
  /** 웹 검색 보강에서 쓴 검색 횟수 (v0.45) */
  webSearches?: number;
  message: string | null;
  startedAt: number;
  finishedAt: number | null;
  // ---- 구독 실행 (v0.50) — 다른 실행은 null ----
  jobId?: string | null;
  /** 마감(회차 시작 + 30분) — 지나면 missing */
  deadlineAt?: number | null;
  /** 예약 작업이 지시서를 받아 간 시각 — 걸린 시간의 시작점 */
  remoteStartedAt?: number | null;
  /** 완성본 검사에서 뺀 기사 수 {이유: 수} */
  droppedItems?: Record<string, number> | null;
  generator?: { mode?: string; config?: string; models?: string[]; skillVersion?: string } | null;
  /** 도는 중일 때만 — 진행 기록과 오래 기다리는 출처(8초 이상). 끝난 실행은 null (API-131, 2026-10-02). remote는 구독 실행의 세부 단계 */
  live?: { log: { at: number; text: string }[]; waiting: { name: string; seconds: number }[]; remote?: { stage: RemoteStage | null; done: number; total: number } } | null;
};

export type BriefingMode = 'api' | 'subscription';
/** API-131의 subscription — 구독 모드일 때만 온다 */
export type SubscriptionStatus = {
  tokenPrefix: string | null;
  tokenLastUsedAt: number | null;
  triggerSet: boolean;
  /** 트리거를 저장했지만 읽을 수 없다(서버 비밀키 변경) — "다시 넣어 주세요" */
  triggerBroken: boolean;
  lastPingAt: number | null;
  /** 오늘 받지 못한 구독 회차 — 마감까지 안 옴(missing) 또는 예약 작업을 켜지 못함(error), 아직 대체되지 않은 것만. 패널의 알림 띠 */
  missing: { runId: number; slot: Slot; deadlineAt: number | null; status: 'missing' | 'error'; message: string | null } | null;
};
export type PingResult = 'fired' | 'ok' | 'trigger_failed' | 'token_invalid' | 'no_request';
/** API-143 — 설정 화면의 구독 상태 */
export type SubscriptionInfo = {
  mode: BriefingMode;
  tokenPrefix: string | null;
  tokenCreatedAt: number | null;
  tokenLastUsedAt: number | null;
  triggerSet: boolean;
  triggerBroken: boolean;
  lastPingAt: number | null;
  lastPingResult: PingResult | null;
  leadMs: number;
  deadlineAfterMs: number;
  /** 켜 둔 회차마다 예약 작업을 켜는 시각 "05:00" */
  triggerTimes: Partial<Record<AutoSlot, string>>;
  recent: { ok: number; missing: number; error: number; avgMinutes: number | null; hint: 'later' | 'earlier' | null };
  allowedDomains: string[];
  checklist: { docvaultUrl: string; envNames: string[]; taskPrompt: string };
};

export type AutoSlot = 'morning' | 'noon' | 'evening';
/** 자동 생성 회차별 켜기·시작 시각("06:30", 한국시간) — v0.43 */
export type AutoSchedule = Record<AutoSlot, { on: boolean; at: string }>;

export type BriefingStatus = {
  configured: boolean;
  autoEnabled: boolean;
  schedule: AutoSchedule;
  nextAutoAt: number | null;
  /** 다음 자동 회차 — 시각으로 짐작하지 않는다(사람마다 시각이 다르다) */
  nextAutoSlot: AutoSlot | null;
  running: BriefingRun | null;
  last: BriefingRun | null;
  monthCostUsd: number;
  monthBudgetUsd: number;
  /** 한도의 이 비율에 닿으면 미리 알린다 (v0.45) */
  budgetWarnRatio?: number;
  /** 지금 만들면 모을 기사의 시작 시각 */
  nextSinceAt: number;
  /** 앱 안 원문 보기 스위치 (v0.45, 설정에서 켠다) */
  readerEnabled?: boolean;
  /** 이번 달 "틀린 곳 알리기" 수 (v0.45) */
  monthFlagCount?: number;
  /** 회차를 누가 만드나 — api(앱이 직접) · subscription(서버가 켠 claude.ai 예약 작업) (v0.50) */
  mode?: BriefingMode;
  subscription?: SubscriptionStatus | null;
};

/** API-135 회차 목록 한 줄 */
export type EditionSummary = {
  fileId: number;
  editionDate: string;
  slot: Slot;
  label: string;
  createdAt: number;
  itemCount: number;
  leadCount: number;
  leadRead: number;
  readCount: number;
  state: 'unread' | 'partial' | 'done';
};

/** API-136 */
export type EditionNav = { prevId: number | null; nextId: number | null; sameDay: { fileId: number; slot: Slot; label: string }[] };

export const STAGE_ORDER = ['collect', 'classify', 'select', 'read', 'fill', 'summarize', 'lens', 'save'] as const;

export const STAGE_LABEL: Record<NonNullable<BriefingRun['stage']>, string> = {
  collect: '수집',
  classify: '분류',
  select: '선별',
  read: '원문 읽기',
  fill: '웹 검색',
  summarize: '요약',
  lens: '보기 쓰기',
  save: '저장',
  remote: '예약 작업',
};

/** 구독 실행의 세부 단계 순서와 이름 — 예약 작업이 보고하는 단계(서버 단계와 달리 저장이 없고 검수가 있다) */
export const REMOTE_STAGE_ORDER: readonly RemoteStage[] = ['collect', 'classify', 'select', 'read', 'fill', 'summarize', 'lens', 'verify'];
export const REMOTE_STAGE_LABEL: Record<RemoteStage, string> = { collect: '수집', classify: '분류', select: '선별', read: '원문 읽기', fill: '웹 검색', summarize: '요약', lens: '보기 쓰기', verify: '검수' };

/** 설정 화면의 [연결 확인] 결과 다섯 상태 (IA SCR-147) */
export const PING_LABEL: Record<PingResult, string> = {
  fired: '켰어요 — 세션을 기다리는 중',
  ok: '연결 확인됨',
  trigger_failed: '예약 작업을 켜지 못했어요 — 트리거 주소·토큰을 확인하세요',
  token_invalid: '연결 열쇠가 맞지 않습니다',
  no_request: '아직 연결 기록 없음 — 세션이 docvault를 부르지 않았어요 (네트워크 허용 목록·환경변수를 확인)',
};
