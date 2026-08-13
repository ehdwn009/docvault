import type { ComponentType } from 'react';
import HtmlRenderer from './HtmlRenderer';
import MarkdownRenderer from './MarkdownRenderer';
import TextRenderer from './TextRenderer';

// 렌더러 레지스트리 — 새 형식 지원 시 여기에 컴포넌트만 등록하면 된다 (아키텍처 — 플러그인 구조)
export const renderers: Partial<Record<string, ComponentType<{ content: string }>>> = {
  md: MarkdownRenderer,
  html: HtmlRenderer,
  text: TextRenderer,
  code: TextRenderer, // 코드 전용 렌더러가 생기기 전까지 텍스트로 표시
};
