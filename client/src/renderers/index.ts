import { lazy, type ComponentType } from 'react';
import type { ViewerTheme } from '../lib/api';
import HtmlRenderer from './HtmlRenderer';
import TextRenderer from './TextRenderer';

/** 렌더러가 부모에 보고하는 목차 한 줄 — jump()를 부르면 그 헤딩으로 이동한다 */
export type RendererTocItem = { text: string; level: number; jump: () => void };

/** 렌더러 안의 문장 선택 보고 — 좌표는 뷰포트 기준. null이면 선택이 풀렸다는 뜻 (SCR-180 질문 패널) */
export type RendererSelection = {
  quote: string;
  context: string;
  rect: { x: number; y: number; w: number; h: number };
};

export type RendererProps = {
  content: string;
  theme?: ViewerTheme;
  /** 파일 이름 — 코드 렌더러가 확장자로 강조 언어를 고르는 데 쓴다 */
  fileName?: string;
  /** 문서 속 상대 경로 링크 클릭 — (경로, 분할로 열지). md 렌더러용 */
  onFileLink?: (path: string, split: boolean) => void;
  /** 줄 번호 앵커(#L16-L26)로 열렸을 때 하이라이트할 줄 범위 — 코드 렌더러용 */
  highlightLines?: { start: number; end: number };
  /** 카드 출처로 열렸을 때 문서에서 찾아 형광펜 칠할 문장 (md·text·html) */
  highlightQuote?: string;
  /** 문장을 찾았는지 보고 — 못 찾으면 부모가 "문서가 바뀌었을 수 있다"고 알린다 */
  onQuoteFound?: (found: boolean) => void;
  /** 밑줄 그을 내 카드 용어(제목·별칭). 없거나 비면 안 긋는다 (md·text·html) */
  terms?: { title: string; aliases: string[] }[];
  /** 문서에서 실제로 찾은 용어들(카드 제목, 중복 없이) 보고 — "이 문서에 내 카드 N장" */
  onTermsFound?: (titles: string[]) => void;
  /** 밑줄 친 용어를 눌렀다 — (카드 제목, 뷰포트 기준 자리) */
  onTermClick?: (title: string, rect: { x: number; y: number; w: number; h: number }) => void;
  /** 열람 시작 시 복원할 스크롤 위치 — iframe 내부에서 스크롤되는 html 렌더러용 */
  initialOffset?: number;
  /** 복원할 비율(0~1) — px은 기기 간에 안 맞아, 있으면 이것을 우선한다 (html 렌더러용) */
  initialRatio?: number;
  /** 렌더러 내부 스크롤 보고(px, 비율) — 부모가 읽던 위치 저장에 사용 (html 렌더러용) */
  onScrollOffset?: (offset: number, ratio?: number) => void;
  /** 렌더러가 수집한 헤딩 목록 보고 — 부모의 목차(SCR-151)에 사용 (html 렌더러용) */
  onToc?: (items: RendererTocItem[]) => void;
  /** 문서 안을 눌렀다는 신호 — 격리된 iframe의 클릭은 부모에 닿지 않아 따로 알려야 한다 (html 렌더러용) */
  onInteract?: () => void;
  /** 문장 선택 보고 — 격리된 iframe의 선택은 부모가 못 읽어 심이 대신 알린다 (html 렌더러용) */
  onSelection?: (sel: RendererSelection | null) => void;
  /** 좁은 화면 맞춤 보정 사용 여부 — 끄면 문서를 만든 그대로 보여준다 (html 렌더러용) */
  fit?: boolean;
  /** 글자 크기 배율(%) — 문서마다 기준 크기가 달라 절대 px가 아니라 배율로 준다 (html 렌더러용) */
  fontScale?: number;
};

// react-markdown + highlight.js가 무거워서 md·코드 렌더러는 지연 로드한다 (사용처는 Suspense로 감쌀 것)
export const MarkdownRenderer = lazy(() => import('./MarkdownRenderer'));
export const CodeRenderer = lazy(() => import('./CodeRenderer'));
// pdf.js(약 1MB)도 지연 로드. 본문이 문자열이 아니라(바이너리) props 계약이 달라 아래 레지스트리에는 안 든다
export const PdfRenderer = lazy(() => import('./PdfRenderer'));

// 렌더러 레지스트리 — 새 형식 지원 시 여기에 컴포넌트만 등록하면 된다 (아키텍처 — 플러그인 구조)
export const renderers: Partial<Record<string, ComponentType<RendererProps>>> = {
  md: MarkdownRenderer,
  html: HtmlRenderer,
  text: TextRenderer,
  code: CodeRenderer,
};
