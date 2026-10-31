import { useEffect, useState } from 'react';
import { api, ApiError } from '../../lib/api';
import { rowId } from './catalog';
import SettingRow, { Switch } from './SettingRow';

/** API-139 — 고를 수 있는 일반 계정 한 줄 */
type ReaderCandidate = { id: number; username: string; displayName: string | null; isActive: number; on: boolean };

type Props = {
  /** 사용자 카테고리로 — 계정이 하나도 없을 때 */
  onOpenUsers: () => void;
};

// SCR-403: 함께 보는 계정 — 고른 일반 계정에만 내 회차가 읽기 전용으로 열린다. 비용은 그대로 내가 낸다 (v0.49, 사용자 결정)
export default function ReadersSettings({ onOpenUsers }: Props) {
  const [readers, setReaders] = useState<ReaderCandidate[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void api<{ users: ReaderCandidate[] }>('/briefing/readers').then((r) => setReaders(r.users), () => setError('목록을 불러오지 못했어요'));
  }, []);

  /** 계정 하나 켜기/끄기 — 서버가 돌려준 목록으로 화면을 맞춘다 */
  async function toggleReader(id: number, on: boolean) {
    setError(null);
    try {
      const r = await api<{ users: ReaderCandidate[] }>(`/briefing/readers/${id}`, { method: 'PUT', body: JSON.stringify({ on }) });
      setReaders(r.users);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : '바꾸지 못했어요');
    }
  }

  return (
    <>
      <p id={rowId('readers', 'list')} className="scroll-mt-24 py-3 text-xs leading-relaxed text-slate-500">
        고른 계정에 뉴스 브리핑 패널이 생기고, 내가 만든 회차(앞으로 생길 것 포함)를 읽기만 할 수 있어요. 읽음 표시·틀린 곳 알리기는 그 사람 것으로 따로 남고, 만들기·앱 안 원문 보기는 열리지 않아요
      </p>
      {readers && readers.length === 0 && (
        <p className="py-3 text-sm text-slate-500">
          일반 계정이 아직 없어요 — <button onClick={onOpenUsers} className="underline underline-offset-2 hover:text-slate-300">사용자</button>에서 계정을 만들면 여기에 나타나요
        </p>
      )}
      {readers?.map((u) => (
        <SettingRow
          key={u.id}
          title={
            <span className={u.isActive ? '' : 'opacity-50'}>
              {u.displayName ?? u.username}
              {u.displayName && <span className="text-slate-500"> · {u.username}</span>}
              {!u.isActive && <span className="text-slate-500"> (비활성)</span>}
            </span>
          }
        >
          <Switch checked={u.on} onChange={(v) => void toggleReader(u.id, v)} label={`${u.displayName ?? u.username} 함께 보기`} />
        </SettingRow>
      ))}
      {error && <p className="mt-2 text-xs text-danger-400">{error}</p>}
    </>
  );
}
