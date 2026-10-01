// 뉴스 브리핑 — 회차 JSON의 모양(서버 lib/briefing/edition.ts와 같아야 한다)과 패널이 쓰는 API 응답 모양.
// 설계: docs/design/뉴스브리핑_docvault_20261001.md

/** 서버 BRIEFING.EDITION_VERSION과 같아야 한다 — 모르는 버전이면 코드 뷰어로 연다 */
export const BRIEFING_EDITION_VERSION = 1;
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

/** "10월 1일 저녁판" */
export function editionTitle(e: Edition): string {
  const [, m, d] = e.edition.date.split('-').map(Number);
  return `${m}월 ${d}일 ${e.edition.label}${e.edition.slot === 'adhoc' ? ' 수시판' : '판'}`;
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
  recent: { fileId: number; name: string; slot: BriefingRun['slot']; editionDate: string; itemCount: number; costUsd: number }[];
};

export const STAGE_LABEL: Record<NonNullable<BriefingRun['stage']>, string> = {
  collect: '수집',
  classify: '분류',
  select: '선별',
  read: '원문 읽기',
  summarize: '요약',
  save: '저장',
};
