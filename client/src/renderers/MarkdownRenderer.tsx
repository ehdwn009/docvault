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
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
}
