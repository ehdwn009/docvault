/**
 * 문서 안에서 글자를 찾아 표시하는 도구 (배움 카드).
 *  - highlightQuote: 출처 클릭 — 문장 하나를 찾아 형광펜 + 스크롤
 *  - markTerms: 내 카드의 제목·별칭이 나오는 자리에 점선 밑줄 (문단마다 첫 등장만)
 *
 * 카드 출처는 "드래그한 문장"이라 문서의 어느 줄인지 번호로 알 수 없다 — 글자로 찾는다.
 * 문서를 md로 렌더링하면 굵게·링크 때문에 한 문장이 여러 텍스트 노드로 쪼개지므로,
 * 노드를 이어 붙인 한 줄에서 찾고 그 자리를 다시 노드·오프셋으로 되짚는다.
 *
 * 표시는 CSS Custom Highlight API로 한다 — DOM을 안 건드려서 React가 그린 노드와 다투지 않는다
 * (텍스트 노드를 쪼개 <mark>로 감싸면 React가 다음 렌더에서 그 노드를 못 찾는다).
 * API가 없는 브라우저에서는 출처 형광펜만 <mark>로 대신하고, 용어 밑줄은 그리지 않는다.
 *
 * HTML 문서는 격리 iframe 안이라 이 코드가 닿지 않는다 — HtmlRenderer의 심에 같은 알고리즘의
 * ES5 복사본이 있다. 규칙을 고치면 양쪽을 같이 고친다.
 */

const QUOTE_NAME = 'dv-source';
const TERM_NAME = 'dv-term';
/** 문서가 고쳐져 문장 전체가 안 잡히면 이 길이의 앞부분으로 다시 찾는다 */
const HEAD_CHARS = 30;
/** 용어 밑줄 상한 — 긴 문서에서 수천 개를 칠하면 느려지고 읽기에도 방해된다 */
const TERM_MAX = 300;
/** 용어가 이 안에 있으면 밑줄을 긋지 않는다 — 코드·링크 속 글자는 용어가 아니라 기호다 */
const TERM_SKIP = 'a, code, pre, kbd';

type HighlightRegistry = { set: (name: string, h: unknown) => void; delete: (name: string) => void };
const registry = (): HighlightRegistry | undefined => (window as unknown as { CSS?: { highlights?: HighlightRegistry } }).CSS?.highlights;
const HighlightCtor = (window as unknown as { Highlight?: new (...ranges: Range[]) => unknown }).Highlight;

/** 공백은 하나로, 앞뒤는 잘라서 — 드래그한 문장과 렌더된 문장은 공백 모양이 다르다 */
const norm = (s: string) => s.replace(/\s+/g, ' ').trim();

type Flat = { text: string; map: { node: Text; offset: number }[] };

/** 텍스트 노드들을 한 줄로 잇는다 (공백은 하나로 접고, 각 글자가 어느 노드의 몇 번째인지 기억) */
function flatten(root: Node): Flat {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const map: Flat['map'] = [];
  let text = '';
  let lastSpace = true;
  for (let n = walker.nextNode() as Text | null; n; n = walker.nextNode() as Text | null) {
    const tag = n.parentElement?.tagName;
    if (tag === 'SCRIPT' || tag === 'STYLE') continue;
    const t = n.data;
    for (let i = 0; i < t.length; i++) {
      const ch = t[i]!;
      if (/\s/.test(ch)) {
        if (lastSpace) continue;
        text += ' ';
        map.push({ node: n, offset: i });
        lastSpace = true;
      } else {
        text += ch;
        map.push({ node: n, offset: i });
        lastSpace = false;
      }
    }
  }
  return { text, map };
}

function rangeOf(flat: Flat, at: number, len: number): Range {
  const s = flat.map[at]!;
  const e = flat.map[at + len - 1]!;
  const range = document.createRange();
  range.setStart(s.node, s.offset);
  range.setEnd(e.node, e.offset + 1);
  return range;
}

export function findQuoteRange(root: Node, quote: string): Range | null {
  const q = norm(quote);
  if (!q) return null;
  const flat = flatten(root);
  let at = flat.text.indexOf(q);
  let len = q.length;
  if (at === -1 && q.length > HEAD_CHARS) {
    const head = q.slice(0, HEAD_CHARS).trim();
    at = flat.text.indexOf(head);
    len = head.length;
  }
  return at === -1 ? null : rangeOf(flat, at, len);
}

export function clearQuoteHighlight(root: HTMLElement) {
  registry()?.delete(QUOTE_NAME);
  root.querySelectorAll(`mark.${QUOTE_NAME}`).forEach((m) => m.replaceWith(...m.childNodes));
}

/** 찾으면 형광펜 + 스크롤하고 true. 못 찾으면 false — 호출자가 "문서가 바뀌었을 수 있다"고 알린다 */
export function highlightQuote(root: HTMLElement, quote: string): boolean {
  clearQuoteHighlight(root);
  const range = findQuoteRange(root, quote);
  if (!range) return false;
  const reg = registry();
  if (reg && HighlightCtor) reg.set(QUOTE_NAME, new HighlightCtor(range));
  else if (range.startContainer === range.endContainer) {
    const mark = document.createElement('mark');
    mark.className = QUOTE_NAME;
    range.surroundContents(mark);
  }
  range.startContainer.parentElement?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  return true;
}

// ---- 용어 밑줄 ----

export type Term = { title: string; aliases: string[] };
export type TermRange = { title: string; range: Range };

const isAsciiWord = (s: string) => /^[A-Za-z0-9._-]+$/.test(s);
const isWordChar = (ch: string | undefined) => ch !== undefined && /[A-Za-z0-9]/.test(ch);

/** 문서 안에서 용어들을 찾아 밑줄을 긋고, 찾은 자리들을 돌려준다 (클릭 판정용). 표시할 수 없는 브라우저면 빈 배열 */
export function markTerms(root: HTMLElement, terms: Term[]): TermRange[] {
  const reg = registry();
  if (!reg || !HighlightCtor) return [];
  reg.delete(TERM_NAME);
  if (terms.length === 0) return [];
  const flat = flatten(root);
  const lower = flat.text.toLowerCase();
  // 긴 이름부터 — "링크 계층 스위치"가 "링크"에 먼저 먹히지 않게. 같은 자리는 한 번만 쓴다
  const names = terms
    .flatMap((t) => [t.title, ...t.aliases].map((n) => ({ title: t.title, name: norm(n) })))
    .filter((x) => x.name.length >= 2)
    .sort((a, b) => b.name.length - a.name.length);
  const taken: [number, number][] = [];
  const seenInBlock = new Set<string>(); // "블록id|제목" — 문단마다 첫 등장만
  const blockIds = new WeakMap<Element, number>();
  let blockSeq = 0;
  const found: TermRange[] = [];
  for (const { title, name } of names) {
    const needle = name.toLowerCase();
    const ascii = isAsciiWord(name);
    let from = 0;
    while (found.length < TERM_MAX) {
      const at = lower.indexOf(needle, from);
      if (at === -1) break;
      from = at + needle.length;
      // 영문·숫자 이름은 단어 경계에서만 — "link"가 "linked" 안에서 걸리지 않게
      if (ascii && (isWordChar(flat.text[at - 1]) || isWordChar(flat.text[at + needle.length]))) continue;
      if (taken.some(([s, e]) => at < e && at + needle.length > s)) continue;
      const range = rangeOf(flat, at, needle.length);
      const el = range.startContainer.parentElement;
      if (!el || el.closest(TERM_SKIP)) continue;
      const block = el.closest('p, li, td, th, h1, h2, h3, h4, h5, h6, blockquote, dd, dt, div') ?? root;
      if (!blockIds.has(block)) blockIds.set(block, ++blockSeq);
      const key = `${blockIds.get(block)}|${title}`;
      if (seenInBlock.has(key)) continue;
      seenInBlock.add(key);
      taken.push([at, at + needle.length]);
      found.push({ title, range });
    }
  }
  if (found.length) reg.set(TERM_NAME, new HighlightCtor(...found.map((f) => f.range)));
  return found;
}

export function clearTerms() {
  registry()?.delete(TERM_NAME);
}

/** 화면의 한 점(클릭 자리)이 어느 용어 위인지 — 없으면 null */
export function termAtPoint(found: TermRange[], x: number, y: number): TermRange | null {
  const doc = document as Document & {
    caretPositionFromPoint?: (x: number, y: number) => { offsetNode: Node; offset: number } | null;
    caretRangeFromPoint?: (x: number, y: number) => Range | null;
  };
  let node: Node | null = null;
  let offset = 0;
  if (doc.caretPositionFromPoint) {
    const p = doc.caretPositionFromPoint(x, y);
    if (p) ({ offsetNode: node, offset } = p);
  } else if (doc.caretRangeFromPoint) {
    const r = doc.caretRangeFromPoint(x, y);
    if (r) ({ startContainer: node, startOffset: offset } = r);
  }
  if (!node) return null;
  for (const f of found) {
    try {
      if (f.range.isPointInRange(node, offset)) return f;
    } catch {
      /* 노드가 문서에서 빠졌으면 건너뛴다 */
    }
  }
  return null;
}
