import { z } from 'zod';
import { OUTLOOK } from '../../constants.js';

// 세계 전망 완성본(format 1)의 모양 — 스킬(outlook-report)이 쓰고, outlook:job build와 (나중의) 서버가 같은 정의로 읽는다.
// 정본 설명은 .claude/skills/outlook-report/references/schema.md

const Quote = z.object({ note: z.number().int().positive(), quote: z.string().min(1).max(OUTLOOK.QUOTE_MAX_CHARS) });
const Calc = z.object({ calc: z.string().min(3).max(300), uses: z.array(z.string()).max(12).default([]) });
export const FactSchema = z.union([Quote, Calc]);
export type Fact = z.infer<typeof FactSchema>;

const ids = z.array(z.string().max(40)).max(30).default([]);
const Text = z.string().min(1).max(OUTLOOK.TEXT_MAX_CHARS);

const Block = z.discriminatedUnion('type', [
  z.object({ type: z.literal('p'), text: Text, facts: ids }),
  z.object({ type: z.literal('bullets'), items: z.array(z.object({ lead: z.string().max(80).optional(), text: Text, facts: ids })).min(1).max(10) }),
  z.object({
    type: z.literal('table'),
    title: z.string().max(120).optional(),
    note: z.string().max(300).optional(),
    columns: z.array(z.string().max(40)).min(2).max(6),
    rows: z.array(z.array(z.string().max(120)).min(2).max(6)).min(1).max(20),
    facts: ids,
  }),
  // 가로 막대 하나짜리 도표 — 같은 기준의 숫자만. 세션은 이름·값 줄만 보내고 그림은 화면 틀이 그린다(설계 10단계)
  z.object({
    type: z.literal('chart'),
    title: z.string().min(1).max(120),
    note: z.string().max(300).optional(),
    unit: z.string().max(12).default(''),
    rows: z.array(z.object({ label: z.string().min(1).max(40), sub: z.string().max(60).optional(), value: z.number(), text: z.string().min(1).max(30) })).min(2).max(16),
    facts: ids,
  }),
]);
export type OutlookBlock = z.infer<typeof Block>;

const Note = z.object({
  n: z.number().int().positive(),
  org: z.string().min(1).max(80),
  title: z.string().min(1).max(200),
  /** 발표일 — 'YYYY-MM-DD'(일을 모르면 'YYYY-MM') */
  date: z.string().regex(/^\d{4}-\d{2}(-\d{2})?$/),
  url: z.string().url().max(600),
  /** 읽는 기간 밖 자료를 비교 맥락으로만 쓸 때 그 이유 — 없으면 기간 안이어야 한다 */
  context: z.string().max(200).optional(),
});
export type OutlookNote = z.infer<typeof Note>;

export const OutlookDataSchema = z.object({
  format: z.literal(1),
  meta: z.object({
    edition: z.enum(['big', 'small']),
    title: z.string().min(1).max(80),
    subtitle: z.string().max(160).default(''),
    /** 판 이름 — "2026년 12월 첫째 판", "2027년 세계 경제 전망" */
    label: z.string().min(1).max(60),
    since: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    until: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    /** 작은 판이 견주는 기준선 판의 이름 */
    baseline: z.string().max(120).optional(),
    /** 시험 운행이면 화면 머리에 그렇다고 적는다 */
    test: z.boolean().default(false),
    generator: z.string().max(80).optional(),
  }),
  summary: z.array(z.object({ text: Text, facts: ids })).min(1).max(5),
  sections: z.array(z.object({ id: z.string().regex(/^[a-z0-9-]{1,30}$/), title: z.string().min(1).max(80), blocks: z.array(Block).min(1).max(14) })).min(2).max(10),
  about: z.object({ title: z.string().min(1).max(40), text: Text, facts: ids }),
  notes: z.array(Note).min(1).max(120),
  facts: z.record(FactSchema),
});
export type OutlookData = z.infer<typeof OutlookDataSchema>;
