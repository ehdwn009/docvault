/** 파일 이름 → 몸통·확장자("회의록", ".md"). 맨 앞 점은 확장자가 아니라 숨김 파일 표시다(.gitignore) */
export function splitExt(name: string): { stem: string; ext: string } {
  const dot = name.lastIndexOf('.');
  return dot > 0 ? { stem: name.slice(0, dot), ext: name.slice(dot) } : { stem: name, ext: '' };
}

/** 이름을 바꿀 때 확장자를 지웠으면 원래 확장자를 다시 붙인다 — 확장자가 형식을 정해서, ".md"를 지우면
    문서가 일반 텍스트로 바뀌어 "# 제목"·"- [ ]" 기호가 그대로 보였다 (사용성 평가 2026-10-01).
    다른 확장자로 바꾸려면 점을 넣어 직접 쓰면 된다 */
export function keepExt(oldName: string, newName: string): string {
  const { ext } = splitExt(oldName);
  return ext && !newName.includes('.') ? `${newName}${ext}` : newName;
}
