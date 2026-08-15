import { useEffect, useMemo, useRef, useState } from 'react';

// HTML은 iframe sandbox로 격리 렌더링한다 (아키텍처 — 보안 경계).
// allow-same-origin은 절대 추가하지 않는다 — 없어야 iframe이 별도 오리진이 되어
// 세션 쿠키·API·부모 창 접근이 전부 차단된다. (allow-scripts와 같이 켜면 격리가 무력화됨)
// 나머지 권한(폼·모달·다운로드·팝업)은 앱형 HTML 문서가 동작하는 데 필요해서 허용한다.
const SANDBOX = 'allow-scripts allow-forms allow-modals allow-downloads allow-popups';

// 격리 오리진에서는 localStorage/sessionStorage 접근 자체가 SecurityError를 던져
// 저장 기능을 쓰는 문서가 통째로 죽는다. 세션 동안만 유지되는 메모리 저장소로 대체한다.
const STORAGE_SHIM = `<script>(function(){try{void window.localStorage}catch(e){var mk=function(){var m={};return{getItem:function(k){return Object.prototype.hasOwnProperty.call(m,k)?m[k]:null},setItem:function(k,v){m[k]=String(v)},removeItem:function(k){delete m[k]},clear:function(){m={}},key:function(i){var ks=Object.keys(m);return i<ks.length?ks[i]:null},get length(){return Object.keys(m).length}}};try{Object.defineProperty(window,'localStorage',{value:mk(),configurable:true});Object.defineProperty(window,'sessionStorage',{value:mk(),configurable:true})}catch(e2){}}})()</${'script'}>`;

// srcdoc 문서는 base URL을 부모 페이지에서 물려받는다 — 그래서 문서 안 #앵커 클릭이
// "문서 내 스크롤"이 아니라 앱 URL로의 iframe 내비게이션(흰 화면)이 된다 (아키텍처 — HTML 렌더러 호환 심).
// ① 앵커 클릭을 가로채 스크롤로 바꾸고 ② 스크롤 위치를 postMessage로 부모에 보고(이어 읽기),
// ③ 마운트 시 심어 둔 위치로 복원한다. 격리 오리진이라 postMessage가 유일한 통신 수단이다.
function navShim(restoreOffset: number): string {
  const offset = Math.max(0, Math.floor(restoreOffset));
  return `<script>(function(){
var se=function(){return document.scrollingElement||document.documentElement};
document.addEventListener('click',function(ev){
var t=ev.target,a=t&&t.closest?t.closest('a[href^="#"]'):null;
if(!a)return;ev.preventDefault();
var id=decodeURIComponent((a.getAttribute('href')||'').slice(1));
var el=id?document.getElementById(id):null;
if(el)el.scrollIntoView({behavior:'smooth',block:'start'});
else if(!id)window.scrollTo({top:0,behavior:'smooth'});
},true);
var t;addEventListener('scroll',function(){clearTimeout(t);t=setTimeout(function(){parent.postMessage({type:'docvault:scroll',offset:se().scrollTop},'*')},400)},{passive:true});
${offset > 0 ? `var ap=function(){se().scrollTop=${offset}};if(document.readyState==='complete')ap();else addEventListener('load',function(){requestAnimationFrame(ap)});` : ''}
})()</${'script'}>`;
}

/** 문서 구조(doctype·head)를 깨뜨리지 않는 위치에 심을 주입한다 */
function injectShims(html: string, restoreOffset: number): string {
  const shims = STORAGE_SHIM + navShim(restoreOffset);
  const head = html.match(/<head[^>]*>/i);
  if (head) {
    const at = head.index! + head[0].length;
    return html.slice(0, at) + shims + html.slice(at);
  }
  const doctype = html.match(/^\s*<!doctype[^>]*>/i);
  if (doctype) {
    const at = doctype[0].length;
    return html.slice(0, at) + shims + html.slice(at);
  }
  return shims + html;
}

type Props = {
  content: string;
  /** 열람 시작 시 복원할 스크롤 위치 (읽던 위치 이어 읽기) */
  initialOffset?: number;
  /** iframe 내부 스크롤 보고 수신 — 부모(Viewer)가 읽던 위치 저장에 사용 */
  onScrollOffset?: (offset: number) => void;
};

export default function HtmlRenderer({ content, initialOffset = 0, onScrollOffset }: Props) {
  const frameRef = useRef<HTMLIFrameElement>(null);
  // srcDoc이 바뀌면 iframe이 통째로 리로드된다 — 복원 위치는 마운트 시점 값으로 고정해
  // 부모 리렌더(트리 갱신 등)가 읽는 중인 문서를 초기화하지 않게 한다
  const [restoreOffset] = useState(initialOffset);
  const doc = useMemo(() => injectShims(content, restoreOffset), [content, restoreOffset]);

  useEffect(() => {
    if (!onScrollOffset) return;
    const report = onScrollOffset; // 좁히기는 중첩 함수 안까지 유지되지 않는다
    function onMessage(e: MessageEvent) {
      // 반드시 이 iframe에서 온 메시지만 신뢰한다 (아키텍처 — HTML 렌더러 호환 심)
      if (e.source !== frameRef.current?.contentWindow) return;
      const d = e.data as { type?: unknown; offset?: unknown } | null;
      if (d && typeof d === 'object' && d.type === 'docvault:scroll' && typeof d.offset === 'number') {
        report(d.offset);
      }
    }
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, [onScrollOffset]);

  return (
    <iframe
      ref={frameRef}
      sandbox={SANDBOX}
      srcDoc={doc}
      title="html-preview"
      className="h-full w-full bg-white"
    />
  );
}
