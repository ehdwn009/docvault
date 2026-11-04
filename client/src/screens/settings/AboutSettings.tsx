import { useState } from 'react';
import NameStory from './NameStory';
import { downloadArchive } from '../../lib/download';
import { rowId } from './catalog';
import SettingRow, { btnClass } from './SettingRow';

type Props = { onShowChangelog: () => void };

// SCR-404: 정보 — 버전·업데이트 기록(SCR-144)·내보내기
export default function AboutSettings({ onShowChangelog }: Props) {
  const [withManifest, setWithManifest] = useState(true);
  const [storyOpen, setStoryOpen] = useState(false);
  const [exportNote, setExportNote] = useState<string | null>(null);
  return (
    <>
      <SettingRow id={rowId('about', 'version')} title={<>Loft <span className="font-medium">v{__APP_VERSION__}</span></>} desc={`${__BUILD_DATE__} 빌드`}>
        <button onClick={onShowChangelog} className={btnClass}>업데이트 기록</button>
      </SettingRow>
      <SettingRow
        id={rowId('about', 'export')}
        title="내보내기"
        desc="내 파일 전부를 폴더 구조 그대로 ZIP 하나로 받습니다. 파일이 많으면 시간이 걸릴 수 있습니다"
        below={
          <>
            <label className="flex min-h-11 items-center gap-2 text-sm text-slate-400">
              <input type="checkbox" checked={withManifest} onChange={(e) => setWithManifest(e.target.checked)} className="h-4 w-4 accent-slate-400" />
              태그·즐겨찾기 목록도 함께 담기
            </label>
            {exportNote && <p role="status" className="mt-2 text-xs text-accent-400">{exportNote}</p>}
          </>
        }
      >
        <button
          onClick={() =>
            void downloadArchive({ all: true, manifest: withManifest })
              .then((r) => setExportNote(r === 'queued' ? '양이 많아 뒤에서 만들고 있어요. 끝나면 알림으로 알려 드릴게요 — 누르면 바로 받아집니다' : null))
              .catch(() => setExportNote('내보내기를 시작하지 못했어요'))
          }
          className={btnClass}
        >
          내 자료 전부 내보내기
        </button>
      </SettingRow>
      {/* 이름 이야기 — 설정의 유일한 읽을거리. 접어 두고 궁금한 사람만 펼친다 (이름·아이콘 결정 2026-11-04) */}
      <SettingRow id={rowId('about', 'nameStory')} title="이름 이야기" desc="docvault가 왜 Loft가 됐고, 아이콘은 왜 사다리인지" below={storyOpen ? <NameStory /> : undefined}>
        <button onClick={() => setStoryOpen((v) => !v)} className={btnClass} aria-expanded={storyOpen}>
          {storyOpen ? '접기' : '읽기'}
        </button>
      </SettingRow>
    </>
  );
}
