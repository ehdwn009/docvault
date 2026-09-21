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

/** 텍스트 계열(본문 조회·편집·버전이 있는 형식) 판정 — 서버 filetypes.ts의 경계와 같아야 한다 */
export function isTextFileType(fileType: string): boolean {
  return fileType === 'md' || fileType === 'html' || fileType === 'code' || fileType === 'text';
}

export type TreeFile = {
  id: number;
  folderId: number | null;
  name: string;
  fileType: FileType;
  /** card = 배움 카드 (서랍에서만 보임, 뷰어는 머리말을 표로 그린다). 없으면 doc */
  kind?: 'doc' | 'card';
  sizeBytes: number;
  isShared: number;
  sortOrder: number;
  updatedAt: number;
  tags: number[];
  state: {
    isFavorite: number;
    lastOpenedAt: number | null;
    /** ratio: 전체 스크롤 대비 비율(0~1) — 기기마다 문서 높이가 달라 px 대신 이것으로 이어 읽는다 */
    readingPosition: { anchor?: string | null; offset?: number; ratio?: number } | null;
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

/**
 * 트리 밖에서 얻은 부분 데이터(공유 트리·검색 결과·메타 조회·관리자 목록)를 뷰어가 받는
 * TreeFile 모양으로 채운다. 빠진 칸은 기본값으로 — 뷰어는 본문·상태를 따로 조회하므로
 * 여기 값들은 목록 표시용이다.
 */
export function toTreeFile(
  f: Partial<Omit<TreeFile, 'state'>> & { state?: Partial<TreeFile['state']> } & Pick<TreeFile, 'id' | 'name' | 'fileType'>,
): TreeFile {
  return {
    folderId: null,
    sizeBytes: 0,
    isShared: 0,
    sortOrder: 0,
    updatedAt: 0,
    ...f,
    tags: f.tags ?? [],
    state: { ...DEFAULT_FILE_STATE, ...(f.state ?? {}) },
  };
}

/** API-021의 실제 응답 — tags·state는 기본값이면 생략, state에 readingPosition은 없다(열 때 API-073 GET로 받는다) */
export type TreeWire = { folders: TreeFolder[]; files: (Omit<TreeFile, 'tags' | 'state'> & { tags?: number[]; state?: Partial<TreeFile['state']> })[] };

export type Tag = { id: number; name: string; color: string };

/** API-039: 속성창(SCR-113)의 파일 쪽 */
export type FileInfo = {
  file: Omit<TreeFile, 'tags' | 'state'> & { createdAt: number; mimeType: string };
  path: { id: number; name: string }[];
  versionCount: number;
  threadCount: number;
  cardCount: number;
  tagIds: number[];
  isFavorite: number;
  lastOpenedAt: number | null;
  charCount: number | null;
  lineCount: number | null;
  storagePath: string | null;
};

/** API-026: 속성창의 폴더 쪽 — 하위 전부를 센 값 */
export type FolderInfo = {
  folder: TreeFolder & { createdAt: number; updatedAt: number };
  path: { id: number; name: string }[];
  folderCount: number;
  fileCount: number;
  bytes: number;
  byType: Record<string, number>;
  latest: { id: number; name: string; updatedAt: number } | null;
};

export type SharedFolder = { id: number; parentId: number | null; name: string; ownerName: string };
export type SharedFile = {
  id: number;
  folderId: number | null;
  name: string;
  fileType: TreeFile['fileType'];
  updatedAt: number;
  ownerName: string;
};

export type ViewerTheme = 'light' | 'sepia' | 'green' | 'gray' | 'dark' | 'night';

/** 다크 계열 판정 — 렌더러들이 글자색·prose 반전을 고를 때 쓴다.
    theme === 'dark' 직접 비교 금지: 테마를 더할 때 판정이 누락된다 (IA — 뷰어 테마 확장) */
export const isDarkViewerTheme = (t: ViewerTheme | undefined): boolean =>
  t === 'dark' || t === 'night';

export type UserSettings = {
  viewerTheme: ViewerTheme;
  fontSize: number;
  /** HTML 문서 글자 크기의 전역 기본 배율(%) — 파일별 값이 없을 때 쓰인다 */
  htmlFontScale: number;
  fontFamily: string | null;
  lineHeight: string | null;
  contentWidth: 'narrow' | 'normal' | 'wide';
  lastSeenVersion: string | null;
  /** 문서 속 내 카드 용어에 점선 밑줄 (1=켬) */
  termHighlight: number;
  /** 질문할 때 관련 카드를 문맥으로 함께 보내기 (1=켬) */
  askWithCards: number;
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

// ---- 질문 (배움 카드 1판, API-101~106) ----

/** 모델 칩 한 줄 — 서버 상수 ASK_MODELS에서 온다 */
export type AskModelInfo = { id: string; label: string; name: string; note: string };

/** limit·remaining이 null이면 한도 없음 (관리자) */
export type AskStatus = { configured: boolean; limit: number | null; used: number; remaining: number | null; models: AskModelInfo[]; defaultModel: string };

export type AskThread = {
  id: number;
  fileId: number | null;
  fileName: string | null;
  quote: string | null;
  title: string;
  /** 이 대화의 답변 모델 — 칩에서 바꾸면 다음 답부터 (API-107) */
  model: string;
  messageCount?: number;
  createdAt: number;
  updatedAt: number;
};

/** model: 답(assistant)을 낸 모델. 옛 답은 null(= Opus) */
export type AskMessage = { id: number; role: 'user' | 'assistant'; content: string; model?: string | null; createdAt: number };

export type AskUsedDoc = { id: number; name: string; fileType: string };

export type AskStreamHandlers = {
  /** cards = 이번 답에 문맥으로 함께 간 내 카드 (활용 ④), docs = 함께 간 내 문서 단락의 출처 (챗봇 내 자료 참고) */
  onMeta?: (meta: { userMessageId: number; remaining: number | null; model?: string; cards?: { id: number; title: string }[]; docs?: AskUsedDoc[] }) => void;
  /** 모델이 웹 검색을 시작했다 — 답이 늦어지는 이유를 화면이 보여 줄 수 있게 */
  onSearching?: () => void;
  onDelta: (text: string) => void;
  onDone: (done: { assistantMessageId: number; content: string; model?: string }) => void;
  onError: (err: { code: string; message: string }) => void;
};

/** API-103: 질문을 보내고 답을 SSE로 받는다. 스트림이 열리기 전의 실패(한도·검증)는 ApiError로 던진다.
    myStuff: 챗봇의 "내 자료 참고" 스위치 — true면 내 카드+문서 단락, false면 순수 대화. 문서 질문은 보내지 않는다 */
export async function askStream(
  threadId: number,
  body: { question: string; quote?: string; excludeCardIds?: number[]; myStuff?: boolean },
  handlers: AskStreamHandlers,
  signal?: AbortSignal,
): Promise<void> {
  const res = await fetch(`/api/v1/ask/threads/${threadId}/messages`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal,
  });
  if (!res.ok || !res.body) {
    let code = 'UNKNOWN';
    let message = `HTTP ${res.status}`;
    try {
      const b = (await res.json()) as { code?: string; message?: string };
      code = b.code ?? code;
      message = b.message ?? message;
    } catch {
      // JSON이 아니면 상태 코드만
    }
    throw new ApiError(res.status, code, message);
  }

  // SSE 프레임은 빈 줄로 나뉜다. 조각이 프레임 중간에서 끊길 수 있어 버퍼에 모아 완성된 것만 처리한다
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  const handleFrame = (frame: string) => {
    let event = 'message';
    const data: string[] = [];
    for (const line of frame.split('\n')) {
      if (line.startsWith('event:')) event = line.slice(6).trim();
      else if (line.startsWith('data:')) data.push(line.slice(5).trimStart());
    }
    if (data.length === 0) return;
    const payload = JSON.parse(data.join('\n')) as Record<string, unknown>;
    if (event === 'delta') handlers.onDelta(String(payload.text ?? ''));
    else if (event === 'done') handlers.onDone(payload as { assistantMessageId: number; content: string; model?: string });
    else if (event === 'error') handlers.onError(payload as { code: string; message: string });
    else if (event === 'meta') handlers.onMeta?.(payload as Parameters<NonNullable<AskStreamHandlers['onMeta']>>[0]);
    else if (event === 'searching') handlers.onSearching?.();
  };
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let at: number;
    while ((at = buffer.indexOf('\n\n')) !== -1) {
      const frame = buffer.slice(0, at);
      buffer = buffer.slice(at + 2);
      if (frame.trim()) handleFrame(frame);
    }
  }
}

// ---- 배움 카드 (2판, API-111~115) ----

export type CardKind = '개념' | '절차' | '비교' | '문제 해결' | '주제';

export type CardSummary = {
  id: number;
  title: string;
  updatedAt: number;
  oneLine: string;
  aliases: string[];
  kind: CardKind;
  topic: string;
  tags: string[];
  links: string[];
  sources: string[];
};

export type CardDraft = {
  title: string;
  oneLine: string;
  aliases: string[];
  kind: CardKind;
  topic: string;
  tags: string[];
  links: string[];
  body: string;
  similar: {
    cardId: number;
    relation: 'same' | 'aspect' | 'related' | 'different';
    reason: string;
    recommendation: 'merge' | 'link' | 'new';
  } | null;
};

export type CardMerge = {
  oneLine: string;
  aliases: string[];
  kind: CardKind;
  tags: string[];
  links: string[];
  body: string;
  changes: string[];
};

export type CardFront = { oneLine: string; aliases: string[]; kind: CardKind; topic: string; tags: string[]; links: string[] };

/** 대화 정리(API-116) 항목 하나 — 개념 초안 + (같은 개념의 카드가 있으면) 그 카드와 재구성 결과 */
export type CardOutlineItem = {
  concept: CardFront & { title: string; body: string; existingCardId: number | null };
  existing: CardSummary | null;
  merged: CardMerge | null;
  /** 2단계(본문·재구성)가 끝났나 — 아니면 "초안 쓰는 중" */
  ready: boolean;
};
export type CardOutline = {
  items: CardOutlineItem[];
  topic: { title: string; oneLine: string; body: string };
  source: string;
  /** 이 정리를 만든 시각. stale = 그 뒤에 대화에 답이 더 붙었다 */
  outlineAt: number;
  stale: boolean;
};
/** 복습(API-119) 한 장 — 요약 + 본문(뒷면) + 지금 간격 */
export type ReviewCard = CardSummary & { body: string; intervalDays: number; dueAt: number };
export type ReviewList = { due: ReviewCard[]; tomorrow: number; total: number };

/** 묶음 저장(API-117) 결과 — 되돌리기의 재료 (새 카드는 휴지통으로, 이어쓴 카드는 저장 전 버전으로) */
export type CardBatchResult = {
  created: CardSummary[];
  merged: { card: CardSummary; versionId: number }[];
  topic: CardSummary | null;
};

/** 카드 요약을 뷰어가 받는 TreeFile로 — 카드는 트리에 없어서 이렇게 만들어 연다 */
export function cardToTreeFile(c: CardSummary): TreeFile {
  return toTreeFile({ id: c.id, name: `${c.title}.md`, fileType: 'md', updatedAt: c.updatedAt, kind: 'card' });
}
