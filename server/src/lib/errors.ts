import type { Context } from 'hono';
import type { ContentfulStatusCode } from 'hono/utils/http-status';

/** 공통 에러 응답 형식 { code, message } (API 명세서 공통 규약).
    charset을 명시하는 이유: JSON은 규격상 늘 UTF-8이라 fetch()는 알아서 읽지만,
    브라우저 주소창으로 API를 직접 열면(디버깅 중 흔하다) charset이 없을 때 한글 메시지가
    시스템 기본 인코딩으로 읽혀 깨진다. nosniff까지 걸려 있어 추측으로도 못 고친다 */
export function fail(c: Context, status: ContentfulStatusCode, code: string, message: string) {
  return c.json({ code, message }, status, { 'Content-Type': 'application/json; charset=utf-8' });
}
