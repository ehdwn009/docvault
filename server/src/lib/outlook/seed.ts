import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { db } from '../../db/index.js';
import { kstToMs } from '../briefing/time.js';
import { renderOutlookHtml, wrapOutlookPage } from './document.js';
import { OutlookDataSchema } from './schema.js';
import { editionCount, firstSentence, saveEdition } from './store.js';

// 서버 전에 손과 스킬로 만든 두 판을 미리 넣는다 — 2027 큰 판 시범(기준선)과 11월 시험 판 (사용자 결정 2026-11-21).
// 표가 비어 있을 때만 — 여러 번 켜져도 한 번. 알림은 보내지 않는다(새 판이 아니라 옮겨 온 판이다)

const SEED_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'assets', 'outlook-seed');

/** 시범 큰 판 — 원문은 마크다운(기준선 글)과 손으로 만든 화면 조각. 읽은 기간은 그 문서 머리의 "대상 기간"과 같다 */
const BIG = {
  md: '2027-whitepaper.md',
  html: '2027-whitepaper.html',
  label: '2027년 세계 경제 전망(시범)',
  title: '2027년 세계 경제 전망',
  since: '2026-09-01',
  until: '2026-11-20',
  publishedOn: '2026-11-20',
};
/** 11월 시험 판 — format 1 완성본. 이름·기간은 그 안의 meta를 쓴다 */
const SMALL = { json: '2026-11-test.json', publishedOn: '2026-11-21' };

const read = (name: string) => fs.readFileSync(path.join(SEED_DIR, name), 'utf8');

/** 마크다운의 「## 요약」 아래 첫 문단의 첫 문장 */
function mdLead(md: string): string {
  const lines = md.split('\n');
  const at = lines.findIndex((l) => l.trim() === '## 요약');
  const para = lines.slice(at + 1).find((l) => l.trim() !== '' && !l.startsWith('#'));
  return para ? firstSentence(para) : '';
}

export function seedOutlookEditions(): void {
  if (editionCount() > 0) return;
  const md = read(BIG.md);
  const bigHtml = wrapOutlookPage(read(BIG.html));
  const parsed = OutlookDataSchema.safeParse(JSON.parse(read(SMALL.json)));
  if (!parsed.success) throw new Error(`${SMALL.json} 형식이 맞지 않습니다: ${parsed.error.issues[0]?.message ?? ''}`);
  const data = parsed.data;
  // 둘 다 들어가거나 둘 다 안 들어가게 — 반만 들어가면 표가 비어 있지 않아 다음 기동 때 다시 넣지 않는다
  db.transaction(() => {
    saveEdition(
      {
        kind: 'big',
        label: BIG.label,
        title: BIG.title,
        // 마크다운 셋째 줄이 부제다(제목 · 빈 줄 · 부제)
        subtitle: md.split('\n')[2]?.trim() ?? '',
        since: BIG.since,
        until: BIG.until,
        dataJson: null,
        baselineText: md,
        lead: mdLead(md),
        status: 'published',
        origin: 'seed',
        jobId: null,
        publishedAt: kstToMs(BIG.publishedOn, 0, 0),
      },
      bigHtml,
    );
    saveEdition(
      {
        kind: data.meta.edition,
        label: data.meta.label,
        title: data.meta.title,
        subtitle: data.meta.subtitle,
        since: data.meta.since,
        until: data.meta.until,
        dataJson: JSON.stringify(data),
        baselineText: null,
        lead: data.meta.subtitle || firstSentence(data.summary[0]?.text ?? ''),
        status: 'published',
        origin: 'seed',
        jobId: null,
        publishedAt: kstToMs(SMALL.publishedOn, 0, 0),
      },
      renderOutlookHtml(data),
    );
  });
  console.log(`[outlook] 시드 두 판을 넣었어요 — ${BIG.label} · ${data.meta.label}`);
}
