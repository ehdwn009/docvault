import { readBoot } from '../../lib/bootTiming';
import { useState, type FormEvent } from 'react';
import { api, ApiError, type UserSettings } from '../../lib/api';
import { APP_THEMES, applyAppTheme, getAppTheme, type AppThemeId } from '../../lib/appTheme';
import { FONT_SCALE_MAX, FONT_SCALE_MIN, FONT_SIZE_MAX, FONT_SIZE_MIN } from '../../lib/constants';
import { downloadArchive } from '../../lib/download';

type Props = {
  settings: UserSettings;
  onChange: (patch: Partial<UserSettings>) => void;
  onShowChangelog: () => void;
  /** 단축키 치트시트 열기 — ? 키와 같은 오버레이 (SCR-145) */
  onShowShortcuts: () => void;
};

const selectClass =
  'mt-1 w-full rounded-md border border-slate-700 bg-slate-800 px-2 py-1.5 text-sm text-slate-100 outline-none focus:border-slate-400';

// SCR-140: 설정 패널 — 뷰어 설정(SCR-141) + 비밀번호 변경(SCR-142) + 정보·업데이트 기록(SCR-144)
export default function SettingsPanel({ settings, onChange, onShowChangelog, onShowShortcuts }: Props) {
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [pwMessage, setPwMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [withManifest, setWithManifest] = useState(true);
  // 앱 테마는 기기별 취향이라 서버 설정이 아니라 localStorage (IA — 앱 테마 프리셋)
  const [appTheme, setAppTheme] = useState<AppThemeId>(getAppTheme);
  const [boot] = useState(readBoot);

  async function changePassword(e: FormEvent) {
    e.preventDefault();
    setPwMessage(null);
    try {
      await api('/auth/password', {
        method: 'PUT',
        body: JSON.stringify({ currentPassword, newPassword }),
      });
      setPwMessage({ ok: true, text: '비밀번호가 변경되었습니다' });
      setCurrentPassword('');
      setNewPassword('');
    } catch (err) {
      setPwMessage({
        ok: false,
        text: err instanceof ApiError ? err.message : '변경에 실패했습니다',
      });
    }
  }

  return (
    // min-h-0 + overflow: 내용(테마·단축키 등)이 화면보다 길어졌다 — 다른 패널들과 같은 스크롤 상자
    <div className="min-h-0 flex-1 space-y-6 overflow-y-auto px-4 py-2 pb-8">
      <section>
        <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500">앱 테마</h3>
        <p className="mt-1 text-xs text-slate-500">앱 전체(메뉴·패널·탭)의 색. 이 기기에만 적용됩니다.</p>
        <div className="mt-2 grid grid-cols-3 gap-1.5">
          {APP_THEMES.map((t) => (
            <button
              key={t.id}
              onClick={() => {
                applyAppTheme(t.id);
                setAppTheme(t.id);
              }}
              className={`rounded-md border p-1.5 text-center transition ${
                appTheme === t.id
                  ? 'border-sky-500 bg-slate-800'
                  : 'border-slate-700 hover:border-slate-500'
              }`}
            >
              {/* 색 견본: 배경 위에 표면·강조색 — 고르기 전에 분위기가 보이게 */}
              <span
                className="flex h-7 items-center justify-center gap-1 rounded"
                style={{ background: t.swatch[0] }}
              >
                <span className="h-3 w-3 rounded-sm" style={{ background: t.swatch[1] }} />
                <span className="h-3 w-3 rounded-full" style={{ background: t.swatch[2] }} />
              </span>
              <span className="mt-1 block truncate text-[10px] text-slate-400">{t.name}</span>
            </button>
          ))}
        </div>
      </section>

      <section>
        <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500">뷰어 설정</h3>

        <label className="mt-3 block text-sm text-slate-300">
          본문 테마
          <select
            value={settings.viewerTheme}
            onChange={(e) => onChange({ viewerTheme: e.target.value as UserSettings['viewerTheme'] })}
            className={selectClass}
          >
            <option value="light">라이트</option>
            <option value="sepia">세피아</option>
            <option value="green">북 그린</option>
            <option value="gray">그레이</option>
            <option value="dark">다크</option>
            <option value="night">나이트 (부드러운 다크)</option>
          </select>
        </label>

        <label className="mt-3 block text-sm text-slate-300">
          글자 크기: {settings.fontSize}px
          <input
            type="range"
            min={FONT_SIZE_MIN}
            max={FONT_SIZE_MAX}
            value={settings.fontSize}
            onChange={(e) => onChange({ fontSize: Number(e.target.value) })}
            className="mt-1 w-full accent-slate-300"
          />
        </label>

        {/* HTML은 문서가 자기 크기를 px로 갖고 있어 절대값을 줄 수 없다 — 문서 기준의 배율로 다룬다 */}
        <label className="mt-3 block text-sm text-slate-300">
          HTML 글자 크기: {settings.htmlFontScale}%
          <input
            type="range"
            min={FONT_SCALE_MIN}
            max={FONT_SCALE_MAX}
            step={1}
            value={settings.htmlFontScale}
            onChange={(e) => onChange({ htmlFontScale: Number(e.target.value) })}
            className="mt-1 w-full accent-slate-300"
          />
          <span className="text-xs text-slate-500">
            HTML 문서에 적용되는 기본 배율입니다. 문서별로 다르게 보고 싶으면 그 문서를 열고 ⋯ 메뉴에서
            바꾸세요.
          </span>
        </label>

        <label className="mt-3 block text-sm text-slate-300">
          본문 너비
          <select
            value={settings.contentWidth}
            onChange={(e) =>
              onChange({ contentWidth: e.target.value as UserSettings['contentWidth'] })
            }
            className={selectClass}
          >
            <option value="narrow">좁게</option>
            <option value="normal">보통</option>
            <option value="wide">넓게</option>
          </select>
        </label>
      </section>

      <section>
        <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500">단축키 · 제스처</h3>
        <p className="mt-2 text-xs leading-relaxed text-slate-500">
          숨어 있는 단축키와 제스처 전체 목록. 어디서든 <kbd className="rounded border border-slate-700 bg-slate-800 px-1">?</kbd> 키로도 열 수 있어요.
        </p>
        <button
          onClick={onShowShortcuts}
          className="mt-2 w-full rounded-md border border-slate-700 py-1.5 text-sm text-slate-300 transition hover:bg-slate-900"
        >
          전체 목록 보기
        </button>
      </section>

      <section>
        <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500">비밀번호 변경</h3>
        <form onSubmit={(e) => void changePassword(e)} className="mt-3 space-y-2">
          <input
            type="password"
            placeholder="현재 비밀번호"
            value={currentPassword}
            onChange={(e) => setCurrentPassword(e.target.value)}
            autoComplete="current-password"
            className={selectClass}
          />
          <input
            type="password"
            placeholder="새 비밀번호 (8자 이상)"
            value={newPassword}
            onChange={(e) => setNewPassword(e.target.value)}
            autoComplete="new-password"
            className={selectClass}
          />
          {pwMessage && (
            <p className={`text-xs ${pwMessage.ok ? 'text-emerald-400' : 'text-red-400'}`}>
              {pwMessage.text}
            </p>
          )}
          <button
            type="submit"
            disabled={!currentPassword || newPassword.length < 8}
            className="w-full rounded-md border border-slate-700 py-1.5 text-sm text-slate-300 transition hover:bg-slate-900 disabled:opacity-40"
          >
            변경
          </button>
        </form>
      </section>

      <section>
        <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500">배움 카드</h3>
        <label className="mt-2 flex items-start gap-2 text-xs text-slate-400">
          <input
            type="checkbox"
            checked={settings.termHighlight === 1}
            onChange={(e) => onChange({ termHighlight: e.target.checked ? 1 : 0 })}
            className="mt-0.5 accent-slate-400"
          />
          <span>
            문서 속 내 카드 용어에 점선 밑줄
            <span className="block text-slate-600">누르면 한 줄 정의가 뜨고 카드로 갈 수 있습니다. 읽기에 방해되면 끄세요</span>
          </span>
        </label>
        <label className="mt-2 flex items-start gap-2 text-xs text-slate-400">
          <input
            type="checkbox"
            checked={settings.askWithCards === 1}
            onChange={(e) => onChange({ askWithCards: e.target.checked ? 1 : 0 })}
            className="mt-0.5 accent-slate-400"
          />
          <span>
            질문할 때 관련 카드 함께 보내기
            <span className="block text-slate-600">질문에 내 카드의 이름이 나오면 그 카드(최대 3장)를 AI가 먼저 읽고 이어서 답합니다. 무엇을 보내는지 입력창 위에 보입니다</span>
          </span>
        </label>
      </section>

      <section>
        <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500">내보내기</h3>
        <p className="mt-2 text-xs leading-relaxed text-slate-500">
          내 파일 전부를 폴더 구조 그대로 ZIP 하나로 받습니다. 파일이 많으면 시간이 걸릴 수 있습니다.
        </p>
        <label className="mt-2 flex items-center gap-2 text-xs text-slate-400">
          <input
            type="checkbox"
            checked={withManifest}
            onChange={(e) => setWithManifest(e.target.checked)}
            className="accent-slate-400"
          />
          태그·즐겨찾기 목록도 함께 담기
        </label>
        <button
          onClick={() => downloadArchive({ all: true, manifest: withManifest })}
          className="mt-2 w-full rounded-md border border-slate-700 py-1.5 text-sm text-slate-300 transition hover:bg-slate-900"
        >
          내 자료 전부 내보내기
        </button>
      </section>

      <section>
        <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500">정보</h3>
        <p className="mt-2 text-sm text-slate-400">
          docvault <span className="font-medium text-slate-200">v{__APP_VERSION__}</span>
          <span className="ml-1.5 text-xs text-slate-600">({__BUILD_DATE__} 빌드)</span>
        </p>
        <button
          onClick={onShowChangelog}
          className="mt-2 w-full rounded-md border border-slate-700 py-1.5 text-sm text-slate-300 transition hover:bg-slate-900"
        >
          업데이트 기록 보기
        </button>
        {boot && (
          // 첫 로딩이 왜 긴지 — 단계별 시간. 어느 칸이 크냐에 따라 처방이 다르다 (lib/bootTiming.ts)
          <div className="mt-3 rounded-md border border-slate-800 bg-slate-900/60 px-3 py-2 text-xs">
            <div className="flex items-baseline justify-between text-slate-400">
              <span>이번 시작 시간</span>
              <span className="font-medium text-slate-200">{(boot.total / 1000).toFixed(1)}초</span>
            </div>
            <table className="mt-1.5 w-full text-[11px] text-slate-500">
              <tbody>
                {boot.steps.map((st) => (
                  <tr key={st.name}>
                    <td className="py-0.5 pr-2">{st.name}</td>
                    <td className="py-0.5 text-right tabular-nums text-slate-300">{st.ms.toLocaleString()}ms</td>
                  </tr>
                ))}
                <tr>
                  <td className="py-0.5 pr-2">앱 파일 (JS {boot.jsFiles}개)</td>
                  {/* 0KB = 브라우저 캐시에서 꺼냈다 — 압축·1년 캐시가 먹힌 증거라 그렇게 적는다 */}
                  <td className="py-0.5 text-right tabular-nums text-slate-300">{boot.jsKB === 0 ? '캐시' : `${boot.jsKB.toLocaleString()}KB`}</td>
                </tr>
              </tbody>
            </table>
            {boot.requests.length > 0 && (
              // 요청 하나를 넷으로 쪼갠 표 — "기다림"이 큰데 서버가 작으면 회선, "그 뒤"가 크면 폰이 바쁜 것
              <>
                <div className="mt-2 text-slate-400">요청별 (어디서 시간이 갔나)</div>
                <table className="mt-1 w-full text-[11px] text-slate-500">
                  <thead className="text-[10px] text-slate-600">
                    <tr>
                      <th className="pr-1 text-left font-normal">요청</th>
                      <th className="px-1 text-right font-normal">대기</th>
                      <th className="px-1 text-right font-normal">응답</th>
                      <th className="px-1 text-right font-normal">받기</th>
                      <th className="pl-1 text-right font-normal">그 뒤</th>
                    </tr>
                  </thead>
                  <tbody className="tabular-nums whitespace-nowrap">
                    {boot.requests.map((r) => (
                      <tr key={r.path}>
                        <td className="max-w-[9rem] truncate py-0.5 pr-1 text-slate-400">{r.path}</td>
                        <td className="px-1 py-0.5 text-right text-slate-300">{r.beforeMs.toLocaleString()}</td>
                        <td className="px-1 py-0.5 text-right text-slate-300">
                          {r.waitMs.toLocaleString()}
                          {r.serverMs !== null && <span className="text-slate-600"> (서버 {r.serverMs})</span>}
                        </td>
                        <td className="px-1 py-0.5 text-right text-slate-300">{r.downloadMs.toLocaleString()}</td>
                        <td className="py-0.5 pl-1 text-right text-slate-300">{r.afterMs === null ? '–' : r.afterMs.toLocaleString()}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </>
            )}
            <p className="mt-1.5 text-[10px] text-slate-600">
              새로고침하면 다시 잽니다. 서버 첫 응답이 크면 서버가 잠에서 깨는 시간, 다운로드가 크면 앱 파일 크기입니다. 요청별 표는 전부 ms — 대기=보내기 전, 응답=답을 기다린 시간(괄호는 그중 서버가 일한 시간), 받기=다운로드, 그 뒤=받고 나서 화면까지.
              응답이 큰데 괄호의 서버가 작으면 폰과 서버 사이 회선이, "그 뒤"가 크면 폰이 바빠서 응답을 못 챙긴 시간입니다
            </p>
          </div>
        )}
      </section>
    </div>
  );
}
