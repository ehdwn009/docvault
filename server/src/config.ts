import path from 'node:path';
import { fileURLToPath } from 'node:url';

const serverRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export const config = {
  port: Number(process.env.PORT ?? 3000),
  /** 영속 데이터 루트. SQLite 파일과 바이너리 원본(files/)이 모두 이 아래에 놓인다. */
  dataDir: path.resolve(process.env.DATA_DIR ?? path.join(serverRoot, '..', 'data')),
  /** SPA 빌드 결과물 경로. 존재하면 정적 서빙한다. */
  clientDist: path.resolve(process.env.CLIENT_DIST ?? path.join(serverRoot, '..', 'client', 'dist')),
  jwtSecret: process.env.JWT_SECRET ?? 'dev-only-secret-change-me',
  /** 최초 기동 시 생성되는 admin 계정의 초기 비밀번호 */
  adminInitialPassword: process.env.ADMIN_INITIAL_PASSWORD ?? 'admin1234',
  isProduction: process.env.NODE_ENV === 'production',
} as const;

if (config.isProduction && config.jwtSecret === 'dev-only-secret-change-me') {
  console.warn('[docvault] WARNING: JWT_SECRET is not set. Set it before exposing this server.');
}
