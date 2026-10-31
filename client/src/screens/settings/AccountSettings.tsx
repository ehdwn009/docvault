import { useEffect, useState, type FormEvent } from 'react';
import { api, ApiError, type User } from '../../lib/api';
import { rowId } from './catalog';
import SettingRow, { btnClass, inputClass, Value } from './SettingRow';

type Props = {
  user: User;
  /** 비밀번호 바꾸기 줄을 펼친 채로 연다 — 첫 사용 안내(SCR-148)의 [비밀번호 바꾸기] */
  openPassword?: boolean;
  onLogout: () => void;
};

// SCR-142: 계정 — 로그인한 계정·비밀번호 바꾸기(펼침)·나가기
export default function AccountSettings({ user, openPassword = false, onLogout }: Props) {
  const [pwOpen, setPwOpen] = useState(openPassword);
  useEffect(() => {
    if (openPassword) setPwOpen(true);
  }, [openPassword]);
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [pwMessage, setPwMessage] = useState<{ ok: boolean; text: string } | null>(null);

  async function changePassword(e: FormEvent) {
    e.preventDefault();
    setPwMessage(null);
    try {
      await api('/auth/password', { method: 'PUT', body: JSON.stringify({ currentPassword, newPassword }) });
      setPwMessage({ ok: true, text: '비밀번호가 변경되었습니다' });
      setCurrentPassword('');
      setNewPassword('');
    } catch (err) {
      setPwMessage({ ok: false, text: err instanceof ApiError ? err.message : '변경에 실패했습니다' });
    }
  }

  return (
    <>
      <SettingRow id={rowId('account', 'who')} title="로그인한 계정">
        <Value>
          {user.displayName ?? user.username}
          {user.displayName && <span className="text-slate-500"> · {user.username}</span>}
          <span className="text-slate-500"> · {user.role === 'admin' ? '관리자' : '일반'}</span>
        </Value>
      </SettingRow>
      <SettingRow
        id={rowId('account', 'password')}
        title="비밀번호"
        desc="8자 이상"
        below={
          pwOpen && (
            <form onSubmit={(e) => void changePassword(e)} className="max-w-sm space-y-2">
              <input type="password" placeholder="현재 비밀번호" value={currentPassword} onChange={(e) => setCurrentPassword(e.target.value)} autoComplete="current-password" className={inputClass} />
              <input type="password" placeholder="새 비밀번호 (8자 이상)" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} autoComplete="new-password" className={inputClass} />
              {pwMessage && <p className={`text-xs ${pwMessage.ok ? 'text-good-400' : 'text-danger-400'}`}>{pwMessage.text}</p>}
              <div className="flex gap-2">
                <button type="submit" disabled={!currentPassword || newPassword.length < 8} className={btnClass}>변경</button>
                <button type="button" onClick={() => setPwOpen(false)} className="min-h-11 px-3 text-sm text-slate-500 hover:text-slate-300">닫기</button>
              </div>
            </form>
          )
        }
      >
        {!pwOpen && <button onClick={() => setPwOpen(true)} className={btnClass}>바꾸기</button>}
      </SettingRow>
      <SettingRow id={rowId('account', 'logout')} title="나가기" desc="이 기기에서 로그아웃합니다">
        <button onClick={onLogout} className={btnClass}>로그아웃</button>
      </SettingRow>
    </>
  );
}
