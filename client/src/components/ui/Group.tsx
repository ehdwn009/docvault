import type { ReactNode } from 'react';

type Props = {
  /** 카드 위에 작게 붙는 이름(「내 파일 · 이름순」) — 없으면 카드만 */
  title?: ReactNode;
  /** 이름 줄 오른쪽 끝(개수·접기 단추) */
  trailing?: ReactNode;
  children: ReactNode;
  className?: string;
};

// 폰 A안(2026-10-31)의 "묶음 카드" — 연회색 바탕 위 둥근 흰 카드(어두움은 한 단 밝은 카드)에 행(GroupRow)을 담는다.
// 아이폰 설정·파일 앱의 inset grouped 목록과 같은 결. 행 사이 선은 index.css의 .dv-group 규칙이 들여 긋는다
export default function Group({ title, trailing, children, className = '' }: Props) {
  return (
    <section className={className}>
      {(title || trailing) && (
        <div className="mb-1.5 flex items-center gap-2 px-4">
          {title && <h3 className="min-w-0 flex-1 truncate text-xs font-medium tracking-wide text-slate-500">{title}</h3>}
          {trailing}
        </div>
      )}
      <div className="dv-group overflow-hidden rounded-xl bg-panel">{children}</div>
    </section>
  );
}
