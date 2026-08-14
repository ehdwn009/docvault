import { and, eq, isNull, sql } from 'drizzle-orm';
import { Hono } from 'hono';
import { getCookie } from 'hono/cookie';
import { MAX_BINARY_FILE_BYTES, MAX_TEXT_FILE_BYTES, SESSION_COOKIE } from '../constants.js';
import { db } from '../db/index.js';
import { files, users } from '../db/schema.js';
import { ALL_EXTENSIONS, extensionOf } from '../lib/filetypes.js';
import { verifySessionToken } from '../lib/session.js';
import { saveBinary } from '../lib/storage.js';

// PWA 공유 시트 수신 (IA — 공유 시트): 폰의 "공유 → docvault"가 여기로 POST한다.
// /api/v1 밖(매니페스트가 고정 주소를 요구)이라 인증을 직접 검사한다.
// OS 공유 흐름에서는 에러 페이지가 최악의 경험이라, 실패는 조용히 건너뛰고 홈으로 돌려보낸다.
export const shareTargetRoutes = new Hono().post('/', async (c) => {
  const token = getCookie(c, SESSION_COOKIE);
  const userId = token ? await verifySessionToken(token) : null;
  const user =
    userId !== null ? db.select().from(users).where(eq(users.id, userId)).get() : undefined;
  if (!user || !user.isActive) return c.redirect('/');

  const nameTaken = (n: string) =>
    db
      .select({ id: files.id })
      .from(files)
      .where(
        and(
          eq(files.ownerId, user.id),
          sql`${files.folderId} IS NULL`,
          eq(files.name, n),
          isNull(files.deletedAt),
        ),
      )
      .get() !== undefined;

  // 공유되는 스크린샷은 이름이 늘 같아서(image.png 등) 충돌 시 자동으로 번호를 붙인다
  const uniqueName = (name: string) => {
    if (!nameTaken(name)) return name;
    const ext = extensionOf(name);
    const stem = ext ? name.slice(0, -ext.length) : name;
    let n = 2;
    while (nameTaken(`${stem} (${n})${ext}`)) n++;
    return `${stem} (${n})${ext}`;
  };

  const body = await c.req.parseBody({ all: true });
  const raw = body['files'];
  const uploads = (Array.isArray(raw) ? raw : [raw]).filter((f): f is File => f instanceof File);
  const now = Date.now();

  for (const file of uploads) {
    const meta = ALL_EXTENSIONS[extensionOf(file.name)];
    if (!meta) continue;
    const isBinary = meta.fileType === 'image' || meta.fileType === 'pdf';
    if (file.size > (isBinary ? MAX_BINARY_FILE_BYTES : MAX_TEXT_FILE_BYTES)) continue;
    db.insert(files)
      .values({
        ownerId: user.id,
        folderId: null,
        name: uniqueName(file.name),
        fileType: meta.fileType,
        mimeType: meta.mimeType,
        sizeBytes: file.size,
        contentText: isBinary ? null : await file.text(),
        storagePath: isBinary ? saveBinary(user.id, Buffer.from(await file.arrayBuffer())) : null,
        createdAt: now,
        updatedAt: now,
      })
      .run();
  }

  // 파일 없는 공유(텍스트·링크)는 md 문서로 저장한다
  if (uploads.length === 0) {
    const parts = [body['title'], body['text'], body['url']].filter(
      (v): v is string => typeof v === 'string' && v.trim() !== '',
    );
    if (parts.length > 0) {
      const stamp = new Date(now).toISOString().slice(0, 19).replace('T', ' ').replaceAll(':', '-');
      db.insert(files)
        .values({
          ownerId: user.id,
          folderId: null,
          name: uniqueName(`공유 ${stamp}.md`),
          fileType: 'md',
          mimeType: 'text/markdown',
          sizeBytes: Buffer.byteLength(parts.join('\n\n'), 'utf8'),
          contentText: parts.join('\n\n'),
          storagePath: null,
          createdAt: now,
          updatedAt: now,
        })
        .run();
    }
  }

  return c.redirect('/');
});
