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
    /** HTML 화면 맞춤 보정 사용 여부 (1=켬) */
    viewerFit: number;
    /** 이 파일만의 글자 크기 배율(%). null이면 전역 기본값을 따른다 */
    fontScale: number | null;
  };
};

/** 트리 밖에서 얻은 파일(검색 결과·딥링크·관리자 목록)에 붙이는 기본 열람 상태 — 서버 기본값과 같아야 한다 */
export const DEFAULT_FILE_STATE: TreeFile['state'] = {
  isFavorite: 0,
  lastOpenedAt: null,
  readingPosition: null,
  viewerFit: 1,
  fontScale: null,
};

export type Tag = { id: number; name: string; color: string };

export type SharedFolder = { id: number; parentId: number | null; name: string; ownerName: string };
export type SharedFile = {
  id: number;
  folderId: number | null;
  name: string;
  fileType: TreeFile['fileType'];
  updatedAt: number;
  ownerName: string;
};

export type ViewerTheme = 'light' | 'dark' | 'sepia';

export type UserSettings = {
  viewerTheme: ViewerTheme;
  fontSize: number;
  /** HTML 문서 글자 크기의 전역 기본 배율(%) — 파일별 값이 없을 때 쓰인다 */
  htmlFontScale: number;
  fontFamily: string | null;
  lineHeight: string | null;
  contentWidth: 'narrow' | 'normal' | 'wide';
  lastSeenVersion: string | null;
};

export type Changelog = { version: string; content: string };

export type Tree = { folders: TreeFolder[]; files: TreeFile[] };

export type FileContent = {
  id: number;
  fileType: TreeFile['fileType'];
  content: string;
  updatedAt: number;
  readonly: boolean;
};

/** 업로드 전용 — fetch는 업로드 진행률을 주지 않아 XHR을 쓴다 (대용량 PDF 대비) */
export function uploadFiles(
  fd: FormData,
  onProgress?: (pct: number) => void,
): Promise<{ files: TreeFile[] }> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', '/api/v1/files');
    if (onProgress) {
      xhr.upload.onprogress = (e) => {
        if (e.lengthComputable) onProgress(Math.round((e.loaded / e.total) * 100));
      };
    }
    xhr.onload = () => {
      type UploadBody = { code?: string; message?: string; files?: TreeFile[] };
      let body: UploadBody | null = null;
      try {
        body = JSON.parse(xhr.responseText) as UploadBody;
      } catch {
        // 응답이 JSON이 아니면 상태 코드로만 처리
      }
      if (xhr.status === 201 && body?.files) resolve({ files: body.files });
      else reject(new ApiError(xhr.status, body?.code ?? 'UNKNOWN', body?.message ?? `HTTP ${xhr.status}`));
    };
    xhr.onerror = () => reject(new ApiError(0, 'NETWORK', '네트워크 오류'));
    xhr.send(fd);
  });
}

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
