import type { Context } from 'hono';
import type { ContentfulStatusCode } from 'hono/utils/http-status';

/** 공통 에러 응답 형식 { code, message } (API 명세서 공통 규약) */
export function fail(c: Context, status: ContentfulStatusCode, code: string, message: string) {
  return c.json({ code, message }, status);
}
