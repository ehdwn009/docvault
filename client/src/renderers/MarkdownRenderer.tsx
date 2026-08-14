import ReactMarkdown from 'react-markdown';
import rehypeHighlight from 'rehype-highlight';
import remarkGfm from 'remark-gfm';
import type { ViewerTheme } from '../lib/api';
import Mermaid from './Mermaid';
import 'highlight.js/styles/github-dark.css';

export default function MarkdownRenderer({
  content,
  theme = 'dark',
}: {
  content: string;
  theme?: ViewerTheme;
}) {
  return (
    <div className={`prose ${theme === 'dark' ? 'prose-invert' : ''} max-w-none`}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[rehypeHighlight]}
        components={{
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
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
}
