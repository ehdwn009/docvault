import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { OutlookBlock, OutlookData } from './schema.js';

// 세계 전망 완성본 → 한 장짜리 HTML. 화면 틀은 server/assets/outlook-template.html 하나 — 스킬이 손으로 게시할 때도 같은 틀을 쓴다.
// 그래프는 세션이 보낸 표(도표 블록의 줄)에서 화면 틀이 그린다(세계전망 설계 10단계)

const TEMPLATE_PATH = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'assets', 'outlook-template.html');

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** 'YYYY-MM-DD' → '2026년 11월 7일' ('YYYY-MM'이면 일 없이) */
export function koDate(d: string): string {
  const [y, m, day] = d.split('-');
  return `${y}년 ${Number(m)}월${day ? ` ${Number(day)}일` : ''}`;
}

/** 본문 글 → HTML. **굵게**와 각주 [n][m]만 바꾼다 — 붙어 있는 각주는 위첨자 하나로 묶는다 */
function inline(text: string): string {
  let h = esc(text).replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
  h = h.replace(/(?:\[\d{1,3}\])+/g, (run) => {
    const ns = [...run.matchAll(/\[(\d{1,3})\]/g)].map((m) => m[1]);
    const links = ns.map((n) => `<a class="fn" href="#note-${n}" data-n="${n}">${n}</a>`).join('<span class="fn-sep">,</span>');
    return `<sup class="fn-ref">${links}</sup>`;
  });
  return h;
}

type ChartSpec = {
  kind: 'bar' | 'diverge';
  domain: [number, number];
  ticks: number[];
  fmt: 'plain';
  unit: string;
  padR: number;
  labelW: number;
  rows: { name: string; sub?: string; v: number; text: string; tip: string[] }[];
};

function niceStep(span: number): number {
  const raw = span / 4;
  const p = 10 ** Math.floor(Math.log10(raw));
  const f = raw / p;
  return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10) * p;
}

function chartSpec(b: Extract<OutlookBlock, { type: 'chart' }>): ChartSpec {
  const vs = b.rows.map((r) => r.value);
  const lo = Math.min(0, ...vs);
  const hi = Math.max(0, ...vs);
  const step = niceStep(hi - lo || 1);
  const d0 = Math.floor(lo / step) * step;
  const d1 = Math.ceil(hi / step) * step || step;
  const ticks: number[] = [];
  for (let t = d0; t <= d1 + step / 2; t += step) ticks.push(Number(t.toFixed(6)));
  const longest = Math.max(...b.rows.map((r) => Math.max(r.label.length, (r.sub ?? '').length * 0.85)));
  return {
    kind: lo < 0 ? 'diverge' : 'bar',
    domain: [d0, d1],
    ticks,
    fmt: 'plain',
    unit: b.unit,
    padR: 72,
    labelW: Math.min(240, Math.max(90, Math.round(longest * 15 + 16))),
    rows: b.rows.map((r) => ({ name: r.label, ...(r.sub ? { sub: r.sub } : {}), v: r.value, text: r.text, tip: [r.text] })),
  };
}

function tableHtml(columns: string[], rows: string[][]): string {
  const head = `<tr>${columns.map((c) => `<th>${esc(c)}</th>`).join('')}</tr>`;
  const body = rows.map((r) => `<tr>${r.map((c) => `<td>${inline(c)}</td>`).join('')}</tr>`).join('');
  return `<div class="table-wrap"><table><thead>${head}</thead><tbody>${body}</tbody></table></div>`;
}

export function renderOutlookPage(d: OutlookData): string {
  const template = fs.readFileSync(TEMPLATE_PATH, 'utf8');
  const charts: ChartSpec[] = [];
  let figNo = 0;

  const block = (b: OutlookBlock): string => {
    if (b.type === 'p') return `<p>${inline(b.text)}</p>`;
    if (b.type === 'bullets') return `<ul class="bul">${b.items.map((i) => `<li>${i.lead ? `<span class="lead">${inline(i.lead)}</span> ` : ''}${inline(i.text)}</li>`).join('')}</ul>`;
    if (b.type === 'table') {
      const title = b.title ? `<p class="lead">${inline(b.title)}</p>` : '';
      const note = b.note ? `<p class="fig-note">${inline(b.note)}</p>` : '';
      return `${title}${tableHtml(b.columns, b.rows)}${note}`;
    }
    figNo++;
    charts.push(chartSpec(b));
    const rows = b.rows.map((r) => [r.sub ? `${r.label} (${r.sub})` : r.label, r.text]);
    return `<figure class="chart-fig"><figcaption><span class="fig-label">도표 ${figNo}</span><span class="fig-title">${inline(b.title)}</span>${b.note ? `<span class="fig-note">${inline(b.note)}</span>` : ''}</figcaption><div class="chart" data-chart="${charts.length - 1}"></div><div class="tip" hidden></div><details class="as-table"><summary>표로 보기</summary>${tableHtml(['', b.unit ? `값(${b.unit})` : '값'], rows)}</details></figure>`;
  };

  const m = d.meta;
  const cover = [
    '<header class="cover">',
    m.test ? '<span class="test-badge">시험 운행</span>' : '',
    `<h1>${esc(m.title)}</h1>`,
    m.subtitle ? `<p class="subtitle">${esc(m.subtitle)}</p>` : '',
    `<p class="meta">${esc(m.label)} · 읽은 기간 ${koDate(m.since)} – ${koDate(m.until)} 발표분${m.baseline ? `<br>견준 기준선: ${esc(m.baseline)}` : ''}</p>`,
    '<p class="disclaimer">이 문서는 공개된 전망을 바탕으로 쓴 분석이며, 특정 자산의 매수·매도를 권하는 투자 권유가 아니다.</p>',
    '</header>',
  ].join('\n');

  const tocItems = [
    `<li><a href="#summary" data-sec="summary"><span class="t-lab">요약</span></a></li>`,
    ...d.sections.map((s, i) => `<li><a href="#s-${s.id}" data-sec="s-${s.id}"><span class="t-num">${i + 1}</span><span class="t-lab">${esc(s.title)}</span></a></li>`),
    `<li class="t-appx"><a href="#about" data-sec="about"><span class="t-lab">${esc(d.about.title)}</span></a></li>`,
    `<li class="t-appx"><a href="#notes" data-sec="notes"><span class="t-lab">주</span></a></li>`,
  ];
  const toc = `<nav class="toc" aria-label="목차"><p class="toc-h">목차</p><ol>${tocItems.join('')}</ol></nav>`;

  const body = [
    `<section class="summary" id="summary"><h2>요약</h2>${d.summary.map((s) => `<p>${inline(s.text)}</p>`).join('')}</section>`,
    ...d.sections.map((s, i) => `<section id="s-${s.id}"><h2><span class="h-num">${i + 1}.</span> ${esc(s.title)}</h2>${s.blocks.map(block).join('\n')}</section>`),
    `<section class="about" id="about"><h2>${esc(d.about.title)}</h2><p>${inline(d.about.text)}</p></section>`,
    `<section class="notes" id="notes"><h2>주</h2><ol class="notes-list">${d.notes
      .map((n) => `<li class="note" id="note-${n.n}"><span class="note-n">${n.n}</span><div class="note-body"><span class="note-org">${esc(n.org)}</span>, 「${esc(n.title)}」, ${koDate(n.date)}. <a class="note-url" href="${esc(n.url)}" target="_blank" rel="noopener noreferrer">${esc(n.url)}</a></div></li>`)
      .join('')}</ol></section>`,
  ].join('\n');

  const sources = Object.fromEntries(d.notes.map((n) => [String(n.n), { org: n.org, title: n.title, date: koDate(n.date), url: n.url }]));
  // </script>로 스크립트 블록이 일찍 닫히지 않게 <를 유니코드 표기로
  const json = (v: unknown) => JSON.stringify(v).replace(/</g, '\\u003c');
  return template
    .replace('%%TITLE%%', () => esc(d.meta.title))
    .replace('%%COVER%%', () => cover)
    .replace('%%TOC%%', () => toc)
    .replace('%%BODY%%', () => body)
    .replace('%%SOURCES%%', () => json(sources))
    .replace('%%CHARTS%%', () => json(charts));
}

/** 게시용 조각(<title>로 시작, doctype 없음)을 뷰어·브라우저로 바로 여는 완전한 문서로 감싼다 — 손으로 만든 시범 큰 판(시드)도 같은 겉옷을 입는다 */
export function wrapOutlookPage(fragment: string): string {
  return `<!doctype html>\n<html lang="ko">\n<head>\n<meta charset="utf-8">\n<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">\n<style>[hidden]{display:none!important} body{margin:0}</style>\n</head>\n<body>\n${fragment}\n</body>\n</html>\n`;
}

/** 뷰어·브라우저로 바로 여는 완전한 문서 — 게시용 조각(renderOutlookPage)을 감싼다 */
export function renderOutlookHtml(d: OutlookData): string {
  return wrapOutlookPage(renderOutlookPage(d));
}
