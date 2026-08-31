// 단축키·제스처 레지스트리 — 도움말 화면(후속)이 이 목록을 읽어 그린다 (IA — 단축키 레지스트리).
// 새 단축키·제스처를 만들면 반드시 여기에도 등록한다 — 도움말을 손으로 따로 쓰면 반드시 낡는다
// (ERD 이중 기재 원칙과 같은 이유).

export type Shortcut = {
  /** 어디서 통하나 */
  context: string;
  /** 뭘 누르나/하나 (예: "Ctrl+K", "Alt+클릭", "가운데 클릭") */
  input: string;
  /** 뭐가 되나 */
  effect: string;
  /** 마우스·키보드 전제(PC 전용)면 true */
  pcOnly?: boolean;
};

export const SHORTCUTS: Shortcut[] = [
  { context: '전체', input: 'Ctrl+K', effect: '커맨드 팔레트 열기/닫기' },
  { context: '전체', input: 'Esc', effect: '몰입 모드·팝업·메뉴 닫기' },
  { context: '전체', input: '파일 끌어다 놓기', effect: '업로드 (트리의 폴더 위에 놓으면 그 폴더로)' },
  { context: '편집기', input: 'Ctrl+S', effect: '저장' },
  { context: '파일 트리', input: 'Alt+클릭', effect: '분할로 열기', pcOnly: true },
  { context: '파일 트리', input: 'Ctrl+클릭', effect: '다중 선택 켜기/추가', pcOnly: true },
  { context: '파일 트리', input: 'Shift+클릭', effect: '범위 선택 (다중 선택 중)', pcOnly: true },
  { context: '탭 바', input: 'Alt+클릭', effect: '분할로 열기', pcOnly: true },
  { context: '탭 바', input: '가운데 클릭', effect: '탭 닫기', pcOnly: true },
  { context: '탭 바', input: '우클릭', effect: '탭 메뉴 (분할로 열기·일괄 닫기)', pcOnly: true },
  { context: '탭 바', input: '탭 드래그', effect: '순서 바꾸기 · 본문에 놓아 분할 배치', pcOnly: true },
  { context: '문서 속 링크', input: 'Alt+클릭', effect: '링크된 파일을 분할로 열기', pcOnly: true },
  { context: '분할 구분선', input: '짧게 탭/클릭', effect: '분할 컨트롤러 (비율·자리 바꾸기·해제)' },
  { context: '분할 구분선', input: '끌기', effect: '분할 비율 조절' },
  { context: '뷰어 헤더 (터치)', input: '좌우 스와이프', effect: '이전/다음 문서로 전환' },
  { context: '⋯ 메뉴 글자 배율', input: 'Shift+누르며 조절', effect: '한 번에 10씩 조절' },
];
