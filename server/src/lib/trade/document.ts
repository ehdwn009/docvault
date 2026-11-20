import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { TradeData } from './verify.js';

// 해부 결과를 한 장짜리 HTML 문서로 — 동향 탭의 [해부 보기]가 이 문서를 뷰어로 연다 (수출입 동향 설계 "해부 화면").
// 화면 틀은 server/assets/trade-template.html 하나 — 스킬이 단독 페이지를 만들 때도 같은 파일을 쓴다

const TEMPLATE_PATH = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'assets', 'trade-template.html');
const MARKER = '<!--TRADE_DATA-->';

export function renderTradeHtml(data: TradeData): string {
  const template = fs.readFileSync(TEMPLATE_PATH, 'utf8');
  if (!template.includes(MARKER)) throw new Error('해부 화면 틀에 자료 자리 표시가 없습니다');
  // </script>로 스크립트 블록이 일찍 닫히지 않게 <를 유니코드 표기로 — JSON.parse는 그대로 읽는다
  const json = JSON.stringify(data).replace(/</g, '\\u003c');
  const body = template.replace(MARKER, () => `<script type="application/json" id="trade-data">${json}</script>`);
  return `<!doctype html>\n<html lang="ko">\n<head>\n<meta charset="utf-8">\n<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">\n<style>[hidden]{display:none!important} body{margin:0}</style>\n</head>\n<body>\n${body}\n</body>\n</html>\n`;
}
