import { zValidator } from '@hono/zod-validator';
import type { ZodType } from 'zod';

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
