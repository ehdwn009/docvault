import { useMemo, useRef } from 'react';
import ReactMarkdown, { type Components } from 'react-markdown';
import rehypeHighlight from 'rehype-highlight';
// CommonMark 규칙상 닫는 **가 문장부호 뒤 + 한글 조사 앞이면(예: "(Caddy)**와") 볼드로
// 인식되지 않는다 — CJK 문서에서 빈번하므로 플러그인으로 완화한다
import remarkCjkFriendly from 'remark-cjk-friendly';
import remarkGfm from 'remark-gfm';
import type { ViewerTheme } from '../lib/api';
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
}: {
  content: string;
  theme?: ViewerTheme;
  /** 상대 경로 링크 클릭 — (경로, 분할로 열지). 없으면 링크는 기본 동작 그대로 */
  onFileLink?: (path: string, split: boolean) => void;
}) {
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
          return <Mermaid code={String(children).trim()} dark={theme === 'dark'} />;
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
    <div className={`prose ${theme === 'dark' ? 'prose-invert' : ''} max-w-none`}>
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
