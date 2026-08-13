import ReactMarkdown from 'react-markdown';
import rehypeHighlight from 'rehype-highlight';
import remarkGfm from 'remark-gfm';
import type { ViewerTheme } from '../lib/api';
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
      <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeHighlight]}>
        {content}
      </ReactMarkdown>
    </div>
  );
}
