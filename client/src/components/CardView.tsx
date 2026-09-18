import type { ReactNode } from 'react';
import { splitCard } from '../lib/frontmatter';

type Props = {
  title: string;
  content: string;
  /** 본문(머리말을 뗀 md)을 그리는 함수 — 뷰어의 md 렌더러를 그대로 쓴다 */
  renderBody: (body: string) => ReactNode;
  onAsk?: () => void;
};

// 카드 뷰 — 머리말은 표처럼, 본문은 글로 (설계 — 카드 한 장 = 머리말(기계용) + 본문(사람용)).
// 머리말이 없는 md(손으로 만든 옛 파일)는 본문만 그린다
export default function CardView({ title, content, renderBody, onAsk }: Props) {
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
              {front.links.map((l) => (
                <span key={l} className="rounded-full border border-current/30 px-2.5 py-0.5 text-xs">{l}</span>
              ))}
            </div>
          )}
          {front.sources.length > 0 && (
            <div className="flex flex-col gap-1">
              <span className="text-xs opacity-60">출처</span>
              {front.sources.map((s) => (
                <span key={s} className="text-xs opacity-80">{s}</span>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
