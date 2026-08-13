import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { config } from '../config.js';

// 바이너리 원본은 디스크에, DB에는 상대 경로만 (아키텍처 — 저장 전략)
// 경로 규칙: files/{ownerId}/{uuid}

/** storage_path(상대)를 절대 경로로. dataDir 밖을 가리키면 거부 (path traversal 방지) */
export function binaryAbsPath(storagePath: string): string {
  const root = path.resolve(config.dataDir);
  const abs = path.resolve(root, storagePath);
  if (!abs.startsWith(root + path.sep)) {
    throw new Error(`storage path escapes data dir: ${storagePath}`);
  }
  return abs;
}

export function saveBinary(ownerId: number, buf: Buffer): string {
  const rel = path.posix.join('files', String(ownerId), crypto.randomUUID());
  const abs = binaryAbsPath(rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, buf);
  return rel;
}

/** DB 레코드 삭제 후 호출. 이미 없으면 조용히 무시 */
export function deleteBinary(storagePath: string | null): void {
  if (!storagePath) return;
  try {
    fs.unlinkSync(binaryAbsPath(storagePath));
  } catch {
    // 파일이 이미 없어도 삭제 흐름을 막지 않는다
  }
}

export function copyBinary(storagePath: string, newOwnerId: number): string {
  return saveBinary(newOwnerId, fs.readFileSync(binaryAbsPath(storagePath)));
}
