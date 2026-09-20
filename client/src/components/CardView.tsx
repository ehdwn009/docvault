import type { ReactNode } from 'react';
import { splitCard } from '../lib/frontmatter';

type Props = {
  title: string;
  content: string;
  /** 본문(머리말을 뗀 md)을 그리는 함수 — 뷰어의 md 렌더러를 그대로 쓴다 */
  renderBody: (body: string) => ReactNode;
  onAsk?: () => void;
  /** 출처 한 줄을 누르면 — 그 대화의 문서를 열고 드래그했던 문장으로 간다 (출처 줄 끝의 "(대화 #N)"이 열쇠) */
  onOpenSource?: (threadId: number) => void;
  /** 연결 칩을 누르면 — 그 이름의 카드를 연다 */
  onOpenLink?: (title: string) => void;
};

/** 출처 한 줄에서 대화 번호를 뽑는다 — 문서명·인용은 사람용, 번호가 기계용 */
function threadIdOf(source: string): number | null {
  const m = /\(대화 #(\d+)\)\s*$/.exec(source);
  return m ? Number(m[1]) : null;
}

// 카드 뷰 — 머리말은 표처럼, 본문은 글로 (설계 — 카드 한 장 = 머리말(기계용) + 본문(사람용)).
// 머리말이 없는 md(손으로 만든 옛 파일)는 본문만 그린다
export default function CardView({ title, content, renderBody, onAsk, onOpenSource, onOpenLink }: Props) {
  const { front, body, hasFront } = splitCard(content);
  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <h1 className="m-0 text-3xl font-bold leading-tight">{title}</h1>
          {hasFront && (
            <div className="mt-2 flex flex-wrap items-center gap-1.5 text-xs">
              {front.aliases.map((a) => (
                <span key={a} className="rounded-full bg-black/10 px-2 py-0.5 dark:bg-white/10">{a}</span>
              ))}
              <span className="rounded-full border border-current/30 px-2 py-0.5 opacity-70">{front.kind}</span>
              {front.topic && <span className="opacity-60">· {front.topic}</span>}
              {front.tags.map((t) => (
                <span key={t} className="rounded-full bg-teal-600/15 px-2 py-0.5 text-teal-700 dark:text-teal-300">#{t}</span>
              ))}
            </div>
          )}
        </div>
        {onAsk && (
          <button
            onClick={onAsk}
            className="shrink-0 rounded-md border border-teal-600/50 bg-teal-600/10 px-3 py-1.5 text-xs font-medium text-teal-700 hover:bg-teal-600/20 dark:text-teal-300"
          >
            이어서 질문
          </button>
        )}
      </div>
      {hasFront && front.oneLine && (
        <div className="rounded-r-lg border-l-4 border-teal-600 bg-teal-600/10 px-4 py-2.5 text-lg font-medium">{front.oneLine}</div>
      )}
      <div>{renderBody(body)}</div>
      {hasFront && (front.links.length > 0 || front.sources.length > 0) && (
        <div className="flex flex-col gap-2 border-t border-current/15 pt-3 text-sm">
          {front.links.length > 0 && (
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="text-xs opacity-60">연결</span>
              {front.links.map((l) =>
                onOpenLink ? (
                  <button key={l} onClick={() => onOpenLink(l)} className="rounded-full border border-current/30 px-2.5 py-0.5 text-xs hover:bg-current/10">{l} →</button>
                ) : (
                  <span key={l} className="rounded-full border border-current/30 px-2.5 py-0.5 text-xs">{l}</span>
                ),
              )}
            </div>
          )}
          {front.sources.length > 0 && (
            <div className="flex flex-col gap-1">
              <span className="text-xs opacity-60">출처</span>
              {front.sources.map((s) => {
                const tid = threadIdOf(s);
                return onOpenSource && tid !== null ? (
                  <button key={s} onClick={() => onOpenSource(tid)} title="문서의 그 문장으로 가기" className="text-left text-xs underline decoration-current/40 underline-offset-2 opacity-80 hover:opacity-100">
                    {s}
                  </button>
                ) : (
                  <span key={s} className="text-xs opacity-80">{s}</span>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
