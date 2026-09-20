import { and, eq, isNull } from 'drizzle-orm';
import { Hono } from 'hono';
import { z } from 'zod';
import { CARD } from '../constants.js';
import { db } from '../db/index.js';
import { cardThreads, files } from '../db/schema.js';
import { isAskConfigured, describeUpstreamError } from '../lib/ask.js';
import {
  createCardFile,
  draftCard,
  findExactCard,
  listCards,
  loadThreadForCard,
  mergeCard,
  outlineThread,
  sourceLine,
  titleOf,
  type CardSummary,
} from '../lib/cards.js';
import { buildAnkiCsv, buildGlossaryMd } from '../lib/cardExport.js';
import { gradeCard, listDueCards } from '../lib/cardReview.js';
import { saveTextContent } from '../lib/content.js';
import { fail } from '../lib/errors.js';
import { CARD_KINDS, cleanListItem, joinCard, splitCard, type CardFrontmatter } from '../lib/frontmatter.js';
import { jsonBody, parseId } from '../lib/validate.js';
import type { AppEnv } from '../types.js';

// API-111~120: 배움 카드 (2판). 카드 = files의 md(kind='card'). 소유자만 다룬다 — 공유는 파일 공유 토글 그대로

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
const draftSchema = z
  .object({
    threadId: z.number().int().positive(),
    /** 이 답 하나로 */
    messageId: z.number().int().positive().optional(),
    /** 고른 답들로 (답 골라 담기). 둘 다 없으면 대화 전체 */
    messageIds: z.array(z.number().int().positive()).min(1).max(CARD.MAX_PICKED_MESSAGES).optional(),
  })
  .refine((v) => v.messageId === undefined || v.messageIds === undefined, { message: 'messageId와 messageIds는 함께 줄 수 없습니다' });
const outlineSchema = z.object({ threadId: z.number().int().positive() });
const exportQuerySchema = z.object({
  format: z.enum(['md', 'csv']).default('md'),
  /** 쉼표로 이은 주제 목록. 없으면 전체. 주제 없음은 NO_TOPIC_MARK */
  topics: z.string().max(2000).optional(),
});
const exportBodySchema = z.object({ topics: z.array(z.string().trim().max(40)).max(50).optional() });
const reviewSchema = z.object({ result: z.enum(['ok', 'again']) });

/** 범위 필터 — topics가 없으면 전부, 있으면 그 주제(들)만. '-'는 주제 없음 */
function pickByTopics(cards: CardSummary[], topics: string[] | undefined): CardSummary[] {
  if (!topics || topics.length === 0) return cards;
  const set = new Set(topics);
  return cards.filter((c) => set.has(c.topic || CARD.NO_TOPIC_MARK));
}
const batchItemSchema = frontSchema.extend({
  title: z.string().trim().min(1).max(80),
  body: z.string().max(CARD.BODY_MAX_CHARS).default(''),
  /** 있으면 새 카드가 아니라 그 카드에 이어 쓴다 (본문은 재구성된 전체) */
  existingCardId: z.number().int().positive().optional(),
});
const batchSchema = z
  .object({
    threadId: z.number().int().positive(),
    items: z.array(batchItemSchema).max(CARD.OUTLINE_MAX_CONCEPTS),
    /** 개념 카드들을 엮는 주제 카드 — 선택 */
    topic: z
      .object({
        title: z.string().trim().min(1).max(80),
        oneLine: z.string().trim().min(1).max(CARD.ONE_LINE_MAX_CHARS),
        body: z.string().max(CARD.BODY_MAX_CHARS).default(''),
        topic: z.string().trim().max(40).default(''),
        tags: listField.default([]),
      })
      .optional(),
  })
  .refine((v) => v.items.length > 0 || v.topic !== undefined, { message: '저장할 카드가 없습니다' });
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

  // API-118: 내보내기 — 용어집 md / Anki CSV를 텍스트로. LLM 없음. 미리보기와 다운로드가 같은 경로를 쓴다
  .get('/export', (c) => {
    const parsed = exportQuerySchema.safeParse(c.req.query());
    if (!parsed.success) return fail(c, 400, 'VALIDATION_ERROR', parsed.error.issues.map((i) => i.message).join('; '));
    const user = c.get('user');
    const topics = parsed.data.topics?.split(',').map((t) => t.trim()).filter(Boolean);
    const cards = pickByTopics(listCards(user.id), topics);
    const ymd = new Date().toISOString().slice(0, 10);
    if (parsed.data.format === 'md') {
      c.header('Content-Type', 'text/markdown; charset=utf-8');
      c.header('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(`용어집 ${ymd}.md`)}`);
      return c.body(buildGlossaryMd(cards, new Date()));
    }
    // Anki 뒷면에는 본문 앞부분이 들어가므로 여기서만 본문을 읽는다
    const withBody = cards
      .filter((k) => k.kind !== '주제')
      .map((summary) => ({ summary, body: splitCard(findOwnCard(user.id, summary.id)?.contentText ?? '').body }));
    c.header('Content-Type', 'text/csv; charset=utf-8');
    c.header('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(`배움카드-anki-${ymd}.csv`)}`);
    return c.body(buildAnkiCsv(withBody));
  })

  // API-118: 용어집을 내 파일에 넣기 — 최상위의 "용어집.md" 하나를 만들거나 갱신한다 (갱신은 편집기 저장과 같은 스냅샷 규칙)
  .post('/export', jsonBody(exportBodySchema), (c) => {
    const user = c.get('user');
    const cards = pickByTopics(listCards(user.id), c.req.valid('json').topics);
    const content = buildGlossaryMd(cards, new Date());
    const existing = db
      .select()
      .from(files)
      .where(and(eq(files.ownerId, user.id), isNull(files.folderId), eq(files.name, CARD.GLOSSARY_FILE_NAME), eq(files.kind, 'doc'), isNull(files.deletedAt)))
      .get();
    if (existing && existing.contentText !== null) {
      const saved = saveTextContent({ id: existing.id, contentText: existing.contentText, sizeBytes: existing.sizeBytes }, content, user.id);
      return c.json({ file: { id: existing.id, name: existing.name, fileType: 'md', updatedAt: saved.updatedAt }, updated: true, count: cards.length });
    }
    const now = Date.now();
    const row = db
      .insert(files)
      .values({
        ownerId: user.id,
        folderId: null,
        name: CARD.GLOSSARY_FILE_NAME,
        fileType: 'md',
        mimeType: 'text/markdown',
        sizeBytes: Buffer.byteLength(content, 'utf8'),
        contentText: content,
        storagePath: null,
        kind: 'doc',
        createdAt: now,
        updatedAt: now,
      })
      .returning()
      .get();
    return c.json({ file: { id: row.id, name: row.name, fileType: 'md', updatedAt: row.updatedAt }, updated: false, count: cards.length }, 201);
  })

  // API-119: 오늘 복습할 카드 — 예정 시각이 지난 것, 오래된 순, 하루 상한. /:id보다 먼저 (review가 id로 안 잡히게)
  .get('/review', (c) => c.json(listDueCards(c.get('user').id)))

  // API-112: 초안 + 비슷한 카드 판단 (LLM). 제목·별칭이 정확히 같은 카드는 LLM 없이도 잡는다
  .post('/draft', jsonBody(draftSchema), async (c) => {
    if (!isAskConfigured()) return fail(c, 503, 'ASK_NOT_CONFIGURED', '관리자가 아직 LLM을 연결하지 않았습니다');
    const user = c.get('user');
    const { threadId, messageId, messageIds } = c.req.valid('json');
    const t = loadThreadForCard(user.id, threadId, { messageId, messageIds });
    if (!t) return fail(c, 404, 'NOT_FOUND', '대화가 없습니다');
    const existing = listCards(user.id);
    try {
      // 답 하나면 그 답의 개념 하나, 여럿(고른 답·대화 전체)이면 아우르는 한 장
      const draft = await draftCard(t, existing, messageId !== undefined ? 'one' : 'all');
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
    if (body.threadId !== undefined) {
      const t = loadThreadForCard(user.id, body.threadId);
      if (!t) return fail(c, 404, 'NOT_FOUND', '대화가 없습니다');
      front.sources = [sourceLine(t)];
    }
    const taken = new Set(listCards(user.id).map((k) => `${k.title}.md`));
    const row = createCardFile(db, user.id, body.title, front, body.body, taken);
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
  })

  // API-120: 채점 — 몰랐다(내일) / 알았다(간격 두 배). 열람 상태 표의 복습 칸만 갱신
  .post('/:id/review', jsonBody(reviewSchema), (c) => {
    const user = c.get('user');
    const id = parseId(c.req.param('id'));
    if (id === null) return fail(c, 400, 'VALIDATION_ERROR', 'id: 올바르지 않은 값');
    if (!findOwnCard(user.id, id)) return fail(c, 404, 'NOT_FOUND', '카드가 없습니다');
    return c.json(gradeCard(user.id, id, c.req.valid('json').result));
  })

  // API-116: 대화 정리 — 대화 하나 → 개념 N개 초안 + 주제 카드 초안. 기존 카드와 같은 개념은 이어쓰기로 표시하고,
  // 그 항목은 재구성(API-113과 같은 LLM 호출)까지 미리 해 둔다 — 저장(API-117)은 LLM 없이 빠르고 원자적이게
  .post('/outline', jsonBody(outlineSchema), async (c) => {
    if (!isAskConfigured()) return fail(c, 503, 'ASK_NOT_CONFIGURED', '관리자가 아직 LLM을 연결하지 않았습니다');
    const user = c.get('user');
    const { threadId } = c.req.valid('json');
    const t = loadThreadForCard(user.id, threadId);
    if (!t) return fail(c, 404, 'NOT_FOUND', '대화가 없습니다');
    const existing = listCards(user.id);
    try {
      const outline = await outlineThread(t, existing);
      const items = await Promise.all(
        outline.concepts.map(async (concept) => {
          const card = concept.existingCardId !== null ? existing.find((x) => x.id === concept.existingCardId) ?? null : null;
          if (!card) return { concept, existing: null, merged: null };
          const row = findOwnCard(user.id, card.id);
          const { front, body } = splitCard(row?.contentText ?? '');
          const merged = await mergeCard(card.title, front, body, t, undefined);
          return { concept, existing: card, merged };
        }),
      );
      return c.json({ items, topic: outline.topic, source: sourceLine(t) });
    } catch (e) {
      return fail(c, 502, 'ASK_UPSTREAM_ERROR', describeUpstreamError(e));
    }
  })

  // API-117: 묶음 저장 — 체크한 개념 카드들(새로/이어쓰기) + 주제 카드를 한 트랜잭션으로. LLM 없음.
  // 되돌리기용으로 새로 만든 카드 id와 이어쓴 카드의 저장 전 버전 id를 돌려준다
  .post('/batch', jsonBody(batchSchema), (c) => {
    const user = c.get('user');
    const body = c.req.valid('json');
    const t = loadThreadForCard(user.id, body.threadId);
    if (!t) return fail(c, 404, 'NOT_FOUND', '대화가 없습니다');
    const source = sourceLine(t);
    const existingRows = new Map<number, NonNullable<ReturnType<typeof findOwnCard>>>();
    for (const item of body.items) {
      if (item.existingCardId === undefined) continue;
      const row = findOwnCard(user.id, item.existingCardId);
      if (!row || row.contentText === null) return fail(c, 404, 'NOT_FOUND', `이어 쓸 카드가 없습니다 (id ${item.existingCardId})`);
      existingRows.set(item.existingCardId, row);
    }
    const taken = new Set(listCards(user.id).map((k) => `${k.title}.md`));
    const topicTitle = body.topic?.title;
    const conceptTitles = body.items.map((i) => i.title);

    const result = db.transaction((tx) => {
      const created: CardSummary[] = [];
      const merged: { card: CardSummary; versionId: number }[] = [];
      const summary = (row: { id: number; name: string; updatedAt: number }, front: CardFrontmatter): CardSummary => ({
        id: row.id,
        title: titleOf(row.name),
        updatedAt: row.updatedAt,
        ...front,
      });
      for (const item of body.items) {
        const front = cleanFront(item);
        // 주제 카드가 있으면 개념 카드마다 그쪽으로 가는 연결을 하나 더 — 양방향이어야 서랍에서 오갈 수 있다
        if (topicTitle && !front.links.includes(topicTitle)) front.links.push(topicTitle);
        const row = item.existingCardId !== undefined ? existingRows.get(item.existingCardId) : undefined;
        if (row) {
          const { front: prev } = splitCard(row.contentText ?? '');
          front.sources = prev.sources.includes(source) ? [...prev.sources] : [...prev.sources, source];
          const saved = saveTextContent({ id: row.id, contentText: row.contentText ?? '', sizeBytes: row.sizeBytes }, joinCard(front, item.body), user.id, tx);
          tx.insert(cardThreads).values({ cardFileId: row.id, threadId: body.threadId, createdAt: Date.now() }).onConflictDoNothing().run();
          merged.push({ card: summary({ id: row.id, name: row.name, updatedAt: saved.updatedAt }, front), versionId: saved.versionId });
        } else {
          front.sources = [source];
          const made = createCardFile(tx, user.id, item.title, front, item.body, taken);
          tx.insert(cardThreads).values({ cardFileId: made.id, threadId: body.threadId, createdAt: Date.now() }).onConflictDoNothing().run();
          created.push(summary(made, front));
        }
      }
      let topic: CardSummary | null = null;
      if (body.topic) {
        const front: CardFrontmatter = {
          oneLine: body.topic.oneLine,
          aliases: [],
          kind: '주제',
          topic: body.topic.topic,
          tags: body.topic.tags.map(cleanListItem).filter(Boolean),
          links: conceptTitles.map(cleanListItem).filter(Boolean).slice(0, CARD.MAX_LIST_ITEMS),
          sources: [source],
        };
        const made = createCardFile(tx, user.id, body.topic.title, front, body.topic.body, taken);
        tx.insert(cardThreads).values({ cardFileId: made.id, threadId: body.threadId, createdAt: Date.now() }).onConflictDoNothing().run();
        topic = summary(made, front);
      }
      return { created, merged, topic };
    });
    return c.json(result, 201);
  });
