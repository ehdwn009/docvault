// HTML은 iframe sandbox로 격리 렌더링한다 (아키텍처 — 보안 경계).
// allow-same-origin은 절대 추가하지 않는다 — 없어야 iframe이 별도 오리진이 되어
// 세션 쿠키·API·부모 창 접근이 전부 차단된다. (allow-scripts와 같이 켜면 격리가 무력화됨)
// 나머지 권한(폼·모달·다운로드·팝업)은 앱형 HTML 문서가 동작하는 데 필요해서 허용한다.
const SANDBOX = 'allow-scripts allow-forms allow-modals allow-downloads allow-popups';

// 격리 오리진에서는 localStorage/sessionStorage 접근 자체가 SecurityError를 던져
// 저장 기능을 쓰는 문서가 통째로 죽는다. 세션 동안만 유지되는 메모리 저장소로 대체한다.
const STORAGE_SHIM = `<script>(function(){try{void window.localStorage}catch(e){var mk=function(){var m={};return{getItem:function(k){return Object.prototype.hasOwnProperty.call(m,k)?m[k]:null},setItem:function(k,v){m[k]=String(v)},removeItem:function(k){delete m[k]},clear:function(){m={}},key:function(i){var ks=Object.keys(m);return i<ks.length?ks[i]:null},get length(){return Object.keys(m).length}}};try{Object.defineProperty(window,'localStorage',{value:mk(),configurable:true});Object.defineProperty(window,'sessionStorage',{value:mk(),configurable:true})}catch(e2){}}})()</${'script'}>`;

/** 문서 구조(doctype·head)를 깨뜨리지 않는 위치에 심을 주입한다 */
function injectShim(html: string): string {
  const head = html.match(/<head[^>]*>/i);
  if (head) {
    const at = head.index! + head[0].length;
    return html.slice(0, at) + STORAGE_SHIM + html.slice(at);
  }
  const doctype = html.match(/^\s*<!doctype[^>]*>/i);
  if (doctype) {
    const at = doctype[0].length;
    return html.slice(0, at) + STORAGE_SHIM + html.slice(at);
  }
  return STORAGE_SHIM + html;
}

export default function HtmlRenderer({ content }: { content: string }) {
  return (
    <iframe
      sandbox={SANDBOX}
      srcDoc={injectShim(content)}
      title="html-preview"
      className="h-full w-full bg-white"
    />
  );
}
