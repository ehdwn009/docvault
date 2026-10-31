import type { ReactNode } from 'react';

// 설정 페이지의 한 줄 = 설정 하나: 왼쪽 "이름 · 한 줄 설명", 오른쪽 컨트롤 (IA — 안 B "나", Obsidian 교훈 5).
// 펼침이 필요한 것(비밀번호 바꾸기·타이머 편집·트리거)은 below로 그 자리에서 펼친다.
// id는 "set-<카테고리>.<항목>" — 설정 검색(SCR-405)과 다른 화면의 바로 가기가 이 id로 스크롤한다.

type Props = {
  id?: string;
  title: ReactNode;
  desc?: ReactNode;
  /** 오른쪽 컨트롤(스위치·셀렉트·단추·값) */
  children?: ReactNode;
  /** 줄 아래에 펼쳐지는 내용 */
  below?: ReactNode;
};

export default function SettingRow({ id, title, desc, children, below }: Props) {
  return (
    <div id={id} className="scroll-mt-24 border-b border-slate-800/70 py-3 last:border-0">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <div className="min-w-0 flex-1 basis-52">
          <p className="text-sm text-slate-200">{title}</p>
          {desc && <div className="mt-0.5 text-xs leading-relaxed text-slate-500">{desc}</div>}
        </div>
        {children && <div className="flex shrink-0 flex-wrap items-center gap-2">{children}</div>}
      </div>
      {below && <div className="mt-3">{below}</div>}
    </div>
  );
}

/** 켬/끔 스위치 — 누르는 자리는 44px, 보이는 손잡이는 작게 */
export function Switch({ checked, onChange, disabled, label }: { checked: boolean; onChange: (v: boolean) => void; disabled?: boolean; label: string }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className="grid h-11 w-14 shrink-0 place-items-center disabled:opacity-40"
    >
      <span className={`relative h-6 w-11 rounded-full transition ${checked ? 'bg-accent-600' : 'bg-slate-700'}`}>
        <span className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-all ${checked ? 'left-[22px]' : 'left-0.5'}`} />
      </span>
    </button>
  );
}

/** 오른쪽 칸의 "값" 글자 — 컨트롤 없이 상태만 보여 줄 때 */
export function Value({ children, tone = 'normal' }: { children: ReactNode; tone?: 'normal' | 'warn' | 'good' | 'muted' }) {
  const color = tone === 'warn' ? 'text-warn-400' : tone === 'good' ? 'text-good-400' : tone === 'muted' ? 'text-slate-500' : 'text-slate-300';
  return <span className={`max-w-xs truncate text-sm ${color}`}>{children}</span>;
}

export const selectClass = 'min-h-11 rounded-md border border-slate-700 bg-slate-800 px-2 text-sm text-slate-100 outline-none focus:border-slate-400';
export const inputClass = 'min-h-11 w-full rounded-md border border-slate-700 bg-slate-800 px-3 text-sm text-slate-100 outline-none placeholder:text-slate-600 focus:border-slate-400';
export const btnClass = 'min-h-11 rounded-md border border-slate-700 px-3 text-sm text-slate-300 transition hover:bg-slate-800 disabled:opacity-40';
export const primaryBtnClass = 'min-h-11 rounded-md bg-accent-600 px-3 text-sm font-medium text-white transition hover:bg-accent-500 disabled:opacity-40';
export const dangerBtnClass = 'min-h-11 rounded-md px-3 text-sm text-slate-500 transition hover:text-danger-300';
export const smallBtnClass = 'min-h-9 rounded border border-slate-700 px-2 text-[11px] text-slate-300 hover:bg-slate-800';
