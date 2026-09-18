import { and, eq, isNull } from 'drizzle-orm';
import { Hono } from 'hono';
import { z } from 'zod';
import { CARD } from '../constants.js';
import { db } from '../db/index.js';
import { cardThreads, files } from '../db/schema.js';
import { isAskConfigured, describeUpstreamError } from '../lib/ask.js';
import { draftCard, findExactCard, listCards, loadThreadForCard, mergeCard, sourceLine, titleOf } from '../lib/cards.js';
import { saveTextContent } from '../lib/content.js';
import { fail } from '../lib/errors.js';
import { CARD_KINDS, cleanListItem, joinCard, splitCard, type CardFrontmatter } from '../lib/frontmatter.js';
import { sanitizeUploadName, uniqueFileName } from '../lib/naming.js';
import { jsonBody, parseId } from '../lib/validate.js';
import type { AppEnv } from '../types.js';

// API-111~116: 배움 카드 (2판). 카드 = files의 md(kind='card'). 소유자만 다룬다 — 공유는 파일 공유 토글 그대로

const listField = z.array(z.string().trim().min(1).max(60)).max(CARD.MAX_LIST_ITEMS);
const frontSchema = z.object({
  oneLine: z.string().trim().min(1).max(CARD.ONE_LINE_MAX_CHARS),
  aliases: listField.default([]),
  kind: z.enum(CARD_KINDS).default('개념'),
  topic: z.string().trim().max(40).default(''),
  tags: listField.default([]),
  links: listField.default([]),
});
const createSchema = frontSchema.extend({
  title: z.string().trim().min(1).max(80),
  body: z.string().max(CARD.BODY_MAX_CHARS).default(''),
  /** 이 대화에서 나온 카드 — 출처 한 줄이 붙고, 대화는 30일 정리에서 빠진다 */
  threadId: z.number().int().positive().optional(),
});
const updateSchema = frontSchema.extend({
  body: z.string().max(CARD.BODY_MAX_CHARS).default(''),
  threadId: z.number().int().positive().optional(),
});
const draftSchema = z.object({
  threadId: z.number().int().positive(),
  /** 이 답 하나로 — 없으면 대화 전체 */
  messageId: z.number().int().positive().optional(),
});
const mergePreviewSchema = z.object({
  cardId: z.number().int().positive(),
  threadId: z.number().int().positive(),
  instruction: z.string().trim().max(300).optional(),
});

function cleanFront(f: z.infer<typeof frontSchema>): CardFrontmatter {
  return {
    oneLine: f.oneLine,
    aliases: f.aliases.map(cleanListItem).filter(Boolean),
    kind: f.kind,
    topic: f.topic,
    tags: f.tags.map(cleanListItem).filter(Boolean),
    links: f.links.map(cleanListItem).filter(Boolean),
    sources: [],
  };
}

function findOwnCard(ownerId: number, id: number) {
  return db
    .select()
    .from(files)
    .where(and(eq(files.id, id), eq(files.ownerId, ownerId), eq(files.kind, 'card'), isNull(files.deletedAt)))
    .get();
}

function linkThread(cardId: number, threadId: number) {
  db.insert(cardThreads).values({ cardFileId: cardId, threadId, createdAt: Date.now() }).onConflictDoNothing().run();
}

export const cardRoutes = new Hono<AppEnv>()

  // API-111: 내 카드 목록 (머리말 요약)
  .get('/', (c) => c.json({ cards: listCards(c.get('user').id) }))

  // API-112: 초안 + 비슷한 카드 판단 (LLM). 제목·별칭이 정확히 같은 카드는 LLM 없이도 잡는다
  .post('/draft', jsonBody(draftSchema), async (c) => {
    if (!isAskConfigured()) return fail(c, 503, 'ASK_NOT_CONFIGURED', '관리자가 아직 LLM을 연결하지 않았습니다');
    const user = c.get('user');
    const { threadId, messageId } = c.req.valid('json');
    const t = loadThreadForCard(user.id, threadId, messageId);
    if (!t) return fail(c, 404, 'NOT_FOUND', '대화가 없습니다');
    const existing = listCards(user.id);
    try {
      const draft = await draftCard(t, existing);
      const exact = findExactCard(existing, draft.title, draft.aliases);
      if (exact && (!draft.similar || draft.similar.cardId !== exact.id)) {
        draft.similar = { cardId: exact.id, relation: 'same', reason: `"${exact.title}" 카드가 이미 있어요 (제목 또는 별칭이 같음)`, recommendation: 'merge' };
      }
      const similarCard = draft.similar ? existing.find((x) => x.id === draft.similar!.cardId) ?? null : null;
      return c.json({ draft, similarCard, source: sourceLine(t) });
    } catch (e) {
      return fail(c, 502, 'ASK_UPSTREAM_ERROR', describeUpstreamError(e));
    }
  })

  // API-113: 합친 결과 미리보기 (LLM 재구성). 저장은 API-115로
  .post('/merge-preview', jsonBody(mergePreviewSchema), async (c) => {
    if (!isAskConfigured()) return fail(c, 503, 'ASK_NOT_CONFIGURED', '관리자가 아직 LLM을 연결하지 않았습니다');
    const user = c.get('user');
    const { cardId, threadId, instruction } = c.req.valid('json');
    const card = findOwnCard(user.id, cardId);
    if (!card) return fail(c, 404, 'NOT_FOUND', '카드가 없습니다');
    const t = loadThreadForCard(user.id, threadId);
    if (!t) return fail(c, 404, 'NOT_FOUND', '대화가 없습니다');
    const { front, body } = splitCard(card.contentText ?? '');
    try {
      const merged = await mergeCard(titleOf(card.name), front, body, t, instruction);
      return c.json({ merged, current: { title: titleOf(card.name), front, body }, source: sourceLine(t) });
    } catch (e) {
      return fail(c, 502, 'ASK_UPSTREAM_ERROR', describeUpstreamError(e));
    }
  })

  // API-114: 카드 만들기 — md 파일 생성 (kind='card'). 이름 = 제목.md, 겹치면 (2)
  .post('/', jsonBody(createSchema), (c) => {
    const user = c.get('user');
    const body = c.req.valid('json');
    const front = cleanFront(body);
    let threadSource: string | null = null;
    if (body.threadId !== undefined) {
      const t = loadThreadForCard(user.id, body.threadId);
      if (!t) return fail(c, 404, 'NOT_FOUND', '대화가 없습니다');
      threadSource = sourceLine(t);
      front.sources = [threadSource];
    }
    const base = sanitizeUploadName(body.title.replace(/\.md$/i, '')) + '.md';
    const mine = listCards(user.id).map((k) => `${k.title}.md`);
    const name = uniqueFileName(base, (n) => mine.includes(n));
    const content = joinCard(front, body.body);
    const now = Date.now();
    const row = db
      .insert(files)
      .values({
        ownerId: user.id,
        folderId: null,
        name,
        fileType: 'md',
        mimeType: 'text/markdown',
        sizeBytes: Buffer.byteLength(content, 'utf8'),
        contentText: content,
        storagePath: null,
        kind: 'card',
        createdAt: now,
        updatedAt: now,
      })
      .returning()
      .get();
    if (body.threadId !== undefined) linkThread(row.id, body.threadId);
    return c.json({ card: { id: row.id, title: titleOf(row.name), name: row.name, updatedAt: row.updatedAt, ...front } }, 201);
  })

  // API-115: 카드 머리말·본문 갱신 (재구성 저장). 버전 스냅샷은 편집기 저장과 같은 규칙. 출처는 지우지 않고 더한다
  .put('/:id', jsonBody(updateSchema), (c) => {
    const user = c.get('user');
    const id = parseId(c.req.param('id'));
    if (id === null) return fail(c, 400, 'VALIDATION_ERROR', 'id: 올바르지 않은 값');
    const card = findOwnCard(user.id, id);
    if (!card || card.contentText === null) return fail(c, 404, 'NOT_FOUND', '카드가 없습니다');
    const body = c.req.valid('json');
    const { front: prev } = splitCard(card.contentText);
    const front = cleanFront(body);
    front.sources = [...prev.sources];
    if (body.threadId !== undefined) {
      const t = loadThreadForCard(user.id, body.threadId);
      if (!t) return fail(c, 404, 'NOT_FOUND', '대화가 없습니다');
      const s = sourceLine(t);
      if (!front.sources.includes(s)) front.sources.push(s);
    }
    const content = joinCard(front, body.body);
    const result = saveTextContent({ id: card.id, contentText: card.contentText, sizeBytes: card.sizeBytes }, content, user.id);
    if (body.threadId !== undefined) linkThread(card.id, body.threadId);
    return c.json({ card: { id: card.id, title: titleOf(card.name), name: card.name, updatedAt: result.updatedAt, ...front } });
  });
