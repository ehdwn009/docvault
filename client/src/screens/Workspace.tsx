import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import CommandPalette from '../components/CommandPalette';
import FileGrid from '../components/FileGrid';
import FileTree, { type TreeActions } from '../components/FileTree';
import FolderPicker from '../components/FolderPicker';
import RecentList from '../components/RecentList';
import TrashPanel from '../components/TrashPanel';
import TagEditor from '../components/TagEditor';
import UpdateNotes from '../components/UpdateNotes';
import {
  api,
  ApiError,
  DEFAULT_FILE_STATE,
  uploadFiles,
  type Changelog,
  type SharedFile,
  type Tag,
  type Tree,
  type TreeFile,
  type User,
  type UserSettings,
} from '../lib/api';
import { choiceDialog, confirmDialog, promptDialog } from '../lib/dialog';
import { downloadArchive, downloadFile } from '../lib/download';
import { toast } from '../lib/toast';
import AdminPanel from './panels/AdminPanel';
import FavoritesPanel from './panels/FavoritesPanel';
import SettingsPanel from './panels/SettingsPanel';
import SharedPanel from './panels/SharedPanel';
import Viewer from './Viewer';

type Panel = 'files' | 'favorites' | 'shared' | 'settings' | 'admin';
type SortBy = 'name' | 'updated';

const DEFAULT_SETTINGS: UserSettings = {
  viewerTheme: 'light',
  fontSize: 16,
  fontFamily: null,
  lineHeight: null,
  contentWidth: 'normal',
  lastSeenVersion: null,
};

const PANEL_TITLE: Record<Panel, string> = {
  files: '내 파일',
  favorites: '즐겨찾기',
  shared: '공유 파일',
  settings: '설정',
  admin: '관리자',
};

/** 공유 트리 항목을 뷰어가 받는 TreeFile 형태로 맞춘다 (내 트리에 없는 파일) */
function sharedToTreeFile(f: SharedFile): TreeFile {
  return {
    id: f.id,
    folderId: f.folderId,
    name: f.name,
    fileType: f.fileType,
    sizeBytes: 0,
    isShared: 1,
    sortOrder: 0,
    updatedAt: f.updatedAt,
    tags: [],
    state: { ...DEFAULT_FILE_STATE },
  };
}

/** OS 드래그의 폴더 항목을 재귀 순회해 상대 경로 목록으로 만든다 (IA — 폴더 업로드) */
async function collectFromEntries(
  entries: FileSystemEntry[],
): Promise<{ file: File; relPath: string }[]> {
  const out: { file: File; relPath: string }[] = [];
  async function walk(entry: FileSystemEntry, prefix: string) {
    if (entry.isFile) {
      const file = await new Promise<File>((res, rej) =>
        (entry as FileSystemFileEntry).file(res, rej),
      );
      out.push({ file, relPath: prefix + file.name });
    } else if (entry.isDirectory) {
      const reader = (entry as FileSystemDirectoryEntry).createReader();
      // readEntries는 한 번에 최대 100개만 준다 — 빈 배열이 올 때까지 반복
      for (;;) {
        const batch = await new Promise<FileSystemEntry[]>((res, rej) =>
          reader.readEntries(res, rej),
        );
        if (batch.length === 0) break;
        for (const child of batch) await walk(child, `${prefix}${entry.name}/`);
      }
    }
  }
  for (const e of entries) await walk(e, '');
  return out;
}

/** 딥링크 경로(/f/{id})에서 파일 ID 추출 (IA — URL 라우팅) */
function fileIdFromPath(pathname: string): number | null {
  const m = pathname.match(/^\/f\/(\d+)$/);
  return m ? Number(m[1]) : null;
}

// SCR-100: 워크스페이스 — 아이콘 레일 + 패널 + 본문(뷰어/편집기)
export default function Workspace({ user, onLogout }: { user: User; onLogout: () => void }) {
  const [tree, setTree] = useState<Tree>({ folders: [], files: [] });
  const [selected, setSelected] = useState<TreeFile | null>(null);
  const [panel, setPanel] = useState<Panel>('files');
  const [settings, setSettings] = useState<UserSettings>(DEFAULT_SETTINGS);
  const [tags, setTags] = useState<Tag[]>([]);
  const [tagFilter, setTagFilter] = useState<number | null>(null);
  const [tagEditorFile, setTagEditorFile] = useState<TreeFile | null>(null);
  const [sortBy, setSortBy] = useState<SortBy>('name');
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [panelCollapsed, setPanelCollapsed] = useState(false); // 활성 레일 버튼 재클릭 시 패널 접기 (PC 전용)
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [immersive, setImmersive] = useState(false); // 몰입 모드: 레일·패널·헤더 숨기고 본문만
  const [uploadProgress, setUploadProgress] = useState<number | null>(null);
  const [checked, setChecked] = useState<Set<number>>(new Set()); // 다중 선택된 파일 id
  const [movePickerOpen, setMovePickerOpen] = useState(false); // 일괄 이동 폴더 선택 모달
  const [trashOpen, setTrashOpen] = useState(false); // 휴지통 모달
  // 보기 모드는 기기별 취향이라 서버 설정이 아니라 localStorage에 둔다
  const [viewMode, setViewMode] = useState<'list' | 'grid'>(() =>
    localStorage.getItem('dv_viewmode') === 'grid' ? 'grid' : 'list',
  );
  const [changelogContent, setChangelogContent] = useState<string | null>(null); // 패치노트 모달
  const [newVersionReady, setNewVersionReady] = useState(false); // 서버에 새 버전 배포됨
  const uploadRef = useRef<HTMLInputElement>(null);
  const dirUploadRef = useRef<HTMLInputElement | null>(null);
  const uploadFolderRef = useRef<number | null>(null);
  const treeRef = useRef<Tree>(tree);
  const dirtyRef = useRef(false); // 편집기의 미저장 변경 여부 — 파일 전환 가드용

  const loadTree = useCallback(async (): Promise<Tree | null> => {
    const t = await api<Tree>('/tree').catch(() => null);
    if (t) {
      setTree(t);
      treeRef.current = t;
      // 이름변경·이동이 반영되도록 선택 파일을 새 트리와 동기화.
      // 트리에 없으면(공유 파일 열람 중) 선택을 유지한다 — 삭제는 deleteFile에서 직접 해제
      setSelected((prev) => (prev ? (t.files.find((f) => f.id === prev.id) ?? prev) : null));
    }
    return t;
  }, []);

  const loadTags = useCallback(async () => {
    const r = await api<{ tags: Tag[] }>('/tags').catch(() => null);
    if (r) setTags(r.tags);
  }, []);

  /** 트리 밖 파일(공유·타 사용자)도 메타 조회로 열 수 있게 한다 */
  const resolveFile = useCallback(async (id: number): Promise<TreeFile | null> => {
    const inTree = treeRef.current.files.find((f) => f.id === id);
    if (inTree) return inTree;
    const meta = await api<Omit<TreeFile, 'tags' | 'state'>>(`/files/${id}`).catch(() => null);
    return meta
      ? { ...meta, tags: [], state: { ...DEFAULT_FILE_STATE } }
      : null;
  }, []);

  // 초기 로드 + 딥링크(/f/{id}) 복원
  useEffect(() => {
    void (async () => {
      await Promise.all([loadTree(), loadTags()]);
      const id = fileIdFromPath(location.pathname);
      if (id !== null) {
        const f = await resolveFile(id);
        if (f) setSelected(f);
      }
    })();
    void api<{ settings: UserSettings }>('/me/settings')
      .then(({ settings }) => {
        setSettings(settings);
        // 새 버전 이후 첫 로그인이면 패치노트를 한 번 보여준다 (확인 시 기록 → 기기 간 공유)
        if (settings.lastSeenVersion !== __APP_VERSION__) {
          void api<Changelog>('/changelog')
            .then(({ content }) => content && setChangelogContent(content))
            .catch(() => {});
        }
      })
      .catch(() => {});
  }, [loadTree, loadTags, resolveFile]);

  // 서버가 새 버전으로 배포됐는지 감시 — 탭 복귀 시 + 10분 주기
  useEffect(() => {
    const check = () =>
      void api<{ version: string }>('/health')
        .then(({ version }) => {
          if (version !== __APP_VERSION__) setNewVersionReady(true);
        })
        .catch(() => {});
    const onVisible = () => document.visibilityState === 'visible' && check();
    const timer = window.setInterval(check, 10 * 60 * 1000);
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, []);

  function closeChangelog() {
    setChangelogContent(null);
    if (settings.lastSeenVersion !== __APP_VERSION__) {
      changeSettings({ lastSeenVersion: __APP_VERSION__ });
    }
  }

  function showChangelog() {
    void api<Changelog>('/changelog')
      .then(({ content }) => setChangelogContent(content || '아직 기록이 없습니다.'))
      .catch(() => toast('업데이트 기록을 불러오지 못했습니다', 'error'));
  }

  // 뒤로가기/앞으로가기
  useEffect(() => {
    const handler = () => {
      const id = fileIdFromPath(location.pathname);
      if (id === null) setSelected(null);
      else void resolveFile(id).then((f) => f && setSelected(f));
    };
    window.addEventListener('popstate', handler);
    return () => window.removeEventListener('popstate', handler);
  }, [resolveFile]);

  /** 파일 선택 — 미저장 편집 확인 → URL 갱신 → 모바일 드로어 닫기 */
  const selectFile = useCallback(async (file: TreeFile) => {
    if (dirtyRef.current) {
      const ok = await confirmDialog('저장하지 않은 변경이 있습니다', {
        message: '이동하면 작성한 내용이 사라집니다.',
        danger: true,
      });
      if (!ok) return;
      dirtyRef.current = false;
    }
    setSelected(file);
    setDrawerOpen(false);
    if (location.pathname !== `/f/${file.id}`) {
      history.pushState(null, '', `/f/${file.id}`);
    }
  }, []);

  /** 트리 조작 공통 래퍼: 에러는 토스트로, 성공하면 트리 재조회 */
  const guard = useCallback(
    async (fn: () => Promise<unknown>) => {
      try {
        await fn();
        await loadTree();
      } catch (e) {
        toast(e instanceof ApiError ? e.message : '작업에 실패했습니다', 'error');
      }
    },
    [loadTree],
  );

  /** 같은 폴더의 이름 충돌을 업로드 전에 해소한다 — 덮어쓰기/이름 변경/건너뛰기 (IA — 충돌 처리) */
  const resolveConflicts = useCallback(
    async (
      list: File[],
      folderId: number | null,
    ): Promise<{ toUpload: File[]; overwritten: number; skipped: number } | null> => {
      const inFolder = treeRef.current.files.filter((f) => f.folderId === folderId);
      const names = new Set(inFolder.map((f) => f.name));
      const conflicts = list.filter((f) => names.has(f.name));
      if (conflicts.length === 0) return { toUpload: list, overwritten: 0, skipped: 0 };

      const preview = conflicts.slice(0, 5).map((f) => f.name).join(', ');
      const choice = await choiceDialog(`이름이 같은 파일이 ${conflicts.length}개 있습니다`, {
        message: preview + (conflicts.length > 5 ? ` 외 ${conflicts.length - 5}개` : ''),
        choices: [
          { label: '덮어쓰기 — 문서는 이전 내용을 버전으로 보관합니다', value: 'overwrite' },
          { label: '이름 바꿔 저장 — "이름 (2)" 형식으로 나란히 둡니다', value: 'rename' },
          { label: '건너뛰기 — 충돌한 파일만 빼고 올립니다', value: 'skip' },
        ],
      });
      if (choice === null) return null; // 업로드 전체 취소

      if (choice === 'skip') {
        return {
          toUpload: list.filter((f) => !names.has(f.name)),
          overwritten: 0,
          skipped: conflicts.length,
        };
      }

      if (choice === 'rename') {
        const used = new Set(names);
        const renamed = list.map((f) => {
          if (!used.has(f.name)) {
            used.add(f.name);
            return f;
          }
          const dot = f.name.lastIndexOf('.');
          const stem = dot > 0 ? f.name.slice(0, dot) : f.name;
          const ext = dot > 0 ? f.name.slice(dot) : '';
          let n = 2;
          while (used.has(`${stem} (${n})${ext}`)) n++;
          const name = `${stem} (${n})${ext}`;
          used.add(name);
          return new File([f], name, { type: f.type });
        });
        return { toUpload: renamed, overwritten: 0, skipped: 0 };
      }

      // 덮어쓰기
      let overwritten = 0;
      const remain: File[] = [];
      for (const f of list) {
        const existing = inFolder.find((x) => x.name === f.name);
        if (!existing) {
          remain.push(f);
          continue;
        }
        if (existing.fileType === 'image' || existing.fileType === 'pdf') {
          // 바이너리는 본문 교체 API가 없어 삭제 후 재업로드 (버전이 없는 형식이라 대체와 동일)
          await api(`/files/${existing.id}`, { method: 'DELETE' });
          remain.push(f);
        } else {
          // 문서는 저장 API로 교체 — 이전 내용이 버전 스냅샷으로 남는다
          await api(`/files/${existing.id}/content`, {
            method: 'PUT',
            body: JSON.stringify({ content: await f.text(), baseUpdatedAt: existing.updatedAt }),
          });
          overwritten++;
        }
      }
      return { toUpload: remain, overwritten, skipped: 0 };
    },
    [],
  );

  /** 충돌 해소 후 실제 업로드까지. 토스트·트리 갱신은 호출자 몫 (여러 폴더에 걸친 업로드 대비) */
  const uploadCore = useCallback(
    async (list: File[], folderId: number | null) => {
      const resolved = await resolveConflicts(list, folderId);
      if (resolved === null) return null;
      let created: TreeFile[] = [];
      if (resolved.toUpload.length > 0) {
        const fd = new FormData();
        for (const f of resolved.toUpload) fd.append('files', f);
        if (folderId !== null) fd.append('folderId', String(folderId));
        created = (await uploadFiles(fd, setUploadProgress)).files;
      }
      return { created, overwritten: resolved.overwritten, skipped: resolved.skipped };
    },
    [resolveConflicts],
  );

  const summarize = (created: number, overwritten: number, skipped: number) => {
    const parts: string[] = [];
    if (created) parts.push(`${created}개 업로드`);
    if (overwritten) parts.push(`${overwritten}개 덮어씀`);
    if (skipped) parts.push(`${skipped}개 건너뜀`);
    return parts.join(' · ');
  };

  const doUpload = useCallback(
    async (fileList: FileList | File[], folderId: number | null) => {
      const list = [...fileList];
      if (list.length === 0) return;
      setUploadProgress(0);
      try {
        const r = await uploadCore(list, folderId);
        if (r === null) return; // 충돌 대화상자에서 취소
        await loadTree();
        toast(
          summarize(r.created.length, r.overwritten, r.skipped) || '업로드한 파일이 없습니다',
          r.created.length || r.overwritten ? 'success' : 'info',
        );
        if (r.created[0]) void selectFile(r.created[0]);
      } catch (e) {
        toast(e instanceof ApiError ? e.message : '업로드에 실패했습니다', 'error');
      } finally {
        setUploadProgress(null);
      }
    },
    [loadTree, selectFile, uploadCore],
  );

  /** "a/b" 경로의 폴더 체인을 보장하고 마지막 폴더 id를 돌려준다 — 기존 폴더는 재사용 */
  const ensureFolderPath = useCallback(
    async (segments: string[], baseId: number | null, cache: Map<string, number>) => {
      let parentId: number | null = baseId;
      let key = `${baseId ?? 'root'}`;
      for (const seg of segments) {
        key += `/${seg}`;
        const cached = cache.get(key);
        if (cached !== undefined) {
          parentId = cached;
          continue;
        }
        const existing = treeRef.current.folders.find(
          (f) => f.parentId === parentId && f.name === seg,
        );
        let id: number;
        if (existing) {
          id = existing.id;
        } else {
          const { folder } = await api<{ folder: { id: number } }>('/folders', {
            method: 'POST',
            body: JSON.stringify({ name: seg, parentId }),
          });
          id = folder.id;
        }
        cache.set(key, id);
        parentId = id;
      }
      return parentId;
    },
    [],
  );

  /** 폴더 업로드 — 상대 경로대로 폴더 체인을 만들고 폴더별로 올린다 (IA — 폴더 업로드) */
  const doUploadTree = useCallback(
    async (items: { file: File; relPath: string }[], baseId: number | null) => {
      if (items.length === 0) return;
      setUploadProgress(0);
      try {
        // 폴더 경로별로 파일을 묶는다 ('' = 드롭 지점 바로 아래)
        const groups = new Map<string, File[]>();
        for (const it of items) {
          const slash = it.relPath.lastIndexOf('/');
          const dir = slash === -1 ? '' : it.relPath.slice(0, slash);
          groups.set(dir, [...(groups.get(dir) ?? []), it.file]);
        }
        const cache = new Map<string, number>();
        let created = 0;
        let overwritten = 0;
        let skipped = 0;
        for (const [dir, group] of groups) {
          const folderId = dir === '' ? baseId : await ensureFolderPath(dir.split('/'), baseId, cache);
          const r = await uploadCore(group, folderId);
          if (r === null) break; // 취소 — 이미 만든 폴더·올린 파일은 유지
          created += r.created.length;
          overwritten += r.overwritten;
          skipped += r.skipped;
        }
        await loadTree();
        toast(
          summarize(created, overwritten, skipped)
            ? `폴더 업로드 완료 — ${summarize(created, overwritten, skipped)}`
            : '업로드한 파일이 없습니다',
          created || overwritten ? 'success' : 'info',
        );
      } catch (e) {
        toast(e instanceof ApiError ? e.message : '폴더 업로드에 실패했습니다', 'error');
      } finally {
        setUploadProgress(null);
      }
    },
    [ensureFolderPath, uploadCore, loadTree],
  );

  /** 드롭된 DataTransfer 처리 — 폴더가 섞여 있으면 구조째, 아니면 평면 업로드.
   *  entries는 드롭 이벤트 스택 안에서 동기로 수집해야 유효하다. */
  const uploadDropped = useCallback(
    (dt: DataTransfer, folderId: number | null) => {
      const entries = [...dt.items]
        .map((it) => (it.kind === 'file' ? it.webkitGetAsEntry() : null))
        .filter((x): x is FileSystemEntry => x !== null);
      if (entries.some((en) => en.isDirectory)) {
        void collectFromEntries(entries).then((items) => doUploadTree(items, folderId));
      } else {
        void doUpload([...dt.files], folderId);
      }
    },
    [doUpload, doUploadTree],
  );

  // 트리가 갱신되면 사라진 파일을 선택 목록에서도 정리한다
  useEffect(() => {
    setChecked((prev) => {
      if (prev.size === 0) return prev;
      const ids = new Set(tree.files.map((f) => f.id));
      const next = new Set([...prev].filter((id) => ids.has(id)));
      return next.size === prev.size ? prev : next;
    });
  }, [tree.files]);

  // 클립보드 붙여넣기 업로드 (IA — 업로드 UX): 입력 요소 밖의 Ctrl+V만 가로챈다
  useEffect(() => {
    const PASTE_EXT: Record<string, string> = {
      'image/png': 'png',
      'image/jpeg': 'jpg',
      'image/gif': 'gif',
      'image/webp': 'webp',
      'image/svg+xml': 'svg',
    };
    const handler = (e: ClipboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
      const stamp = new Date()
        .toISOString()
        .slice(0, 19)
        .replace('T', ' ')
        .replaceAll(':', '-');
      const pasted = e.clipboardData?.files;
      if (pasted && pasted.length > 0) {
        e.preventDefault();
        // 스크린샷 등 이름 없는 클립보드 이미지에는 시각 기반 이름을 붙인다
        const renamed = [...pasted].map((f, i) => {
          const ext = PASTE_EXT[f.type];
          if (!ext) return f;
          const suffix = pasted.length > 1 ? `-${i + 1}` : '';
          return new File([f], `붙여넣기 ${stamp}${suffix}.${ext}`, { type: f.type });
        });
        void doUpload(renamed, null);
        return;
      }
      const text = e.clipboardData?.getData('text/plain');
      if (text && text.trim().length > 0) {
        e.preventDefault();
        void promptDialog('붙여넣은 텍스트로 새 문서 만들기 — 파일 이름', `붙여넣기 ${stamp}.md`).then(
          (name) => {
            const trimmed = name?.trim();
            if (!trimmed) return;
            const final = /\.(md|markdown|txt|html)$/i.test(trimmed) ? trimmed : `${trimmed}.md`;
            void doUpload([new File([text], final, { type: 'text/markdown' })], null);
          },
        );
      }
    };
    window.addEventListener('paste', handler);
    return () => window.removeEventListener('paste', handler);
  }, [doUpload]);

  // 앱 어디에 놓아도 업로드: 브라우저 기본 동작(파일을 새 탭으로 열기)을 막고,
  // 트리 폴더 등 개별 드롭 존이 처리하지 않은 드롭은 전부 최상위 업로드로 받는다
  useEffect(() => {
    const over = (e: DragEvent) => {
      if (e.dataTransfer?.types.includes('Files')) e.preventDefault();
    };
    const drop = (e: DragEvent) => {
      if (!e.dataTransfer?.types.includes('Files')) return;
      if (e.defaultPrevented) return; // 개별 드롭 존이 이미 처리함
      e.preventDefault();
      uploadDropped(e.dataTransfer, null);
    };
    window.addEventListener('dragover', over);
    window.addEventListener('drop', drop);
    return () => {
      window.removeEventListener('dragover', over);
      window.removeEventListener('drop', drop);
    };
  }, [uploadDropped]);

  // Ctrl+K: 커맨드 팔레트 (IA — 단축키)
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setPaletteOpen((open) => !open);
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

  // Escape로 몰입 모드 종료
  useEffect(() => {
    if (!immersive) return;
    const handler = (e: KeyboardEvent) => e.key === 'Escape' && setImmersive(false);
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [immersive]);

  const actions: TreeActions = {
    createFolder: (parentId) => {
      void promptDialog('폴더 이름').then((name) => {
        if (!name?.trim()) return;
        void guard(() =>
          api('/folders', { method: 'POST', body: JSON.stringify({ name: name.trim(), parentId }) }),
        );
      });
    },
    renameFolder: (id, name) =>
      void guard(() => api(`/folders/${id}`, { method: 'PUT', body: JSON.stringify({ name }) })),
    moveFolder: (id, parentId) => {
      const prev = treeRef.current.folders.find((f) => f.id === id)?.parentId ?? null;
      if (prev === parentId) return;
      void guard(async () => {
        await api(`/folders/${id}`, { method: 'PUT', body: JSON.stringify({ parentId }) });
        toast('폴더를 이동했습니다', 'success', {
          action: {
            label: '실행 취소',
            onAction: () =>
              void guard(() =>
                api(`/folders/${id}`, { method: 'PUT', body: JSON.stringify({ parentId: prev }) }),
              ),
          },
        });
      });
    },
    deleteFolder: (id) => {
      void confirmDialog('폴더를 삭제할까요?', {
        message: '폴더 구조는 삭제되고, 안의 파일은 휴지통으로 이동합니다.',
        danger: true,
      }).then((ok) => {
        if (ok) void guard(() => api(`/folders/${id}`, { method: 'DELETE' }));
      });
    },
    renameFile: (id, name) =>
      void guard(() => api(`/files/${id}`, { method: 'PUT', body: JSON.stringify({ name }) })),
    moveFile: (id, folderId) => {
      const prev = treeRef.current.files.find((f) => f.id === id)?.folderId ?? null;
      if (prev === folderId) return;
      void guard(async () => {
        await api(`/files/${id}`, { method: 'PUT', body: JSON.stringify({ folderId }) });
        toast('파일을 이동했습니다', 'success', {
          action: {
            label: '실행 취소',
            onAction: () =>
              void guard(() =>
                api(`/files/${id}`, { method: 'PUT', body: JSON.stringify({ folderId: prev }) }),
              ),
          },
        });
      });
    },
    // 삭제는 확인 없이 휴지통으로 — 실행 취소(복원)가 안전망이라 대화상자보다 빠르고 안전하다
    deleteFile: (id) => {
      if (selected?.id === id) {
        setSelected(null);
        history.replaceState(null, '', '/');
      }
      void guard(async () => {
        await api(`/files/${id}`, { method: 'DELETE' });
        toast('휴지통으로 이동했습니다', 'success', {
          action: {
            label: '실행 취소',
            onAction: () => void guard(() => api(`/files/${id}/restore`, { method: 'POST' })),
          },
        });
      });
    },
    copyFile: (id) => void guard(() => api(`/files/${id}/copy`, { method: 'POST' })),
    downloadFile: (file) => downloadFile(file.id, file.name),
    downloadFolder: (folder) => downloadArchive({ folderIds: [folder.id] }),
    uploadTo: (folderId) => {
      uploadFolderRef.current = folderId;
      uploadRef.current?.click();
    },
    uploadDropped,
    moveFiles: (ids, folderId) => {
      setChecked(new Set());
      moveMany(ids, folderId);
    },
    editTags: setTagEditorFile,
    shareFile: (file) =>
      void guard(() =>
        api(`/files/${file.id}/share`, {
          method: 'PUT',
          body: JSON.stringify({ isShared: file.isShared !== 1 }),
        }),
      ),
    shareFolder: (folder) =>
      void guard(() =>
        api(`/folders/${folder.id}/share`, {
          method: 'PUT',
          body: JSON.stringify({ isShared: folder.isShared !== 1 }),
        }),
      ),
  };

  /** 여러 파일 이동 — 이전 위치를 기억해 실행 취소 제공 (IA — 다중 선택) */
  const moveMany = useCallback(
    (ids: number[], folderId: number | null) => {
      const prevMap = new Map(
        ids.map((id) => [id, treeRef.current.files.find((f) => f.id === id)?.folderId ?? null]),
      );
      const moving = ids.filter((id) => prevMap.get(id) !== folderId);
      if (moving.length === 0) return;
      void guard(async () => {
        for (const id of moving) {
          await api(`/files/${id}`, { method: 'PUT', body: JSON.stringify({ folderId }) });
        }
        toast(`${moving.length}개 파일을 이동했습니다`, 'success', {
          action: {
            label: '실행 취소',
            onAction: () =>
              void guard(async () => {
                for (const id of moving) {
                  await api(`/files/${id}`, {
                    method: 'PUT',
                    body: JSON.stringify({ folderId: prevMap.get(id) ?? null }),
                  });
                }
              }),
          },
        });
      });
    },
    [guard],
  );

  function bulkMove(folderId: number | null) {
    const ids = [...checked];
    setMovePickerOpen(false);
    setChecked(new Set());
    moveMany(ids, folderId);
  }

  function bulkDelete() {
    const ids = [...checked];
    if (selected && checked.has(selected.id)) {
      setSelected(null);
      history.replaceState(null, '', '/');
    }
    setChecked(new Set());
    void guard(async () => {
      for (const id of ids) await api(`/files/${id}`, { method: 'DELETE' });
      toast(`${ids.length}개 파일을 휴지통으로 이동했습니다`, 'success', {
        action: {
          label: '실행 취소',
          onAction: () =>
            void guard(async () => {
              for (const id of ids) await api(`/files/${id}/restore`, { method: 'POST' });
            }),
        },
      });
    });
  }

  function toggleFavorite(file: TreeFile) {
    void guard(() =>
      api(`/me/files/${file.id}/state`, {
        method: 'PUT',
        body: JSON.stringify({ isFavorite: file.state.isFavorite !== 1 }),
      }),
    );
  }

  function changeSettings(patch: Partial<UserSettings>) {
    // 실시간 미리보기: 화면에 즉시 반영하고 서버에는 바로 저장 (SCR-141)
    setSettings((prev) => ({ ...prev, ...patch }));
    void api('/me/settings', { method: 'PUT', body: JSON.stringify(patch) }).catch(() => {});
  }

  async function handleLogout() {
    await api('/auth/logout', { method: 'POST' }).catch(() => {});
    onLogout();
  }

  // 정렬 (SCR-111) + 태그 필터를 적용한 트리 데이터
  const visibleFiles = useMemo(() => {
    const filtered =
      tagFilter === null ? tree.files : tree.files.filter((f) => f.tags.includes(tagFilter));
    return [...filtered].sort((a, b) =>
      sortBy === 'name' ? a.name.localeCompare(b.name, 'ko') : b.updatedAt - a.updatedAt,
    );
  }, [tree.files, tagFilter, sortBy]);
  const sortedFolders = useMemo(
    () => [...tree.folders].sort((a, b) => a.name.localeCompare(b.name, 'ko')),
    [tree.folders],
  );

  const railButton = (target: Panel, icon: string, label: string) => (
    <button
      onClick={() => {
        // VS Code 방식: 활성 패널의 버튼을 다시 누르면 패널을 접는다
        if (panel === target) setPanelCollapsed((v) => !v);
        else {
          setPanel(target);
          setPanelCollapsed(false);
        }
      }}
      title={label}
      className={`flex h-10 w-10 items-center justify-center rounded-lg text-lg transition ${
        panel === target && !panelCollapsed
          ? 'bg-slate-800 text-slate-100'
          : 'text-slate-500 hover:text-slate-200'
      }`}
    >
      {icon}
    </button>
  );

  return (
    <div className="flex h-dvh bg-slate-950 text-slate-100">
      {/* 터치 기기: 드로어 토글 (입력 방식 기준 — 가로모드에서도 드로어 유지) */}
      <button
        onClick={() => setDrawerOpen(true)}
        className={`fixed left-3 top-2 z-20 rounded-md border border-slate-800 bg-slate-900/90 px-2.5 py-1 text-slate-300 pc:hidden ${immersive ? 'hidden' : ''}`}
      >
        ☰
      </button>
      {drawerOpen && (
        <div className="fixed inset-0 z-30 bg-black/50 pc:hidden" onClick={() => setDrawerOpen(false)} />
      )}

      <div
        className={`z-40 flex shrink-0 bg-slate-950 touch:fixed touch:inset-y-0 touch:left-0 touch:transition-transform ${
          drawerOpen ? '' : 'touch:-translate-x-full'
        } ${immersive ? 'hidden' : ''}`}
      >
      {/* 아이콘 레일 — 유일한 전역 내비게이션 (IA) */}
      <div className="flex w-12 shrink-0 flex-col items-center gap-1 border-r border-slate-800 py-3">
        {railButton('files', '📄', '내 파일')}
        {railButton('favorites', '★', '즐겨찾기')}
        {railButton('shared', '🔗', '공유 파일')}
        {railButton('settings', '⚙', '설정')}
        {user.role === 'admin' && railButton('admin', '🛠', '관리자')}
        <button
          onClick={handleLogout}
          title={`로그아웃 (${user.displayName ?? user.username})`}
          className="mt-auto flex h-10 w-10 items-center justify-center rounded-lg text-lg text-slate-600 transition hover:text-slate-300"
        >
          ⏻
        </button>
      </div>

      {/* 접힘은 PC 전용 — 터치 드로어에서는 패널이 곧 내비게이션이라 항상 펼친다 */}
      <aside
        className={`flex w-72 shrink-0 flex-col border-r border-slate-800 ${panelCollapsed ? 'pc:hidden' : ''}`}
      >
        <div className="flex items-center gap-2 px-4 py-3">
          <h1 className="text-sm font-bold tracking-tight">{PANEL_TITLE[panel]}</h1>
          <span className="ml-auto truncate text-xs text-slate-600">
            {user.displayName ?? user.username}
          </span>
        </div>

        {panel === 'files' && (
          <>
            <div className="flex gap-2 px-3">
              <input
                ref={uploadRef}
                type="file"
                multiple
                accept=".md,.markdown,.html,.txt,.png,.jpg,.jpeg,.gif,.webp,.svg,.pdf"
                className="hidden"
                onChange={(e) => {
                  const folderId = uploadFolderRef.current;
                  uploadFolderRef.current = null;
                  if (e.target.files) void doUpload(e.target.files, folderId);
                  e.target.value = '';
                }}
              />
              <button
                onClick={() => actions.uploadTo(null)}
                title="md·html·txt·이미지·PDF"
                className="flex-1 rounded-md border border-dashed border-slate-700 py-2 text-sm text-slate-400 transition hover:border-slate-500 hover:text-slate-200"
              >
                + 업로드
              </button>
              <button
                onClick={() => actions.createFolder(null)}
                className="rounded-md border border-dashed border-slate-700 px-3 text-sm text-slate-400 transition hover:border-slate-500 hover:text-slate-200"
              >
                + 폴더
              </button>
            </div>
            {/* webkitdirectory는 React 타입에 없어 ref에서 DOM 속성으로 직접 지정한다 */}
            <input
              ref={(el) => {
                dirUploadRef.current = el;
                el?.setAttribute('webkitdirectory', '');
              }}
              type="file"
              multiple
              className="hidden"
              onChange={(e) => {
                const fl = e.target.files;
                if (fl && fl.length > 0) {
                  const items = [...fl].map((f) => ({
                    file: f,
                    relPath: f.webkitRelativePath || f.name,
                  }));
                  void doUploadTree(items, null);
                }
                e.target.value = '';
              }}
            />
            <button
              onClick={() => dirUploadRef.current?.click()}
              title="폴더를 하위 구조 그대로 업로드합니다"
              className="mx-3 mt-1.5 hidden rounded-md border border-dashed border-slate-800 py-1 text-xs text-slate-500 transition hover:border-slate-600 hover:text-slate-300 pc:block"
            >
              📂 폴더째 업로드
            </button>
            {uploadProgress !== null && (
              <div className="mx-3 mt-2 h-1 overflow-hidden rounded bg-slate-800">
                <div
                  className="h-full bg-sky-500 transition-all"
                  style={{ width: `${uploadProgress}%` }}
                />
              </div>
            )}
            <div className="mt-2 flex items-start gap-1 px-3">
              {tags.length > 0 && (
                <div className="flex min-w-0 flex-1 flex-wrap gap-1">
                  <button
                    onClick={() => setTagFilter(null)}
                    className={`rounded-full px-2 py-0.5 text-[11px] transition ${
                      tagFilter === null ? 'bg-slate-700 text-slate-100' : 'text-slate-500 hover:text-slate-300'
                    }`}
                  >
                    전체
                  </button>
                  {tags.map((tag) => (
                    <button
                      key={tag.id}
                      onClick={() => setTagFilter((cur) => (cur === tag.id ? null : tag.id))}
                      className={`flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] transition ${
                        tagFilter === tag.id ? 'bg-slate-700 text-slate-100' : 'text-slate-500 hover:text-slate-300'
                      }`}
                    >
                      <span className="h-1.5 w-1.5 rounded-full" style={{ background: tag.color }} />
                      {tag.name}
                    </button>
                  ))}
                </div>
              )}
              <select
                value={sortBy}
                onChange={(e) => setSortBy(e.target.value as SortBy)}
                title="정렬"
                className="ml-auto rounded border border-slate-800 bg-slate-900 px-1 py-0.5 text-[11px] text-slate-400 outline-none"
              >
                <option value="name">이름순</option>
                <option value="updated">최근 수정순</option>
              </select>
              <button
                onClick={() =>
                  setViewMode((m) => {
                    const next = m === 'list' ? 'grid' : 'list';
                    localStorage.setItem('dv_viewmode', next);
                    return next;
                  })
                }
                title={viewMode === 'list' ? '격자 보기' : '목록 보기'}
                className="rounded border border-slate-800 bg-slate-900 px-1.5 py-0.5 text-[11px] text-slate-400 hover:text-slate-200"
              >
                {viewMode === 'list' ? '▦' : '▤'}
              </button>
            </div>
            {checked.size > 0 && (
              <div className="mx-3 mt-2 flex items-center gap-2 rounded-md border border-sky-900 bg-sky-950/40 px-2 py-1.5 text-xs">
                <span className="font-medium text-sky-300">{checked.size}개 선택</span>
                <span className="ml-auto flex gap-1">
                  <button
                    onClick={() => downloadArchive({ fileIds: [...checked] })}
                    title="고른 파일을 ZIP 하나로 받기"
                    className="rounded border border-slate-700 px-2 py-0.5 text-slate-300 hover:bg-slate-800"
                  >
                    다운로드
                  </button>
                  <button
                    onClick={() => setMovePickerOpen(true)}
                    className="rounded border border-slate-700 px-2 py-0.5 text-slate-300 hover:bg-slate-800"
                  >
                    이동
                  </button>
                  <button
                    onClick={bulkDelete}
                    className="rounded border border-red-900 px-2 py-0.5 text-red-400 hover:bg-red-950"
                  >
                    삭제
                  </button>
                  <button
                    onClick={() => setChecked(new Set())}
                    title="선택 해제"
                    className="rounded px-1.5 py-0.5 text-slate-500 hover:text-slate-200"
                  >
                    ✕
                  </button>
                </span>
              </div>
            )}
            <nav className="mt-3 min-h-0 flex-1 overflow-auto px-2 pb-4">
              <RecentList files={tree.files} onSelect={(f) => void selectFile(f)} />
              {viewMode === 'grid' ? (
                <FileGrid
                  files={visibleFiles}
                  folders={sortedFolders}
                  selectedId={selected?.id ?? null}
                  onSelect={(f) => void selectFile(f)}
                />
              ) : (
                <FileTree
                  folders={sortedFolders}
                  files={visibleFiles}
                  tags={tags}
                  isAdmin={user.role === 'admin'}
                  selectedId={selected?.id ?? null}
                  onSelect={(f) => void selectFile(f)}
                  actions={actions}
                  checked={checked}
                  onCheckChange={setChecked}
                />
              )}
            </nav>
            <button
              onClick={() => setTrashOpen(true)}
              className="mx-3 mb-3 flex shrink-0 items-center gap-1.5 rounded-md px-2 py-1.5 text-left text-xs text-slate-500 transition hover:bg-slate-900 hover:text-slate-300"
            >
              🗑 휴지통
            </button>
          </>
        )}

        {panel === 'favorites' && (
          <FavoritesPanel
            files={tree.files}
            selectedId={selected?.id ?? null}
            onSelect={(f) => void selectFile(f)}
          />
        )}

        {panel === 'shared' && (
          <SharedPanel
            selectedId={selected?.id ?? null}
            onSelect={(f) => void selectFile(sharedToTreeFile(f))}
          />
        )}

        {panel === 'settings' && (
          <SettingsPanel settings={settings} onChange={changeSettings} onShowChangelog={showChangelog} />
        )}

        {panel === 'admin' && user.role === 'admin' && (
          <AdminPanel meId={user.id} onSelectFile={(f) => void selectFile(f)} />
        )}
      </aside>
      </div>

      {/* OS 드롭 업로드는 window 전역 핸들러가 받는다 — 트리 폴더 위 드롭만 개별 처리 */}
      <main className="min-w-0 flex-1">
        {selected ? (
          <Viewer
            file={selected}
            settings={settings}
            immersive={immersive}
            onToggleImmersive={() => setImmersive((v) => !v)}
            onContentSaved={() => void loadTree()}
            onStateChanged={() => void loadTree()}
            onToggleFavorite={toggleFavorite}
            onDirtyChange={(d) => (dirtyRef.current = d)}
          />
        ) : (
          <div className="flex h-full flex-col items-center justify-center gap-2 text-sm text-slate-600">
            <p>좌측에서 파일을 선택하거나, 여기로 파일을 끌어다 놓으세요</p>
            <p>
              <span className="rounded border border-slate-800 px-1.5 py-0.5 text-xs">Ctrl+K</span>{' '}
              검색
            </p>
          </div>
        )}
      </main>

      {paletteOpen && (
        <CommandPalette
          files={tree.files}
          onPick={(f) => void selectFile(f)}
          onClose={() => setPaletteOpen(false)}
        />
      )}

      {trashOpen && (
        <TrashPanel onChanged={() => void loadTree()} onClose={() => setTrashOpen(false)} />
      )}

      {movePickerOpen && (
        <FolderPicker
          folders={sortedFolders}
          title={`${checked.size}개 파일을 이동할 폴더`}
          onPick={bulkMove}
          onClose={() => setMovePickerOpen(false)}
        />
      )}

      {tagEditorFile && (
        <TagEditor
          file={tagEditorFile}
          tags={tags}
          onChanged={() => {
            void loadTags();
            void loadTree();
          }}
          onClose={() => setTagEditorFile(null)}
        />
      )}

      {changelogContent !== null && (
        <UpdateNotes content={changelogContent} onClose={closeChangelog} />
      )}

      {newVersionReady && (
        <div className="fixed bottom-4 right-4 z-40 flex items-center gap-3 rounded-lg border border-sky-800 bg-slate-900 px-4 py-2.5 shadow-xl">
          <span className="text-sm text-slate-200">새 버전이 배포되었습니다</span>
          <button
            onClick={() => location.reload()}
            className="rounded-md bg-sky-600 px-3 py-1 text-sm font-medium text-white hover:bg-sky-500"
          >
            새로고침
          </button>
        </div>
      )}
    </div>
  );
}
