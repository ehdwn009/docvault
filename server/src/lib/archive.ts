import { existsSync } from 'node:fs';
import type { Readable } from 'node:stream';
import { and, eq, isNull } from 'drizzle-orm';
import { ZipFile } from 'yazl';
import { APP_VERSION } from '../config.js';
import { MAX_ARCHIVE_ENTRIES } from '../constants.js';
import { db } from '../db/index.js';
import { fileTags, files, folders, tags, userFileState } from '../db/schema.js';
import type { SessionUser } from '../types.js';
import { canReadFile, canReadFolder } from './access.js';
import { binaryAbsPath } from './storage.js';

// 여러 파일을 ZIP 하나로 묶어 내려보낸다 (API-040).
// 텍스트 본문은 DB에, 바이너리는 디스크에 있으므로(아키텍처 — 저장 전략) 내보내기는
// "폴더를 그대로 압축"이 아니라 두 출처에서 파일을 되살려 조립하는 작업이다.

type FileRow = typeof files.$inferSelect;

export type ArchiveEntry = { file: FileRow; zipPath: string };

export type ArchiveScope = {
  fileIds: number[];
  folderIds: number[];
  /** 내 파일 전체 (설정 → 내보내기) */
  all: boolean;
};

/** 담을 파일이 상한을 넘었을 때. 라우트가 413으로 변환한다 */
export class ArchiveTooLargeError extends Error {}

/** ZIP 안의 경로 한 칸으로 쓸 수 있게 다듬는다.
 *  업로드 시 이름 규칙(nameField)이 이미 경로 문자를 막지만, 압축을 푸는 쪽 OS에서
 *  문제가 되는 문자까지 여기서 한 번 더 걷어낸다 (윈도우 금지 문자·제어 문자) */
function sanitizeSegment(name: string): string {
  const cleaned = name
    .replace(/[/\\:*?"<>|]/g, '_')
    .replace(/[\u0000-\u001f\u007f]/g, '') // 제어 문자
    .replace(/^\.+/, '') // 앞의 점 — 숨김 파일이나 상위 경로(..)로 해석되지 않게
    .replace(/[. ]+$/, '') // 윈도우는 끝의 점·공백을 잘라내므로 미리 없앤다
    .trim();
  return cleaned || '이름없음';
}

/** 같은 폴더 안에서 이름이 겹치면 " (2)", " (3)" … 을 붙여 덮어쓰기를 막는다 */
function uniquePath(taken: Set<string>, dir: string, name: string): string {
  const join = (n: string) => (dir ? `${dir}/${n}` : n);
  if (!taken.has(join(name).toLowerCase())) {
    taken.add(join(name).toLowerCase());
    return join(name);
  }
  const dot = name.lastIndexOf('.');
  const stem = dot > 0 ? name.slice(0, dot) : name;
  const ext = dot > 0 ? name.slice(dot) : '';
  for (let n = 2; ; n++) {
    const candidate = join(`${stem} (${n})${ext}`);
    if (!taken.has(candidate.toLowerCase())) {
      taken.add(candidate.toLowerCase());
      return candidate;
    }
  }
}

function filesDirectlyIn(folderId: number | null, ownerId?: number): FileRow[] {
  return db
    .select()
    .from(files)
    .where(
      and(
        folderId === null ? isNull(files.folderId) : eq(files.folderId, folderId),
        isNull(files.deletedAt), // 휴지통 파일은 내보내지 않는다
        ownerId === undefined ? undefined : eq(files.ownerId, ownerId),
      ),
    )
    .all();
}

function subFolders(parentId: number | null, ownerId?: number) {
  return db
    .select()
    .from(folders)
    .where(
      and(
        parentId === null ? isNull(folders.parentId) : eq(folders.parentId, parentId),
        ownerId === undefined ? undefined : eq(folders.ownerId, ownerId),
      ),
    )
    .all();
}

/**
 * 요청 범위를 실제로 담을 파일 목록으로 펼친다.
 * 경로 규칙: 폴더·전체 내보내기는 폴더 구조를 그대로 살리고,
 * 파일을 골라 받는 경우는 평평하게 담는다 (고른 것만 바로 보이는 편이 자연스러우므로).
 */
export function collectArchiveEntries(user: SessionUser, scope: ArchiveScope): ArchiveEntry[] {
  const entries: ArchiveEntry[] = [];
  const taken = new Set<string>();
  const visited = new Set<number>(); // 폴더 순환 방어

  const push = (file: FileRow, dir: string) => {
    if (!canReadFile(user, file)) return;
    // 디스크에서 원본이 사라진 바이너리는 건너뛴다 — 하나 때문에 전체 다운로드가 깨지지 않게
    if (file.storagePath && !existsSync(binaryAbsPath(file.storagePath))) return;
    if (entries.length >= MAX_ARCHIVE_ENTRIES) throw new ArchiveTooLargeError();
    entries.push({ file, zipPath: uniquePath(taken, dir, sanitizeSegment(file.name)) });
  };

  const walk = (folderId: number, dir: string, ownerId?: number) => {
    if (visited.has(folderId)) return;
    visited.add(folderId);
    for (const file of filesDirectlyIn(folderId, ownerId)) push(file, dir);
    for (const child of subFolders(folderId, ownerId)) {
      walk(child.id, `${dir}/${sanitizeSegment(child.name)}`, ownerId);
    }
  };

  if (scope.all) {
    for (const file of filesDirectlyIn(null, user.id)) push(file, '');
    for (const root of subFolders(null, user.id)) walk(root.id, sanitizeSegment(root.name), user.id);
    return entries;
  }

  for (const folderId of scope.folderIds) {
    const folder = db.select().from(folders).where(eq(folders.id, folderId)).get();
    if (!folder || !canReadFolder(user, folder)) continue;
    // 폴더 자신을 최상위 칸으로 만들어, 압축을 풀면 그 폴더가 통째로 나오게 한다
    walk(folder.id, sanitizeSegment(folder.name));
  }

  for (const fileId of scope.fileIds) {
    const file = db.select().from(files).where(eq(files.id, fileId)).get();
    if (file) push(file, '');
  }

  return entries;
}

/** 함께 넣는 목록표 — 태그·즐겨찾기처럼 파일 자체에는 남지 않는 정보를 보존한다 */
export function buildManifest(user: SessionUser, entries: ArchiveEntry[]) {
  const tagsByFile = new Map<number, string[]>();
  for (const row of db
    .select({ fileId: fileTags.fileId, name: tags.name })
    .from(fileTags)
    .innerJoin(tags, eq(fileTags.tagId, tags.id))
    .where(eq(tags.ownerId, user.id))
    .all()) {
    const list = tagsByFile.get(row.fileId) ?? [];
    list.push(row.name);
    tagsByFile.set(row.fileId, list);
  }

  const favorites = new Set(
    db
      .select({ fileId: userFileState.fileId })
      .from(userFileState)
      .where(and(eq(userFileState.userId, user.id), eq(userFileState.isFavorite, 1)))
      .all()
      .map((r) => r.fileId),
  );

  return {
    app: 'docvault',
    appVersion: APP_VERSION,
    exportedAt: Date.now(),
    exportedBy: user.username,
    fileCount: entries.length,
    files: entries.map(({ file, zipPath }) => ({
      path: zipPath,
      fileType: file.fileType,
      sizeBytes: file.sizeBytes,
      createdAt: file.createdAt,
      updatedAt: file.updatedAt,
      tags: tagsByFile.get(file.id) ?? [],
      isFavorite: favorites.has(file.id),
    })),
  };
}

/**
 * ZIP을 스트림으로 만든다 — 전체를 메모리에 쌓지 않고 만드는 족족 흘려보내므로
 * 파일이 많아도 서버 메모리가 버틴다. 대신 미리 크기를 알 수 없어 Content-Length는 없다.
 */
export function createArchiveStream(entries: ArchiveEntry[], manifest: object | null): Readable {
  const zip = new ZipFile();
  for (const { file, zipPath } of entries) {
    const mtime = new Date(file.updatedAt);
    if (file.storagePath) {
      zip.addFile(binaryAbsPath(file.storagePath), zipPath, { mtime });
    } else {
      zip.addBuffer(Buffer.from(file.contentText ?? '', 'utf8'), zipPath, { mtime });
    }
  }
  if (manifest) {
    zip.addBuffer(Buffer.from(JSON.stringify(manifest, null, 2), 'utf8'), 'docvault-manifest.json');
  }
  zip.end();
  // yazl의 타입 선언은 최소 인터페이스(NodeJS.ReadableStream)지만 실체는 PassThrough다.
  // 웹 스트림으로 바꾸려면 Readable이어야 해서 여기서 좁혀 준다.
  return zip.outputStream as Readable;
}
