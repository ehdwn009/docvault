import { BRIEFING } from '../../constants.js';
import { readBodies, type Material } from './body.js';
import { collect, type Candidate } from './collect.js';
import { toPicked, toStored, type CandidatesFile, type CandidateStats, type MaterialsResponse, type Selected } from './jobCandidates.js';
import { addLog, openRemoteLive, setRemoteStage, track } from './live.js';
import type { Source } from './sources.js';

// 재료는 서버가 — 수집과 원문 읽기(뉴스 브리핑 설계 "구독 생성 방식 — 재료는 서버가", 사용자 결정 2026-11-01).
// 클라우드 세션은 연합뉴스·동아·BBC 같은 피드·원문이 막혀(403) 후보의 60%가 제목만이었고, 서버는 막히지 않는다. 그래서 트리거를 켤 때
// 서버가 먼저 수집해 두고(API-154), 세션이 고른 기사의 원문도 서버가 읽어 준다(API-155·156). 판단과 글(분류·선별·요약·검수)은 그대로 세션이.
// 전부 **메모리에만** 둔다 — 원문 글은 어디에도 저장하지 않는다는 규칙 그대로. 실행이 닫히면 지우고, 서버가 재시작되면 사라진다(그때 세션은 스스로 수집한다)

type CollectState =
  | { status: 'collecting'; done: number; total: number }
  | { status: 'ready'; stats: CandidateStats; candidates: Candidate[] }
  | { status: 'failed'; reason: string };

type ReadState = { status: 'reading'; done: number; total: number } | { status: 'ready'; result: MaterialsResponse } | { status: 'failed'; reason: string };

type Store = { collect: CollectState; read: ReadState | null };

const stores = new Map<number, Store>();

/** 수집을 시작하고 바로 돌아온다 — 트리거를 늦추지 않는다. 끝나면 진행 기록에 한 줄 */
export function startCollect(runId: number, sources: Source[], range: { since: number; until: number; excludeUrls: Set<string> }): void {
  const store: Store = { collect: { status: 'collecting', done: 0, total: sources.length }, read: null };
  stores.set(runId, store);
  const live = openRemoteLive(runId);
  addLog(live, `서버가 수집을 시작했어요 — 출처 ${sources.length}곳`);
  setRemoteStage(live, 'collect', 0, sources.length);
  void collect(sources, {
    since: range.since,
    until: range.until,
    excludeUrls: range.excludeUrls,
    onProgress: (done, total) => {
      if (store.collect.status === 'collecting') store.collect = { status: 'collecting', done, total };
      setRemoteStage(live, 'collect', done, total);
    },
    track: (name) => track(live, name),
  })
    .then((got) => {
      // 그사이 실행이 닫혔으면(대체·방식 변경) 버린다 — dropMaterials가 지운 자리에 다시 넣지 않는다
      if (stores.get(runId) !== store) return;
      const outletDropNames = got.outletDrops.slice(0, BRIEFING.OUTLET_DROPS_LOG_MAX).map((d) => `${d.source} ${d.count}`);
      const stats: CandidateStats = {
        sources: got.sourceCount,
        sourcesFailed: got.failed.length,
        failedSources: got.failed.map((f) => f.name),
        candidates: got.candidates.length,
        attached: got.attached,
        wouldMerge: got.wouldMerge,
        outletDrops: got.outletDrops.reduce((a, d) => a + d.count, 0),
        outletDropNames,
      };
      store.collect = { status: 'ready', stats, candidates: got.candidates };
      const feedFailed = got.failed.filter((f) => f.kind === 'feed').length;
      addLog(live, `서버 수집 끝 — 후보 ${got.candidates.length}건${got.failed.length ? `, 못 받은 출처 ${got.failed.length}곳(언론사 ${feedFailed})` : ''}`);
    })
    .catch((e: unknown) => {
      if (stores.get(runId) !== store) return;
      const reason = e instanceof Error ? e.message : String(e);
      store.collect = { status: 'failed', reason };
      addLog(live, `서버 수집 실패 — ${reason}. 세션이 직접 수집해요`);
    });
}

/** API-154 — 후보. 수집 중이면 진행, 끝났으면 candidates.json과 같은 모양. 서버가 가진 것이 없으면(재시작·수집 실패) null */
export function candidatesView(runId: number): { status: 'collecting'; done: number; total: number } | { status: 'ready'; file: CandidatesFile } | null {
  const st = stores.get(runId)?.collect;
  if (!st || st.status === 'failed') return null;
  if (st.status === 'collecting') return st;
  return { status: 'ready', file: { stats: st.stats, candidates: st.candidates.map(toStored) } };
}

export class MaterialsError extends Error {
  constructor(
    readonly kind: 'no_candidates' | 'collecting' | 'bad_selection',
    message: string,
  ) {
    super(message);
  }
}

/**
 * API-155 — 세션이 고른 기사(selected.json 그대로)의 원문을 서버가 읽기 시작한다. 바로 돌아오고 결과는 API-156으로.
 * 이미 읽는 중이면 그 진행을 돌려준다(두 번 시작하지 않는다). 다시 고른 뒤 다시 부르면 새로 읽는다
 */
export function startRead(runId: number, selected: Selected, prevStoryIds: ReadonlySet<string>): { status: 'reading'; done: number; total: number } {
  const store = stores.get(runId);
  if (!store || store.collect.status === 'failed') throw new MaterialsError('no_candidates', '서버가 가진 후보가 없어요 — 세션이 직접 수집·원문 읽기를 해요');
  if (store.collect.status === 'collecting') throw new MaterialsError('collecting', '서버 수집이 아직 끝나지 않았어요');
  if (store.read?.status === 'reading') return store.read;
  const candidates = store.collect.candidates;
  const byIndex = new Map(candidates.map((c, i) => [i, c]));
  const indexOf = new Map(candidates.map((c, i) => [c, i]));
  let picked;
  let warnings: string[];
  try {
    ({ picked, warnings } = toPicked(selected, byIndex, prevStoryIds));
  } catch (e) {
    throw new MaterialsError('bad_selection', e instanceof Error ? e.message : String(e));
  }
  const total = picked.filter((p) => p.importance >= BRIEFING.BODY_FETCH_MIN_IMPORTANCE).length;
  const state: ReadState = { status: 'reading', done: 0, total };
  store.read = state;
  const live = openRemoteLive(runId);
  addLog(live, `서버가 원문을 읽기 시작했어요 — 선별 ${picked.length}건 중 핵심·주요 ${total}건`);
  setRemoteStage(live, 'read', 0, total);
  void readBodies(picked, {
    onProgress: (done, t) => {
      if (store.read === state) store.read = { status: 'reading', done, total: t };
      setRemoteStage(live, 'read', done, t);
    },
    track: (name) => track(live, name),
  })
    .then((read) => {
      if (stores.get(runId) !== store || (store.read && store.read.status !== 'reading')) return;
      const stories: MaterialsResponse['stories'] = [];
      picked.forEach((p, i) => {
        const materials: Material[] | undefined = read.materials.get(i);
        const main = indexOf.get(p.main);
        if (materials && main !== undefined) stories.push({ main, materials });
      });
      store.read = { status: 'ready', result: { stats: { bodiesRead: read.materials.size, fromFeed: read.fromFeed, extractRejected: read.rejected }, stories, warnings } };
      addLog(live, `서버 원문 읽기 끝 — 재료 있는 기사 ${read.materials.size}건${read.fromFeed ? ` (피드 본문 ${read.fromFeed})` : ''}${read.rejected ? `, 제목과 안 맞아 버림 ${read.rejected}` : ''}`);
    })
    .catch((e: unknown) => {
      if (stores.get(runId) !== store) return;
      const reason = e instanceof Error ? e.message : String(e);
      store.read = { status: 'failed', reason };
      addLog(live, `서버 원문 읽기 실패 — ${reason}`);
    });
  return state;
}

/** API-156 — 읽은 재료. 읽는 중이면 진행, 없으면(시작한 적 없음·실패) null */
export function materialsView(runId: number): ReadState | null {
  return stores.get(runId)?.read ?? null;
}

/** 실행이 닫히면 재료를 지운다 — 원문 글은 실행보다 오래 살지 않는다 */
export function dropMaterials(runId: number): void {
  stores.delete(runId);
}
