import { useEffect, useMemo, useRef, useState } from 'react';
import type { ViewerTheme } from '../lib/api';
import type { RendererTocItem } from './index';

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
// 심이 하는 일: ① 앵커 클릭을 가로채 스크롤로 변환 ② 스크롤 위치·헤딩 목록을 postMessage로
// 부모에 보고(이어 읽기·목차) ③ 부모의 이동(goto)·테마(theme) 메시지 수행 ④ 심어 둔 위치·테마 복원.
// 격리 오리진이라 postMessage가 유일한 통신 수단이다.
function navShim(restoreOffset: number, theme: ViewerTheme): string {
  const offset = Math.max(0, Math.floor(restoreOffset));
  // 문서가 원하면 CSS에서 [data-theme="dark"]로 뷰어 테마를 따를 수 있게 표식만 남긴다 (강제하지 않음)
  const safeTheme = theme === 'dark' || theme === 'sepia' ? theme : 'light';
  return `<script>(function(){
var se=function(){return document.scrollingElement||document.documentElement};
document.documentElement.dataset.theme='${safeTheme}';
document.addEventListener('click',function(ev){
var t=ev.target,a=t&&t.closest?t.closest('a[href^="#"]'):null;
if(!a)return;ev.preventDefault();
var id=decodeURIComponent((a.getAttribute('href')||'').slice(1));
var el=id?document.getElementById(id):null;
if(el)el.scrollIntoView({behavior:'smooth',block:'start'});
else if(!id)window.scrollTo({top:0,behavior:'smooth'});
},true);
var t;addEventListener('scroll',function(){clearTimeout(t);t=setTimeout(function(){parent.postMessage({type:'docvault:scroll',offset:se().scrollTop},'*')},400)},{passive:true});
var HD=[];
var sendToc=function(){HD=[].slice.call(document.querySelectorAll('h1,h2,h3')).slice(0,300);
parent.postMessage({type:'docvault:toc',items:HD.map(function(h){return{text:(h.textContent||'').trim().slice(0,120),level:+h.tagName[1]||1}})},'*')};
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',sendToc);else sendToc();
addEventListener('message',function(ev){var d=ev.data||{};
if(d.type==='docvault:goto'&&HD[d.index])HD[d.index].scrollIntoView({behavior:'smooth',block:'start'});
else if(d.type==='docvault:theme')document.documentElement.dataset.theme=String(d.theme)});
${offset > 0 ? `var ap=function(){se().scrollTop=${offset}};if(document.readyState==='complete')ap();else addEventListener('load',function(){requestAnimationFrame(ap)});` : ''}
})()</${'script'}>`;
}

// 좁은 화면 맞춤 (아키텍처 — 모바일 화면 맞춤).
// 올라오는 HTML은 docvault를 모르고 만들어진 남의 문서다 — 문서를 고치라고 요구하지 않고 뷰어가 맞춘다.
// 넘칠 때만, 약한 수단부터 단계적으로 개입한다: 가드 CSS → 원인 요소만 스크롤 상자로 → 그래도 넘치면 축소.
// DOM은 건드리지 않고 인라인 스타일만 덧씌운다 — 요소를 감싸면 문서의 `>`·:nth-child 선택자가 깨지기 때문.
function fitShim(enabled: boolean): string {
  return `<script>(function(){
var TOL=2,MIN_ZOOM=.5,on=${enabled ? 'true' : 'false'};
var css=null,zoomed=false,patched=[],timer;
var de=function(){return document.documentElement};
var over=function(){return (document.scrollingElement||de()).scrollWidth-de().clientWidth};
// 덧씌우기 전 원래 값을 적어 둔다 — 보정을 끄면 그대로 되돌린다. 요소에 표식을 남겨 중복 적용을 막는다
var put=function(el,prop,val){
var m=el.__dvFit||(el.__dvFit={});if(m[prop])return;m[prop]=1;
patched.push([el,prop,el.style.getPropertyValue(prop),el.style.getPropertyPriority(prop)]);
el.style.setProperty(prop,val,'important')};
var undo=function(){
for(var i=patched.length-1;i>=0;i--){var p=patched[i];p[0].style.setProperty(p[1],p[2],p[3]);delete p[0].__dvFit}
patched=[];
if(css){if(css.parentNode)css.parentNode.removeChild(css);css=null}
if(zoomed){de().style.zoom='';zoomed=false}};
// ① 가드: 그림·영상은 화면보다 커지지 않게, 긴 낱말은 줄바꿈되게
var guard=function(){
if(css)return;css=document.createElement('style');
css.textContent='img,svg,video,canvas,iframe{max-width:100%!important}img,svg,video{height:auto!important}body{overflow-wrap:break-word}';
(document.head||de()).appendChild(css)};
// 표의 내부(tr·td)는 스크롤 상자가 될 수 없다 — 고칠 수 있는 바깥 요소로 바꿔 준다
var fixable=function(el){
var d=getComputedStyle(el).display;
if(d.slice(0,6)==='table-'){var t=el.closest&&el.closest('table');if(t)return t}
if(d==='inline')return el.parentElement;
return el};
// ② 화면보다 넓은 요소 중 가장 안쪽만이 진짜 원인 — 바깥은 그것 때문에 넓어졌을 뿐이다
var patchWide=function(){
var vw=de().clientWidth,wide=[],all=document.body.getElementsByTagName('*'),i,p,el;
for(i=0;i<all.length;i++)if(all[i].getBoundingClientRect().width>vw+TOL)wide.push(all[i]);
var outer=new Set();
for(i=0;i<wide.length;i++)for(p=wide[i].parentElement;p;p=p.parentElement)outer.add(p);
var targets=[];
for(i=0;i<wide.length;i++){if(outer.has(wide[i]))continue;
var t=fixable(wide[i]);if(t&&t!==document.body&&targets.indexOf(t)<0)targets.push(t)}
for(i=0;i<targets.length;i++){el=targets[i];
put(el,'max-width','100%');
if(el.tagName==='TABLE')put(el,'display','block');
if(el.tagName==='TABLE'||getComputedStyle(el).overflowX==='visible')put(el,'overflow-x','auto');
// grid/flex의 1fr은 내용물의 min-content보다 못 줄어든다 — 조상 사슬을 풀어야 칸이 좁아진다
for(p=el.parentElement;p&&p!==document.body;p=p.parentElement)put(p,'min-width','0')}};
// ③ 마지막 수단: 문서 전체를 화면 폭에 맞게 축소 (글씨가 못 읽을 만큼 작아지지 않게 하한을 둔다)
var zoomFit=function(){
if(zoomed)return;
var sw=(document.scrollingElement||de()).scrollWidth,vw=de().clientWidth;
if(sw<=vw+TOL)return;
de().style.zoom=Math.max(MIN_ZOOM,Math.floor(vw/sw*100)/100);zoomed=true};
var run=function(){
if(!on||!document.body||over()<=TOL)return;
guard();if(over()<=TOL)return;
try{patchWide()}catch(e){}
if(over()<=TOL)return;
zoomFit()};
var schedule=function(){clearTimeout(timer);timer=setTimeout(run,80)};
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',run);else run();
addEventListener('load',function(){run();setTimeout(run,600)});
addEventListener('resize',schedule,{passive:true});
addEventListener('message',function(ev){var d=ev.data||{};
if(d.type==='docvault:fit'){on=!!d.on;undo();if(on)run()}});
})()</${'script'}>`;
}

/** 문서 구조(doctype·head)를 깨뜨리지 않는 위치에 심을 주입한다 */
function injectShims(html: string, restoreOffset: number, theme: ViewerTheme, fit: boolean): string {
  // 맞춤 심을 앞에 둔다 — load 리스너가 먼저 등록되어야 "맞춤 후 읽던 위치 복원" 순서가 된다
  const shims = STORAGE_SHIM + fitShim(fit) + navShim(restoreOffset, theme);
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
  theme?: ViewerTheme;
  /** 열람 시작 시 복원할 스크롤 위치 (읽던 위치 이어 읽기) */
  initialOffset?: number;
  /** iframe 내부 스크롤 보고 수신 — 부모(Viewer)가 읽던 위치 저장에 사용 */
  onScrollOffset?: (offset: number) => void;
  /** 문서 헤딩 목록 보고 수신 — 부모(Viewer)가 목차(SCR-151)에 사용 */
  onToc?: (items: RendererTocItem[]) => void;
  /** 좁은 화면 맞춤 보정 — 끄면 문서를 만든 그대로 보여준다 */
  fit?: boolean;
};

export default function HtmlRenderer({ content, theme, initialOffset = 0, onScrollOffset, onToc, fit = true }: Props) {
  const frameRef = useRef<HTMLIFrameElement>(null);
  // srcDoc이 바뀌면 iframe이 통째로 리로드된다 — 복원 위치·초기 테마·초기 맞춤은 마운트 시점 값으로 고정해
  // 부모 리렌더(트리 갱신·설정 변경 등)가 읽는 중인 문서를 초기화하지 않게 한다
  const [restoreOffset] = useState(initialOffset);
  const [initialTheme] = useState<ViewerTheme>(theme ?? 'light');
  const [initialFit] = useState(fit);
  const doc = useMemo(
    () => injectShims(content, restoreOffset, initialTheme, initialFit),
    [content, restoreOffset, initialTheme, initialFit],
  );

  useEffect(() => {
    function onMessage(e: MessageEvent) {
      // 반드시 이 iframe에서 온 메시지만 신뢰한다 (아키텍처 — HTML 렌더러 호환 심)
      if (e.source !== frameRef.current?.contentWindow) return;
      const d = e.data as { type?: unknown; offset?: unknown; items?: unknown } | null;
      if (!d || typeof d !== 'object') return;
      if (d.type === 'docvault:scroll' && typeof d.offset === 'number') {
        onScrollOffset?.(d.offset);
      } else if (d.type === 'docvault:toc' && Array.isArray(d.items)) {
        const items = (d.items as { text?: unknown; level?: unknown }[]).map((it, index) => ({
          text: String(it.text ?? ''),
          level: Number(it.level) || 1,
          // 목차 클릭 = iframe에 이동 요청 쪽지 — 격리 때문에 직접 스크롤시킬 수 없다
          jump: () => frameRef.current?.contentWindow?.postMessage({ type: 'docvault:goto', index }, '*'),
        }));
        onToc?.(items);
      }
    }
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, [onScrollOffset, onToc]);

  // 열람 중 테마·맞춤 변경은 리로드 없이 쪽지로 전파한다 (마운트 시점 값은 이미 심에 박혀 있다).
  // 실제로 보낸 값을 기억해 두는 이유: 처음 값으로 되돌아가는 변경(밝게→어둡게→밝게)도 전해야 한다
  const sent = useRef({ theme: initialTheme, fit: initialFit });
  useEffect(() => {
    const win = frameRef.current?.contentWindow;
    if (!win) return;
    if (theme && theme !== sent.current.theme) {
      win.postMessage({ type: 'docvault:theme', theme }, '*');
      sent.current.theme = theme;
    }
    if (fit !== sent.current.fit) {
      win.postMessage({ type: 'docvault:fit', on: fit }, '*');
      sent.current.fit = fit;
    }
  }, [theme, fit]);

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
