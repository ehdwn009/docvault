// 설정 페이지의 지도 — 카테고리(왼쪽 목록)와 항목 색인(검색 SCR-405). 본문은 카테고리별 컴포넌트가 그린다 (IA — 안 B "나").

export type SettingsCategoryId =
  | 'display' | 'cards' | 'account'
  | 'briefing' | 'subscription' | 'readers' | 'stats' | 'users' | 'tree' | 'ai' | 'perf'
  | 'about';

/** 다른 화면에서 "설정의 그 항목으로" 갈 때 — item은 SETTINGS_INDEX의 item */
export type SettingsTarget = { category: SettingsCategoryId; item?: string };

export type SettingsCategory = { id: SettingsCategoryId; name: string; scr: string };

export const SETTINGS_SECTIONS: { title: string; admin?: boolean; items: SettingsCategory[] }[] = [
  {
    title: '내 취향',
    items: [
      { id: 'display', name: '화면·뷰어', scr: 'SCR-141' },
      { id: 'cards', name: '배움 카드', scr: 'SCR-401' },
      { id: 'account', name: '계정', scr: 'SCR-142' },
    ],
  },
  {
    title: '앱 운영',
    admin: true,
    items: [
      { id: 'briefing', name: '뉴스 브리핑', scr: 'SCR-147' },
      { id: 'subscription', name: '구독 연결', scr: 'SCR-402' },
      { id: 'readers', name: '함께 보는 계정', scr: 'SCR-403' },
      { id: 'users', name: '사용자', scr: 'SCR-302' },
      { id: 'stats', name: '통계', scr: 'SCR-301' },
      { id: 'tree', name: '전체 파일', scr: 'SCR-303' },
      { id: 'ai', name: 'AI 사용량', scr: 'SCR-305' },
      { id: 'perf', name: '성능', scr: 'SCR-306' },
    ],
  },
  {
    title: '정보',
    items: [{ id: 'about', name: '정보', scr: 'SCR-404' }],
  },
];

export const CATEGORY_BY_ID: Record<SettingsCategoryId, SettingsCategory> = Object.fromEntries(
  SETTINGS_SECTIONS.flatMap((s) => s.items).map((c) => [c.id, c]),
) as Record<SettingsCategoryId, SettingsCategory>;

export const isAdminCategory = (id: SettingsCategoryId) => SETTINGS_SECTIONS.some((s) => s.admin && s.items.some((c) => c.id === id));

/** 행의 DOM id — SettingRow의 id와 검색·바로 가기가 같은 규칙을 쓴다 */
export const rowId = (category: SettingsCategoryId, item: string) => `set-${category}.${item}`;

/** 검색 색인 — 이름·설명을 걸러 카테고리 너머로 찾는다. 행을 추가하면 여기에도 한 줄 */
export type SettingsIndexEntry = { category: SettingsCategoryId; item: string; title: string; desc: string; admin?: boolean };
export const SETTINGS_INDEX: SettingsIndexEntry[] = [
  { category: 'display', item: 'scheme', title: '앱 테마', desc: '시스템 · 밝음 · 어두움. 앱 전체(메뉴·패널·탭)의 명암' },
  { category: 'display', item: 'accent', title: '강조색', desc: '하늘 · 초록 · 보라 · 앰버' },
  { category: 'display', item: 'viewerTheme', title: '본문 테마', desc: '문서를 읽는 바탕색 — 라이트 · 세피아 · 북 그린 · 그레이 · 다크 · 나이트' },
  { category: 'display', item: 'fontSize', title: '글자 크기', desc: '마크다운 문서의 글자 크기' },
  { category: 'display', item: 'htmlFontScale', title: 'HTML 글자 크기', desc: 'HTML 문서의 기본 배율' },
  { category: 'display', item: 'contentWidth', title: '본문 너비', desc: '좁게 · 보통 · 넓게' },
  { category: 'display', item: 'shortcuts', title: '단축키 · 제스처', desc: '숨어 있는 단축키와 제스처 전체 목록' },
  { category: 'cards', item: 'termHighlight', title: '문서 속 내 카드 용어에 점선 밑줄', desc: '누르면 한 줄 정의가 뜨고 카드로 갈 수 있습니다' },
  { category: 'cards', item: 'askWithCards', title: '질문할 때 관련 카드 함께 보내기', desc: '질문에 내 카드의 이름이 나오면 그 카드를 AI가 먼저 읽습니다' },
  { category: 'account', item: 'who', title: '로그인한 계정', desc: '아이디와 역할' },
  { category: 'account', item: 'password', title: '비밀번호', desc: '비밀번호 바꾸기' },
  { category: 'account', item: 'logout', title: '나가기', desc: '로그아웃' },
  { category: 'briefing', item: 'auto', title: '자동 생성', desc: '정한 시각에 뉴스 브리핑 회차를 만듭니다', admin: true },
  { category: 'briefing', item: 'timers', title: '타이머', desc: '회차 시각과 이름 — 최대 5개, 켜진 것끼리 2시간 이상', admin: true },
  { category: 'briefing', item: 'cost', title: '이번 달 비용', desc: '한도에 닿으면 자동 생성이 멈춥니다', admin: true },
  { category: 'briefing', item: 'mode', title: '생성 방식', desc: '앱이 직접 만들기(API) · 구독으로 받기(Claude 예약 작업)', admin: true },
  { category: 'briefing', item: 'reader', title: '앱 안 원문 보기', desc: '기사 화면에서 원문을 앱 안에서 읽습니다', admin: true },
  { category: 'briefing', item: 'sources', title: '수집 목록', desc: 'RSS 주소와 검색어 문서', admin: true },
  { category: 'subscription', item: 'firstConnect', title: '처음 연결하기', desc: '여섯 단계 안내 — 열쇠·시크릿·허용 목록·예약 작업·트리거·연결 확인', admin: true },
  { category: 'subscription', item: 'token', title: '연결 열쇠', desc: '예약 작업이 docvault에 들어올 때 쓰는 열쇠', admin: true },
  { category: 'subscription', item: 'trigger', title: '예약 작업 트리거', desc: 'docvault가 claude.ai 예약 작업을 켤 때 쓰는 주소와 토큰', admin: true },
  { category: 'subscription', item: 'ping', title: '연결 확인', desc: '예약 작업을 한 번 켜서 왕복을 확인합니다', admin: true },
  { category: 'subscription', item: 'times', title: '예약 시각', desc: '타이머마다 예약 작업이 켜지는 시각과 마감', admin: true },
  { category: 'subscription', item: 'recent', title: '최근 회차', desc: '성공 · 도착 안 함 · 실패 · 평균 시간', admin: true },
  { category: 'readers', item: 'list', title: '함께 보는 계정', desc: '고른 계정에 내 브리핑이 읽기 전용으로 열립니다', admin: true },
  { category: 'users', item: 'list', title: '사용자', desc: '계정 발급 · 비활성화 · 역할 · 비밀번호 초기화 · 삭제', admin: true },
  { category: 'stats', item: 'all', title: '통계', desc: '사용자 · 파일 · 폴더 · 버전 · 공유 · 용량', admin: true },
  { category: 'tree', item: 'all', title: '전체 파일', desc: '사용자별 파일 목록', admin: true },
  { category: 'ai', item: 'all', title: 'AI 사용량', desc: '누가 얼마나 물어봤나, 추정 비용', admin: true },
  { category: 'perf', item: 'all', title: '성능', desc: '앱 시작 시간 측정', admin: true },
  { category: 'about', item: 'version', title: '버전', desc: 'docvault 버전과 업데이트 기록' },
  { category: 'about', item: 'export', title: '내보내기', desc: '내 파일 전부를 ZIP 하나로 받습니다' },
];
