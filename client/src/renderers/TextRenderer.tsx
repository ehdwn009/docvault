import { useEffect, useRef } from 'react';
import { isDarkViewerTheme, type ViewerTheme } from '../lib/api';
import { clearQuoteHighlight, highlightQuote } from '../lib/findQuote';

export default function TextRenderer({
  content,
  theme = 'dark',
  highlightQuote: quote,
  onQuoteFound,
}: {
  content: string;
  theme?: ViewerTheme;
  highlightQuote?: string;
  onQuoteFound?: (found: boolean) => void;
}) {
  const ref = useRef<HTMLPreElement>(null);
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
      // 고정 색인 이유: slate 클래스는 앱 테마가 재정의한다 — 본문 색은 뷰어 테마만 따라야 한다
      className={`whitespace-pre-wrap font-mono text-sm leading-relaxed ${
        isDarkViewerTheme(theme) ? 'text-[#e2e8f0]' : 'text-[#1e293b]'
      }`}
    >
      {content}
    </pre>
  );
}
