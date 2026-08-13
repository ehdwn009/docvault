export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
  ) {
    super(message);
  }
}

export type User = {
  id: number;
  username: string;
  displayName: string | null;
  role: 'user' | 'admin';
};

export type TreeFolder = {
  id: number;
  parentId: number | null;
  name: string;
  isShared: number;
  sortOrder: number;
};

export type TreeFile = {
  id: number;
  folderId: number | null;
  name: string;
  fileType: 'md' | 'html' | 'code' | 'text' | 'image' | 'pdf';
  sizeBytes: number;
  isShared: number;
  sortOrder: number;
  updatedAt: number;
  tags: number[];
  state: {
    isFavorite: number;
    lastOpenedAt: number | null;
    readingPosition: { anchor?: string | null; offset?: number } | null;
  };
};

export type ViewerTheme = 'light' | 'dark' | 'sepia';

export type UserSettings = {
  viewerTheme: ViewerTheme;
  fontSize: number;
  fontFamily: string | null;
  lineHeight: string | null;
  contentWidth: 'narrow' | 'normal' | 'wide';
};

export type Tree = { folders: TreeFolder[]; files: TreeFile[] };

export type FileContent = {
  id: number;
  fileType: TreeFile['fileType'];
  content: string;
  updatedAt: number;
  readonly: boolean;
};

/** /api/v1 공통 fetch 래퍼. 세션은 httpOnly 쿠키라 코드에서 다룰 것이 없다. */
export async function api<T>(path: string, init?: RequestInit): Promise<T> {
  // Content-Type은 JSON 문자열 body일 때만 지정한다 — FormData는 브라우저가 boundary를 붙여야 함
  const jsonHeaders =
    typeof init?.body === 'string' ? { 'Content-Type': 'application/json' } : undefined;
  const res = await fetch(`/api/v1${path}`, {
    ...init,
    headers: { ...jsonHeaders, ...init?.headers },
  });

  if (!res.ok) {
    let code = 'UNKNOWN';
    let message = `HTTP ${res.status}`;
    try {
      const body = (await res.json()) as { code?: string; message?: string };
      code = body.code ?? code;
      message = body.message ?? message;
    } catch {
      // 에러 응답이 JSON이 아니면 상태 코드만으로 처리
    }
    throw new ApiError(res.status, code, message);
  }

  return res.json() as Promise<T>;
}
