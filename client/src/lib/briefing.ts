// 뉴스 브리핑 — 회차 JSON의 모양(서버 lib/briefing/edition.ts와 같아야 한다)과 패널이 쓰는 API 응답 모양.
// 설계: docs/design/뉴스브리핑_docvault_20261001.md

/** 서버 BRIEFING.EDITION_VERSION과 같아야 한다 — 모르는 버전이면 코드 뷰어로 연다 */
export const BRIEFING_EDITION_VERSION = 1;
/** 오늘의 핵심 기사 수 — 서버 BRIEFING.LEAD_COUNT와 같아야 한다 (옛 회차는 화면이 계산한다) */
export const BRIEFING_LEAD_COUNT = 6;
/** 회차 화면에서 기사를 읽었다 — 패널이 듣고 읽음 상태를 다시 받는다 */
export const BRIEFING_READ_EVENT = 'dv:briefing-read';
/** 브리핑 폴더·수집 목록 문서 이름 — 서버 BRIEFING.FOLDER_NAME·SOURCES_FILE_NAME과 같아야 한다 */
export const BRIEFING_FOLDER_NAME = '뉴스 브리핑';
export const BRIEFING_SOURCES_FILE_NAME = '수집 목록.json';
/** 실행 중 상태를 다시 읽는 주기 — 서버 BRIEFING.STATUS_POLL_MS와 같은 값 */
export const BRIEFING_STATUS_POLL_MS = 2000;

export type Importance = 1 | 2 | 3;

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
  /** 요약의 근거 — body(원문 앞부분) · lede(발췌) · title(제목뿐). 옛 회차에는 없다 */
  basis?: 'body' | 'lede' | 'title';
};

export type Edition = {
  version: number;
  edition: { date: string; slot: 'morning' | 'noon' | 'evening' | 'adhoc'; label: string; since: number; until: number; createdAt: number };
  stats: { sources: number; sourcesFailed: number; candidates: number; items: number };
  cost: { usd: number };
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

/** 오늘의 핵심 — 핵심(3) 기사를 다룬 언론사 수(대표 1 + 다른 보도) 많은 순, 같으면 최신순.
    서버 leadIdsOf와 같은 규칙 — lead가 없는 옛 회차용 */
export function leadIdsOf(e: Edition): string[] {
  if (e.lead) return e.lead;
  const top: EditionItem[] = [];
  for (const s of e.sections) for (const c of s.categories) for (const sub of c.subs) for (const it of sub.items) if (it.importance === 3) top.push(it);
  return top
    .sort((a, b) => (b.related?.length ?? 0) - (a.related?.length ?? 0) || b.publishedAt - a.publishedAt)
    .slice(0, BRIEFING_LEAD_COUNT)
    .map((it) => it.id);
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

export type BriefingRun = {
  id: number;
  trigger: 'manual' | 'auto';
  slot: Edition['edition']['slot'];
  editionDate: string;
  status: 'running' | 'ok' | 'error' | 'skipped';
  stage: 'collect' | 'classify' | 'select' | 'read' | 'summarize' | 'save' | null;
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
  message: string | null;
  startedAt: number;
  finishedAt: number | null;
};

export type BriefingStatus = {
  configured: boolean;
  autoEnabled: boolean;
  nextAutoAt: number | null;
  running: BriefingRun | null;
  last: BriefingRun | null;
  monthCostUsd: number;
  monthBudgetUsd: number;
  /** 지금 만들면 모을 기사의 시작 시각 */
  nextSinceAt: number;
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

export const STAGE_ORDER = ['collect', 'classify', 'select', 'read', 'summarize', 'save'] as const;

export const STAGE_LABEL: Record<NonNullable<BriefingRun['stage']>, string> = {
  collect: '수집',
  classify: '분류',
  select: '선별',
  read: '원문 읽기',
  summarize: '요약',
  save: '저장',
};
