/** v1 허용 확장자 (API-031). 형식 확장 시 이 맵에만 추가한다 (아키텍처 — 확장 로드맵) */
export const TEXT_EXTENSIONS: Record<string, { fileType: 'md' | 'html' | 'text'; mimeType: string }> = {
  '.md': { fileType: 'md', mimeType: 'text/markdown' },
  '.markdown': { fileType: 'md', mimeType: 'text/markdown' },
  '.html': { fileType: 'html', mimeType: 'text/html' },
  '.txt': { fileType: 'text', mimeType: 'text/plain' },
};

export function extensionOf(name: string): string {
  const dot = name.lastIndexOf('.');
  return dot === -1 ? '' : name.slice(dot).toLowerCase();
}
