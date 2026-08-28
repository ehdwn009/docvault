import { useMemo } from 'react';
// common 빌드(주요 ~35개 언어)만 싣는다 — 전체 빌드는 190여 개 언어로 지나치게 무겁다
import hljs from 'highlight.js/lib/common';
import 'highlight.js/styles/github-dark.css';
import type { RendererProps } from './index';

// 확장자 → highlight.js 언어 id. 여기 없거나 common 빌드에 없는 언어는 자동 감지로 넘어간다
const EXT_LANGUAGE: Record<string, string> = {
  js: 'javascript', jsx: 'javascript', mjs: 'javascript', cjs: 'javascript',
  ts: 'typescript', tsx: 'typescript',
  py: 'python', rb: 'ruby', php: 'php', java: 'java', kt: 'kotlin', swift: 'swift',
  c: 'c', h: 'c', cpp: 'cpp', hpp: 'cpp', cc: 'cpp', cs: 'csharp',
  go: 'go', rs: 'rust', lua: 'lua', r: 'r', pl: 'perl',
  sql: 'sql', sh: 'bash', bash: 'bash', zsh: 'bash',
  json: 'json', jsonc: 'json', yml: 'yaml', yaml: 'yaml',
  toml: 'ini', ini: 'ini', cfg: 'ini', conf: 'ini',
  xml: 'xml', html: 'xml', vue: 'xml', svelte: 'xml',
  css: 'css', scss: 'scss', less: 'less',
  md: 'markdown', markdown: 'markdown',
};

/** 자동 감지를 시도할 본문 크기 상한 — 큰 파일에 전체 언어 채점을 돌리면 화면이 멈춘다 */
const AUTO_DETECT_MAX_CHARS = 50_000;

function escapeHtml(s: string): string {
  return s.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
}

// 코드 전용 렌더러 — 문법 강조 + 줄 번호. 배경은 테마와 무관하게 어둡게 고정한다
// (에디터 관례이기도 하고, 강조 팔레트가 어두운 배경 기준이라 라이트에서도 그대로 읽힌다)
export default function CodeRenderer({ content, fileName }: RendererProps) {
  const html = useMemo(() => {
    const ext = fileName?.slice(fileName.lastIndexOf('.') + 1).toLowerCase() ?? '';
    const language = EXT_LANGUAGE[ext];
    try {
      if (language && hljs.getLanguage(language)) {
        return hljs.highlight(content, { language }).value;
      }
      if (content.length <= AUTO_DETECT_MAX_CHARS) {
        return hljs.highlightAuto(content).value;
      }
    } catch {
      /* 강조 실패는 치명적이지 않다 — 아래에서 강조 없이 보여준다 */
    }
    return escapeHtml(content);
  }, [content, fileName]);

  // 마지막 줄바꿈 뒤의 빈 줄은 줄 번호를 세지 않는다 (에디터들과 같은 규칙)
  const lineCount = Math.max(1, content.split('\n').length - (content.endsWith('\n') ? 1 : 0));

  return (
    <div className="overflow-hidden rounded-lg bg-[#0d1117]">
      <div className="flex font-mono text-[0.875em] leading-relaxed">
        <div aria-hidden className="shrink-0 select-none py-4 pl-3 pr-3 text-right text-slate-600">
          {Array.from({ length: lineCount }, (_, i) => (
            <div key={i}>{i + 1}</div>
          ))}
        </div>
        {/* 긴 줄은 본문 안에서만 가로 스크롤 — 줄 번호는 제자리에 남는다 */}
        <pre className="flex-1 overflow-x-auto py-4 pr-4">
          <code className="hljs !bg-transparent !p-0" dangerouslySetInnerHTML={{ __html: html }} />
        </pre>
      </div>
    </div>
  );
}
