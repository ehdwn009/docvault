import { randomBytes } from 'node:crypto';
import { and, eq, gt } from 'drizzle-orm';
import { TELEGRAM } from '../constants.js';
import { db } from '../db/index.js';
import { appSettings, userSettings } from '../db/schema.js';
import { decryptSecret, encryptSecret } from './crypto.js';

// 텔레그램 봇 통로 (알림 3단계 2026-11-05). 푸시가 막히는 기기(시크릿 창·옛 브라우저)의 안전망.
// 봇은 앱에 하나(관리자가 BotFather 토큰을 넣는다), 사용자는 저마다 /start 코드로 자기 대화를 잇는다.
// 보내는 글은 제목·한 줄뿐 — 문서 내용은 절대 보내지 않는다 (폐쇄형 플랫폼).

type Bot = { token: string; username: string };

let bot: Bot | null | undefined; // undefined = 아직 안 읽음
let pollAbort: AbortController | null = null;
let pollOffset = 0;

function readBot(): Bot | null {
  if (bot !== undefined) return bot;
  const row = db.select({ value: appSettings.value }).from(appSettings).where(eq(appSettings.key, TELEGRAM.SETTING_KEY)).get();
  const plain = row ? decryptSecret(row.value, TELEGRAM.PURPOSE) : null;
  bot = plain ? (JSON.parse(plain) as Bot) : null;
  return bot;
}

async function call<T>(token: string, method: string, body?: unknown, signal?: AbortSignal): Promise<T> {
  const res = await fetch(`${TELEGRAM.API}/bot${token}/${method}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
    signal,
  });
  const json = (await res.json()) as { ok: boolean; result?: T; description?: string };
  if (!json.ok) throw new Error(json.description ?? `telegram ${method} failed (${res.status})`);
  return json.result as T;
}

/** 설정 화면용 — 봇이 있나, 이름은 뭔가. 토큰은 절대 밖에 내지 않는다 */
export function botStatus(): { configured: boolean; username: string | null } {
  const b = readBot();
  return { configured: !!b, username: b?.username ?? null };
}

/** 관리자가 토큰을 넣는다 — getMe로 진짜 봇인지 확인하고 이름을 같이 저장. 폴링을 (다시) 켠다 */
export async function setBotToken(token: string): Promise<{ username: string }> {
  const me = await call<{ username?: string }>(token, 'getMe');
  if (!me.username) throw new Error('봇 이름을 받지 못했어요');
  const value = encryptSecret(JSON.stringify({ token, username: me.username } satisfies Bot), TELEGRAM.PURPOSE);
  db.insert(appSettings)
    .values({ key: TELEGRAM.SETTING_KEY, value, updatedAt: Date.now() })
    .onConflictDoUpdate({ target: appSettings.key, set: { value, updatedAt: Date.now() } })
    .run();
  bot = { token, username: me.username };
  startTelegramPolling();
  return { username: me.username };
}

export function clearBot(): void {
  db.delete(appSettings).where(eq(appSettings.key, TELEGRAM.SETTING_KEY)).run();
  bot = null;
  pollAbort?.abort();
  pollAbort = null;
}

/** 내 연결 상태 */
export function linkStatus(userId: number): { linked: boolean } {
  const row = db.select({ chat: userSettings.telegramChatId }).from(userSettings).where(eq(userSettings.userId, userId)).get();
  return { linked: !!row?.chat };
}

/** [연결] — 10분짜리 코드와 t.me 링크. 봇이 /start 코드를 받으면 chat id를 적는다 */
export function createLinkCode(userId: number): { code: string; url: string; expiresAt: number } {
  const b = readBot();
  if (!b) throw new Error('관리자가 아직 봇을 연결하지 않았어요');
  const code = randomBytes(6).toString('base64url');
  const expiresAt = Date.now() + TELEGRAM.LINK_CODE_TTL_MS;
  db.insert(userSettings)
    .values({ userId, telegramLinkCode: code, telegramLinkExpiresAt: expiresAt, updatedAt: Date.now() })
    .onConflictDoUpdate({ target: userSettings.userId, set: { telegramLinkCode: code, telegramLinkExpiresAt: expiresAt, updatedAt: Date.now() } })
    .run();
  return { code, url: `https://t.me/${b.username}?start=${code}`, expiresAt };
}

export function unlink(userId: number): void {
  db.update(userSettings).set({ telegramChatId: null, telegramLinkCode: null, telegramLinkExpiresAt: null }).where(eq(userSettings.userId, userId)).run();
}

/** 한 사람에게 한 통. 연결이 없거나 봇이 없으면 조용히 아무것도 안 한다 */
export async function sendTelegram(userId: number, text: string): Promise<boolean> {
  const b = readBot();
  if (!b) return false;
  const row = db.select({ chat: userSettings.telegramChatId }).from(userSettings).where(eq(userSettings.userId, userId)).get();
  if (!row?.chat) return false;
  try {
    await call(b.token, 'sendMessage', { chat_id: row.chat, text, disable_web_page_preview: true });
    return true;
  } catch (e) {
    console.log(`[telegram] send failed for user ${userId}: ${e instanceof Error ? e.message : String(e)}`);
    return false;
  }
}

type Update = { update_id: number; message?: { chat: { id: number }; text?: string } };

/** /start <code> 하나만 알아듣는다 — 코드가 맞고 안 지났으면 연결, 아니면 안내 */
async function handleUpdate(b: Bot, u: Update): Promise<void> {
  const text = u.message?.text?.trim() ?? '';
  const chatId = u.message?.chat.id;
  if (!chatId) return;
  const m = text.match(/^\/start(?:@\w+)?\s+(\S+)/);
  if (!m) {
    await call(b.token, 'sendMessage', { chat_id: chatId, text: 'Loft 알림 봇이에요. 앱의 나 › 알림 › 텔레그램에서 [연결]을 눌러 받은 링크로 들어와 주세요.' });
    return;
  }
  const code = m[1]!;
  const row = db
    .select({ userId: userSettings.userId })
    .from(userSettings)
    .where(and(eq(userSettings.telegramLinkCode, code), gt(userSettings.telegramLinkExpiresAt, Date.now())))
    .get();
  if (!row) {
    await call(b.token, 'sendMessage', { chat_id: chatId, text: '연결 코드가 틀리거나 10분이 지났어요. 앱에서 [연결]을 다시 눌러 주세요.' });
    return;
  }
  db.update(userSettings).set({ telegramChatId: String(chatId), telegramLinkCode: null, telegramLinkExpiresAt: null }).where(eq(userSettings.userId, row.userId)).run();
  await call(b.token, 'sendMessage', { chat_id: chatId, text: '연결됐어요. 브리핑이 도착하거나 오래 걸린 일이 끝나면 여기로 알려 드릴게요. 끊으려면 앱의 나 › 알림에서.' });
}

/** 긴 폴링 — 기동 때와 토큰을 넣을 때 켠다. 봇이 없으면 아무것도 안 한다 */
export function startTelegramPolling(): void {
  pollAbort?.abort();
  const b = readBot();
  if (!b) return;
  const ctrl = new AbortController();
  pollAbort = ctrl;
  void (async () => {
    while (!ctrl.signal.aborted) {
      try {
        const updates = await call<Update[]>(b.token, 'getUpdates', { offset: pollOffset, timeout: TELEGRAM.POLL_TIMEOUT_S, allowed_updates: ['message'] }, ctrl.signal);
        for (const u of updates) {
          pollOffset = u.update_id + 1;
          await handleUpdate(b, u).catch((e: unknown) => console.log(`[telegram] update failed: ${e instanceof Error ? e.message : String(e)}`));
        }
      } catch (e) {
        if (ctrl.signal.aborted) return;
        console.log(`[telegram] poll failed: ${e instanceof Error ? e.message : String(e)}`);
        await new Promise((r) => setTimeout(r, TELEGRAM.POLL_RETRY_MS));
      }
    }
  })();
}
