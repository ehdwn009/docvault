/**
 * 목록에 파일 이름을 그리는 한 곳 (트리·최근·즐겨찾기·공유·격자·카드 서랍).
 *
 * 그냥 truncate를 걸면 CSS가 **뒤를 자른다**. 그런데 구분되는 정보는 대개 꼬리에 있다
 * ("…atlas (1).html" vs "…atlas (2).html"). 그래서 앞부분만 줄이고 꼬리(마지막 몇 글자 +
 * 확장자)는 절대 자르지 않는다.
 */

/** 꼬리에 남길 글자 수 — "(2)"나 "_아이폰용" 같은 구분 꼬리가 들어갈 만큼 */
const TAIL_CHARS = 6;
/** 이보다 짧은 이름은 어차피 안 잘리므로 나누지 않는다 (가운데 생략이 오히려 산만해진다) */
const MIN_SPLIT = 12;

type Props = {
  name: string;
  /** 지금 보고 있는 행 — 한 줄에 못 담으면 두 줄까지 펴서 전체를 보여 준다 */
  expanded?: boolean;
  className?: string;
};

export default function FileName({ name, expanded = false, className = '' }: Props) {
  if (expanded) return <span className={`line-clamp-2 break-all ${className}`}>{name}</span>;
  if (name.length <= MIN_SPLIT) return <span className={`truncate ${className}`}>{name}</span>;

  // 맨 앞 점은 확장자가 아니라 숨김 파일 표시다 (.gitignore)
  const dot = name.lastIndexOf('.');
  const ext = dot > 0 ? name.slice(dot) : '';
  const stem = dot > 0 ? name.slice(0, dot) : name;
  const cut = Math.max(0, stem.length - TAIL_CHARS);

  return (
    <span className={`flex min-w-0 ${className}`}>
      <span className="min-w-0 truncate">{stem.slice(0, cut)}</span>
      <span className="shrink-0">
        {stem.slice(cut)}
        {ext}
      </span>
    </span>
  );
}
