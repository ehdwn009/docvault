import { execFile } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { parseHTML } from 'linkedom';
import { OUTLOOK } from '../../constants.js';
import { assertPublicUrl } from '../briefing/fetch.js';

// 출처 주소 → 원문 글. 인용 대조의 바탕이라 스킬(outlook:job grab·fetch)과 서버(API-177·178)가 같은 함수를 쓴다(세계전망 설계 10단계 "원문 재확인").
// 본문 추출(Readability)은 쓰지 않고 페이지 글 전체를 쓴다 — 표·짧은 줄도 인용될 수 있어서다. 대조는 띄어쓰기를 무시하므로 글이 붙어도 된다.
// 사이트가 막으면 우회하지 않는다 — 그 출처는 "확인 못 함"으로 남는다

const run = promisify(execFile);

export type SourceResult = { ok: true; kind: 'pdf' | 'html' | 'text'; text: string } | { ok: false; why: string };

async function pdfText(buf: Buffer): Promise<string> {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'outlook-'));
  const file = path.join(dir, 'source.pdf');
  try {
    fs.writeFileSync(file, buf);
    const { stdout } = await run('pdftotext', ['-layout', file, '-'], { maxBuffer: 128 * 1024 * 1024, timeout: OUTLOOK.PDFTOTEXT_TIMEOUT_MS });
    return stdout;
  } catch (e) {
    const code = (e as NodeJS.ErrnoException).code;
    throw new Error(code === 'ENOENT' ? 'pdftotext가 없습니다 (poppler-utils 설치 필요)' : `PDF에서 글자를 뽑지 못함`);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

export function htmlText(html: string): string {
  const { document } = parseHTML(html);
  for (const el of document.querySelectorAll('script, style, noscript, svg, template')) el.remove();
  return (document.body?.textContent ?? document.documentElement?.textContent ?? '').replace(/[ \t\r\f\v]+/g, ' ').replace(/\n\s*\n+/g, '\n');
}

/** 리디렉트를 직접 따라가며 넘어가는 곳마다 내부망 주소인지 본다 — 서버가 세션 대신 받으므로(2단계) 주소는 밖에서 온 값이다(SSRF).
    검사 규칙은 브리핑의 원문 받기와 같다(lib/briefing/fetch.ts — 프록시를 거치는 세션에서는 프록시의 허용 목록이 울타리) */
async function fetchPublic(raw: string, signal: AbortSignal): Promise<Response> {
  let url = new URL(raw);
  for (let hop = 0; hop <= OUTLOOK.MAX_REDIRECTS; hop++) {
    await assertPublicUrl(url, signal);
    const res = await fetch(url, {
      headers: { 'user-agent': OUTLOOK.USER_AGENT, accept: 'text/html,application/pdf,application/xhtml+xml,*/*;q=0.8' },
      redirect: 'manual',
      signal,
    });
    if (res.status < 300 || res.status >= 400) return res;
    const loc = res.headers.get('location');
    await res.body?.cancel().catch(() => {});
    if (!loc) throw new Error(`리디렉트 주소 없음 (${res.status})`);
    url = new URL(loc, url);
  }
  throw new Error('리디렉트가 너무 많습니다');
}

export async function fetchSource(url: string): Promise<SourceResult> {
  let res: Response;
  try {
    res = await fetchPublic(url, AbortSignal.timeout(OUTLOOK.FETCH_TIMEOUT_MS));
  } catch (e) {
    return { ok: false, why: `요청 실패 (${e instanceof Error ? e.message : String(e)})` };
  }
  if (!res.ok) return { ok: false, why: `HTTP ${res.status}` };
  const len = Number(res.headers.get('content-length') ?? 0);
  if (len > OUTLOOK.SOURCE_MAX_BYTES) return { ok: false, why: `너무 큼 (${len}바이트)` };
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length > OUTLOOK.SOURCE_MAX_BYTES) return { ok: false, why: `너무 큼 (${buf.length}바이트)` };
  const type = res.headers.get('content-type') ?? '';
  try {
    if (type.includes('pdf') || buf.subarray(0, 5).toString('latin1') === '%PDF-') return { ok: true, kind: 'pdf', text: await pdfText(buf) };
    const body = buf.toString('utf8');
    if (type.includes('html') || /<html[\s>]/i.test(body.slice(0, 2000))) {
      const text = htmlText(body);
      // 글이 거의 없으면 자동 접속 확인 화면이거나 스크립트로 그리는 페이지다 — 받은 것으로 치지 않는다
      return text.replace(/\s+/g, '').length < 300 ? { ok: false, why: '본문 글이 거의 없음(자동 접속 확인 화면이거나 스크립트로 그리는 페이지)' } : { ok: true, kind: 'html', text };
    }
    return { ok: true, kind: 'text', text: body };
  } catch (e) {
    return { ok: false, why: e instanceof Error ? e.message : String(e) };
  }
}
