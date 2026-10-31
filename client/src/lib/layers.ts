// 기록 스택 — 폰에서 "열린 층"(질문 시트·대화 본문·설정 상세)을 브라우저 기록에 한 층씩 쌓아, 뒤로 가기가
// "맨 위 층 하나 닫기"가 되게 한다. 전에는 주소가 `/f/{id}`일 때만 쌓여 뒤로 가면 문서가 전부 닫혔다 (폰 감사 2026-10-31).
// 주소는 바꾸지 않고 state에 층 번호만 둔다.

type Entry = { id: number; close: () => void };
const stack: Entry[] = [];
let seq = 0;
/** UI가 스스로 닫으며 history.back()을 부른 경우 — 뒤따르는 popstate에서 close를 다시 부르지 않는다 */
let silent = 0;

function layerOf(state: unknown): number {
  return state && typeof state === 'object' && typeof (state as { dvLayer?: unknown }).dvLayer === 'number' ? (state as { dvLayer: number }).dvLayer : 0;
}

/** 층을 연다. 돌려주는 함수는 UI가 스스로 닫을 때 부른다(✕·‹) — 기록도 같이 한 칸 물러난다 */
export function pushLayer(close: () => void): () => void {
  const id = ++seq;
  stack.push({ id, close });
  const base = history.state && typeof history.state === 'object' ? (history.state as Record<string, unknown>) : {};
  history.pushState({ ...base, dvLayer: id }, '', location.href);
  return () => {
    const i = stack.findIndex((e) => e.id === id);
    if (i < 0) return; // 이미 뒤로 가기로 닫혔다
    stack.splice(i);
    if (layerOf(history.state) === id) {
      silent++;
      history.back();
    }
  };
}

window.addEventListener('popstate', (e) => {
  const to = layerOf(e.state);
  const wasSilent = silent > 0;
  if (wasSilent) silent--;
  while (stack.length && stack[stack.length - 1]!.id > to) {
    const top = stack.pop()!;
    if (!wasSilent) top.close();
  }
});

/** 열린 층이 있나 — 주소 기반 뒤로 가기 처리(Workspace)가 층 닫기와 겹치지 않게 */
export const hasLayers = () => stack.length > 0;
