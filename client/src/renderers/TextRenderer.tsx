import type { ViewerTheme } from '../lib/api';

export default function TextRenderer({
  content,
  theme = 'dark',
}: {
  content: string;
  theme?: ViewerTheme;
}) {
  return (
    <pre
      className={`whitespace-pre-wrap font-mono text-sm leading-relaxed ${
        theme === 'dark' ? 'text-slate-200' : 'text-slate-800'
      }`}
    >
      {content}
    </pre>
  );
}
