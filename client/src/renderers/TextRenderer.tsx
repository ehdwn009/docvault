import { useEffect, useRef } from 'react';
import { isDarkViewerTheme, type ViewerTheme } from '../lib/api';
import { clearQuoteHighlight, clearTerms, highlightQuote, markTerms, termAtPoint, type Term, type TermRange } from '../lib/findQuote';

export default function TextRenderer({
  content,
  theme = 'dark',
  highlightQuote: quote,
  onQuoteFound,
  terms,
  onTermsFound,
  onTermClick,
}: {
  content: string;
  theme?: ViewerTheme;
  highlightQuote?: string;
  onQuoteFound?: (found: boolean) => void;
  terms?: Term[];
  onTermsFound?: (titles: string[]) => void;
  onTermClick?: (title: string, rect: { x: number; y: number; w: number; h: number }) => void;
}) {
  const ref = useRef<HTMLPreElement>(null);
  const termRangesRef = useRef<TermRange[]>([]);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (!terms || terms.length === 0) {
      clearTerms();
      termRangesRef.current = [];
      return;
    }
    const id = requestAnimationFrame(() => {
      const found = markTerms(el, terms);
      termRangesRef.current = found;
      onTermsFound?.([...new Set(found.map((f) => f.title))]);
    });
    return () => cancelAnimationFrame(id);
  }, [content, terms]); // eslint-disable-line react-hooks/exhaustive-deps
  // 카드 출처로 열렸으면 그 문장을 찾아 형광펜 — 본문이 그려진 다음 프레임에
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (!quote) {
      clearQuoteHighlight(el);
      return;
    }
    const id = requestAnimationFrame(() => onQuoteFound?.(highlightQuote(el, quote)));
    return () => cancelAnimationFrame(id);
  }, [content, quote]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <pre
      ref={ref}
      onClick={(e) => {
        if (!onTermClick || window.getSelection()?.isCollapsed === false) return;
        const hit = termAtPoint(termRangesRef.current, e.clientX, e.clientY);
        if (!hit) return;
        const r = hit.range.getClientRects()[0] ?? hit.range.getBoundingClientRect(); // 줄이 바뀌는 용어는 첫 줄 상자에 붙인다
        onTermClick(hit.title, { x: r.left, y: r.top, w: r.width, h: r.height });
      }}
      // 고정 색인 이유: slate 클래스는 앱 테마가 재정의한다 — 본문 색은 뷰어 테마만 따라야 한다
      className={`whitespace-pre-wrap font-mono text-sm leading-relaxed ${
        isDarkViewerTheme(theme) ? 'text-[#e2e8f0]' : 'text-[#1e293b]'
      }`}
    >
      {content}
    </pre>
  );
}
