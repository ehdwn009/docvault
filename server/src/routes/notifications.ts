import { Hono } from 'hono';
import { z } from 'zod';
import { countUnread, listNotifications, markNotificationsRead } from '../lib/notifications.js';
import { jsonBody } from '../lib/validate.js';
import type { AppEnv } from '../types.js';

const readSchema = z.object({
  // 비우면 전부 읽음 ([모두 읽음])
  ids: z.array(z.number().int().positive()).max(200).optional(),
});

export const notificationRoutes = new Hono<AppEnv>()

  // API-160: 내 알림함 — 목록 + 안 읽은 개수를 한 번에 (종 배지와 목록이 같은 응답을 쓴다)
  .get('/', (c) => {
    const userId = c.get('user').id;
    return c.json({ notifications: listNotifications(userId), unread: countUnread(userId) });
  })

  // API-161: 읽음 처리
  .post('/read', jsonBody(readSchema), (c) => {
    const userId = c.get('user').id;
    const { ids } = c.req.valid('json');
    markNotificationsRead(userId, ids ?? null);
    return c.json({ unread: countUnread(userId) });
  });
