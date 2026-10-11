import fs from 'node:fs';
import { fetchSource } from '../lib/briefing/collect.js';
import { parseFeed } from '../lib/briefing/rss.js';
import { errorText, mapLimit } from '../lib/briefing/limit.js';
import { defaultSourcesDoc, parseSourcesDoc, toSources } from '../lib/briefing/sources.js';
import { BRIEFING } from '../constants.js';

// 수집 목록의 주소가 실제로 열리는지 한 번에 점검한다 — 서버에서:
//   docker compose exec app npm run briefing:check -w server            (기본 목록)
//   docker compose exec app npm run briefing:check -w server -- 목록.json (내 수집 목록 문서를 받아 둔 파일)
// 브리핑을 만들지 않고 AI도 부르지 않는다. 출처마다 성공/실패, 기사 수, 가장 최근 기사 시각을 찍는다

// 기본 목록은 꺼진 후보(CANDIDATE_FEEDS)까지 전부 점검한다 — 켤지 말지를 정하는 것이 이 명령의 쓸모다 (개선 합의안 S5)
const file = process.argv[2];
const doc = file ? parseSourcesDoc(fs.readFileSync(file, 'utf8')) : { ...defaultSourcesDoc(), disabled: [] };
const sources = toSources(doc);
const off = new Set(file ? [] : defaultSourcesDoc().disabled);

const results = await mapLimit(sources, BRIEFING.FETCH_CONCURRENCY, async (s) => parseFeed(await fetchSource(s)));
let ok = 0;
results.forEach((r, i) => {
  const s = sources[i];
  if (!s) return;
  if (r.ok) {
    ok++;
    const newest = Math.max(0, ...r.value.map((it) => it.publishedAt ?? 0));
    const dated = r.value.filter((it) => it.publishedAt !== null).length;
    const when = newest ? new Date(newest + BRIEFING.KST_OFFSET_MS).toISOString().slice(0, 16).replace('T', ' ') : '시각 없음';
    const full = r.value.filter((it) => it.fullText).length;
    console.log(`OK    ${off.has(s.name) ? '[후보] ' : ''}${s.name} — ${r.value.length}건 (시각 있는 것 ${dated}, 본문 있는 것 ${full}) · 최근 ${when} KST`);
  } else {
    console.log(`FAIL  ${off.has(s.name) ? '[후보] ' : ''}${s.name} — ${errorText(r.error)}  ${s.url}`);
  }
});
console.log(`\n${ok}/${sources.length} 성공`);
if (!file) console.log('[후보]는 기본 목록에서 꺼져 있는 출처 — 수집 목록 문서의 disabled에서 이름을 지우면 켜집니다');
