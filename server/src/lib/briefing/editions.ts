import { and, desc, eq, isNull } from 'drizzle-orm';
import { BRIEFING } from '../../constants.js';
import { db } from '../../db/index.js';
import { briefingRuns, files, userFileState } from '../../db/schema.js';
import { leadIdsOf, slotLabel, type Edition, type Slot } from './edition.js';
import { parseIdList } from './readItems.js';
import { kstParts } from './time.js';

// 회차 목록·이동 — 브리핑 패널이 보관함이다(v0.43). 기준은 실행 기록이 아니라 회차 파일 자체(kind='briefing')라서,
// 휴지통에 넣으면 목록에서 빠지고 되살리면 돌아온다

type EditionRow = {
  fileId: number;
  createdAt: number;
  slot: Slot;
  itemCount: number;
  runId: number | null;
  leadIds: string | null;
  readItems: string | null;
};

function loadRows(ownerId: number, userId: number): EditionRow[] {
  return db
    .select({
      fileId: files.id,
      createdAt: files.createdAt,
      slot: briefingRuns.slot,
      itemCount: briefingRuns.itemCount,
      runId: briefingRuns.id,
      leadIds: briefingRuns.leadIds,
      readItems: userFileState.readItems,
    })
    .from(files)
    .leftJoin(briefingRuns, eq(briefingRuns.fileId, files.id))
    .leftJoin(userFileState, and(eq(userFileState.fileId, files.id), eq(userFileState.userId, userId)))
    .where(and(eq(files.ownerId, ownerId), eq(files.kind, 'briefing'), isNull(files.deletedAt)))
    .orderBy(desc(files.createdAt))
    .all()
    .map((r) => ({ ...r, slot: r.slot ?? 'adhoc', itemCount: r.itemCount ?? 0 }));
}

/** v0.43 이전 회차는 lead_ids가 비어 있다 — 처음 한 번 회차 JSON에서 같은 규칙으로 계산해 채운다.
    실행 기록이 없는 회차(가져온 파일 등)는 칸·기사 수도 JSON에서 읽는다 */
function withLead(row: EditionRow): EditionRow & { lead: string[] } {
  if (row.leadIds !== null) return { ...row, lead: parseIdList(row.leadIds) };
  const file = db.select({ contentText: files.contentText }).from(files).where(eq(files.id, row.fileId)).get();
  let ed: Partial<Edition> = {};
  try {
    ed = JSON.parse(file?.contentText ?? '') as Edition;
  } catch {
    ed = {};
  }
  const lead = ed.lead ?? leadIdsOf(ed.sections ?? []);
  if (row.runId !== null) {
    db.update(briefingRuns).set({ leadIds: JSON.stringify(lead) }).where(eq(briefingRuns.id, row.runId)).run();
    return { ...row, lead };
  }
  return { ...row, lead, slot: ed.edition?.slot ?? row.slot, itemCount: ed.stats?.items ?? row.itemCount };
}

function toSummary(raw: EditionRow) {
  const row = withLead(raw);
  const lead = row.lead;
  const read = new Set(parseIdList(row.readItems));
  const leadRead = lead.filter((id) => read.has(id)).length;
  const state = read.size === 0 ? 'unread' : leadRead === lead.length ? 'done' : 'partial';
  return {
    fileId: row.fileId,
    editionDate: kstParts(row.createdAt).date,
    slot: row.slot,
    label: slotLabel(row.slot, row.createdAt),
    createdAt: row.createdAt,
    itemCount: row.itemCount,
    leadCount: lead.length,
    leadRead,
    readCount: read.size,
    state,
  };
}

/** API-135 — before(그날은 빼고) 이전의 회차를 날짜 days개치. 날짜는 회차를 만든 한국시간 기준(회차 JSON의 date와 같다) */
export function listEditions(ownerId: number, userId: number, before: string | null, days: number) {
  const rows = loadRows(ownerId, userId).filter((r) => before === null || kstParts(r.createdAt).date < before);
  const dates: string[] = [];
  const picked: EditionRow[] = [];
  let nextBefore: string | null = null;
  for (const r of rows) {
    const date = kstParts(r.createdAt).date;
    if (!dates.includes(date)) {
      if (dates.length === days) {
        nextBefore = dates[dates.length - 1] ?? null;
        break;
      }
      dates.push(date);
    }
    picked.push(r);
  }
  return { editions: picked.map(toSummary), nextBefore };
}

/** API-136 — 만든 순서로 바로 앞·뒤 회차와 같은 날 회차들(이른 순). 이 사용자의 회차가 아니면 null */
export function editionNav(ownerId: number, userId: number, fileId: number) {
  const rows = loadRows(ownerId, userId); // 최신순
  const i = rows.findIndex((r) => r.fileId === fileId);
  const cur = rows[i];
  if (!cur) return null;
  const date = kstParts(cur.createdAt).date;
  return {
    prevId: rows[i + 1]?.fileId ?? null,
    nextId: rows[i - 1]?.fileId ?? null,
    sameDay: rows
      .filter((r) => kstParts(r.createdAt).date === date)
      .reverse()
      .map((r) => ({ fileId: r.fileId, slot: r.slot, label: slotLabel(r.slot, r.createdAt) })),
  };
}

export function clampDays(raw: string | undefined): number {
  const n = Number(raw ?? BRIEFING.EDITIONS_DAYS_DEFAULT);
  return Number.isInteger(n) && n > 0 ? Math.min(n, BRIEFING.EDITIONS_DAYS_MAX) : BRIEFING.EDITIONS_DAYS_DEFAULT;
}
