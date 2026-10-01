import { useEffect, useState } from 'react';
import { api, ApiError } from '../../lib/api';
import { kstTime, type BriefingStatus } from '../../lib/briefing';

type Props = {
  /** 수집 목록 문서를 연다 — 고치는 곳은 설정이 아니라 그 문서다 */
  onOpenSources: () => void;
};

// SCR-147: 설정 → 뉴스 브리핑 (관리자만) — 자동 생성 켜기/끄기, 이번 달 비용·한도 표시
export default function BriefingSettings({ onOpenSources }: Props) {
  const [status, setStatus] = useState<BriefingStatus | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void api<BriefingStatus>('/briefing/status').then(setStatus, () => setError('상태를 불러오지 못했어요'));
  }, []);

  async function setAuto(on: boolean) {
    setError(null);
    try {
      const r = await api<{ autoEnabled: boolean; nextAutoAt: number | null }>('/briefing/settings', {
        method: 'PUT',
        body: JSON.stringify({ autoEnabled: on }),
      });
      setStatus((s) => (s ? { ...s, autoEnabled: r.autoEnabled, nextAutoAt: r.nextAutoAt } : s));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : '바꾸지 못했어요');
    }
  }

  return (
    <section>
      <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500">뉴스 브리핑</h3>
      {status && (
        <>
          <label className="mt-2 flex items-start gap-2 text-xs text-slate-400">
            <input
              type="checkbox"
              checked={status.autoEnabled}
              disabled={!status.configured}
              onChange={(e) => void setAuto(e.target.checked)}
              className="mt-0.5 accent-slate-400"
            />
            <span>
              자동 생성
              <span className="block text-slate-600">
                아침 06:30 · 점심 11:30 · 저녁 17:30(한국시간)에 만들기 시작합니다. 실패한 회차는 다시 시도하지 않으니 패널의 버튼으로 만드세요
                {status.autoEnabled && status.nextAutoAt ? ` · 다음 ${kstTime(status.nextAutoAt)}` : ''}
              </span>
            </span>
          </label>
          <p className="mt-2 text-xs text-slate-500">
            이번 달 ≈ ${status.monthCostUsd.toFixed(2)} / 한도 ${status.monthBudgetUsd} — 한도에 닿으면 자동 생성이 멈춥니다
          </p>
          <button onClick={onOpenSources} className="mt-2 text-xs text-slate-400 underline hover:text-slate-200">
            수집 목록 열기 (RSS 주소·검색어)
          </button>
        </>
      )}
      {error && <p className="mt-2 text-xs text-red-400">{error}</p>}
    </section>
  );
}
