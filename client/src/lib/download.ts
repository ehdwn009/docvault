// 파일 내려받기 진입점 모음 (API-038 단일 파일 / API-040 ZIP 묶음).
// fetch로 받아 Blob으로 만들지 않고 브라우저에게 주소만 넘긴다 — 그래야 큰 묶음도
// 메모리에 쌓이지 않고 디스크로 바로 흘러가고, 진행 상황도 브라우저 다운로드 UI가 보여준다.

/** 현재 화면은 그대로 두고 다운로드만 시작한다 (서버가 attachment로 응답하므로 페이지 이동이 없다) */
export function startDownload(url: string, filename?: string) {
  const a = document.createElement('a');
  a.href = url;
  if (filename) a.download = filename; // 같은 출처라 서버의 inline 지정보다 우선한다
  a.rel = 'noopener';
  document.body.appendChild(a);
  a.click();
  a.remove();
}

/** 파일 하나 받기 */
export function downloadFile(id: number, name: string) {
  startDownload(`/api/v1/files/${id}/raw`, name);
}

type ArchiveScope = {
  fileIds?: number[];
  folderIds?: number[];
  /** 내 파일 전체 */
  all?: boolean;
  /** 태그·즐겨찾기를 담은 목록표(docvault-manifest.json) 동봉 */
  manifest?: boolean;
};

/** 고른 파일·폴더·전체를 ZIP 하나로 받기 */
export function downloadArchive(scope: ArchiveScope) {
  const params = new URLSearchParams();
  if (scope.fileIds?.length) params.set('files', scope.fileIds.join(','));
  if (scope.folderIds?.length) params.set('folders', scope.folderIds.join(','));
  if (scope.all) params.set('all', '1');
  if (scope.manifest) params.set('manifest', '1');
  // 이름은 서버가 Content-Disposition으로 정해준다 (폴더 하나면 폴더 이름, 전체면 날짜)
  startDownload(`/api/v1/files/archive?${params}`);
}
