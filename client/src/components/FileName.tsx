import { Fragment } from 'react';
import { splitExt } from '../lib/fileName';
/**
 * 목록에 파일 이름을 그리는 한 곳 (트리·최근·즐겨찾기·공유·격자·카드 서랍).
 *
 * 세로 목록(wrap)은 최대 두 줄로 보여 준다. 한 줄 안에서 앞이나 꼬리를 고르면, 구분 정보가 가운데 있는
 * 이름("1장_컴퓨터네트워크와인터넷_요약본" · "…_정독본")이 장 번호 말고는 다 같아 보였다 (IA — 이름 표시, 2026-10-19).
 *
 * 격자·카드 서랍처럼 한 줄인 곳은 앞부분만 줄이고 꼬리(마지막 몇 글자 + 확장자)를 남긴다 —
 * "…atlas (1).html" vs "…atlas (2).html"처럼 꼬리가 구분 정보인 경우가 많아서.
 */

/** 꼬리에 남길 글자 수 — "(2)"나 "_아이폰용" 같은 구분 꼬리가 들어갈 만큼 */
const TAIL_CHARS = 6;
/** 이보다 짧은 이름은 어차피 안 잘리므로 나누지 않는다 (가운데 생략이 오히려 산만해진다) */
const MIN_SPLIT = 12;

type Props = {
  name: string;
  /** 지금 보고 있는 행 — 이름 전체를 보여 준다(세로 목록은 줄 제한 없이, 한 줄 목록은 두 줄까지) */
  expanded?: boolean;
  /** 최대 두 줄 (세로 목록) */
  wrap?: boolean;
  /** 확장자를 숨긴다 — 형식 배지가 같은 말을 이미 하고 있을 때만 (트리) */
  hideExt?: boolean;
  className?: string;
};

/** `_ - .` 뒤에 줄바꿈 기회 — 언더스코어로 이어진 영어 이름은 브라우저가 끊을 자리를 모른다.
    한글은 기본 줄바꿈(아무 글자 사이)에 맡긴다: 단어 경계에서만 끊으면 세 줄이 되어 두 줄 제한이 꼬리를 자른다 */
function withBreaks(text: string) {
  return text.split(/(?<=[_\-.])/).map((part, i) => (
    <Fragment key={i}>
      {part}
      <wbr />
    </Fragment>
  ));
}

export default function FileName({ name, expanded = false, wrap = false, hideExt = false, className = '' }: Props) {
  const { stem, ext } = splitExt(name);
  const shown = hideExt && ext ? stem : name;

  if (wrap) {
    return (
      <span title={name} className={`min-w-0 wrap-anywhere ${expanded ? '' : 'line-clamp-2'} ${className}`}>
        {withBreaks(shown)}
      </span>
    );
  }
  // 격자 칸은 높이를 맞춰야 해서 고른 칸도 두 줄까지만
  if (expanded) return <span className={`line-clamp-2 break-all ${className}`}>{shown}</span>;
  if (shown.length <= MIN_SPLIT) return <span className={`truncate ${className}`}>{shown}</span>;

  const body = hideExt ? shown : stem;
  const tailExt = hideExt ? '' : ext;
  const cut = Math.max(0, body.length - TAIL_CHARS);
  return (
    <span className={`flex min-w-0 ${className}`}>
      <span className="min-w-0 truncate">{body.slice(0, cut)}</span>
      <span className="shrink-0">
        {body.slice(cut)}
        {tailExt}
      </span>
    </span>
  );
}
