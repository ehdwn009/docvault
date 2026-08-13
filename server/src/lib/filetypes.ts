// 허용 확장자 (API-031). 형식 확장 시 이 맵에만 추가한다 (아키텍처 — 확장 로드맵)

export const TEXT_EXTENSIONS: Record<string, { fileType: 'md' | 'html' | 'text'; mimeType: string }> = {
  '.md': { fileType: 'md', mimeType: 'text/markdown' },
  '.markdown': { fileType: 'md', mimeType: 'text/markdown' },
  '.html': { fileType: 'html', mimeType: 'text/html' },
  '.txt': { fileType: 'text', mimeType: 'text/plain' },
};

export const BINARY_EXTENSIONS: Record<string, { fileType: 'image' | 'pdf'; mimeType: string }> = {
  '.png': { fileType: 'image', mimeType: 'image/png' },
  '.jpg': { fileType: 'image', mimeType: 'image/jpeg' },
  '.jpeg': { fileType: 'image', mimeType: 'image/jpeg' },
  '.gif': { fileType: 'image', mimeType: 'image/gif' },
  '.webp': { fileType: 'image', mimeType: 'image/webp' },
  '.svg': { fileType: 'image', mimeType: 'image/svg+xml' },
  '.pdf': { fileType: 'pdf', mimeType: 'application/pdf' },
};

export const ALL_EXTENSIONS: Record<string, { fileType: 'md' | 'html' | 'text' | 'image' | 'pdf'; mimeType: string }> = {
  ...TEXT_EXTENSIONS,
  ...BINARY_EXTENSIONS,
};

export function extensionOf(name: string): string {
  const dot = name.lastIndexOf('.');
  return dot === -1 ? '' : name.slice(dot).toLowerCase();
}
