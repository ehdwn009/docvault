import { Hono } from 'hono';
import { z } from 'zod';
import { PUSH } from '../constants.js';
import { fail } from '../lib/errors.js';
import { countUnread, listNotifications, markNotificationsRead } from '../lib/notifications.js';
import { countDevices, getVapid, listDevices, removeDevice, saveSubscription, sendTest } from '../lib/push.js';
import { jsonBody, parseId } from '../lib/validate.js';
import type { AppEnv } from '../types.js';

const readSchema = z.object({
  // 비우면 전부 읽음 ([모두 읽음])
  ids: z.array(z.number().int().positive()).max(200).optional(),
});

// 브라우저의 PushSubscription.toJSON() 모양 그대로 — 우리가 쓰는 칸만 받는다
const subscribeSchema = z.object({
  endpoint: z.string().url().max(2000),
  keys: z.object({ p256dh: z.string().min(1).max(200), auth: z.string().min(1).max(100) }),
  label: z.string().trim().min(1).max(PUSH.LABEL_MAX),
});

const unsubscribeSchema = z.object({ endpoint: z.string().url().max(2000) });

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
  })

  // API-162: 푸시 공개 열쇠 — 브라우저가 구독할 때 applicationServerKey로 넣는다
  .get('/push/key', (c) => c.json({ publicKey: getVapid().publicKey }))

  // API-163: 내 기기 목록
  .get('/push/devices', (c) => c.json({ devices: listDevices(c.get('user').id) }))

  // API-164: 이 기기 등록 (같은 endpoint면 갱신)
  .post('/push/devices', jsonBody(subscribeSchema), (c) => {
    const userId = c.get('user').id;
    const { endpoint, keys, label } = c.req.valid('json');
    if (countDevices(userId) >= PUSH.MAX_DEVICES) {
      return fail(c, 409, 'CONFLICT', `기기는 ${PUSH.MAX_DEVICES}대까지 등록할 수 있어요. 안 쓰는 기기를 끊어 주세요`);
    }
    const r = saveSubscription(userId, { endpoint, keys }, label);
    return c.json({ device: { id: r.id } }, r.created ? 201 : 200);
  })

  // API-165: 끊기 — 설정 화면(id) 또는 브라우저 쪽에서 구독을 풀 때(endpoint)
  .delete('/push/devices/:id', (c) => {
    const id = parseId(c.req.param('id'));
    if (id === null) return fail(c, 400, 'VALIDATION_ERROR', 'id: 올바르지 않은 값');
    if (!removeDevice(c.get('user').id, { id })) return fail(c, 404, 'NOT_FOUND', '그 기기가 없어요');
    return c.json({ ok: true });
  })
  .post('/push/unsubscribe', jsonBody(unsubscribeSchema), (c) => {
    removeDevice(c.get('user').id, { endpoint: c.req.valid('json').endpoint });
    return c.json({ ok: true });
  })

  // API-166: 시험 알림 — 그 기기 한 대로
  .post('/push/devices/:id/test', async (c) => {
    const id = parseId(c.req.param('id'));
    if (id === null) return fail(c, 400, 'VALIDATION_ERROR', 'id: 올바르지 않은 값');
    const result = await sendTest(c.get('user').id, id);
    if (result === 'none') return fail(c, 404, 'NOT_FOUND', '그 기기가 없어요');
    if (result === 'gone') return fail(c, 410, 'PUSH_DEVICE_GONE', '이 기기의 구독이 만료됐어요. 그 기기에서 다시 켜 주세요');
    if (result === 'failed') return fail(c, 502, 'PUSH_FAILED', '푸시 서버가 받지 않았어요. 잠시 뒤 다시 해 보세요');
    return c.json({ sent: true });
  });
