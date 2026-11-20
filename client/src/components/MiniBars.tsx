import { useState } from 'react';

type Props = {
  /** 달마다의 값 — 오래된 달부터. 0에서 시작하는 막대라 음수는 그리지 않는다(수출액·수입액용) */
  values: number[];
  /** 각 칸의 달 'YYYY-MM' — values와 같은 길이 */
  periods: string[];
  /** 값의 단위(풍선과 읽어 주는 말에 붙는다) */
  unit: string;
  /** 무엇의 그래프인지 — 화면 읽기 프로그램에 읽어 준다(예: "수출액") */
  name: string;
  /** 막대 영역 높이(px) */
  height?: number;
};

/** 'YYYY-MM' → "2026년 10월" */
export function periodName(period: string): string {
  const [y, m] = period.split('-').map(Number);
  return `${y}년 ${m}월`;
}
const monthOf = (period: string) => `${Number(period.split('-')[1])}월`;
const fmt = (v: number) => v.toLocaleString('ko-KR');

// 최근 열세 달의 작은 막대 그래프 — 홈의 수출입 동향 카드와 동향 탭 카드가 쓴다 (IA — 홈 미리보기·동향 추이 v0.74).
// 한 가지 값의 흐름만 보여 준다: 지난 달들은 흐린 색, 이번 달만 강조색과 숫자. 색으로만 구분하지 않게 이번 달에는 값을 적는다.
// 막대마다 올리거나 누르면 그 달의 값이 뜬다 — 값만 보여 주고 다른 화면으로 가지 않는다(그 달의 호를 여는 것은 동향 탭의 「달마다」 표가 맡는다.
// 같은 숫자의 표이기도 하다)
export default function MiniBars({ values, periods, unit, name, height = 64 }: Props) {
  const [at, setAt] = useState<number | null>(null);
  const max = Math.max(...values, 0);
  if (values.length === 0 || max <= 0) return null;
  const last = values.length - 1;
  const shown = at ?? last;
  return (
    <div role="group" aria-label={`${name} 최근 ${values.length}개월 막대 그래프. ${periodName(periods[last]!)} ${fmt(values[last]!)}${unit}, 가장 큰 달은 ${periodName(periods[values.indexOf(max)]!)} ${fmt(max)}${unit}`}>
      {/* 고른(없으면 이번) 달의 값 — 막대 위에 숫자를 달마다 달지 않고 한 줄로 */}
      <p className="mb-1 flex items-baseline gap-1.5 text-xs text-slate-500" aria-live="polite">
        <span>{periodName(periods[shown]!)}</span>
        <span className="font-semibold tabular-nums text-slate-200">
          {fmt(values[shown]!)}
          {unit}
        </span>
      </p>
      <div className="flex items-end gap-[2px] border-b border-slate-700" style={{ height }} onMouseLeave={() => setAt(null)}>
        {values.map((v, i) => (
          // 잡는 자리는 막대가 아니라 칸 전체 — 낮은 막대도 잡히게. 키보드로도 달마다 옮겨 값을 듣는다
          <div
            key={periods[i]}
            tabIndex={0}
            role="img"
            aria-label={`${periodName(periods[i]!)} ${fmt(v)}${unit}`}
            onMouseEnter={() => setAt(i)}
            onFocus={() => setAt(i)}
            onBlur={() => setAt(null)}
            onTouchStart={() => setAt(i)}
            className="flex h-full min-w-0 flex-1 items-end justify-center outline-none"
          >
            <span
              // 막대는 24px을 넘기지 않고 남는 폭은 비워 둔다. 값 쪽 끝만 둥글고 바닥은 반듯하게
              className={`block w-full max-w-[24px] rounded-t-[4px] ${i === last ? 'bg-accent-500' : i === at ? 'bg-slate-400' : 'bg-slate-500'}`}
              style={{ height: `${Math.max(2, (v / max) * 100)}%` }}
            />
          </div>
        ))}
      </div>
      <div className="mt-1 flex justify-between text-[11px] text-slate-500" aria-hidden="true">
        <span>{`${periods[0]!.slice(2, 4)}년 ${monthOf(periods[0]!)}`}</span>
        <span>{monthOf(periods[last]!)}</span>
      </div>
    </div>
  );
}
