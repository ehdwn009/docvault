import { useEffect, useState } from 'react';

// mermaid는 매우 큰 라이브러리 — 다이어그램 블록이 실제로 있을 때만 동적 로드한다
let renderSeq = 0;

export default function Mermaid({ code, dark }: { code: string; dark: boolean }) {
  const [svg, setSvg] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let alive = true;
    setSvg(null);
    setFailed(false);
    void (async () => {
      try {
        const mermaid = (await import('mermaid')).default;
        mermaid.initialize({
          startOnLoad: false,
          securityLevel: 'strict', // 문서 내용은 신뢰하지 않는다 — 스크립트·링크 무력화
          theme: dark ? 'dark' : 'default',
        });
        const { svg } = await mermaid.render(`dv-mmd-${++renderSeq}`, code);
        if (alive) setSvg(svg);
      } catch {
        if (alive) setFailed(true);
      }
    })();
    return () => {
      alive = false;
    };
  }, [code, dark]);

  // 문법 오류면 다이어그램 대신 원본 코드를 보여준다
  if (failed) return <pre>{code}</pre>;
  if (!svg) return <p className="text-sm opacity-50">다이어그램 렌더링 중…</p>;
  return <div className="not-prose overflow-x-auto" dangerouslySetInnerHTML={{ __html: svg }} />;
}
