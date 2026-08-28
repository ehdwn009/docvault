import { MAX_TEXT_FILE_BYTES, TEXT_SNIFF_BYTES } from '../constants.js';

// 형식 분류 (API-031 전량 수용 정책, 2026-08-27): 어떤 확장자도 거절하지 않는다.
// 이 맵은 "더 나은 미리보기·저장 방식"을 아는 형식만 담고, 여기 없는 확장자는
// classifyUpload가 내용을 보고 text 또는 binary로 분류한다 (아키텍처 — 전량 수용 정책)

export type FileType =
  | 'md'
  | 'html'
  | 'code'
  | 'text'
  | 'image'
  | 'pdf'
  | 'audio'
  | 'video'
  | 'binary';

export type TypeMeta = { fileType: FileType; mimeType: string };

/** 텍스트 계열(DB 본문 저장) 판정 — 저장·편집·버전·검색이 모두 이 경계를 따른다 */
export function isTextType(fileType: string): boolean {
  return fileType === 'md' || fileType === 'html' || fileType === 'code' || fileType === 'text';
}

// 코드의 MIME은 전부 text/plain — .js를 application/javascript로 내리면 브라우저가 실행
// 가능한 리소스로 취급할 수 있어, 열람 플랫폼에서는 "본문은 항상 그냥 텍스트"가 안전하다
const CODE_EXTENSION_LIST = [
  '.js', '.jsx', '.ts', '.tsx', '.mjs', '.cjs',
  '.py', '.rb', '.php', '.java', '.kt', '.swift', '.scala', '.dart',
  '.c', '.h', '.cpp', '.hpp', '.cc', '.cs', '.go', '.rs', '.lua', '.r', '.pl',
  '.sql', '.sh', '.bash', '.zsh', '.bat', '.cmd', '.ps1',
  '.json', '.jsonc', '.yml', '.yaml', '.toml', '.ini', '.cfg', '.conf',
  '.xml', '.css', '.scss', '.less', '.vue', '.svelte', '.graphql', '.proto',
] as const;

export const TEXT_EXTENSIONS: Record<string, TypeMeta> = {
  '.md': { fileType: 'md', mimeType: 'text/markdown' },
  '.markdown': { fileType: 'md', mimeType: 'text/markdown' },
  '.html': { fileType: 'html', mimeType: 'text/html' },
  '.txt': { fileType: 'text', mimeType: 'text/plain' },
  '.csv': { fileType: 'text', mimeType: 'text/plain' },
  '.tsv': { fileType: 'text', mimeType: 'text/plain' },
  '.log': { fileType: 'text', mimeType: 'text/plain' },
  ...Object.fromEntries(
    CODE_EXTENSION_LIST.map((ext) => [ext, { fileType: 'code', mimeType: 'text/plain' }]),
  ),
};

export const BINARY_EXTENSIONS: Record<string, TypeMeta> = {
  '.png': { fileType: 'image', mimeType: 'image/png' },
  '.jpg': { fileType: 'image', mimeType: 'image/jpeg' },
  '.jpeg': { fileType: 'image', mimeType: 'image/jpeg' },
  '.gif': { fileType: 'image', mimeType: 'image/gif' },
  '.webp': { fileType: 'image', mimeType: 'image/webp' },
  '.svg': { fileType: 'image', mimeType: 'image/svg+xml' },
  '.pdf': { fileType: 'pdf', mimeType: 'application/pdf' },
  '.mp3': { fileType: 'audio', mimeType: 'audio/mpeg' },
  '.wav': { fileType: 'audio', mimeType: 'audio/wav' },
  '.ogg': { fileType: 'audio', mimeType: 'audio/ogg' },
  '.m4a': { fileType: 'audio', mimeType: 'audio/mp4' },
  '.flac': { fileType: 'audio', mimeType: 'audio/flac' },
  '.mp4': { fileType: 'video', mimeType: 'video/mp4' },
  '.m4v': { fileType: 'video', mimeType: 'video/mp4' },
  '.webm': { fileType: 'video', mimeType: 'video/webm' },
  '.mov': { fileType: 'video', mimeType: 'video/quicktime' },
  // 미리보기는 없지만 자주 오가는 형식 — 다운로드 시 올바른 MIME을 주기 위한 항목
  '.zip': { fileType: 'binary', mimeType: 'application/zip' },
  '.7z': { fileType: 'binary', mimeType: 'application/x-7z-compressed' },
  '.tar': { fileType: 'binary', mimeType: 'application/x-tar' },
  '.gz': { fileType: 'binary', mimeType: 'application/gzip' },
  '.docx': {
    fileType: 'binary',
    mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  },
  '.xlsx': {
    fileType: 'binary',
    mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  },
  '.pptx': {
    fileType: 'binary',
    mimeType: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  },
  '.hwp': { fileType: 'binary', mimeType: 'application/x-hwp' },
  '.epub': { fileType: 'binary', mimeType: 'application/epub+zip' },
};

export const ALL_EXTENSIONS: Record<string, TypeMeta> = {
  ...TEXT_EXTENSIONS,
  ...BINARY_EXTENSIONS,
};

/** 모르는 확장자의 도착지 두 곳 — 내용이 텍스트면 text, 아니면 보관 전용 binary */
export const UNKNOWN_TEXT: TypeMeta = { fileType: 'text', mimeType: 'text/plain' };
export const GENERIC_BINARY: TypeMeta = { fileType: 'binary', mimeType: 'application/octet-stream' };

export function extensionOf(name: string): string {
  const dot = name.lastIndexOf('.');
  return dot === -1 ? '' : name.slice(dot).toLowerCase();
}

/** 앞부분이 "사람이 읽는 텍스트"인지 — git·에디터들이 쓰는 판정과 같다 (NUL 없음 + 유효한 UTF-8) */
export function looksLikeText(head: Buffer): boolean {
  if (head.includes(0)) return false;
  const decoder = new TextDecoder('utf-8', { fatal: true });
  // 검사 경계에서 멀티바이트 글자가 잘렸을 수 있다 — 끝을 최대 3바이트까지 줄여 가며 재시도
  for (let cut = 0; cut <= 3 && cut <= head.length; cut++) {
    try {
      decoder.decode(head.subarray(0, head.length - cut));
      return true;
    } catch {
      /* 다음 cut으로 */
    }
  }
  return false;
}

/** 업로드 파일의 형식 결정 — 아는 확장자는 맵으로, 모르는 확장자는 내용 검사로 */
export async function classifyUpload(file: File): Promise<TypeMeta> {
  const known = ALL_EXTENSIONS[extensionOf(file.name)];
  if (known) return known;
  // 텍스트로 받으려면 본문이 DB에 들어가야 하므로 텍스트 크기 제한을 넘으면 검사 없이 바이너리
  if (file.size <= MAX_TEXT_FILE_BYTES) {
    const head = Buffer.from(await file.slice(0, TEXT_SNIFF_BYTES).arrayBuffer());
    if (looksLikeText(head)) return UNKNOWN_TEXT;
  }
  return GENERIC_BINARY;
}
