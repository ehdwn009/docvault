import { useCallback, useEffect, useRef, useState } from 'react';
import {
  getDocument,
  GlobalWorkerOptions,
  RenderingCancelledException,
  type PDFDocumentProxy,
  type RenderTask,
} from 'pdfjs-dist';
// 워커는 별도 파일로 떼어 배포하고 URL만 알려준다 — pdf.js는 파싱을 워커 스레드에서 한다
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';

GlobalWorkerOptions.workerSrc = workerUrl;

// PDF를 브라우저 내장 뷰어(iframe)에 맡기지 않고 canvas에 직접 그린다 —
// iOS는 iframe 속 PDF를 "1페이지짜리 원본 크기 그림"으로만 그려서 모바일에서 뷰어가 성립하지 않았다.
// 전 페이지를 세로로 이어 붙여 부모의 스크롤(읽던 위치·진행률·크롬 숨김)을 그대로 태운다.

/** 페이지당 캔버스 픽셀 상한 — 기기 픽셀 밀도(3x 등)는 그대로 살려 선명하게 그리되,
    고배율 확대에서 메모리가 폭주하지 않게 총량만 막는다 (8M픽셀 ≈ 32MB).
    밀도를 2로 고정했더니 3x 아이폰에서 글자가 흐릿했다 — 상한은 밀도가 아니라 총량에 건다 */
const MAX_CANVAS_PIXELS = 8 * 1024 * 1024;
/** 화면 밖 페이지도 이만큼 미리 그려 둔다(위아래 한 화면분) — 스크롤 시 흰 페이지가 보이지 않게 */
const RENDER_MARGIN = '100% 0px';

type PageSize = { width: number; height: number };

type Props = {
  fileId: number;
  /** 배율(%) — 100 = 화면 폭 맞춤. ⋯ 메뉴의 글자 크기 조절을 그대로 물려받는다 */
  scale: number;
  /** 문서 준비(페이지 자리 확보) 보고 — 부모는 이 뒤에야 읽던 위치를 복원할 수 있다 */
  onReady?: () => void;
};

export default function PdfRenderer({ fileId, scale, onReady }: Props) {
  const [doc, setDoc] = useState<PDFDocumentProxy | null>(null);
  const [pageSizes, setPageSizes] = useState<PageSize[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [containerWidth, setContainerWidth] = useState(0);
  const [currentPage, setCurrentPage] = useState(1);
  const rootRef = useRef<HTMLDivElement>(null);

  // 문서 로드 — 언마운트되면 즉시 파기해 워커·메모리를 돌려준다
  useEffect(() => {
    let disposed = false;
    const task = getDocument({ url: `/api/v1/files/${fileId}/raw` });
    (async () => {
      try {
        const pdf = await task.promise;
        // 자리(placeholder) 높이를 정확히 잡기 위해 전 페이지의 원본 크기를 먼저 읽는다 —
        // 크기가 어긋나면 읽던 위치 복원과 진행률이 전부 틀어진다
        const sizes: PageSize[] = [];
        for (let i = 1; i <= pdf.numPages; i++) {
          const page = await pdf.getPage(i);
          const vp = page.getViewport({ scale: 1 });
          sizes.push({ width: vp.width, height: vp.height });
        }
        if (disposed) return;
        setDoc(pdf);
        setPageSizes(sizes);
      } catch (e: unknown) {
        if (disposed) return;
        setError(e instanceof Error && e.name === 'PasswordException'
          ? '암호가 걸린 PDF는 아직 열 수 없습니다'
          : 'PDF를 여는 데 실패했습니다');
      }
    })();
    return () => {
      disposed = true;
      void task.destroy();
    };
  }, [fileId]);

  // 준비 보고는 페이지 자리가 실제 DOM 높이를 가진 뒤(다음 페인트)여야 한다
  useEffect(() => {
    if (pageSizes.length === 0 || !onReady) return;
    const raf = requestAnimationFrame(onReady);
    return () => cancelAnimationFrame(raf);
    // onReady 자체의 변경으로 재보고하지 않는다 — 문서 준비 시 1회
  }, [pageSizes.length]); // eslint-disable-line react-hooks/exhaustive-deps

  // 컨테이너 폭 추적 — 분할·회전·창 크기 변경 시 페이지 폭을 다시 맞춘다
  useEffect(() => {
    const el = rootRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => {
      if (entry) setContainerWidth(entry.contentRect.width);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // 현재 페이지 표시 — 화면과 겹친 페이지 중 가장 앞 번호
  const visiblePagesRef = useRef<Set<number>>(new Set());
  const pageIoRef = useRef<IntersectionObserver | null>(null);
  useEffect(() => {
    const io = new IntersectionObserver((entries) => {
      const seen = visiblePagesRef.current;
      for (const e of entries) {
        const n = Number((e.target as HTMLElement).dataset['page']);
        if (e.isIntersecting) seen.add(n);
        else seen.delete(n);
      }
      if (seen.size > 0) setCurrentPage(Math.min(...seen));
    });
    pageIoRef.current = io;
    return () => io.disconnect();
  }, []);
  const trackPage = useCallback((el: HTMLDivElement | null) => {
    if (el) pageIoRef.current?.observe(el);
  }, []);

  if (error) {
    return (
      <div className="flex min-h-full items-center justify-center p-6">
        <p className="text-sm text-red-400">{error}</p>
      </div>
    );
  }
  if (!doc || pageSizes.length === 0 || containerWidth === 0) {
    return (
      <div ref={rootRef} className="p-6">
        <p className="text-sm text-slate-500">PDF 준비 중…</p>
      </div>
    );
  }

  // 100% = 폭 맞춤. 여백을 뺀 폭 기준이라 기본 상태에서 가로 스크롤이 절대 생기지 않는다
  const padding = 12;
  const cssWidth = Math.max(50, (containerWidth - padding * 2) * (scale / 100));

  return (
    <div ref={rootRef}>
      {/* 페이지 번호 — 높이 0의 sticky라 본문을 밀지 않고 위에 떠서 따라온다.
          가로 스크롤 상자(overflow) "밖"에 둬야 한다 — overflow 조상이 생기면 sticky의 기준이
          세로로 스크롤되지 않는 그 상자로 바뀌어, 스크롤하자마자 본문과 같이 밀려 사라진다 */}
      {/* 터치는 오버레이 헤더 아래(top-12)에 — top-2면 헤더에 가려진다 (크롬 자동 숨김 오버레이) */}
      {doc.numPages > 1 && (
        <div className="sticky top-2 z-10 h-0 touch:top-12">
          <div className="flex justify-end pr-3">
            <span className="rounded-full bg-slate-900/75 px-2.5 py-1 text-xs text-slate-200 backdrop-blur">
              {currentPage} / {doc.numPages}
            </span>
          </div>
        </div>
      )}
      {/* 확대(scale>100) 시에는 부모가 아니라 이 상자 안에서만 가로 스크롤한다 (표 스크롤과 같은 규칙) */}
      <div className="overflow-x-auto">
        <div className="flex flex-col gap-3" style={{ padding }}>
          {pageSizes.map((size, i) => (
            <PdfPage
              key={i}
              doc={doc}
              pageNum={i + 1}
              size={size}
              cssWidth={cssWidth}
              trackRef={trackPage}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

function PdfPage({
  doc,
  pageNum,
  size,
  cssWidth,
  trackRef,
}: {
  doc: PDFDocumentProxy;
  pageNum: number;
  size: PageSize;
  cssWidth: number;
  trackRef: (el: HTMLDivElement | null) => void;
}) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const taskRef = useRef<RenderTask | null>(null);
  // 화면 근처에 온 페이지만 canvas를 만든다 — 수백 페이지 PDF를 폰에서 열어도 메모리가 남게
  const [near, setNear] = useState(false);

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    trackRef(el);
    const io = new IntersectionObserver(
      ([entry]) => setNear(entry?.isIntersecting ?? false),
      { rootMargin: RENDER_MARGIN },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [trackRef]);

  useEffect(() => {
    if (!near) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    let cancelled = false;
    (async () => {
      try {
        const page = await doc.getPage(pageNum);
        if (cancelled) return;
        const cssArea = cssWidth * ((cssWidth * size.height) / size.width);
        const ratio = Math.min(window.devicePixelRatio || 1, Math.sqrt(MAX_CANVAS_PIXELS / cssArea));
        const viewport = page.getViewport({ scale: (cssWidth / size.width) * ratio });
        canvas.width = Math.floor(viewport.width);
        canvas.height = Math.floor(viewport.height);
        const task = page.render({ canvas, viewport });
        taskRef.current = task;
        await task.promise;
      } catch (e: unknown) {
        // 스크롤로 지나쳐서 취소된 것은 정상 흐름
        if (!(e instanceof RenderingCancelledException)) console.error('PDF page render:', e);
      }
    })();
    return () => {
      cancelled = true;
      taskRef.current?.cancel();
      taskRef.current = null;
    };
  }, [near, doc, pageNum, cssWidth, size.width]);

  // 높이를 원본 비율로 미리 확보한다 — 그리기 전·해제 후에도 전체 스크롤 길이가 흔들리지 않게.
  // mx-auto: 폭 맞춤이면 가운데, 확대로 컨테이너보다 넓어지면 왼쪽 기준 — 가운데 정렬을 고집하면 확대 시 왼쪽 끝으로 스크롤할 수 없다
  return (
    <div
      ref={wrapRef}
      data-page={pageNum}
      style={{ width: cssWidth, height: (cssWidth * size.height) / size.width }}
      className="mx-auto shrink-0 bg-white shadow-md"
    >
      {near && <canvas ref={canvasRef} className="block h-full w-full" />}
    </div>
  );
}
