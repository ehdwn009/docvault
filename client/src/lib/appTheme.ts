// 앱 껍데기 테마 — "명암(시스템/밝음/어두움) + 강조색" 두 축 (IA — UI 재설계 안 B, 외관 단순화).
// 색 정의는 index.css의 [data-scheme=…]·[data-accent=…] 변수 블록에 있고,
// 여기는 목록·저장·적용만 담당한다.
// 보기 모드(dv_viewmode)처럼 "기기별 취향"이라 서버 설정이 아니라 localStorage에 둔다.

import { useEffect, useState } from 'react';

export type Scheme = 'system' | 'light' | 'dark';
export type Accent = 'sky' | 'emerald' | 'violet' | 'amber';
export type AppTheme = { scheme: Scheme; accent: Accent };

export const SCHEMES: { id: Scheme; name: string; hint: string }[] = [
  { id: 'system', name: '시스템', hint: '기기 설정을 따릅니다' },
  { id: 'light', name: '밝음', hint: '' },
  { id: 'dark', name: '어두움', hint: '' },
];

/** swatch: 설정 화면의 색 견본 (어두운 배경 기준 강조색 400) */
export const ACCENTS: { id: Accent; name: string; swatch: string }[] = [
  { id: 'sky', name: '하늘', swatch: '#38bdf8' },
  { id: 'emerald', name: '초록', swatch: '#34d399' },
  { id: 'violet', name: '보라', swatch: '#a78bfa' },
  { id: 'amber', name: '앰버', swatch: '#fbbf24' },
];

export const DEFAULT_APP_THEME: AppTheme = { scheme: 'dark', accent: 'sky' };

const STORAGE_KEY = 'dv_apptheme';

/** v0.52까지의 프리셋 6개 → 두 축으로 옮긴다 (저장된 값이 사라지지 않게) */
const LEGACY: Record<string, AppTheme> = {
  midnight: { scheme: 'dark', accent: 'sky' },
  graphite: { scheme: 'dark', accent: 'sky' },
  forest: { scheme: 'dark', accent: 'emerald' },
  aubergine: { scheme: 'dark', accent: 'violet' },
  paper: { scheme: 'light', accent: 'sky' },
  ivory: { scheme: 'light', accent: 'amber' },
};

const isScheme = (v: unknown): v is Scheme => SCHEMES.some((s) => s.id === v);
const isAccent = (v: unknown): v is Accent => ACCENTS.some((a) => a.id === v);

export function getAppTheme(): AppTheme {
  let saved: string | null = null;
  try {
    saved = localStorage.getItem(STORAGE_KEY);
  } catch {
    /* 사생활 모드 등 — 기본값으로 */
  }
  if (!saved) return DEFAULT_APP_THEME;
  const legacy = LEGACY[saved];
  if (legacy) return legacy;
  try {
    const v: unknown = JSON.parse(saved);
    if (v && typeof v === 'object') {
      const { scheme, accent } = v as Record<string, unknown>;
      return {
        scheme: isScheme(scheme) ? scheme : DEFAULT_APP_THEME.scheme,
        accent: isAccent(accent) ? accent : DEFAULT_APP_THEME.accent,
      };
    }
  } catch {
    /* 깨진 값은 기본값으로 */
  }
  return DEFAULT_APP_THEME;
}

const darkMq = () => window.matchMedia('(prefers-color-scheme: dark)');

/** '시스템'은 기기 설정으로 풀어서 light/dark 둘 중 하나로 */
export function resolveScheme(scheme: Scheme): 'light' | 'dark' {
  if (scheme === 'system') return darkMq().matches ? 'dark' : 'light';
  return scheme;
}

/** 테마가 바뀌면(설정에서 고르거나 시스템 명암이 바뀌면) 알린다 — prose 명암을 다시 고를 때 */
export const APP_THEME_EVENT = 'dv:apptheme';

let current: AppTheme = DEFAULT_APP_THEME;
let listening = false;

function paint() {
  const root = document.documentElement.dataset;
  // 기본값(어두움·하늘)은 속성을 지운다 — CSS의 기본 변수값이 곧 그 색이다
  const scheme = resolveScheme(current.scheme);
  if (scheme === 'dark') delete root.scheme;
  else root.scheme = scheme;
  if (current.accent === 'sky') delete root.accent;
  else root.accent = current.accent;
  window.dispatchEvent(new Event(APP_THEME_EVENT));
}

export function applyAppTheme(theme: AppTheme) {
  current = theme;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(theme));
  } catch {
    /* 저장이 막혀도 이번 세션에는 적용한다 */
  }
  if (!listening) {
    // '시스템'일 때 기기 명암이 바뀌면(해 지면 다크 등) 바로 따라간다
    darkMq().addEventListener('change', () => {
      if (current.scheme === 'system') paint();
    });
    listening = true;
  }
  paint();
}

/** 앱 껍데기 위에 마크다운(prose)을 그릴 때 쓸 명암 — 문서 뷰어 테마가 아니라 앱 테마를 따른다.
 *  밝은 테마에서 다크용(prose-invert)으로 그리면 밝은 배경에 밝은 글자가 되어 안 읽힌다. */
export function getAppProseTheme(): 'light' | 'dark' {
  return resolveScheme(current.scheme);
}

/** 렌더 중에 읽는 prose 명암 — 테마가 바뀌면(설정·시스템 명암) 다시 그린다 */
export function useAppProseTheme(): 'light' | 'dark' {
  const [theme, setTheme] = useState(getAppProseTheme);
  useEffect(() => {
    const on = () => setTheme(getAppProseTheme());
    window.addEventListener(APP_THEME_EVENT, on);
    return () => window.removeEventListener(APP_THEME_EVENT, on);
  }, []);
  return theme;
}
