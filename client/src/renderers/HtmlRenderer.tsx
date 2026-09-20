import { useEffect, useMemo, useRef, useState } from 'react';
import { isDarkViewerTheme, type ViewerTheme } from '../lib/api';
import { ASK_CONTEXT_MAX_CHARS, ASK_QUOTE_MAX_CHARS, HTML_SCROLLER_LIMIT } from '../lib/constants';
import type { RendererSelection, RendererTocItem } from './index';

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
  return `<style>::highlight(dv-source),mark.dv-source{background:rgba(250,204,21,.5);color:inherit}::highlight(dv-term){text-decoration:underline dotted rgba(20,184,166,.9)}</style><script>(function(){
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
// 프레임당 한 번만 보고한다 — 부모의 크롬 자동 숨김이 손가락을 바로 따라가야 하기 때문.
// 디바운스(멈춘 뒤 한 번)로는 손을 뗀 뒤에야 헤더가 튀어나온다. 서버 저장은 부모가 따로 묶는다
var rq=0;addEventListener('scroll',function(){if(rq)return;rq=1;requestAnimationFrame(function(){rq=0;
var s=se(),d=s.scrollHeight-s.clientHeight;
parent.postMessage({type:'docvault:scroll',offset:s.scrollTop,ratio:d>0?Math.min(1,s.scrollTop/d):0},'*')})},{passive:true});
var HD=[];
var sendToc=function(){HD=[].slice.call(document.querySelectorAll('h1,h2,h3')).slice(0,300);
parent.postMessage({type:'docvault:toc',items:HD.map(function(h){return{text:(h.textContent||'').trim().slice(0,120),level:+h.tagName[1]||1}})},'*')};
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',sendToc);else sendToc();
// 카드 출처 문장 찾기 — lib/findQuote.ts와 같은 알고리즘의 ES5 복사본 (격리 iframe이라 import가 안 된다. 규칙을 고치면 양쪽 같이)
var HLN='dv-source';
var findQ=function(q){q=q.replace(/\\s+/g,' ').replace(/^\\s+|\\s+$/g,'');if(!q)return null;
var w=document.createTreeWalker(document.body,NodeFilter.SHOW_TEXT,null),map=[],flat='',ls=true,n;
while((n=w.nextNode())){var p=n.parentNode&&n.parentNode.nodeName;if(p==='SCRIPT'||p==='STYLE')continue;var t=n.data;
for(var i=0;i<t.length;i++){var ch=t.charAt(i);if(/\\s/.test(ch)){if(ls)continue;flat+=' ';map.push([n,i]);ls=true}else{flat+=ch;map.push([n,i]);ls=false}}}
var at=flat.indexOf(q),len=q.length;if(at<0&&q.length>30){var h=q.slice(0,30).replace(/\\s+$/,'');at=flat.indexOf(h);len=h.length}
if(at<0)return null;var r=document.createRange();r.setStart(map[at][0],map[at][1]);r.setEnd(map[at+len-1][0],map[at+len-1][1]+1);return r};
var doFind=function(q){var old=document.querySelectorAll('mark.'+HLN);for(var i=0;i<old.length;i++){var m=old[i];while(m.firstChild)m.parentNode.insertBefore(m.firstChild,m);m.parentNode.removeChild(m)}
if(window.CSS&&CSS.highlights)CSS.highlights['delete'](HLN);
var r=findQ(q);if(!r){parent.postMessage({type:'docvault:found',ok:false},'*');return}
if(window.CSS&&CSS.highlights&&window.Highlight)CSS.highlights.set(HLN,new Highlight(r));else if(r.startContainer===r.endContainer){var mk=document.createElement('mark');mk.className=HLN;r.surroundContents(mk)}
var el=r.startContainer.parentNode;if(el&&el.scrollIntoView)el.scrollIntoView({behavior:'smooth',block:'center'});parent.postMessage({type:'docvault:found',ok:true},'*')};
// 내 카드 용어 밑줄 — lib/findQuote.ts markTerms의 ES5 복사본. 문단마다 첫 등장만, 링크·코드 안은 건너뛴다
var TRM=[];var flatAll=function(){var w=document.createTreeWalker(document.body,NodeFilter.SHOW_TEXT,null),map=[],flat='',ls=true,n;
while((n=w.nextNode())){var p=n.parentNode&&n.parentNode.nodeName;if(p==='SCRIPT'||p==='STYLE')continue;var t=n.data;
for(var i=0;i<t.length;i++){var ch=t.charAt(i);if(/\\s/.test(ch)){if(ls)continue;flat+=' ';map.push([n,i]);ls=true}else{flat+=ch;map.push([n,i]);ls=false}}}return{t:flat,m:map}};
var isW=function(c){return !!c&&/[A-Za-z0-9]/.test(c)};
var markTerms=function(terms){TRM=[];if(window.CSS&&CSS.highlights)CSS.highlights['delete']('dv-term');if(!terms.length)return;
var f=flatAll(),low=f.t.toLowerCase(),names=[],i,j;
for(i=0;i<terms.length;i++){var alls=[terms[i].title].concat(terms[i].aliases||[]);for(j=0;j<alls.length;j++){var nm=String(alls[j]).replace(/\\s+/g,' ').replace(/^\\s+|\\s+$/g,'');if(nm.length>=2)names.push([terms[i].title,nm])}}
names.sort(function(a,b){return b[1].length-a[1].length});
var taken=[],seen={},blocks=[],ranges=[];
for(i=0;i<names.length;i++){var title=names[i][0],needle=names[i][1].toLowerCase(),ascii=/^[A-Za-z0-9._-]+$/.test(names[i][1]),from=0;
while(TRM.length<300){var at=low.indexOf(needle,from);if(at<0)break;from=at+needle.length;
if(ascii&&(isW(f.t.charAt(at-1))||isW(f.t.charAt(at+needle.length))))continue;
var ov=false;for(j=0;j<taken.length;j++){if(at<taken[j][1]&&at+needle.length>taken[j][0]){ov=true;break}}if(ov)continue;
var r=document.createRange();r.setStart(f.m[at][0],f.m[at][1]);r.setEnd(f.m[at+needle.length-1][0],f.m[at+needle.length-1][1]+1);
var el=r.startContainer.parentElement;if(!el||el.closest('a, code, pre, kbd'))continue;
var blk=el.closest('p, li, td, th, h1, h2, h3, h4, h5, h6, blockquote, dd, dt, div')||document.body;
var bi=blocks.indexOf(blk);if(bi<0){blocks.push(blk);bi=blocks.length-1}
var key=bi+'|'+title;if(seen[key])continue;seen[key]=1;
taken.push([at,at+needle.length]);TRM.push([title,r]);ranges.push(r)}}
if(ranges.length&&window.CSS&&CSS.highlights&&window.Highlight)CSS.highlights.set('dv-term',new (Function.prototype.bind.apply(Highlight,[null].concat(ranges)))());
var titles=[];for(i=0;i<TRM.length;i++)if(titles.indexOf(TRM[i][0])<0)titles.push(TRM[i][0]);
parent.postMessage({type:'docvault:terms-found',titles:titles},'*')};
document.addEventListener('click',function(ev){if(!TRM.length)return;var s=document.getSelection();if(s&&!s.isCollapsed)return;
var node=null,off=0;if(document.caretPositionFromPoint){var cp=document.caretPositionFromPoint(ev.clientX,ev.clientY);if(cp){node=cp.offsetNode;off=cp.offset}}
else if(document.caretRangeFromPoint){var cr=document.caretRangeFromPoint(ev.clientX,ev.clientY);if(cr){node=cr.startContainer;off=cr.startOffset}}
if(!node)return;for(var i=0;i<TRM.length;i++){try{if(TRM[i][1].isPointInRange(node,off)){ev.preventDefault();var b=TRM[i][1].getClientRects()[0]||TRM[i][1].getBoundingClientRect();
parent.postMessage({type:'docvault:term',title:TRM[i][0],x:b.left,y:b.top,w:b.width,h:b.height},'*');return}}catch(e){}}},true);
addEventListener('message',function(ev){var d=ev.data||{};
if(d.type==='docvault:goto'&&HD[d.index])HD[d.index].scrollIntoView({behavior:'smooth',block:'start'});
else if(d.type==='docvault:find'&&typeof d.quote==='string')doFind(d.quote);
else if(d.type==='docvault:terms'&&Array.isArray(d.terms))markTerms(d.terms);
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

// 스크롤 상자 메모리 가드 (아키텍처 — 스크롤 상자 메모리 가드).
// iOS는 가로로 넘치는 스크롤 상자마다 합성 레이어를 따로 두는데, 레티나에서는 한 장이 수 MB다.
// 터미널 블록이 백 개 넘는 문서는 탭 메모리 한도를 넘겨 "문제가 반복적으로 발생" 강제 종료가 되고,
// 앱은 다시 켜면 마지막 문서를 여므로 빠져나올 수도 없다 — 그래서 화면 맞춤 토글과 무관하게 항상 켠다.
// 상자가 한도를 넘을 때만, 줄바꿈이 가능한 코드형 상자만 바꾼다. 표는 줄바꿈하면 칸이 무너져 스크롤로 남긴다
function memoryGuardShim(): string {
  return `<script>(function(){
if(matchMedia('(hover: hover) and (pointer: fine)').matches)return; // PC는 메모리가 넉넉하다 — 문서를 만든 그대로 둔다
var LIMIT=${HTML_SCROLLER_LIMIT};
var run=function(){
if(!document.body)return;
var all=document.body.getElementsByTagName('*'),hit=[],i,el,cs;
// 읽기를 전부 끝낸 뒤에 쓴다 — 섞으면 요소마다 문서 전체 레이아웃을 새로 계산한다
for(i=0;i<all.length;i++){el=all[i];if(el.__dvWrap)continue;cs=getComputedStyle(el);
if((cs.overflowX==='auto'||cs.overflowX==='scroll')&&el.scrollWidth>el.clientWidth+2)hit.push([el,cs.whiteSpace])}
if(hit.length<=LIMIT)return;
// 한 번 줄바꿈한 상자는 되돌리지 않는다 — 되돌리는 순간 다시 레이어가 되어 한도를 넘는다
for(i=0;i<hit.length;i++){el=hit[i][0];
if(hit[i][1]==='normal'||el.querySelector('table'))continue;
el.__dvWrap=1;
el.style.setProperty('white-space','pre-wrap','important');
el.style.setProperty('overflow-wrap','anywhere','important');
el.style.setProperty('overflow-x','visible','important')}};
var safe=function(){try{run()}catch(e){}};
// 레이어는 그릴 때 생긴다 — 첫 그림 전에 한 번, 글꼴·이미지·배율로 폭이 바뀐 뒤에 다시
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',safe);else safe();
addEventListener('load',function(){safe();setTimeout(safe,1000)});
// 배율이 커지면 새로 넘치는 상자가 생긴다 — 같은 쪽지를 받는 맞춤 심보다 먼저 끝나도록 등록 순서를 앞에 둔다
addEventListener('message',function(ev){var d=ev.data||{};if(d.type==='docvault:scale')setTimeout(safe,0)});
})()</${'script'}>`;
}

// 문장 선택 보고 (SCR-180 질문 패널). 격리 오리진이라 부모가 getSelection()을 못 읽는다 —
// 심이 선택 문장, 그 문장이 든 블록과 앞뒤 블록(=LLM에 보낼 문맥), 화면 좌표를 대신 보고한다.
// 문맥을 블록 단위로 자르는 이유: 문서 전체를 보내지 않는다는 설계 원칙의 구현 지점이 여기다
function selectionShim(): string {
  // 이 안은 TS 템플릿 리터럴이다 — 정규식·개행은 반드시 \\s, \\n처럼 두 번 이스케이프한다.
  // 한 번만 쓰면 TS가 먼저 풀어 버려(\s→s, \n→진짜 개행) 심 전체가 문법 오류로 죽는다 (v0.23.1에서 실제로 겪음)
  return `<script>(function(){
var QMAX=${ASK_QUOTE_MAX_CHARS},CMAX=${ASK_CONTEXT_MAX_CHARS};
var isBlock=function(e){var d=getComputedStyle(e).display;return d!=='inline'&&d!=='contents'};
var blockOf=function(n){var e=n&&n.nodeType===1?n:n&&n.parentElement;
while(e&&e!==document.body){if(isBlock(e))return e;e=e.parentElement}return null};
var txt=function(e){return e?String(e.innerText||e.textContent||'').replace(/\\s+/g,' ').trim():''};
var ctx=function(el){if(!el)return '';var out=[];
var p=el.previousElementSibling;if(p)out.push(txt(p));
out.push(txt(el));
var n=el.nextElementSibling;if(n)out.push(txt(n));
return out.filter(Boolean).join('\\n\\n').slice(0,CMAX)};
var last='',timer,rq=0;
// force: 문장은 같아도 좌표가 바뀐 경우(스크롤)에 다시 보고
var report=function(force){var s=document.getSelection();
var q=s&&!s.isCollapsed?String(s).replace(/\\s+/g,' ').trim():'';
if(!q){if(last){last='';parent.postMessage({type:'docvault:selection',quote:''},'*')}return}
if(q===last&&!force)return;last=q;
var r=s.getRangeAt(0).getBoundingClientRect();
parent.postMessage({type:'docvault:selection',quote:q.slice(0,QMAX),context:ctx(blockOf(s.anchorNode)),x:r.left,y:r.top,w:r.width,h:r.height},'*')};
// 손을 뗀 순간 보고하고, 터치 손잡이 조절처럼 pointerup이 안 오는 경우는 selectionchange를 잠시 모아 보고한다
addEventListener('pointerup',function(){setTimeout(report,0)},{passive:true});
addEventListener('touchend',function(){setTimeout(report,0)},{passive:true});
addEventListener('keyup',function(){setTimeout(report,0)},{passive:true});
document.addEventListener('selectionchange',function(){clearTimeout(timer);timer=setTimeout(report,300)});
// 스크롤하면 좌표가 낡는다 — 선택은 그대로니 새 좌표로 다시 보고해 바가 글을 따라가게 한다 (프레임당 한 번)
addEventListener('scroll',function(){if(!last||rq)return;rq=1;requestAnimationFrame(function(){rq=0;report(true)})},{passive:true});
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
  // 순서가 곧 실행 순서다(리스너는 등록된 차례로 불린다) — 글자 크기를 정한 뒤 그 결과로 넘치는 코드 상자를
  // 줄바꿈하고(메모리 가드), 남은 넘침으로 맞춤을 재고, 마지막에 읽던 위치를 복원해야
  // 앞 단계가 바꿔 놓은 레이아웃 위에서 제자리를 찾는다
  const shims =
    STORAGE_SHIM +
    scaleShim(scale) +
    memoryGuardShim() +
    fitShim(fit) +
    selectionShim() +
    navShim(restoreOffset, restoreRatio, theme);
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
  /** 문장 선택 보고 — 좌표는 뷰포트 기준으로 바꿔서 준다. null = 선택 풀림 */
  onSelection?: (sel: RendererSelection | null) => void;
  /** 카드 출처로 열렸을 때 찾아 형광펜 칠할 문장 — 심에 쪽지로 보낸다 */
  highlightQuote?: string;
  onQuoteFound?: (found: boolean) => void;
  /** 밑줄 그을 내 카드 용어 — 심에 쪽지로 보내고, 찾은 것·눌린 것을 심이 보고한다 */
  terms?: { title: string; aliases: string[] }[];
  onTermsFound?: (titles: string[]) => void;
  onTermClick?: (title: string, rect: { x: number; y: number; w: number; h: number }) => void;
};

export default function HtmlRenderer({ content, theme, initialOffset = 0, initialRatio, onScrollOffset, onToc, onInteract, fit = true, fontScale = 100, onSelection, highlightQuote, onQuoteFound, terms, onTermsFound, onTermClick }: Props) {
  const frameRef = useRef<HTMLIFrameElement>(null);
  // 문서가 다 올라온 뒤에야 찾기 쪽지를 보낼 수 있다 — 심이 'docvault:toc'를 보내면 준비된 것
  const [ready, setReady] = useState(false);
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
      const d = e.data as {
        type?: unknown; offset?: unknown; ratio?: unknown; items?: unknown; ok?: unknown; titles?: unknown; title?: unknown;
        quote?: unknown; context?: unknown; x?: unknown; y?: unknown; w?: unknown; h?: unknown;
      } | null;
      if (!d || typeof d !== 'object') return;
      const frameRect = () => frameRef.current?.getBoundingClientRect();
      if (d.type === 'docvault:interact') {
        onInteract?.();
      } else if (d.type === 'docvault:found') {
        onQuoteFound?.(d.ok === true);
      } else if (d.type === 'docvault:terms-found' && Array.isArray(d.titles)) {
        onTermsFound?.((d.titles as unknown[]).map(String));
      } else if (d.type === 'docvault:term' && typeof d.title === 'string') {
        const fr = frameRect();
        onTermClick?.(d.title, { x: (fr?.left ?? 0) + Number(d.x ?? 0), y: (fr?.top ?? 0) + Number(d.y ?? 0), w: Number(d.w ?? 0), h: Number(d.h ?? 0) });
      } else if (d.type === 'docvault:selection') {
        const quote = typeof d.quote === 'string' ? d.quote : '';
        if (!quote) {
          onSelection?.(null);
          return;
        }
        // iframe 안 좌표 → 뷰포트 좌표: iframe 상자의 위치를 더한다
        const fr = frameRef.current?.getBoundingClientRect();
        onSelection?.({
          quote,
          context: typeof d.context === 'string' ? d.context : '',
          rect: {
            x: (fr?.left ?? 0) + Number(d.x ?? 0),
            y: (fr?.top ?? 0) + Number(d.y ?? 0),
            w: Number(d.w ?? 0),
            h: Number(d.h ?? 0),
          },
        });
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
        setReady(true);
      }
    }
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, [onScrollOffset, onToc, onInteract, onSelection, onQuoteFound, onTermsFound, onTermClick]);

  // 용어 목록 — 문서가 준비된 뒤, 그리고 목록이 바뀔 때마다
  useEffect(() => {
    if (!ready) return;
    frameRef.current?.contentWindow?.postMessage({ type: 'docvault:terms', terms: (terms ?? []).map((t) => ({ title: t.title, aliases: t.aliases })) }, '*');
  }, [ready, terms]);

  // 출처 문장 찾기 — 문서가 준비된 뒤, 그리고 문장이 바뀔 때마다
  useEffect(() => {
    if (!ready || !highlightQuote) return;
    frameRef.current?.contentWindow?.postMessage({ type: 'docvault:find', quote: highlightQuote }, '*');
  }, [ready, highlightQuote]);

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
