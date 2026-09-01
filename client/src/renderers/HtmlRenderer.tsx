import { useEffect, useMemo, useRef, useState } from 'react';
import { isDarkViewerTheme, type ViewerTheme } from '../lib/api';
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
/** 문서에 남기는 data-theme 표식은 기존 3값(light/dark/sepia) 계약 유지 —
    새 테마는 가장 가까운 값으로 접는다 (IA — 뷰어 테마 확장) */
function collapseTheme(theme: ViewerTheme): 'light' | 'dark' | 'sepia' {
  if (isDarkViewerTheme(theme)) return 'dark';
  return theme === 'sepia' || theme === 'green' || theme === 'gray' ? 'sepia' : 'light';
}

function navShim(restoreOffset: number, restoreRatio: number | undefined, theme: ViewerTheme): string {
  const offset = Math.max(0, Math.floor(restoreOffset));
  // 비율(0~1)이 있으면 우선 — px은 화면 폭이 다른 기기에서는 다른 문단에 떨어진다 (기기 간 이어 읽기)
  const ratio = restoreRatio != null && restoreRatio > 0 && restoreRatio <= 1 ? restoreRatio : null;
  // 문서가 원하면 CSS에서 [data-theme="dark"]로 뷰어 테마를 따를 수 있게 표식만 남긴다 (강제하지 않음)
  const safeTheme = collapseTheme(theme);
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
// 문서를 누른 것은 부모에게 보이지 않는다(iframe 경계) — 열려 있는 팝오버를 닫으라고 알린다
addEventListener('pointerdown',function(){parent.postMessage({type:'docvault:interact'},'*')},{passive:true,capture:true});
var t;addEventListener('scroll',function(){clearTimeout(t);t=setTimeout(function(){
var s=se(),d=s.scrollHeight-s.clientHeight;
parent.postMessage({type:'docvault:scroll',offset:s.scrollTop,ratio:d>0?Math.min(1,s.scrollTop/d):0},'*')},400)},{passive:true});
var HD=[];
var sendToc=function(){HD=[].slice.call(document.querySelectorAll('h1,h2,h3')).slice(0,300);
parent.postMessage({type:'docvault:toc',items:HD.map(function(h){return{text:(h.textContent||'').trim().slice(0,120),level:+h.tagName[1]||1}})},'*')};
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',sendToc);else sendToc();
addEventListener('message',function(ev){var d=ev.data||{};
if(d.type==='docvault:goto'&&HD[d.index])HD[d.index].scrollIntoView({behavior:'smooth',block:'start'});
else if(d.type==='docvault:theme')document.documentElement.dataset.theme=String(d.theme)});
${ratio !== null || offset > 0 ? `var ap=function(){var s=se(),d=s.scrollHeight-s.clientHeight;s.scrollTop=${ratio !== null ? `d>0?Math.round(d*${ratio}):${offset}` : `${offset}`}};if(document.readyState==='complete')ap();else addEventListener('load',function(){requestAnimationFrame(ap)});` : ''}
})()</${'script'}>`;
}

// 글자 크기 배율 (아키텍처 — 글자 크기 배율).
// 문서마다 기준 크기가 달라(어떤 정독본은 본문 15px, 어떤 건 14px) 절대 px가 아니라 배율로 다룬다.
// 방법: 문서가 가진 스타일 규칙을 읽어 font-size만 배율을 곱한 **사본 시트**를 맨 뒤에 덧붙인다.
// 원본 규칙을 고치지 않으므로 되돌리기가 시트 한 장 제거이고, 선택자를 그대로 베끼므로
// 제목 36px : 본문 15px 같은 위계도 비율 그대로 남는다.
function scaleShim(percent: number): string {
  return `<script>(function(){
var ID='dv-scale',cur=${Math.round(percent)},patched=[],baseRoot=0;
var de=function(){return document.documentElement};
// 인라인 style="font-size:14px"는 어떤 시트보다 세다 — 따로 손대고 원래 값을 적어 둔다
var putInline=function(el,val){
patched.push([el,el.style.getPropertyValue('font-size'),el.style.getPropertyPriority('font-size')]);
el.style.setProperty('font-size',val,'important')};
var undoInline=function(){
for(var i=patched.length-1;i>=0;i--){var p=patched[i];p[0].style.setProperty('font-size',p[1],p[2])}
patched=[]};
// px·pt만 곱한다. em·rem·%는 부모(또는 루트)에 비례하는 값이라 손대면 두 번 커진다 —
// 부모가 커지면 저절로 따라 커지므로 그대로 두는 것이 정답이다
var scaleVal=function(v,f){
var m=/^\\s*(-?[\\d.]+)(px|pt)\\s*$/.exec(v||'');
return m?(Math.round(parseFloat(m[1])*f*100)/100)+m[2]:null};
var collect=function(rules,f,out){
for(var i=0;i<rules.length;i++){var r=rules[i];
if(r.selectorText&&r.style){var s=scaleVal(r.style.fontSize,f);
if(s)out.push(r.selectorText+'{font-size:'+s+' !important}')}
else if(r.media&&r.cssRules){var a=[];collect(r.cssRules,f,a);
if(a.length)out.push('@media '+r.media.mediaText+'{'+a.join('')+'}')}
else if(r.conditionText&&r.cssRules){var b=[];collect(r.cssRules,f,b);
if(b.length)out.push('@supports '+r.conditionText+'{'+b.join('')+'}')}
else if(r.cssRules)collect(r.cssRules,f,out)}};
var apply=function(){
var old=document.getElementById(ID);if(old&&old.parentNode)old.parentNode.removeChild(old);
undoInline();
// 원본 상태에서의 루트 크기를 한 번만 기억한다 — 매번 재면 우리가 키운 값 위에 또 곱해진다
if(!baseRoot)baseRoot=parseFloat(getComputedStyle(de()).fontSize)||16;
var f=cur/100;
if(!(f>0)||f===1||!document.body)return;
var out=[],sheets=document.styleSheets;
for(var i=0;i<sheets.length;i++){
if(sheets[i].ownerNode&&sheets[i].ownerNode.id===ID)continue;
var rules;try{rules=sheets[i].cssRules}catch(e){continue} // 외부(CDN) 시트는 읽을 수 없다 — 건너뛴다
if(rules)collect(rules,f,out)}
// rem의 기준인 루트 크기도 함께 키운다 — 크기를 rem으로만 짠 문서가 반응하도록
out.unshift('html{font-size:'+(Math.round(baseRoot*f*100)/100)+'px !important}');
var st=document.createElement('style');st.id=ID;st.textContent=out.join('\\n');
document.body.appendChild(st);
var els=document.querySelectorAll('[style*="font-size"]');
for(var j=0;j<els.length;j++){var sv=scaleVal(els[j].style.fontSize,f);if(sv)putInline(els[j],sv)}};
var run=function(){try{apply()}catch(e){}};
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',run);else run();
// 늦게 붙는 <style>이나 JS가 나중에 그리는 본문(인라인 style)까지 덮기 위해 한 번 더
addEventListener('load',function(){run();setTimeout(run,900)});
addEventListener('message',function(ev){var d=ev.data||{};
if(d.type==='docvault:scale'&&typeof d.percent==='number'){cur=d.percent;run()}});
})()</${'script'}>`;
}

// 좁은 화면 맞춤 (아키텍처 — 모바일 화면 맞춤).
// 올라오는 HTML은 docvault를 모르고 만들어진 남의 문서다 — 문서를 고치라고 요구하지 않고 뷰어가 맞춘다.
// 넘칠 때만, 약한 수단부터 단계적으로 개입한다: 가드 CSS → 원인 요소만 스크롤 상자로 → 그래도 넘치면 축소.
// DOM은 건드리지 않고 인라인 스타일만 덧씌운다 — 요소를 감싸면 문서의 `>`·:nth-child 선택자가 깨지기 때문.
function fitShim(enabled: boolean): string {
  return `<script>(function(){
var TOL=2,MIN_ZOOM=.5,on=${enabled ? 'true' : 'false'};
var css=null,zoomed=false,patched=[],timer,obs;
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
// ② 넘치는 요소를 손본다. 두 걸음으로 나누는 이유:
// "가장 안쪽이 범인"이라는 짐작으로 한 놈만 고르면, 고정 width를 가진 바깥 상자나
// 오른쪽으로 밀려난 형제를 놓친다. 그래서 ⓐ 넘치는 것을 일단 전부 화면 폭 안으로 가둔 뒤
// ⓑ 가두고 나서도 제 안에서 내용이 넘치는 것만 가로 스크롤 상자로 만든다.
var patchWide=function(){
var vw=de().clientWidth,list=[],all=document.body.getElementsByTagName('*'),i,p,el,r;
for(i=0;i<all.length;i++){el=all[i];r=el.getBoundingClientRect();
// 폭이 넓은 것뿐 아니라 오른쪽으로 밀려난 것도 범인이다 (폭은 좁아도 화면 밖으로 나간다)
if(r.width<=vw+TOL&&r.right<=vw+TOL)continue;
if(getComputedStyle(el).position==='fixed')continue; // 떠 있는 요소는 문서 폭에 관여하지 않는다
list.push(el)}
for(i=0;i<list.length;i++){el=list[i];
if(el.tagName==='TABLE')put(el,'display','block'); // 표는 block이어야 overflow가 먹는다
// box-sizing을 같이 주지 않으면 max-width:100%가 "내용 상자" 기준이라 좌우 여백만큼 그대로 넘친다
put(el,'box-sizing','border-box');put(el,'max-width','100%');put(el,'min-width','0');
// grid/flex의 1fr은 내용물의 min-content보다 못 줄어든다 — 조상 사슬을 풀어야 칸이 좁아진다
for(p=el.parentElement;p&&p!==document.body;p=p.parentElement)put(p,'min-width','0')}
// 스크롤을 맡을 후보에는 조상도 넣는다 — 제 상자는 멀쩡한데 자식들만 삐져나오는 부모가
// 진짜 스크롤 상자여야 한다(3단 배치의 줄, 코드 블록 등). 그런 부모는 위 목록에 잡히지 않는다
var cand=[],seen=new Set();
var add=function(e){if(e&&e!==document.body&&!seen.has(e)){seen.add(e);
var d=0,q=e;while(q=q.parentElement)d++;cand.push([d,e])}};
for(i=0;i<list.length;i++){add(list[i]);
for(p=list[i].parentElement;p&&p!==document.body;p=p.parentElement)add(p)}
// 안쪽부터 처리해야 가장 가까운 상자가 스크롤을 맡는다 (바깥이 맡으면 문서 전체가 흔들린다)
cand.sort(function(a,b){return b[0]-a[0]});
for(i=0;i<cand.length;i++){el=cand[i][1];
if(el.scrollWidth>el.clientWidth+TOL&&getComputedStyle(el).overflowX==='visible')
put(el,'overflow-x','auto')}};
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
var schedule=function(){clearTimeout(timer);timer=setTimeout(run,120)};
// 문서가 나중에 그리는 내용(스크립트가 붙이는 표·목록)도 잡는다.
// 자식이 늘고 주는 것만 본다 — 속성까지 보면 우리가 덧씌운 스타일이 스스로를 다시 부른다
var watch=function(){
if(obs||!window.MutationObserver||!document.body)return;
obs=new MutationObserver(schedule);obs.observe(document.body,{childList:true,subtree:true})};
var start=function(){run();watch()};
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',start);else start();
addEventListener('load',function(){start();setTimeout(run,600)});
addEventListener('resize',schedule,{passive:true});
addEventListener('message',function(ev){var d=ev.data||{};
if(d.type==='docvault:fit'){on=!!d.on;undo();if(on)run()}
// 글자가 커지면 표·코드가 다시 넘친다 — 배율이 바뀌면 맞춤을 처음부터 다시 계산한다.
// 0ms 뒤로 미루는 이유: 같은 쪽지를 받는 배율 심이 먼저 일을 끝내야 한다
else if(d.type==='docvault:scale')setTimeout(function(){undo();if(on)run()},0)});
})()</${'script'}>`;
}

/** 문서 구조(doctype·head)를 깨뜨리지 않는 위치에 심을 주입한다 */
function injectShims(
  html: string,
  restoreOffset: number,
  restoreRatio: number | undefined,
  theme: ViewerTheme,
  fit: boolean,
  scale: number,
): string {
  // 순서가 곧 실행 순서다(리스너는 등록된 차례로 불린다) — 글자 크기를 정한 뒤 그 결과로 맞춤을 재고,
  // 마지막에 읽던 위치를 복원해야 앞 단계가 바꿔 놓은 레이아웃 위에서 제자리를 찾는다
  const shims =
    STORAGE_SHIM + scaleShim(scale) + fitShim(fit) + navShim(restoreOffset, restoreRatio, theme);
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
  /** 복원할 비율(0~1) — 있으면 px보다 우선한다 (기기 간 이어 읽기) */
  initialRatio?: number;
  /** iframe 내부 스크롤 보고 수신(px, 비율) — 부모(Viewer)가 읽던 위치 저장에 사용 */
  onScrollOffset?: (offset: number, ratio?: number) => void;
  /** 문서 헤딩 목록 보고 수신 — 부모(Viewer)가 목차(SCR-151)에 사용 */
  onToc?: (items: RendererTocItem[]) => void;
  /** 문서 안을 눌렀다는 신호 — 부모가 열어 둔 팝오버를 닫는 데 쓴다 */
  onInteract?: () => void;
  /** 좁은 화면 맞춤 보정 — 끄면 문서를 만든 그대로 보여준다 */
  fit?: boolean;
  /** 글자 크기 배율(%) — 100이면 문서가 정한 크기 그대로 */
  fontScale?: number;
};

export default function HtmlRenderer({ content, theme, initialOffset = 0, initialRatio, onScrollOffset, onToc, onInteract, fit = true, fontScale = 100 }: Props) {
  const frameRef = useRef<HTMLIFrameElement>(null);
  // srcDoc이 바뀌면 iframe이 통째로 리로드된다 — 복원 위치·초기 테마·맞춤·배율은 마운트 시점 값으로 고정해
  // 부모 리렌더(트리 갱신·설정 변경 등)가 읽는 중인 문서를 초기화하지 않게 한다
  const [restoreOffset] = useState(initialOffset);
  const [restoreRatio] = useState(initialRatio);
  const [initialTheme] = useState<ViewerTheme>(theme ?? 'light');
  const [initialFit] = useState(fit);
  const [initialScale] = useState(fontScale);
  const doc = useMemo(
    () => injectShims(content, restoreOffset, restoreRatio, initialTheme, initialFit, initialScale),
    [content, restoreOffset, restoreRatio, initialTheme, initialFit, initialScale],
  );

  useEffect(() => {
    function onMessage(e: MessageEvent) {
      // 반드시 이 iframe에서 온 메시지만 신뢰한다 (아키텍처 — HTML 렌더러 호환 심)
      if (e.source !== frameRef.current?.contentWindow) return;
      const d = e.data as { type?: unknown; offset?: unknown; ratio?: unknown; items?: unknown } | null;
      if (!d || typeof d !== 'object') return;
      if (d.type === 'docvault:interact') {
        onInteract?.();
      } else if (d.type === 'docvault:scroll' && typeof d.offset === 'number') {
        onScrollOffset?.(d.offset, typeof d.ratio === 'number' ? d.ratio : undefined);
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
  }, [onScrollOffset, onToc, onInteract]);

  // 열람 중 테마·맞춤 변경은 리로드 없이 쪽지로 전파한다 (마운트 시점 값은 이미 심에 박혀 있다).
  // 실제로 보낸 값을 기억해 두는 이유: 처음 값으로 되돌아가는 변경(밝게→어둡게→밝게)도 전해야 한다
  const sent = useRef({ theme: initialTheme, fit: initialFit, scale: initialScale });
  useEffect(() => {
    const win = frameRef.current?.contentWindow;
    if (!win) return;
    if (theme && theme !== sent.current.theme) {
      win.postMessage({ type: 'docvault:theme', theme: collapseTheme(theme) }, '*');
      sent.current.theme = theme;
    }
    if (fit !== sent.current.fit) {
      win.postMessage({ type: 'docvault:fit', on: fit }, '*');
      sent.current.fit = fit;
    }
    if (fontScale !== sent.current.scale) {
      win.postMessage({ type: 'docvault:scale', percent: fontScale }, '*');
      sent.current.scale = fontScale;
    }
  }, [theme, fit, fontScale]);

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
