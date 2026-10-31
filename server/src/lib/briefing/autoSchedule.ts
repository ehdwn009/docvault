import { randomBytes } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { BRIEFING } from '../../constants.js';
import { db } from '../../db/index.js';
import { userSettings } from '../../db/schema.js';
import { kstParts, kstToMs } from './time.js';

// 자동 생성 타이머 목록 (v0.52, 사용자 결정 2026-10-31) — v0.43의 고정 세 회차(아침·점심·저녁)를 대체한다.
// 타이머 = { id, label, at, on }. 처음엔 하나, [+ 추가]로 최대 TIMERS_MAX개. 켜진 타이머끼리 TIMER_MIN_GAP_MS(2시간) 이상 —
// 회차의 범위가 "직전 회차 끝 ~ 이번 회차 켜짐"이라 가까우면 얇은 회차가 되고, 구독은 한 번에 하나만 돈다.
// user_settings.briefing_schedule에 {"timers":[…]} JSON으로 두고, 옛 {"morning":{…},…} 모양은 읽을 때 타이머 3개로 옮긴다(이름 유지)

export type Timer = { id: string; label: string; at: string; on: boolean };
export type AutoSchedule = { timers: Timer[] };
/** 옛 코드와의 호환용 이름 — 타이머 id */
export type AutoSlot = string;

const pad = (n: number) => String(n).padStart(2, '0');
const toMinutes = (at: string) => Number(at.slice(0, 2)) * 60 + Number(at.slice(3, 5));

export const DEFAULT_SCHEDULE: AutoSchedule = { timers: [{ ...BRIEFING.DEFAULT_TIMER }] };

/** 새 타이머 id — 옛 id(morning·noon·evening)와 겹치지 않게 접두어 + 난수 */
export function newTimerId(): string {
  return BRIEFING.TIMER_ID_PREFIX + randomBytes(8).toString('base64url').replace(/[^a-z0-9]/gi, '').slice(0, BRIEFING.TIMER_ID_RANDOM_CHARS).toLowerCase();
}

const atSchema = z
  .string()
  .regex(/^([01]\d|2[0-3]):[0-5]\d$/, '시각은 HH:MM 형식이어야 합니다')
  // 늦게라도 시작하는 창(AUTO_CATCHUP_MS)이 자정을 넘지 않게 마지막 시각을 막는다 — 넘으면 "오늘 이 회차를 했나"를 날짜로 셀 수 없다
  .refine((at) => toMinutes(at) <= BRIEFING.AUTO_LATEST_MINUTE, `시작 시각은 ${pad(Math.floor(BRIEFING.AUTO_LATEST_MINUTE / 60))}:${pad(BRIEFING.AUTO_LATEST_MINUTE % 60)}까지 고를 수 있어요`);

const timerSchema = z.object({
  /** 빈 문자열이면 서버가 만든다(화면이 [+ 추가]로 보낸 새 줄) */
  id: z.string().max(20).regex(/^[a-z0-9_-]*$/, 'id는 영문 소문자·숫자만'),
  label: z.string().trim().max(BRIEFING.TIMER_LABEL_MAX_CHARS, `이름은 ${BRIEFING.TIMER_LABEL_MAX_CHARS}자까지`),
  at: atSchema,
  on: z.boolean(),
});

/** 타이머 목록 — 개수·간격을 검사하고 시각순으로 정렬해 돌려준다. 화면이 보낸 순서는 믿지 않는다 */
export const scheduleSchema = z
  .object({ timers: z.array(timerSchema).min(1, '타이머가 하나는 있어야 해요').max(BRIEFING.TIMERS_MAX, `타이머는 ${BRIEFING.TIMERS_MAX}개까지`) })
  .transform((s) => ({ timers: [...s.timers].map((t) => ({ ...t, id: t.id || newTimerId() })).sort((a, b) => toMinutes(a.at) - toMinutes(b.at)) }))
  .refine((s) => new Set(s.timers.map((t) => t.id)).size === s.timers.length, '타이머 id가 겹쳐요')
  .refine((s) => {
    const on = s.timers.filter((t) => t.on);
    for (let i = 1; i < on.length; i++) if ((toMinutes(on[i]!.at) - toMinutes(on[i - 1]!.at)) * 60_000 < BRIEFING.TIMER_MIN_GAP_MS) return false;
    return true;
  }, `켜진 타이머는 서로 ${BRIEFING.TIMER_MIN_GAP_MS / 3_600_000}시간 이상 떨어져야 해요`);

/** 옛 모양 {"morning":{on,at},"noon":…,"evening":…} → 타이머 3개 (이름 아침·점심·저녁 그대로) */
function fromLegacy(raw: unknown): AutoSchedule | null {
  if (!raw || typeof raw !== 'object' || 'timers' in raw) return null;
  const obj = raw as Record<string, { on?: unknown; at?: unknown }>;
  const timers: Timer[] = [];
  for (const def of BRIEFING.LEGACY_TIMERS) {
    const v = obj[def.id];
    if (!v || typeof v !== 'object') return null;
    timers.push({ id: def.id, label: def.label, at: typeof v.at === 'string' ? v.at : def.at, on: v.on === true });
  }
  const r = scheduleSchema.safeParse({ timers });
  return r.success ? r.data : null;
}

/** 저장된 글자를 읽는다 — 비었거나 망가졌으면 기본값(타이머 하나). 옛 모양이면 타이머 3개로 */
export function parseSchedule(text: string | null | undefined): AutoSchedule {
  if (!text) return DEFAULT_SCHEDULE;
  try {
    const raw: unknown = JSON.parse(text);
    const legacy = fromLegacy(raw);
    if (legacy) return legacy;
    const r = scheduleSchema.safeParse(raw);
    return r.success ? r.data : DEFAULT_SCHEDULE;
  } catch {
    return DEFAULT_SCHEDULE;
  }
}

export function readSchedule(userId: number): AutoSchedule {
  const row = db.select({ v: userSettings.briefingSchedule }).from(userSettings).where(eq(userSettings.userId, userId)).get();
  return parseSchedule(row?.v);
}

export function timerOf(schedule: AutoSchedule, id: string): Timer | undefined {
  return schedule.timers.find((t) => t.id === id);
}

/** 회차 이름 — 타이머 이름, 비우면 시각("13:00"). 화면은 뒤에 "판"을 붙인다 */
export function timerLabel(t: Pick<Timer, 'label' | 'at'>): string {
  return t.label.trim() || t.at;
}

/** 타이머 id로 회차 이름 — 목록에 없으면(지운 타이머·옛 id) 옛 이름표나 id 그대로 */
export function labelOf(schedule: AutoSchedule, id: string): string {
  const t = timerOf(schedule, id);
  if (t) return timerLabel(t);
  return BRIEFING.LEGACY_TIMERS.find((l) => l.id === id)?.label ?? id;
}

export function startOf(date: string, at: string): number {
  return kstToMs(date, Number(at.slice(0, 2)), Number(at.slice(3, 5)));
}

/** 지금 창(시작 ~ 시작+2시간) 안에 있는 켜진 타이머들 — 시각순 */
export function activeTimers(schedule: AutoSchedule, now: number): Timer[] {
  const { date } = kstParts(now);
  return schedule.timers.filter((t) => {
    const start = startOf(date, t.at);
    return t.on && now >= start && now < start + BRIEFING.AUTO_CATCHUP_MS;
  });
}

/** 지금 이후 가장 가까운 켜진 타이머 — 오늘 남은 것이 없으면 내일 첫 타이머. 켜진 것이 없으면 null */
export function nextAuto(schedule: AutoSchedule, now: number): { at: number; slot: string; label: string } | null {
  const on = schedule.timers.filter((t) => t.on);
  if (on.length === 0) return null;
  const today = kstParts(now).date;
  for (const t of on) {
    const at = startOf(today, t.at);
    if (at > now) return { at, slot: t.id, label: timerLabel(t) };
  }
  const tomorrow = kstParts(now + 24 * 60 * 60 * 1000).date;
  const first = on[0]!;
  return { at: startOf(tomorrow, first.at), slot: first.id, label: timerLabel(first) };
}
