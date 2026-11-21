import { and, asc, desc, eq, isNull, sql } from 'drizzle-orm';
import { db } from '../../db/index.js';
import { files, outlookEditions, outlookJobs } from '../../db/schema.js';
import { uniqueFileName } from '../naming.js';
import { archiveOwnerId } from '../trade/store.js';
import { OutlookDataSchema } from './schema.js';
import { outlookPlainText } from './verify.js';

// 세계 전망 판을 Loft 파일로 남긴다 — 화면은 kind='outlook' HTML 파일(폴더 없음), 기록은 outlook_editions 한 줄 (세계전망 설계 출시 2단계)

export type EditionRow = typeof outlookEditions.$inferSelect;
export type NewEdition = Omit<typeof outlookEditions.$inferInsert, 'id' | 'fileId' | 'createdAt'>;

/** 보관함 안에서 같은 이름이 있는가 — 폴더가 없으므로 주인의 outlook 파일끼리만 본다 */
function outlookNameTaken(ownerId: number, name: string): boolean {
  return !!db
    .select({ id: files.id })
    .from(files)
    .where(and(eq(files.ownerId, ownerId), eq(files.kind, 'outlook'), eq(files.name, name), isNull(files.deletedAt)))
    .get();
}

/** 판 하나를 파일과 줄로 — 주인은 수출입 동향과 같이 가장 먼저 만든 활성 관리자(계정이 아니라 앱이 받는 자료라 한 사람에게 모은다).
 *  kind='outlook'은 트리·공유받음·검색에 안 나오고 동향 탭에서만 보인다. 읽기는 모든 계정(canReadFile) */
export function saveEdition(edition: NewEdition, html: string, now = Date.now()): EditionRow {
  const ownerId = archiveOwnerId();
  if (ownerId === null) throw new Error('활성 관리자 계정이 없어 보관할 곳이 없어요');
  const name = uniqueFileName(`${edition.label}.html`, (n) => outlookNameTaken(ownerId, n));
  const size = Buffer.byteLength(html, 'utf8');
  return db.transaction((tx) => {
    const file = tx
      .insert(files)
      .values({ ownerId, folderId: null, name, fileType: 'html', mimeType: 'text/html', sizeBytes: size, contentText: html, kind: 'outlook', createdAt: now, updatedAt: now })
      .returning()
      .get();
    return tx.insert(outlookEditions).values({ ...edition, fileId: file.id, createdAt: now }).returning().get();
  });
}

export function editionCount(): number {
  return db.select({ n: sql<number>`count(*)` }).from(outlookEditions).get()?.n ?? 0;
}

export function editionById(id: number): EditionRow | undefined {
  return db.select().from(outlookEditions).where(eq(outlookEditions.id, id)).get();
}

/** 판 목록 — 게시 시각 최신순 */
export function listEditions(): EditionRow[] {
  return db.select().from(outlookEditions).orderBy(desc(outlookEditions.publishedAt), desc(outlookEditions.id)).all();
}

/** 이 이름이 판이나 실행으로 이미 쓰였는가 — 자동 판은 이름마다 한 번만 켠다 */
export function labelUsed(label: string): boolean {
  return (
    !!db.select({ id: outlookEditions.id }).from(outlookEditions).where(eq(outlookEditions.label, label)).get() ||
    !!db.select({ id: outlookJobs.id }).from(outlookJobs).where(eq(outlookJobs.label, label)).get()
  );
}

/** 게시된 판 가운데 가장 늦은 until — 다음 작은 판은 그 다음 날부터 읽는다. 내린 판은 치지 않는다 */
export function lastPublishedUntil(): string | null {
  return db.select({ v: sql<string | null>`max(${outlookEditions.until})` }).from(outlookEditions).where(eq(outlookEditions.status, 'published')).get()?.v ?? null;
}

/** 기준선 — 게시된 큰 판 가운데 until이 가장 늦은 것 */
export function baselineEdition(): EditionRow | undefined {
  return db
    .select()
    .from(outlookEditions)
    .where(and(eq(outlookEditions.kind, 'big'), eq(outlookEditions.status, 'published')))
    .orderBy(desc(outlookEditions.until), desc(outlookEditions.publishedAt))
    .limit(1)
    .get();
}

/** 기준선 뒤에 게시된 작은 판들 — 오래된 것부터(세션이 "가장 최근 값"을 마지막에 읽게) */
export function smallEditionsAfter(base: EditionRow | undefined): EditionRow[] {
  return db
    .select()
    .from(outlookEditions)
    .where(and(eq(outlookEditions.kind, 'small'), eq(outlookEditions.status, 'published')))
    .orderBy(asc(outlookEditions.publishedAt), asc(outlookEditions.id))
    .all()
    .filter((e) => !base || e.publishedAt > base.publishedAt);
}

/** 가장 최근에 게시된 판 — 다음 판이 다시 쓰지 않을 출처 주소를 여기서 뽑는다 */
export function latestPublished(): EditionRow | undefined {
  return db.select().from(outlookEditions).where(eq(outlookEditions.status, 'published')).orderBy(desc(outlookEditions.publishedAt), desc(outlookEditions.id)).limit(1).get();
}

/** 완성본 JSON을 읽는다 — 서버 대조를 통과해 저장된 것이지만, 형식이 바뀐 옛 줄이 와도 터지지 않게 다시 확인한다 */
function editionData(e: EditionRow) {
  if (e.dataJson === null) return null;
  try {
    const parsed = OutlookDataSchema.safeParse(JSON.parse(e.dataJson));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

/** 다음 판의 세션이 읽을 글 — 넣어 둔 글이 있으면 그것(시범 큰 판의 마크다운), 없으면 완성본의 화면 글 */
export function editionText(e: EditionRow): string {
  if (e.baselineText !== null) return e.baselineText;
  const data = editionData(e);
  return data ? outlookPlainText(data) : '';
}

/** 그 판이 쓴 출처 주소 — 완성본이면 주 목록, 마크다운 원문이면 글 속 주소 */
export function editionUrls(e: EditionRow): string[] {
  const data = editionData(e);
  if (data) return [...new Set(data.notes.map((n) => n.url))];
  return [...new Set((e.baselineText ?? '').match(/https?:\/\/[^\s<>()\[\]"']+/g) ?? [])];
}

/** 내리기·다시 올리기 — 목록에서만 감춘다. 파일 읽기는 막지 않는다(알림·링크가 깨지지 않게) */
export function setEditionStatus(id: number, status: 'published' | 'hidden'): boolean {
  return db.update(outlookEditions).set({ status }).where(eq(outlookEditions.id, id)).run().changes > 0;
}

/** 목록에 보일 첫 문장 — 각주 표시와 굵게 표시를 걷어 낸다. 소수점(2.5%)에서 끊기지 않게 마침표 뒤가 빈칸이거나 끝일 때만 끊는다 */
export function firstSentence(text: string): string {
  const plain = text.replace(/\[\d{1,3}\]/g, '').replace(/\*\*/g, '').replace(/\s+/g, ' ').trim();
  return plain.match(/^(.+?[.!?])(?=\s|$)/)?.[1] ?? plain;
}
