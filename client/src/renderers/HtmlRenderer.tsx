// HTML은 iframe sandbox로 격리 렌더링한다 (아키텍처 — 보안 경계).
// allow-scripts: JS 구동 문서(슬라이드 덱 등)를 위해 스크립트는 허용.
// allow-same-origin은 절대 추가하지 않는다 — 없어야 iframe이 별도 오리진이 되어
// 세션 쿠키·API·부모 창 접근이 전부 차단된다. (둘을 같이 켜면 격리가 무력화됨)
export default function HtmlRenderer({ content }: { content: string }) {
  return (
    <iframe
      sandbox="allow-scripts"
      srcDoc={content}
      title="html-preview"
      className="h-full min-h-[70vh] w-full rounded-md bg-white"
    />
  );
}
