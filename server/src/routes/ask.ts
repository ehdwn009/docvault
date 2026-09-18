import { and, asc, desc, eq, sql } from 'drizzle-orm';
import { Hono } from 'hono';
import { streamSSE } from 'hono/streaming';
import { z } from 'zod';
import { ASK } from '../constants.js';
import { db } from '../db/index.js';
import { askMessages, askThreads, files } from '../db/schema.js';
import { canReadFile } from '../lib/access.js';
import {
  countQuestionsToday,
  createAnswerStream,
  describeUpstreamError,
  isAskConfigured,
  purgeExpiredThreads,
  toApiMessages,
} from '../lib/ask.js';
import { fail } from '../lib/errors.js';
import { jsonBody, parseId } from '../lib/validate.js';
import type { AppEnv } from '../types.js';

// API-101~106: 질문 (배움 카드 1판). LLM은 서버만 부른다 — 키는 env, 클라이언트는 이 라우트만 안다

const createSchema = z.object({
  fileId: z.number().int().positive().optional(),
  quote: z.string().trim().max(ASK.QUOTE_MAX_CHARS).optional(),
  context: z.string().trim().max(ASK.CONTEXT_MAX_CHARS).optional(),
});

const messageSchema = z.object({
  question: z.string().trim().min(1).max(ASK.QUESTION_MAX_CHARS),
  /** 대화 중 문서에서 다시 드래그한 문장 — 이번 질문에 인용으로 붙는다 */
  quote: z.string().trim().max(ASK.QUOTE_MAX_CHARS).optional(),
});

type ThreadRow = typeof askThreads.$inferSelect;

/** 하루 질문 한도 — 관리자는 없음(null). 키를 넣고 요금을 내는 사람이 자기를 막을 이유가 없다 */
function dailyLimitFor(user: { role: 'user' | 'admin' }): number | null {
  return user.role === 'admin' ? null : ASK.DAILY_LIMIT;
}

function serializeThread(t: ThreadRow, fileName: string | null, messageCount?: number) {
  return {
    id: t.id,
    fileId: t.fileId,
    fileName,
    quote: t.quote,
    title: t.title,
    ...(messageCount !== undefined ? { messageCount } : {}),
    createdAt: t.createdAt,
    updatedAt: t.updatedAt,
  };
}

/** 내 대화 하나 — 남의 것은 존재를 알리지 않는다 (API 공통 규약 — 404 통일) */
function findOwnThread(ownerId: number, id: number) {
  return db
    .select({ thread: askThreads, fileName: files.name })
    .from(askThreads)
    .leftJoin(files, eq(files.id, askThreads.fileId))
    .where(and(eq(askThreads.id, id), eq(askThreads.ownerId, ownerId)))
    .get();
}

export const askRoutes = new Hono<AppEnv>()

  // API-101: 상태 — 키 여부와 오늘 남은 횟수. 패널이 열릴 때 부른다
  .get('/status', (c) => {
    const user = c.get('user');
    const used = countQuestionsToday(user.id);
    const limit = dailyLimitFor(user);
    return c.json({
      configured: isAskConfigured(),
      limit,
      used,
      remaining: limit === null ? null : Math.max(0, limit - used),
    });
  })

  // API-102: 대화 시작 — LLM은 아직 안 부른다. 첫 질문은 API-103으로
  .post('/threads', jsonBody(createSchema), (c) => {
    if (!isAskConfigured()) return fail(c, 503, 'ASK_NOT_CONFIGURED', '관리자가 아직 LLM을 연결하지 않았습니다');
    const user = c.get('user');
    const body = c.req.valid('json');

    let fileName: string | null = null;
    if (body.fileId !== undefined) {
      const file = db.select().from(files).where(eq(files.id, body.fileId)).get();
      // 공유 문서(남의 문서)도 읽을 수 있으면 물어볼 수 있다 — 대화는 내 것이라 문서를 건드리지 않는다 (설계 흐름 K)
      if (!file || !canReadFile(user, file)) return fail(c, 404, 'NOT_FOUND', '파일이 없습니다');
      fileName = file.name;
    }

    const now = Date.now();
    const thread = db
      .insert(askThreads)
      .values({
        ownerId: user.id,
        fileId: body.fileId ?? null,
        quote: body.quote || null,
        context: body.context || null,
        // 첫 질문이 오면 그것으로 바뀐다
        title: body.quote ? body.quote.slice(0, 60) : '새 대화',
        createdAt: now,
        updatedAt: now,
      })
      .returning()
      .get();
    return c.json({ thread: serializeThread(thread, fileName) }, 201);
  })

  // API-104: 지난 대화 목록 — 최근 갱신순, 본문 제외
  .get('/threads', (c) => {
    const rows = db
      .select({
        thread: askThreads,
        fileName: files.name,
        messageCount: sql<number>`(select count(*) from ${askMessages} where ${askMessages.threadId} = ${askThreads.id})`,
      })
      .from(askThreads)
      .leftJoin(files, eq(files.id, askThreads.fileId))
      .where(eq(askThreads.ownerId, c.get('user').id))
      .orderBy(desc(askThreads.updatedAt))
      .limit(ASK.LIST_LIMIT)
      .all();
    return c.json({ threads: rows.map((r) => serializeThread(r.thread, r.fileName, r.messageCount)) });
  })

  // API-105: 대화 하나 + 메시지 전부
  .get('/threads/:id', (c) => {
    const id = parseId(c.req.param('id'));
    if (id === null) return fail(c, 400, 'VALIDATION_ERROR', 'id: 올바르지 않은 값');
    const found = findOwnThread(c.get('user').id, id);
    if (!found) return fail(c, 404, 'NOT_FOUND', '대화가 없습니다');
    const messages = db
      .select({ id: askMessages.id, role: askMessages.role, content: askMessages.content, createdAt: askMessages.createdAt })
      .from(askMessages)
      .where(eq(askMessages.threadId, id))
      .orderBy(asc(askMessages.id))
      .all();
    return c.json({ thread: serializeThread(found.thread, found.fileName), messages });
  })

  // API-106: 대화 삭제
  .delete('/threads/:id', (c) => {
    const id = parseId(c.req.param('id'));
    if (id === null) return fail(c, 400, 'VALIDATION_ERROR', 'id: 올바르지 않은 값');
    const found = findOwnThread(c.get('user').id, id);
    if (!found) return fail(c, 404, 'NOT_FOUND', '대화가 없습니다');
    db.delete(askThreads).where(eq(askThreads.id, id)).run();
    return c.json({ ok: true });
  })

  // API-103: 질문 → 답변 SSE 스트리밍. 한도·검증은 스트림을 열기 전에 끝낸다 (그래야 JSON 오류로 답할 수 있다)
  .post('/threads/:id/messages', jsonBody(messageSchema), async (c) => {
    if (!isAskConfigured()) return fail(c, 503, 'ASK_NOT_CONFIGURED', '관리자가 아직 LLM을 연결하지 않았습니다');
    const user = c.get('user');
    const id = parseId(c.req.param('id'));
    if (id === null) return fail(c, 400, 'VALIDATION_ERROR', 'id: 올바르지 않은 값');
    const found = findOwnThread(user.id, id);
    if (!found) return fail(c, 404, 'NOT_FOUND', '대화가 없습니다');

    const used = countQuestionsToday(user.id);
    const limit = dailyLimitFor(user);
    if (limit !== null && used >= limit) {
      return fail(c, 429, 'ASK_LIMIT_EXCEEDED', `오늘 질문 한도(${limit}번)를 다 썼습니다. 내일 다시 물어보세요`);
    }

    const { question, quote } = c.req.valid('json');
    const content = quote ? `「${quote}」\n\n${question}` : question;
    const now = Date.now();
    const isFirst =
      (db.select({ n: sql<number>`count(*)` }).from(askMessages).where(eq(askMessages.threadId, id)).get()?.n ?? 0) === 0;
    // 질문은 답과 무관하게 먼저 저장한다 — LLM이 실패해도 질문 글은 남아 다시 시도할 수 있다 (설계 흐름 L)
    const userMsg = db
      .insert(askMessages)
      .values({ threadId: id, role: 'user', content, createdAt: now })
      .returning()
      .get();
    db.update(askThreads)
      .set({ updatedAt: now, ...(isFirst ? { title: question.slice(0, 60) } : {}) })
      .where(eq(askThreads.id, id))
      .run();

    const history = db.select().from(askMessages).where(eq(askMessages.threadId, id)).orderBy(asc(askMessages.id)).all();
    const apiMessages = toApiMessages(found.thread, history, found.fileName);

    return streamSSE(c, async (stream) => {
      await stream.writeSSE({ event: 'meta', data: JSON.stringify({ userMessageId: userMsg.id, remaining: limit === null ? null : limit - used - 1 }) });
      let text = '';
      try {
        const answer = createAnswerStream(apiMessages);
        stream.onAbort(() => answer.abort());
        for await (const ev of answer) {
          if (ev.type === 'content_block_delta' && ev.delta.type === 'text_delta') {
            text += ev.delta.text;
            await stream.writeSSE({ event: 'delta', data: JSON.stringify({ text: ev.delta.text }) });
          }
        }
        const final = await answer.finalMessage();
        // 길이 초과로 잘린 답은 그대로 두되 사용자가 알게 한다 — 이어 물으면 된다
        if (final.stop_reason === 'max_tokens') text += '\n\n…(답이 길어 여기서 끊었어요. "이어서 설명해 줘"라고 물어보세요)';
        if (final.stop_reason === 'refusal') text = text || '이 질문에는 답할 수 없어요.';
        const saved = db
          .insert(askMessages)
          .values({ threadId: id, role: 'assistant', content: text, createdAt: Date.now() })
          .returning()
          .get();
        db.update(askThreads).set({ updatedAt: saved.createdAt }).where(eq(askThreads.id, id)).run();
        await stream.writeSSE({ event: 'done', data: JSON.stringify({ assistantMessageId: saved.id, content: text }) });
      } catch (e) {
        // assistant 메시지는 저장하지 않는다 — 반쪽 답이 이력에 남아 다음 답을 오염시키지 않게
        await stream.writeSSE({ event: 'error', data: JSON.stringify({ code: 'ASK_UPSTREAM_ERROR', message: describeUpstreamError(e) }) });
      }
    });
  });

export { purgeExpiredThreads };
