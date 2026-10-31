import { useState } from 'react';
import type { UserSettings } from '../../lib/api';
import { ACCENTS, SCHEMES, applyAppTheme, getAppTheme, type AppTheme } from '../../lib/appTheme';
import { FONT_SCALE_MAX, FONT_SCALE_MIN, FONT_SIZE_MAX, FONT_SIZE_MIN } from '../../lib/constants';
import { getLayout, setLayout } from '../../lib/layout';
import { rowId } from './catalog';
import SettingRow, { btnClass, selectClass, Switch } from './SettingRow';

type Props = {
  settings: UserSettings;
  onChange: (patch: Partial<UserSettings>) => void;
  /** 단축키 치트시트 열기 — ? 키와 같은 오버레이 (SCR-145) */
  onShowShortcuts: () => void;
};

// SCR-141: 화면·뷰어 — 앱 테마(기기별, localStorage) + 뷰어 설정(서버, 실시간 미리보기) + 단축키
export default function DisplaySettings({ settings, onChange, onShowShortcuts }: Props) {
  // 앱 테마는 기기별 취향이라 서버 설정이 아니라 localStorage (IA — 안 B, 외관 = 명암 + 강조색)
  const [appTheme, setAppTheme] = useState<AppTheme>(getAppTheme);
  function pickTheme(patch: Partial<AppTheme>) {
    const next = { ...appTheme, ...patch };
    applyAppTheme(next);
    setAppTheme(next);
  }
  const id = (item: string) => rowId('display', item);
  // "이전 레이아웃" — v0.54 한 버전만 두는 스위치 (IA — 안 B 결정 1)
  const [classic, setClassic] = useState(() => getLayout() === 'classic');

  return (
    <>
      <SettingRow id={id('scheme')} title="앱 테마" desc="앱 전체(메뉴·패널·탭)의 명암. 이 기기에만 적용됩니다">
        <select value={appTheme.scheme} onChange={(e) => pickTheme({ scheme: e.target.value as AppTheme['scheme'] })} className={selectClass} aria-label="앱 테마">
          {SCHEMES.map((s) => (
            <option key={s.id} value={s.id}>{s.name}{s.hint ? ` (${s.hint})` : ''}</option>
          ))}
        </select>
      </SettingRow>
      <SettingRow id={id('accent')} title="강조색" desc="단추·선택·링크의 색">
        <div className="flex items-center" role="radiogroup" aria-label="강조색">
          {ACCENTS.map((a) => (
            <button
              key={a.id}
              type="button"
              role="radio"
              aria-checked={appTheme.accent === a.id}
              aria-label={a.name}
              title={a.name}
              onClick={() => pickTheme({ accent: a.id })}
              className={`grid h-11 w-11 place-items-center rounded-full transition ${appTheme.accent === a.id ? 'ring-2 ring-slate-100' : 'hover:ring-2 hover:ring-slate-600'}`}
            >
              <span className="h-6 w-6 rounded-full" style={{ background: a.swatch }} />
            </button>
          ))}
        </div>
      </SettingRow>
      <SettingRow id={id('viewerTheme')} title="본문 테마" desc="문서를 읽는 바탕색. 코드 뷰어는 항상 어두움">
        <select value={settings.viewerTheme} onChange={(e) => onChange({ viewerTheme: e.target.value as UserSettings['viewerTheme'] })} className={selectClass} aria-label="본문 테마">
          <option value="light">라이트</option>
          <option value="sepia">세피아</option>
          <option value="green">북 그린</option>
          <option value="gray">그레이</option>
          <option value="dark">다크</option>
          <option value="night">나이트 (부드러운 다크)</option>
        </select>
      </SettingRow>
      <SettingRow id={id('fontSize')} title={`글자 크기 · ${settings.fontSize}px`} desc="마크다운 문서의 글자 크기. 문서별 배율은 그 문서의 ⋯ 메뉴에서">
        <input type="range" min={FONT_SIZE_MIN} max={FONT_SIZE_MAX} value={settings.fontSize} onChange={(e) => onChange({ fontSize: Number(e.target.value) })} className="h-11 w-40 accent-slate-300" aria-label="글자 크기" />
      </SettingRow>
      {/* HTML은 문서가 자기 크기를 px로 갖고 있어 절대값을 줄 수 없다 — 문서 기준의 배율로 다룬다 */}
      <SettingRow id={id('htmlFontScale')} title={`HTML 글자 크기 · ${settings.htmlFontScale}%`} desc="HTML 문서에 적용되는 기본 배율. 문서별로 다르게 보고 싶으면 그 문서의 ⋯ 메뉴에서">
        <input type="range" min={FONT_SCALE_MIN} max={FONT_SCALE_MAX} step={1} value={settings.htmlFontScale} onChange={(e) => onChange({ htmlFontScale: Number(e.target.value) })} className="h-11 w-40 accent-slate-300" aria-label="HTML 글자 크기" />
      </SettingRow>
      <SettingRow id={id('contentWidth')} title="본문 너비">
        <select value={settings.contentWidth} onChange={(e) => onChange({ contentWidth: e.target.value as UserSettings['contentWidth'] })} className={selectClass} aria-label="본문 너비">
          <option value="narrow">좁게</option>
          <option value="normal">보통</option>
          <option value="wide">넓게</option>
        </select>
      </SettingRow>
      <SettingRow id={id('layout')} title="이전 레이아웃" desc="v0.53의 모습으로 — 홈 없이 내 파일·즐겨찾기·공유·카드·대화·브리핑이 레일(폰은 문서·대화·브리핑·설정 탭)에 따로 있습니다. 설정 페이지·질문 패널은 그대로예요. 이 스위치는 한 버전만 있다가 사라집니다">
        <Switch
          checked={classic}
          onChange={(v) => {
            setClassic(v);
            setLayout(v ? 'classic' : 'home');
          }}
          label="이전 레이아웃"
        />
      </SettingRow>
      <SettingRow
        id={id('shortcuts')}
        title="단축키 · 제스처"
        desc={
          <>
            숨어 있는 단축키와 제스처 전체 목록. 어디서든 <kbd className="rounded border border-slate-700 bg-slate-800 px-1">?</kbd> 키로도 열 수 있어요
          </>
        }
      >
        <button onClick={onShowShortcuts} className={btnClass}>전체 목록 보기</button>
      </SettingRow>
    </>
  );
}
