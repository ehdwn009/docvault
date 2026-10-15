import { BRIEFING } from '../../constants.js';

// 브리핑 읽음 기록 — USER_FILE_STATE.read_items(기사 id JSON 배열)와 BRIEFING_RUNS.lead_ids를 다룬다 (v0.43)

/** 저장된 id 배열 JSON을 읽는다. 깨졌거나 비었으면 빈 배열 — 읽음 표시가 사라질 뿐 화면은 멀쩡하다 */
export function parseIdList(raw: string | null | undefined): string[] {
  if (!raw) return [];
  try {
    const v: unknown = JSON.parse(raw);
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
  } catch {
    return [];
  }
}

/** 더하기만 한다 — 교체로 받으면 두 기기에서 동시에 읽을 때 한쪽 기록이 지워진다. 상한을 넘으면 오래된 것부터 버린다 */
export function mergeReadItems(existing: string | null | undefined, add: string[]): string {
  const merged = [...new Set([...parseIdList(existing), ...add])];
  return JSON.stringify(merged.slice(-BRIEFING.READ_ITEMS_MAX));
}

// ---- 틀린 곳 알리기 (v0.45, 개선 합의안 6.2) ----

/** reason: number 숫자가 틀림 · mixed 다른 사건이 섞임 · overstated 과장 · impact 영향 판단이 이상함(v0.46) · explain 해설이 이상함(v0.48) · other */
export type FlagItem = { id: string; at: number; reason: 'number' | 'mixed' | 'overstated' | 'impact' | 'explain' | 'other'; note?: string };

export function parseFlagItems(raw: string | null | undefined): FlagItem[] {
  if (!raw) return [];
  try {
    const v: unknown = JSON.parse(raw);
    return Array.isArray(v) ? (v as FlagItem[]).filter((x) => x && typeof x.id === 'string' && typeof x.at === 'number') : [];
  } catch {
    return [];
  }
}

/** 더하기만 — 같은 기사를 두 번 알리면 뒤의 것이 앞을 대신한다. 상한을 넘으면 오래된 것부터 버린다 */
export function mergeFlagItems(existing: string | null | undefined, add: Omit<FlagItem, 'at'>): string {
  const rest = parseFlagItems(existing).filter((f) => f.id !== add.id);
  const item: FlagItem = { id: add.id, at: Date.now(), reason: add.reason, ...(add.note ? { note: add.note } : {}) };
  return JSON.stringify([...rest, item].slice(-BRIEFING.FLAG_ITEMS_MAX));
}
