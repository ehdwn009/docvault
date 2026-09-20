/**
 * 문서 안에서 문장을 찾아 형광펜을 칠하고 그리로 스크롤한다 (배움 카드 — 출처 클릭).
 *
 * 카드 출처는 "드래그한 문장"이라 문서의 어느 줄인지 번호로 알 수 없다 — 글자로 찾는다.
 * 문서를 md로 렌더링하면 굵게·링크 때문에 한 문장이 여러 텍스트 노드로 쪼개지므로,
 * 노드를 이어 붙인 한 줄에서 찾고 그 자리를 다시 노드·오프셋으로 되짚는다.
 *
 * HTML 문서는 격리 iframe 안이라 이 코드가 닿지 않는다 — HtmlRenderer의 심에 같은 알고리즘의
 * ES5 복사본이 있다. 규칙을 고치면 양쪽을 같이 고친다.
 */

const NAME = 'dv-source';
/** 문서가 고쳐져 문장 전체가 안 잡히면 이 길이의 앞부분으로 다시 찾는다 */
const HEAD_CHARS = 30;

type HighlightRegistry = { set: (name: string, h: unknown) => void; delete: (name: string) => void };
const registry = (): HighlightRegistry | undefined => (window as unknown as { CSS?: { highlights?: HighlightRegistry } }).CSS?.highlights;
const HighlightCtor = (window as unknown as { Highlight?: new (...ranges: Range[]) => unknown }).Highlight;

/** 공백은 하나로, 앞뒤는 잘라서 — 드래그한 문장과 렌더된 문장은 공백 모양이 다르다 */
const norm = (s: string) => s.replace(/\s+/g, ' ').trim();

export function findQuoteRange(root: Node, quote: string): Range | null {
  const q = norm(quote);
  if (!q) return null;
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const map: { node: Text; offset: number }[] = [];
  let flat = '';
  let lastSpace = true;
  for (let n = walker.nextNode() as Text | null; n; n = walker.nextNode() as Text | null) {
    const tag = n.parentElement?.tagName;
    if (tag === 'SCRIPT' || tag === 'STYLE') continue;
    const t = n.data;
    for (let i = 0; i < t.length; i++) {
      const ch = t[i]!;
      if (/\s/.test(ch)) {
        if (lastSpace) continue;
        flat += ' ';
        map.push({ node: n, offset: i });
        lastSpace = true;
      } else {
        flat += ch;
        map.push({ node: n, offset: i });
        lastSpace = false;
      }
    }
  }
  let at = flat.indexOf(q);
  let len = q.length;
  if (at === -1 && q.length > HEAD_CHARS) {
    const head = q.slice(0, HEAD_CHARS).trim();
    at = flat.indexOf(head);
    len = head.length;
  }
  if (at === -1) return null;
  const s = map[at]!;
  const e = map[at + len - 1]!;
  const range = document.createRange();
  range.setStart(s.node, s.offset);
  range.setEnd(e.node, e.offset + 1);
  return range;
}

export function clearQuoteHighlight(root: HTMLElement) {
  registry()?.delete(NAME);
  root.querySelectorAll(`mark.${NAME}`).forEach((m) => m.replaceWith(...m.childNodes));
}

/** 찾으면 형광펜 + 스크롤하고 true. 못 찾으면 false — 호출자가 "문서가 바뀌었을 수 있다"고 알린다 */
export function highlightQuote(root: HTMLElement, quote: string): boolean {
  clearQuoteHighlight(root);
  const range = findQuoteRange(root, quote);
  if (!range) return false;
  const reg = registry();
  // CSS Custom Highlight API가 있으면 DOM을 안 건드린다 (여러 노드에 걸친 문장도 됨).
  // 없으면 한 노드 안에 있을 때만 <mark>로 감싼다 — 여러 노드면 스크롤만
  if (reg && HighlightCtor) reg.set(NAME, new HighlightCtor(range));
  else if (range.startContainer === range.endContainer) {
    const mark = document.createElement('mark');
    mark.className = NAME;
    range.surroundContents(mark);
  }
  range.startContainer.parentElement?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  return true;
}
