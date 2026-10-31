import { useState } from 'react';
import { downloadArchive } from '../../lib/download';
import { rowId } from './catalog';
import SettingRow, { btnClass } from './SettingRow';

type Props = { onShowChangelog: () => void };

// SCR-404: 정보 — 버전·업데이트 기록(SCR-144)·내보내기
export default function AboutSettings({ onShowChangelog }: Props) {
  const [withManifest, setWithManifest] = useState(true);
  return (
    <>
      <SettingRow id={rowId('about', 'version')} title={<>docvault <span className="font-medium">v{__APP_VERSION__}</span></>} desc={`${__BUILD_DATE__} 빌드`}>
        <button onClick={onShowChangelog} className={btnClass}>업데이트 기록</button>
      </SettingRow>
      <SettingRow
        id={rowId('about', 'export')}
        title="내보내기"
        desc="내 파일 전부를 폴더 구조 그대로 ZIP 하나로 받습니다. 파일이 많으면 시간이 걸릴 수 있습니다"
        below={
          <label className="flex min-h-11 items-center gap-2 text-sm text-slate-400">
            <input type="checkbox" checked={withManifest} onChange={(e) => setWithManifest(e.target.checked)} className="h-4 w-4 accent-slate-400" />
            태그·즐겨찾기 목록도 함께 담기
          </label>
        }
      >
        <button onClick={() => downloadArchive({ all: true, manifest: withManifest })} className={btnClass}>내 자료 전부 내보내기</button>
      </SettingRow>
    </>
  );
}
