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
        theme === 'dark' ? 'text-zinc-200' : 'text-zinc-800'
      }`}
    >
      {content}
    </pre>
  );
}
