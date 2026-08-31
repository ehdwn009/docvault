import { isDarkViewerTheme, type ViewerTheme } from '../lib/api';

export default function TextRenderer({
  content,
  theme = 'dark',
}: {
  content: string;
  theme?: ViewerTheme;
}) {
  return (
    <pre
      // 고정 색인 이유: slate 클래스는 앱 테마가 재정의한다 — 본문 색은 뷰어 테마만 따라야 한다
      className={`whitespace-pre-wrap font-mono text-sm leading-relaxed ${
        isDarkViewerTheme(theme) ? 'text-[#e2e8f0]' : 'text-[#1e293b]'
      }`}
    >
      {content}
    </pre>
  );
}
