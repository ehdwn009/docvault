import { zValidator } from '@hono/zod-validator';
import { z, type ZodType } from 'zod';

/** JSON body를 zod로 검증하고, 실패 시 공통 형식의 VALIDATION_ERROR 400을 반환하는 미들웨어 */
export const jsonBody = <T extends ZodType>(schema: T) =>
  zValidator('json', schema, (result, c) => {
    if (!result.success) {
      const message = result.error.issues
        .map((i) => (i.path.length ? `${i.path.join('.')}: ${i.message}` : i.message))
        .join('; ');
      return c.json({ code: 'VALIDATION_ERROR', message }, 400);
    }
  });

/** URL 파라미터의 양의 정수 ID. 아니면 null */
export function parseId(raw: string | undefined): number | null {
  const id = Number(raw);
  return Number.isInteger(id) && id > 0 ? id : null;
}

/** 파일·폴더 이름 공통 규칙 — 경로 문자를 금지한다 (CLAUDE.md 보안 — path traversal 방지) */
export const nameField = z
  .string()
  .trim()
  .min(1)
  .max(255)
  .refine((n) => !/[/\\]/.test(n) && n !== '.' && n !== '..', {
    message: '이름에 경로 문자를 쓸 수 없습니다',
  });
