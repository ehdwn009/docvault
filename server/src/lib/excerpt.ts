import { HOME } from '../constants.js';

// 홈 「이어 읽기」의 첫 줄 미리보기 (API-048) — 본문 앞부분에서 꾸밈 기호를 걷어 낸 글자만.
// 정확한 변환기가 아니라 "무슨 글인지 알아볼 한두 줄"이면 된다 — 그래서 파서 없이 정규식으로 걷어 낸다

const ENTITIES: Record<string, string> = { '&nbsp;': ' ', '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&#39;': "'" };

function fromHtml(src: string): string {
  return src
    .replace(/<(script|style|head|title)[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<(script|style|head)[\s\S]*$/i, ' ') // 앞부분만 읽어 닫는 태그가 잘린 경우
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<[^>]*>/g, ' ')
    .replace(/<[^>]*$/, ' ')
    .replace(/&(nbsp|amp|lt|gt|quot|#39);/g, (m) => ENTITIES[m] ?? ' ');
}

function fromMarkdown(src: string): string {
  return src
    .replace(/\r\n/g, '\n') // 윈도우 줄바꿈으로 올린 문서도 같은 규칙으로
    .replace(/^---\n[\s\S]*?\n---\n/, '') // 머리말(front matter)
    .replace(/^\s*#{1,6}\s+.*\n+/, '') // 맨 위 제목 — 파일 이름과 같은 말이라 미리보기에서는 뺀다
    .replace(/```[\s\S]*?(```|$)/g, ' ')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/^\s{0,3}(#{1,6}|>|[-*+]|\d+\.)\s+/gm, '')
    .replace(/[*_`~|]/g, '');
}

/** 본문 앞부분 → 한두 줄 미리보기. 글자가 없으면 빈 문자열(바이너리·빈 문서) */
export function excerptOf(fileType: string, head: string | null): string {
  if (!head) return '';
  const plain = (fileType === 'html' ? fromHtml(head) : fileType === 'md' ? fromMarkdown(head) : head).replace(/\s+/g, ' ').trim();
  return plain.length > HOME.EXCERPT_CHARS ? `${plain.slice(0, HOME.EXCERPT_CHARS).trimEnd()}…` : plain;
}
