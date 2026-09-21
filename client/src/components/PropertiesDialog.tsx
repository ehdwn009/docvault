import { useEffect, useState, type ReactNode } from 'react';
import { api, ApiError, type FileInfo, type FolderInfo, type Tag, type TreeFile, type TreeFolder } from '../lib/api';
import { toast } from '../lib/toast';
import Icon from './Icon';

export type PropertiesTarget = { kind: 'file'; file: TreeFile } | { kind: 'folder'; folder: TreeFolder };

type Props = {
  target: PropertiesTarget;
  tags: Tag[];
  isPc: boolean;
  onClose: () => void;
  /** 이름 칸의 연필 — 트리의 이름 변경과 같은 동작을 부른다 */
  onRename: (name: string) => void;
  /** 위치를 누르면 그 폴더를 트리에서 고른다 */
  onGoFolder: (folderId: number | null) => void;
};

const TYPE_LABEL: Record<string, string> = {
  md: '마크다운 문서', html: 'HTML 문서', code: '코드', text: '텍스트', image: '이미지', pdf: 'PDF', audio: '오디오', video: '비디오', binary: '파일',
};

export function formatBytes(n: number): string {
  if (n < 1024) return `${n}B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)}KB`;
  return `${(n / 1024 / 1024).toFixed(1)}MB`;
}

function when(ts: number | null | undefined): string {
  if (!ts) return '—';
  const d = new Date(ts);
  const diff = Date.now() - ts;
  const rel = diff < 60_000 ? '방금' : diff < 3_600_000 ? `${Math.floor(diff / 60_000)}분 전` : diff < 86_400_000 ? `${Math.floor(diff / 3_600_000)}시간 전` : diff < 30 * 86_400_000 ? `${Math.floor(diff / 86_400_000)}일 전` : '';
  return `${d.toLocaleString()}${rel ? ` (${rel})` : ''}`;
}

// SCR-113: 속성창 — 윈도우의 "속성"처럼 파일·폴더 하나의 사실을 한 자리에. 폰은 아래에서 올라오는 시트, PC는 가운데 창.
// 이름은 여기서 바로 고친다. 위치를 누르면 그 폴더로 간다
export default function PropertiesDialog({ target, tags, isPc, onClose, onRename, onGoFolder }: Props) {
  const [fileInfo, setFileInfo] = useState<FileInfo | null>(null);
  const [folderInfo, setFolderInfo] = useState<FolderInfo | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const name = target.kind === 'file' ? target.file.name : target.folder.name;
  const [draft, setDraft] = useState(name);

  useEffect(() => {
    setError(null);
    const url = target.kind === 'file' ? `/files/${target.file.id}/info` : `/folders/${target.folder.id}/info`;
    api<FileInfo | FolderInfo>(url)
      .then((r) => (target.kind === 'file' ? setFileInfo(r as FileInfo) : setFolderInfo(r as FolderInfo)))
      .catch((e: unknown) => setError(e instanceof ApiError ? e.message : '속성을 불러오지 못했습니다'));
  }, [target]);

  function saveName() {
    const next = draft.trim();
    setEditing(false);
    if (!next || next === name) return;
    onRename(next);
    toast('이름을 바꿨습니다');
  }

  const path = (p: { id: number; name: string }[]) => (
    <span className="flex flex-wrap items-center gap-x-1">
      <button onClick={() => onGoFolder(null)} className="text-sky-400 hover:underline">내 파일</button>
      {p.map((f) => (
        <span key={f.id} className="flex items-center gap-x-1">
          <span className="text-slate-600">/</span>
          <button onClick={() => onGoFolder(f.id)} className="text-sky-400 hover:underline">{f.name}</button>
        </span>
      ))}
    </span>
  );

  const row = (label: string, value: ReactNode) => (
    <>
      <dt className="text-slate-500">{label}</dt>
      <dd className="min-w-0 break-words text-slate-200">{value}</dd>
    </>
  );
  const section = (label: string) => <div className="col-span-2 mt-1 border-t border-slate-800 pt-1.5 text-[11px] font-semibold tracking-wide text-slate-500">{label}</div>;

  const nameRow = row(
    '이름',
    editing ? (
      <form
        onSubmit={(e) => {
          e.preventDefault();
          saveName();
        }}
        className="flex items-center gap-1"
      >
        <input autoFocus value={draft} onChange={(e) => setDraft(e.target.value)} onBlur={saveName} className="min-w-0 flex-1 rounded border border-slate-600 bg-slate-950 px-1.5 py-0.5 text-sm text-slate-100 focus:border-sky-600 focus:outline-none" />
      </form>
    ) : (
      <span className="flex items-center gap-1.5">
        <span className="break-all">{name}</span>
        <button onClick={() => { setDraft(name); setEditing(true); }} title="이름 바꾸기" className="shrink-0 text-slate-500 hover:text-slate-200">
          <Icon name="pencil" size={14} />
        </button>
      </span>
    ),
  );

  let body: ReactNode;
  if (error) body = <p className="text-sm text-red-300">{error}</p>;
  else if (target.kind === 'file') {
    const f = target.file;
    const i = fileInfo;
    const fileTags = tags.filter((t) => (i?.tagIds ?? f.tags).includes(t.id));
    body = (
      <dl className="grid grid-cols-[5.5rem_1fr] gap-x-3 gap-y-1.5 text-[13px]">
        {nameRow}
        {row('종류', `${TYPE_LABEL[f.fileType] ?? f.fileType} · ${formatBytes(f.sizeBytes)}`)}
        {row('위치', i ? path(i.path) : '…')}
        {section('시간')}
        {row('만든 날', when(i?.file.createdAt))}
        {row('마지막 수정', when(f.updatedAt))}
        {row('마지막 열람', i ? (i.lastOpenedAt ? when(i.lastOpenedAt) : '아직') : '…')}
        {i?.charCount !== null && i?.charCount !== undefined
          ? row('분량', `${i.charCount.toLocaleString()}자 · ${i.lineCount?.toLocaleString()}줄`)
          : i?.storagePath
            ? row('원본 위치', <code className="break-all text-xs text-slate-400">data/files/{i.storagePath}</code>)
            : null}
        {section('연결')}
        {row('버전', i ? `${i.versionCount}개` : '…')}
        {row('태그', fileTags.length ? (
          <span className="flex flex-wrap gap-1">
            {fileTags.map((t) => (
              <span key={t.id} className="rounded px-1.5 text-[11px] text-white" style={{ background: t.color }}>{t.name}</span>
            ))}
          </span>
        ) : '없음')}
        {row('공유', `${f.isShared === 1 ? '공유 중' : '안 함'}${(i?.isFavorite ?? f.state.isFavorite) === 1 ? ' · 즐겨찾기' : ''}`)}
        {row('카드', i ? `이 문서를 읽다 만든 카드 ${i.cardCount}장` : '…')}
        {row('대화', i ? `여기서 시작한 대화 ${i.threadCount}개` : '…')}
      </dl>
    );
  } else {
    const d = target.folder;
    const i = folderInfo;
    const types = i ? Object.entries(i.byType).sort((a, b) => b[1] - a[1]).map(([t, n]) => `${t} ${n}`).join(' · ') : '';
    body = (
      <dl className="grid grid-cols-[5.5rem_1fr] gap-x-3 gap-y-1.5 text-[13px]">
        {nameRow}
        {row('위치', i ? path(i.path) : '…')}
        {row('안에', i ? `폴더 ${i.folderCount} · 파일 ${i.fileCount} (하위 전부)` : '…')}
        {row('종류', i ? types || '비어 있음' : '…')}
        {row('총 크기', i ? formatBytes(i.bytes) : '…')}
        {section('시간')}
        {row('만든 날', when(i?.folder.createdAt))}
        {row('최근 변경', i ? (i.latest ? `${i.latest.name} · ${when(i.latest.updatedAt)}` : '없음') : '…')}
        {section('공유')}
        {row('공유', d.isShared === 1 ? `공유 중${i ? ` · 안의 파일 ${i.fileCount}개가 함께 공개` : ''}` : '안 함')}
      </dl>
    );
  }

  const content = (
    <>
      <div className="flex items-center gap-2 border-b border-slate-800 px-4 py-3">
        <Icon name={target.kind === 'file' ? 'doc' : 'folder'} size={18} className="text-slate-400" />
        <h3 className="min-w-0 flex-1 truncate text-sm font-semibold">{name}</h3>
        <button onClick={onClose} className="px-1 text-slate-500 hover:text-slate-300" title="닫기"><Icon name="close" size={16} /></button>
      </div>
      <div className="min-h-0 flex-1 overflow-auto px-4 py-3">{body}</div>
    </>
  );

  if (isPc) {
    return (
      <>
        <div className="fixed inset-0 z-40 bg-black/60" onClick={onClose} />
        <div className="fixed left-1/2 top-1/2 z-50 flex max-h-[85vh] w-[min(520px,94vw)] -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden rounded-2xl border border-slate-700 bg-slate-950 text-slate-100 shadow-2xl">{content}</div>
      </>
    );
  }
  return (
    <>
      <div className="fixed inset-0 z-40 bg-black/60" onClick={onClose} />
      <div className="fixed inset-x-0 bottom-0 z-50 flex max-h-[85vh] flex-col overflow-hidden rounded-t-2xl border-t border-slate-700 bg-slate-950 pb-[env(safe-area-inset-bottom)] text-slate-100">
        <div className="mx-auto mt-2 h-1 w-9 rounded-full bg-slate-600" />
        {content}
      </div>
    </>
  );
}
