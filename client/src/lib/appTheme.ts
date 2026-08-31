// 앱 껍데기 테마 — 색 정의는 index.css의 [data-app-theme=…] 변수 블록에 있고,
// 여기는 목록·저장·적용만 담당한다 (IA — 앱 테마 프리셋).
// 보기 모드(dv_viewmode)처럼 "기기별 취향"이라 서버 설정이 아니라 localStorage에 둔다.

export type AppThemeId = 'midnight' | 'graphite' | 'forest' | 'aubergine' | 'paper' | 'ivory';

/** swatch: 설정 화면의 색 견본 [배경, 표면, 강조] */
export const APP_THEMES: { id: AppThemeId; name: string; swatch: [string, string, string] }[] = [
  { id: 'midnight', name: '미드나잇 블루', swatch: ['#020617', '#1e293b', '#38bdf8'] },
  { id: 'graphite', name: '그래파이트', swatch: ['#0b0b0d', '#27272a', '#38bdf8'] },
  { id: 'forest', name: '딥 그린', swatch: ['#081711', '#1c3a2e', '#34d399'] },
  { id: 'aubergine', name: '오베르진', swatch: ['#150a19', '#352040', '#a78bfa'] },
  { id: 'paper', name: '페이퍼', swatch: ['#f4f6f8', '#d8dee6', '#0284c7'] },
  { id: 'ivory', name: '아이보리', swatch: ['#faf6ec', '#e3d8bf', '#b45309'] },
];

const STORAGE_KEY = 'dv_apptheme';

export function getAppTheme(): AppThemeId {
  const saved = localStorage.getItem(STORAGE_KEY);
  return APP_THEMES.some((t) => t.id === saved) ? (saved as AppThemeId) : 'midnight';
}

/** 기본 테마(midnight)는 속성을 지운다 — CSS의 기본 변수값이 곧 미드나잇이다 */
export function applyAppTheme(id: AppThemeId) {
  localStorage.setItem(STORAGE_KEY, id);
  if (id === 'midnight') delete document.documentElement.dataset.appTheme;
  else document.documentElement.dataset.appTheme = id;
}
