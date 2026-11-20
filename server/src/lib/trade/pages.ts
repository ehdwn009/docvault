import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { TRADE } from '../../constants.js';

// PDF → 쪽별 텍스트. 인용 대조의 바탕이라 서버와 스킬(trade:job pages)이 같은 도구·같은 옵션을 쓴다 (수출입 동향 설계 2단계 "Docker").
// 쪽 번호는 PDF 쪽(1부터) — 배열의 [0]이 1쪽이다

const run = promisify(execFile);

/** pdftotext는 쪽 끝마다 폼 피드(\f)를 넣는다 — 한 번 돌려 그 글자로 가른다 */
export async function pdfPageTexts(pdfPath: string): Promise<string[]> {
  let stdout: string;
  try {
    ({ stdout } = await run('pdftotext', ['-layout', pdfPath, '-'], { maxBuffer: 64 * 1024 * 1024, timeout: TRADE.PDFTOTEXT_TIMEOUT_MS }));
  } catch (e) {
    const code = (e as NodeJS.ErrnoException).code;
    throw new Error(code === 'ENOENT' ? 'pdftotext가 없습니다 (poppler-utils 설치 필요)' : `PDF에서 글자를 뽑지 못했어요 (${e instanceof Error ? e.message.split('\n')[0] : String(e)})`);
  }
  const pages = stdout.split('\f');
  // 마지막 폼 피드 뒤의 빈 조각은 쪽이 아니다
  if (pages.length > 1 && pages[pages.length - 1]!.trim() === '') pages.pop();
  return pages;
}
