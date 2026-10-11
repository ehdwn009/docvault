import { and, desc, eq, isNull } from 'drizzle-orm';
import { db } from '../db/index.js';
import { files } from '../db/schema.js';
import { BRIEFING } from '../constants.js';
import type { Edition, EditionItem } from '../lib/briefing/edition.js';
import { fetchGuarded } from '../lib/briefing/fetch.js';
import { mapLimit } from '../lib/briefing/limit.js';
import { extractParagraphs, readerQualityOk } from '../lib/briefing/reader.js';

// 앱 안 원문 보기를 켜도 되는지 재는 점검 명령 (개선 합의안 7장 "D0 측정") — 서버에서:
//   docker compose exec app npm run briefing:readcheck -w server
// 최근 회차(기본 1개, 인자로 개수)의 핵심·주요 기사마다 readUrl을 받아 Readability로 뽑고, 두 비율을 찍는다.
//   품질 통과율: readUrl 있는 기사 중 "600자 이상 + 제목 핵심어 겹침"을 통과한 비율 → 70% 이상
//   범위: 핵심·주요 중 readUrl이 있는 비율 → 50% 이상
// 둘 다 넘으면 설정 → 뉴스 브리핑에서 "앱 안 원문 보기"를 켠다. AI를 부르지 않고, 받은 글은 저장하지 않는다

const count = Math.max(1, Number(process.argv[2] ?? 1) || 1);
const rows = db
  .select({ id: files.id, name: files.name, contentText: files.contentText })
  .from(files)
  .where(and(eq(files.kind, 'briefing'), isNull(files.deletedAt)))
  .orderBy(desc(files.createdAt))
  .limit(count)
  .all();

const items: EditionItem[] = [];
for (const r of rows) {
  try {
    const ed = JSON.parse(r.contentText ?? '') as Edition;
    for (const s of ed.sections ?? []) for (const c of s.categories ?? []) for (const sub of c.subs ?? []) for (const it of sub.items ?? []) if (it.importance >= 2) items.push(it);
    console.log(`회차: ${r.name}`);
  } catch {
    console.log(`회차 ${r.name}: JSON을 읽지 못함`);
  }
}
const withUrl = items.filter((it) => it.readUrl);
console.log(`핵심·주요 ${items.length}건, readUrl 있는 것 ${withUrl.length}건 (범위 ${items.length ? Math.round((withUrl.length / items.length) * 100) : 0}%)`);

const results = await mapLimit(withUrl, 3, async (it) => {
  const html = await fetchGuarded('page', it.readUrl!, { label: it.source, timeoutMs: BRIEFING.READER_TIMEOUT_MS });
  const ex = extractParagraphs(html, it.readUrl!);
  return { ok: readerQualityOk(it.originalTitle ?? it.title, ex.paragraphs), chars: ex.paragraphs.join('').length, paras: ex.paragraphs.length };
});
let pass = 0;
const byHost = new Map<string, { ok: number; total: number }>();
results.forEach((r, i) => {
  const it = withUrl[i]!;
  const host = new URL(it.readUrl!).hostname;
  const h = byHost.get(host) ?? { ok: 0, total: 0 };
  h.total++;
  if (r.ok && r.value.ok) {
    pass++;
    h.ok++;
    console.log(`OK    ${it.source} — ${r.value.chars}자 · 문단 ${r.value.paras} · ${it.title.slice(0, 30)}`);
  } else {
    console.log(`FAIL  ${it.source} — ${r.ok ? `${r.value.chars}자(짧거나 제목과 안 맞음)` : r.error instanceof Error ? r.error.message : String(r.error)} · ${it.readUrl}`);
  }
  byHost.set(host, h);
});
console.log(`\n품질 통과 ${pass}/${withUrl.length} (${withUrl.length ? Math.round((pass / withUrl.length) * 100) : 0}%) — 기준 70%`);
console.log(`범위 ${withUrl.length}/${items.length} (${items.length ? Math.round((withUrl.length / items.length) * 100) : 0}%) — 기준 50%`);
console.log('\n사이트별 (70% 미만은 "원문 보기 제외" 후보):');
for (const [host, h] of [...byHost.entries()].sort((a, b) => b[1].total - a[1].total)) console.log(`  ${host}: ${h.ok}/${h.total}`);
console.log('\n표본 20건은 눈으로도 확인하세요(기자 메일·관련 기사 목록이 섞였는지).');
