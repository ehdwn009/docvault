import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { BRIEFING } from '../../constants.js';
import { db } from '../../db/index.js';
import { userSettings } from '../../db/schema.js';
import { kstParts, kstToMs } from './time.js';

// 자동 생성 시각 — 아침·점심·저녁마다 켜기/끄기와 시작 시각을 사람이 정한다 (v0.43, 사용자 요청).
// user_settings.briefing_schedule에 JSON으로 두고, 비어 있으면 기본값(06:30·11:30·17:30 모두 켬)이다

export type AutoSlot = (typeof BRIEFING.AUTO_SLOTS)[number]['slot'];
export type SlotSetting = { on: boolean; at: string };
export type AutoSchedule = Record<AutoSlot, SlotSetting>;

const pad = (n: number) => String(n).padStart(2, '0');
const toMinutes = (at: string) => Number(at.slice(0, 2)) * 60 + Number(at.slice(3, 5));

export const DEFAULT_SCHEDULE: AutoSchedule = Object.fromEntries(
  BRIEFING.AUTO_SLOTS.map((s) => [s.slot, { on: true, at: `${pad(s.hour)}:${pad(s.minute)}` }]),
) as AutoSchedule;

const slotSchema = z.object({
  on: z.boolean(),
  // 늦게라도 시작하는 창(AUTO_CATCHUP_MS)이 자정을 넘지 않게 마지막 시각을 막는다 — 넘으면 "오늘 이 회차를 했나"를 날짜로 셀 수 없다
  at: z
    .string()
    .regex(/^([01]\d|2[0-3]):[0-5]\d$/, '시각은 HH:MM 형식이어야 합니다')
    .refine((at) => toMinutes(at) <= BRIEFING.AUTO_LATEST_MINUTE, `시작 시각은 ${pad(Math.floor(BRIEFING.AUTO_LATEST_MINUTE / 60))}:${pad(BRIEFING.AUTO_LATEST_MINUTE % 60)}까지 고를 수 있어요`),
});

/** 아침 < 점심 < 저녁 순서를 지킨다 — 회차 이름(아침판·점심판·저녁판)이 시각과 어긋나지 않게 */
export const scheduleSchema = z
  .object({ morning: slotSchema, noon: slotSchema, evening: slotSchema })
  .refine((s) => toMinutes(s.morning.at) < toMinutes(s.noon.at) && toMinutes(s.noon.at) < toMinutes(s.evening.at), '아침 → 점심 → 저녁 순서로 시각을 골라 주세요');

/** 저장된 글자를 읽는다 — 비었거나 망가졌으면 기본값 */
export function parseSchedule(text: string | null | undefined): AutoSchedule {
  if (!text) return DEFAULT_SCHEDULE;
  try {
    const r = scheduleSchema.safeParse(JSON.parse(text));
    return r.success ? r.data : DEFAULT_SCHEDULE;
  } catch {
    return DEFAULT_SCHEDULE;
  }
}

export function readSchedule(userId: number): AutoSchedule {
  const row = db.select({ v: userSettings.briefingSchedule }).from(userSettings).where(eq(userSettings.userId, userId)).get();
  return parseSchedule(row?.v);
}

function startOf(date: string, at: string): number {
  return kstToMs(date, Number(at.slice(0, 2)), Number(at.slice(3, 5)));
}

/** 지금 창(시작 ~ 시작+2시간) 안에 있는 켜진 회차들 — 시각 순 */
export function activeSlots(schedule: AutoSchedule, now: number): AutoSlot[] {
  const { date } = kstParts(now);
  return BRIEFING.AUTO_SLOTS.map((s) => s.slot).filter((slot) => {
    const { on, at } = schedule[slot];
    const start = startOf(date, at);
    return on && now >= start && now < start + BRIEFING.AUTO_CATCHUP_MS;
  });
}

/** 지금 이후 가장 가까운 켜진 회차 — 오늘 남은 것이 없으면 내일 첫 회차. 켜진 회차가 없으면 null */
export function nextAuto(schedule: AutoSchedule, now: number): { at: number; slot: AutoSlot } | null {
  const slots = BRIEFING.AUTO_SLOTS.map((s) => s.slot).filter((slot) => schedule[slot].on);
  if (slots.length === 0) return null;
  const today = kstParts(now).date;
  for (const slot of slots) {
    const at = startOf(today, schedule[slot].at);
    if (at > now) return { at, slot };
  }
  const tomorrow = kstParts(now + 24 * 60 * 60 * 1000).date;
  const first = slots[0]!;
  return { at: startOf(tomorrow, schedule[first].at), slot: first };
}
