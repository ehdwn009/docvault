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
