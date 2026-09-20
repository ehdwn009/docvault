import { useEffect, useMemo, useRef } from 'react';
import { clearQuoteHighlight, clearTerms, highlightQuote, markTerms, termAtPoint, type Term, type TermRange } from '../lib/findQuote';
import ReactMarkdown, { type Components } from 'react-markdown';
import rehypeHighlight from 'rehype-highlight';
// CommonMark 규칙상 닫는 **가 문장부호 뒤 + 한글 조사 앞이면(예: "(Caddy)**와") 볼드로
// 인식되지 않는다 — CJK 문서에서 빈번하므로 플러그인으로 완화한다
import remarkCjkFriendly from 'remark-cjk-friendly';
import remarkGfm from 'remark-gfm';
import { isDarkViewerTheme, type ViewerTheme } from '../lib/api';
import Mermaid from './Mermaid';
import 'highlight.js/styles/github-dark.css';

/** 외부로 나가는 주소인가 — 이건 브라우저 기본 동작에 맡긴다 */
function isExternalHref(href: string): boolean {
  return /^[a-z][a-z0-9+.-]*:/i.test(href) || href.startsWith('//');
}

export default function MarkdownRenderer({
  content,
  theme = 'dark',
  onFileLink,
  highlightQuote: quote,
  onQuoteFound,
  terms,
  onTermsFound,
  onTermClick,
}: {
  content: string;
  theme?: ViewerTheme;
  /** 상대 경로 링크 클릭 — (경로, 분할로 열지). 없으면 링크는 기본 동작 그대로 */
  onFileLink?: (path: string, split: boolean) => void;
  /** 카드 출처로 열렸을 때 찾아 형광펜 칠할 문장 */
  highlightQuote?: string;
  onQuoteFound?: (found: boolean) => void;
  /** 밑줄 그을 내 카드 용어 */
  terms?: Term[];
  onTermsFound?: (titles: string[]) => void;
  onTermClick?: (title: string, rect: { x: number; y: number; w: number; h: number }) => void;
}) {
  const rootRef = useRef<HTMLDivElement>(null);
  // 밑줄 친 자리들 — 클릭이 어느 용어 위인지 판정할 때 쓴다
  const termRangesRef = useRef<TermRange[]>([]);
  useEffect(() => {
    const el = rootRef.current;
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
  const onRootClick = (e: React.MouseEvent) => {
    if (!onTermClick || termRangesRef.current.length === 0) return;
    if (window.getSelection()?.isCollapsed === false) return; // 드래그 선택은 질문 흐름 — 용어 클릭이 아니다
    const hit = termAtPoint(termRangesRef.current, e.clientX, e.clientY);
    if (!hit) return;
    e.preventDefault();
    const r = hit.range.getClientRects()[0] ?? hit.range.getBoundingClientRect(); // 줄이 바뀌는 용어는 첫 줄 상자에 붙인다
    onTermClick(hit.title, { x: r.left, y: r.top, w: r.width, h: r.height });
  };
  // 출처 문장 찾기 — 본문이 그려진 다음 프레임에. 문장이 없어지면 형광펜을 지운다
  useEffect(() => {
    const el = rootRef.current;
    if (!el) return;
    if (!quote) {
      clearQuoteHighlight(el);
      return;
    }
    const id = requestAnimationFrame(() => onQuoteFound?.(highlightQuote(el, quote)));
    return () => cancelAnimationFrame(id);
  }, [content, quote]); // eslint-disable-line react-hooks/exhaustive-deps

  // 커스텀 컴포넌트를 렌더마다 새 함수로 만들면 React가 매 렌더에 <a>들을 재마운트한다.
  // 분할에서 비활성 칸의 링크를 누르면 pointerdown의 칸 활성화 리렌더가 클릭 완성 전에
  // 요소를 갈아치워 click이 아예 발생하지 않는다 — 그래서 identity를 고정(useMemo)하고
  // 최신 핸들러는 ref로 읽는다
  const linkRef = useRef(onFileLink);
  linkRef.current = onFileLink;

  const components = useMemo<Components>(
    () => ({
      // 상대 경로 링크(다른 문서 가리킴)는 브라우저 이동 대신 앱이 그 파일을 연다.
      // 클릭 = 탭으로, Alt+클릭 = 분할로 (트리와 같은 문법). #앵커·외부 URL은 기본 동작
      a: ({ href, children, ...props }) => (
        <a
          href={href}
          {...props}
          onClick={(e) => {
            const handler = linkRef.current;
            if (!handler || !href || href.startsWith('#') || isExternalHref(href)) return;
            e.preventDefault();
            // remark가 한글 경로를 %-인코딩하므로 되돌린다
            let path = href;
            try {
              path = decodeURIComponent(href);
            } catch {
              /* 이상한 인코딩이면 원문 그대로 시도 */
            }
            handler(path, e.altKey);
          }}
        >
          {children}
        </a>
      ),
      // ```mermaid 블록은 다이어그램으로 렌더링
      code: ({ className, children, ...props }) => {
        if (className?.includes('language-mermaid')) {
          return <Mermaid code={String(children).trim()} dark={isDarkViewerTheme(theme)} />;
        }
        return (
          <code className={className} {...props}>
            {children}
          </code>
        );
      },
      // 표는 원래 너비를 유지하고 넘치는 만큼만 자체 가로 스크롤 —
      // 좁은 화면에서 셀이 세로로 짜부라지거나 페이지 전체가 가로로 밀리는 것 방지
      table: (props) => (
        <div className="overflow-x-auto">
          <table {...props} />
        </div>
      ),
    }),
    [theme],
  );

  return (
    <div ref={rootRef} onClick={onRootClick} className={`prose ${isDarkViewerTheme(theme) ? 'prose-invert' : ''} max-w-none`}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm, remarkCjkFriendly]}
        rehypePlugins={[rehypeHighlight]}
        components={components}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
}
