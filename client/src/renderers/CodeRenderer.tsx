import { useEffect, useMemo, useRef } from 'react';
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

/** 강조된 HTML을 줄 단위로 쪼갠다 — 여러 줄에 걸친 <span>(블록 주석 등)은
    줄마다 다시 열고 닫아서 각 줄이 완전한 HTML 조각이 되게 한다 */
function splitHighlighted(html: string): string[] {
  const out: string[] = [];
  const openStack: string[] = [];
  for (const line of html.split('\n')) {
    const prefix = openStack.join('');
    const re = /<span[^>]*>|<\/span>/g;
    for (let m = re.exec(line); m; m = re.exec(line)) {
      if (m[0] === '</span>') openStack.pop();
      else openStack.push(m[0]);
    }
    out.push(prefix + line + '</span>'.repeat(openStack.length));
  }
  // 끝의 줄바꿈 뒤 빈 줄은 줄 번호를 세지 않는다 (에디터들과 같은 규칙)
  if (out.length > 1 && out[out.length - 1] === '') out.pop();
  return out;
}

// 코드 전용 렌더러 — 문법 강조 + 줄 번호 + 줄 하이라이트(#L16-L26 앵커).
// 배경은 테마와 무관하게 어둡게 고정한다 (에디터 관례이고, 강조 팔레트가 어두운 배경 기준)
export default function CodeRenderer({ content, fileName, highlightLines }: RendererProps) {
  const lines = useMemo(() => {
    const ext = fileName?.slice(fileName.lastIndexOf('.') + 1).toLowerCase() ?? '';
    const language = EXT_LANGUAGE[ext];
    let html: string;
    try {
      if (language && hljs.getLanguage(language)) {
        html = hljs.highlight(content, { language }).value;
      } else if (content.length <= AUTO_DETECT_MAX_CHARS) {
        html = hljs.highlightAuto(content).value;
      } else {
        html = escapeHtml(content);
      }
    } catch {
      // 강조 실패는 치명적이지 않다 — 강조 없이 보여준다
      html = escapeHtml(content);
    }
    return splitHighlighted(html);
  }, [content, fileName]);

  const hl = highlightLines ?? null;
  const inRange = (lineNo: number) => hl !== null && lineNo >= hl.start && lineNo <= hl.end;

  // 하이라이트 첫 줄로 스크롤 — 링크가 "파일 속 한 지점"을 가리키므로 열자마자 데려간다
  const jumpRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    jumpRef.current?.scrollIntoView({ block: 'center' });
  }, [hl?.start, hl?.end, content]);

  return (
    <div className="overflow-hidden rounded-lg bg-[#0d1117]">
      <div className="flex font-mono text-[0.875em] leading-relaxed">
        <div aria-hidden className="shrink-0 select-none py-4 pl-3 pr-3 text-right text-slate-600">
          {lines.map((_, i) => (
            <div
              key={i}
              ref={i + 1 === hl?.start ? jumpRef : undefined}
              className={inRange(i + 1) ? 'bg-amber-400/20 text-amber-300' : ''}
            >
              {i + 1}
            </div>
          ))}
        </div>
        {/* 긴 줄은 본문 안에서만 가로 스크롤 — 줄 번호는 제자리에 남는다 */}
        <pre className="flex-1 overflow-x-auto py-4">
          <code className="hljs block !bg-transparent !p-0">
            {lines.map((h, i) => (
              <div
                key={i}
                // w-max: 하이라이트 띠가 가로 스크롤 폭 전체를 덮게 (빈 줄은 &nbsp;로 높이 유지)
                className={`w-max min-w-full pr-4 ${inRange(i + 1) ? 'bg-amber-400/20' : ''}`}
                dangerouslySetInnerHTML={{ __html: h === '' ? '&nbsp;' : h }}
              />
            ))}
          </code>
        </pre>
      </div>
    </div>
  );
}
