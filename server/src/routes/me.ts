import { desc, eq, isNotNull, and } from 'drizzle-orm';
import { Hono } from 'hono';
import { z } from 'zod';
import { db } from '../db/index.js';
import { files, userFileState, userSettings } from '../db/schema.js';
import { canReadFile } from '../lib/access.js';
import { fail } from '../lib/errors.js';
import { jsonBody, parseId } from '../lib/validate.js';
import type { AppEnv } from '../types.js';

const DEFAULT_SETTINGS = {
  viewerTheme: 'light' as const,
  fontSize: 16,
  fontFamily: null,
  lineHeight: null,
  contentWidth: 'normal' as const,
  lastSeenVersion: null as string | null,
};

const settingsSchema = z.object({
  viewerTheme: z.enum(['light', 'dark', 'sepia']).optional(),
  fontSize: z.number().int().min(12).max(24).optional(),
  fontFamily: z.string().max(100).nullable().optional(),
  lineHeight: z.string().max(20).nullable().optional(),
  contentWidth: z.enum(['narrow', 'normal', 'wide']).optional(),
  lastSeenVersion: z.string().max(20).optional(),
});

const stateSchema = z
  .object({
    isFavorite: z.boolean().optional(),
    readingPosition: z
      .object({ anchor: z.string().nullable().optional(), offset: z.number().optional() })
      .nullable()
      .optional(),
    touch: z.boolean().optional(),
  })
  .refine((v) => v.isFavorite !== undefined || v.readingPosition !== undefined || v.touch, {
    message: '변경할 필드가 없습니다',
  });

function pickSettings(row: typeof userSettings.$inferSelect) {
  const { userId: _omit, updatedAt: _omit2, ...rest } = row;
  return rest;
}

export const meRoutes = new Hono<AppEnv>()

  // API-071: 뷰어 설정 조회 — 행이 없으면 기본값 (첫 저장 때 생성)
  .get('/settings', (c) => {
    const row = db
      .select()
      .from(userSettings)
      .where(eq(userSettings.userId, c.get('user').id))
      .get();
    return c.json({ settings: row ? pickSettings(row) : DEFAULT_SETTINGS });
  })

  // API-072: 뷰어 설정 저장 (부분 갱신 upsert)
  .put('/settings', jsonBody(settingsSchema), (c) => {
    const userId = c.get('user').id;
    const patch = c.req.valid('json');

    const existing = db.select().from(userSettings).where(eq(userSettings.userId, userId)).get();
    const merged = { ...DEFAULT_SETTINGS, ...(existing ? pickSettings(existing) : {}), ...patch };

    const row = db
      .insert(userSettings)
      .values({ userId, ...merged, updatedAt: Date.now() })
      .onConflictDoUpdate({
        target: userSettings.userId,
        set: { ...merged, updatedAt: Date.now() },
      })
      .returning()
      .get();
    return c.json({ settings: pickSettings(row) });
  })

  // API-073: 파일 상태 저장 — 즐겨찾기·읽던 위치·열람 기록 부분 갱신(upsert)
  .put('/files/:id/state', jsonBody(stateSchema), (c) => {
    const user = c.get('user');
    const id = parseId(c.req.param('id'));
    if (id === null) return fail(c, 400, 'VALIDATION_ERROR', 'id: 올바르지 않은 값');
    const patch = c.req.valid('json');

    const file = db.select().from(files).where(eq(files.id, id)).get();
    if (!file) return fail(c, 404, 'NOT_FOUND', '파일이 없습니다');
    // 공유 파일 열람자도 자신만의 즐겨찾기·읽던 위치를 가진다 (ERD — USER_FILE_STATE 설계 의도)
    if (!canReadFile(user, file)) return fail(c, 403, 'FORBIDDEN', '접근 권한이 없습니다');

    const existing = db
      .select()
      .from(userFileState)
      .where(and(eq(userFileState.userId, user.id), eq(userFileState.fileId, id)))
      .get();

    const merged = {
      isFavorite:
        patch.isFavorite !== undefined ? (patch.isFavorite ? 1 : 0) : (existing?.isFavorite ?? 0),
      readingPosition:
        patch.readingPosition !== undefined
          ? patch.readingPosition === null
            ? null
            : JSON.stringify(patch.readingPosition)
          : (existing?.readingPosition ?? null),
      lastOpenedAt: patch.touch ? Date.now() : (existing?.lastOpenedAt ?? null),
    };

    const row = db
      .insert(userFileState)
      .values({ userId: user.id, fileId: id, ...merged })
      .onConflictDoUpdate({
        target: [userFileState.userId, userFileState.fileId],
        set: merged,
      })
      .returning()
      .get();

    return c.json({
      state: {
        isFavorite: row.isFavorite,
        readingPosition: row.readingPosition ? JSON.parse(row.readingPosition) : null,
        lastOpenedAt: row.lastOpenedAt,
      },
    });
  })

  // API-074: 최근 열람 파일 목록
  .get('/recent', (c) => {
    const user = c.get('user');
    const rows = db
      .select({
        id: files.id,
        folderId: files.folderId,
        name: files.name,
        fileType: files.fileType,
        ownerId: files.ownerId,
        isShared: files.isShared,
        lastOpenedAt: userFileState.lastOpenedAt,
      })
      .from(userFileState)
      .innerJoin(files, eq(userFileState.fileId, files.id))
      .where(and(eq(userFileState.userId, user.id), isNotNull(userFileState.lastOpenedAt)))
      .orderBy(desc(userFileState.lastOpenedAt))
      .limit(20)
      .all();

    // 공유가 풀리는 등 더 이상 볼 수 없게 된 파일은 목록에서 제외
    return c.json({ files: rows.filter((r) => canReadFile(user, r)) });
  });
