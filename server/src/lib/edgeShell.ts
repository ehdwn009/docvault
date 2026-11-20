import fs from 'node:fs';
import path from 'node:path';

// 시험 입구(/edge)의 HTML — index.html에 아이폰 웹앱의 "상태 표시 아래까지 화면을 쓴다" 설정을 더해 내준다.
// 보통 입구(/)는 건드리지 않는다: 이 설정은 모든 아이폰의 위쪽 배치를 바꾸므로, 시험 아이콘을 따로 추가한 기기에서만 켜지게 했다
// (IA — 화면 가장자리 시험 2026-11-20)
const EDGE_HEAD = [
  '<meta name="apple-mobile-web-app-capable" content="yes" />',
  '<meta name="mobile-web-app-capable" content="yes" />',
  '<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />',
  '<meta name="apple-mobile-web-app-title" content="Loft 시험" />',
].join('\n    ');

export function edgeShellHtml(clientDist: string): string | null {
  const file = path.join(clientDist, 'index.html');
  if (!fs.existsSync(file)) return null;
  // 요청마다 읽는다 — 배포로 index.html이 바뀌면(해시 이름) 바로 따라가야 하고, 작은 파일이다
  const html = fs.readFileSync(file, 'utf8');
  return html.replace('href="/manifest.webmanifest"', 'href="/manifest-edge.webmanifest"').replace('</head>', `  ${EDGE_HEAD}\n  </head>`);
}
