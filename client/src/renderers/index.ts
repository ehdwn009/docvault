import { lazy, type ComponentType } from 'react';
import type { ViewerTheme } from '../lib/api';
import HtmlRenderer from './HtmlRenderer';
import TextRenderer from './TextRenderer';

export type RendererProps = { content: string; theme?: ViewerTheme };

// react-markdown + highlight.js가 무거워서 md 렌더러는 지연 로드한다 (사용처는 Suspense로 감쌀 것)
export const MarkdownRenderer = lazy(() => import('./MarkdownRenderer'));

// 렌더러 레지스트리 — 새 형식 지원 시 여기에 컴포넌트만 등록하면 된다 (아키텍처 — 플러그인 구조)
export const renderers: Partial<Record<string, ComponentType<RendererProps>>> = {
  md: MarkdownRenderer,
  html: HtmlRenderer,
  text: TextRenderer,
  code: TextRenderer, // 코드 전용 렌더러가 생기기 전까지 텍스트로 표시
};
