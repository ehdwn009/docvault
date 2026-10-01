import { and, eq, isNull } from 'drizzle-orm';
import { BRIEFING } from '../../constants.js';
import { db } from '../../db/index.js';
import { files } from '../../db/schema.js';
import type { DbOrTx } from '../content.js';
import { basisOf } from './body.js';
import { costOf, type Usage } from './ai.js';
import { uniqueFileName } from '../naming.js';
import type { PrevStory, Picked } from './select.js';
import { briefingFolderId, findOrCreateFolder } from './sources.js';
import type { Written } from './summarize.js';
import { categoriesOf, SECTIONS, type BriefingSection } from './taxonomy.js';
import { kstParts } from './time.js';

// 회차 JSON — 회차 하나 = 문서 하나의 본문 (뉴스 브리핑 설계 "회차 JSON (version 1)").
// 저장하는 것은 새로 쓴 제목·요약·의미, 언론사 이름, 원문 링크뿐이다. RSS 발췌는 여기 들어오지 않는다

export type Slot = 'morning' | 'noon' | 'evening' | 'adhoc';

export type EditionItem = {
  id: string;
  title: string;
  summary: string;
  why: string;
  importance: 1 | 2 | 3;
  source: string;
  url: string;
  publishedAt: number;
  storyId: string;
  status: 'new' | 'updated';
  related: { source: string; url: string }[];
  /** 요약의 근거 — body(원문 앞부분) · lede(발췌) · title(제목뿐). v0.43부터, 옛 회차에는 없다 */
  basis?: 'body' | 'lede' | 'title';
};

export type Edition = {
  version: number;
  edition: { date: string; slot: Slot; label: string; since: number; until: number; createdAt: number };
  stats: { sources: number; sourcesFailed: number; candidates: number; items: number };
  cost: { usd: number; haiku: { input: number; output: number }; sonnet: { input: number; output: number } };
  sections: {
    section: BriefingSection;
    categories: { name: string; subs: { id: string; name: string; items: EditionItem[] }[] }[];
  }[];
};

const SLOT_LABEL: Record<Exclude<Slot, 'adhoc'>, string> = { morning: '아침', noon: '점심', evening: '저녁' };

/** 회차 이름표 — 정기판은 "저녁", 수시판은 만든 시각 "14시 23분" */
export function slotLabel(slot: Slot, createdAt: number): string {
  if (slot !== 'adhoc') return SLOT_LABEL[slot];
  const { hour, minute } = kstParts(createdAt);
  return `${hour}시 ${String(minute).padStart(2, '0')}분`;
}

/** 파일 이름 — 폴더 밖(검색 결과·탭·최근 열람)에서 이름만 보여도 무엇인지 알게 "뉴스 브리핑"을 다시 넣는다 */
export function editionFileName(date: string, label: string): string {
  return `${BRIEFING.FOLDER_NAME} ${date} ${label}.json`;
}

export function assembleEdition(args: {
  picked: Picked[];
  written: Map<number, Written>;
  bodies: Map<number, string>;
  slot: Slot;
  since: number;
  until: number;
  createdAt: number;
  stats: { sources: number; sourcesFailed: number; candidates: number };
  usage: Usage;
}): Edition {
  const { date } = kstParts(args.createdAt);
  const counter = new Map<string, number>();
  const bySub = new Map<string, EditionItem[]>();

  args.picked.forEach((p, i) => {
    const text = p.importance >= 2 ? args.written.get(i) : p.brief;
    // 핵심·주요인데 요약을 못 받았으면 싣지 않는다 — 원문 제목만 덩그러니 두지 않는다
    if (!text) return;
    const n = (counter.get(p.sub.id) ?? 0) + 1;
    counter.set(p.sub.id, n);
    const id = `${p.sub.id}.${String(n).padStart(3, '0')}`;
    const item: EditionItem = {
      id,
      title: text.title,
      summary: text.summary,
      why: text.why,
      importance: p.importance,
      source: p.main.source,
      url: p.main.url,
      publishedAt: p.main.publishedAt,
      // 이어받은 이슈는 직전 id 그대로 — 다음 회차·2차 이슈 타임라인이 같은 열쇠로 묶는다
      storyId: p.prevStoryId ?? `${p.sub.id}.${date}.${args.slot}.${n}`,
      status: p.prevStoryId ? 'updated' : 'new',
      basis: basisOf(p, args.bodies.has(i)),
      related: [...p.related.map((r) => ({ source: r.source, url: r.url })), ...p.main.related].filter(
        (r, j, arr) => r.url !== p.main.url && arr.findIndex((x) => x.url === r.url) === j,
      ).slice(0, BRIEFING.MAX_RELATED),
    };
    bySub.set(p.sub.id, [...(bySub.get(p.sub.id) ?? []), item]);
  });

  let total = 0;
  const sections = SECTIONS.map((section) => ({
    section,
    categories: categoriesOf(section)
      .map((cat) => ({
        name: cat.name,
        subs: cat.subs
          .map((s) => ({
            id: s.id,
            name: s.name,
            // 중요한 것부터, 같은 중요도면 최신부터
            items: (bySub.get(s.id) ?? []).sort((a, b) => b.importance - a.importance || b.publishedAt - a.publishedAt),
          }))
          .filter((s) => s.items.length > 0),
      }))
      .filter((c) => c.subs.length > 0),
  })).filter((s) => s.categories.length > 0);
  for (const s of sections) for (const c of s.categories) for (const sub of c.subs) total += sub.items.length;

  return {
    version: BRIEFING.EDITION_VERSION,
    edition: { date, slot: args.slot, label: slotLabel(args.slot, args.createdAt), since: args.since, until: args.until, createdAt: args.createdAt },
    stats: { ...args.stats, items: total },
    cost: {
      usd: costOf(args.usage),
      haiku: { input: args.usage.haikuInput, output: args.usage.haikuOutput },
      sonnet: { input: args.usage.sonnetInput, output: args.usage.sonnetOutput },
    },
    sections,
  };
}

/** 직전 회차에서 다음 회차가 쓰는 것 — 분야별 이슈 목록(updated 판정)과 이미 실린 링크(중복 제외).
    문서를 지웠거나 깨졌으면 빈 값 — 범위는 실행 기록에서 계산하므로 흔들리지 않는다 */
export function readPrevious(fileId: number | null): { storiesBySub: Map<string, PrevStory[]>; urls: Set<string> } {
  const storiesBySub = new Map<string, PrevStory[]>();
  const urls = new Set<string>();
  if (fileId === null) return { storiesBySub, urls };
  const row = db.select({ contentText: files.contentText }).from(files).where(and(eq(files.id, fileId), isNull(files.deletedAt))).get();
  if (!row?.contentText) return { storiesBySub, urls };
  try {
    const prev = JSON.parse(row.contentText) as Edition;
    for (const s of prev.sections ?? []) {
      for (const c of s.categories ?? []) {
        for (const sub of c.subs ?? []) {
          storiesBySub.set(sub.id, (sub.items ?? []).map((it) => ({ storyId: it.storyId, title: it.title })));
          for (const it of sub.items ?? []) {
            urls.add(it.url);
            for (const r of it.related ?? []) urls.add(r.url);
          }
        }
      }
    }
  } catch {
    // 깨진 회차는 없는 것으로 친다
  }
  return { storiesBySub, urls };
}

/** 회차를 "뉴스 브리핑/YYYY-MM/"에 문서 하나로 저장한다. 폴더는 없으면 만든다. 이름이 겹치면 (2).
    tx를 받는 이유: 실행 기록을 ok로 바꾸는 일과 한 트랜잭션이어야 한다 — 파일만 생기고 기록이 running으로 남으면 안 된다 */
export function saveEdition(tx: DbOrTx, ownerId: number, edition: Edition): { fileId: number; name: string } {
  const root = briefingFolderId(tx, ownerId);
  const monthFolder = findOrCreateFolder(tx, ownerId, root, edition.edition.date.slice(0, 7));
  const taken = new Set(
    tx
      .select({ name: files.name })
      .from(files)
      .where(and(eq(files.ownerId, ownerId), eq(files.folderId, monthFolder), isNull(files.deletedAt)))
      .all()
      .map((r) => r.name),
  );
  const name = uniqueFileName(editionFileName(edition.edition.date, edition.edition.label), (n) => taken.has(n));
  const content = JSON.stringify(edition);
  const now = Date.now();
  const row = tx
    .insert(files)
    .values({
      ownerId,
      folderId: monthFolder,
      name,
      fileType: 'code',
      mimeType: 'text/plain',
      sizeBytes: Buffer.byteLength(content, 'utf8'),
      contentText: content,
      storagePath: null,
      kind: 'briefing',
      createdAt: now,
      updatedAt: now,
    })
    .returning({ id: files.id })
    .get();
  return { fileId: row.id, name };
}
