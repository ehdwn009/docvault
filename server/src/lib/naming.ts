import { extensionOf } from './filetypes.js';

/**
 * 이름이 겹치면 접미를 붙여 가며 빈 이름을 찾는다. 확장자는 늘 끝에 유지된다.
 * 휴지통 복원·파일 복사·공유 시트 수신이 같은 규칙을 쓰도록 한 곳에 모은다.
 *
 * `suffix(n)`은 n번째 시도의 접미다 — 1이 첫 시도이므로 기본값은 접미 없음,
 * 그 뒤가 " (2)", " (3)"… 복사처럼 첫 시도부터 접미가 필요하면 넘겨서 바꾼다.
 */
export function uniqueFileName(
  baseName: string,
  isTaken: (name: string) => boolean,
  suffix: (n: number) => string = (n) => (n === 1 ? '' : ` (${n})`),
): string {
  const ext = extensionOf(baseName);
  const stem = ext ? baseName.slice(0, -ext.length) : baseName;
  for (let n = 1; ; n++) {
    const candidate = `${stem}${suffix(n)}${ext}`;
    if (!isTaken(candidate)) return candidate;
  }
}
