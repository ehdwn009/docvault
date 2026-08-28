import { and, eq, isNull } from 'drizzle-orm';
import { Hono } from 'hono';
import { MAX_BINARY_FILE_BYTES, MAX_TEXT_FILE_BYTES } from '../constants.js';
import { db } from '../db/index.js';
import { files } from '../db/schema.js';
import { classifyUpload, isTextType } from '../lib/filetypes.js';
import { uniqueFileName } from '../lib/naming.js';
import { saveBinary } from '../lib/storage.js';
import { resolveSessionUser } from '../middleware/auth.js';

// PWA 공유 시트 수신 (IA — 공유 시트): 폰의 "공유 → docvault"가 여기로 POST한다.
// /api/v1 밖(매니페스트가 고정 주소를 요구)이라 authGuard를 안 거치므로,
// 같은 판정을 쓰도록 resolveSessionUser를 호출한다(검사 단계가 갈라지지 않게).
// OS 공유 흐름에서는 에러 페이지가 최악의 경험이라, 실패는 조용히 건너뛰고 홈으로 돌려보낸다.
export const shareTargetRoutes = new Hono().post('/', async (c) => {
  const session = await resolveSessionUser(c);
  if (!session.ok) return c.redirect('/');
  const user = session.user;

  const nameTaken = (n: string) =>
    db
      .select({ id: files.id })
      .from(files)
      .where(
        and(
          eq(files.ownerId, user.id),
          isNull(files.folderId),
          eq(files.name, n),
          isNull(files.deletedAt),
        ),
      )
      .get() !== undefined;

  // 공유되는 스크린샷은 이름이 늘 같아서(image.png 등) 충돌 시 자동으로 번호를 붙인다
  const uniqueName = (name: string) => uniqueFileName(name, nameTaken);

  const body = await c.req.parseBody({ all: true });
  const raw = body['files'];
  const uploads = (Array.isArray(raw) ? raw : [raw]).filter((f): f is File => f instanceof File);
  const now = Date.now();

  for (const file of uploads) {
    const meta = await classifyUpload(file); // 업로드와 같은 전량 수용 정책 (API-031)
    const isBinary = !isTextType(meta.fileType);
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
