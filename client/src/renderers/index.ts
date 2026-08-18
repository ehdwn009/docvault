import { lazy, type ComponentType } from 'react';
import type { ViewerTheme } from '../lib/api';
import HtmlRenderer from './HtmlRenderer';
import TextRenderer from './TextRenderer';

/** 렌더러가 부모에 보고하는 목차 한 줄 — jump()를 부르면 그 헤딩으로 이동한다 */
export type RendererTocItem = { text: string; level: number; jump: () => void };

export type RendererProps = {
  content: string;
  theme?: ViewerTheme;
  /** 열람 시작 시 복원할 스크롤 위치 — iframe 내부에서 스크롤되는 html 렌더러용 */
  initialOffset?: number;
  /** 렌더러 내부 스크롤 보고 — 부모가 읽던 위치 저장에 사용 (html 렌더러용) */
  onScrollOffset?: (offset: number) => void;
  /** 렌더러가 수집한 헤딩 목록 보고 — 부모의 목차(SCR-151)에 사용 (html 렌더러용) */
  onToc?: (items: RendererTocItem[]) => void;
  /** 좁은 화면 맞춤 보정 사용 여부 — 끄면 문서를 만든 그대로 보여준다 (html 렌더러용) */
  fit?: boolean;
};

// react-markdown + highlight.js가 무거워서 md 렌더러는 지연 로드한다 (사용처는 Suspense로 감쌀 것)
export const MarkdownRenderer = lazy(() => import('./MarkdownRenderer'));

// 렌더러 레지스트리 — 새 형식 지원 시 여기에 컴포넌트만 등록하면 된다 (아키텍처 — 플러그인 구조)
export const renderers: Partial<Record<string, ComponentType<RendererProps>>> = {
  md: MarkdownRenderer,
  html: HtmlRenderer,
  text: TextRenderer,
  code: TextRenderer, // 코드 전용 렌더러가 생기기 전까지 텍스트로 표시
};
