// 카드 머리말 읽기 — 서버 lib/frontmatter.ts와 같은 규칙 (서버·클라이언트는 별개 프로그램이라 공유할 수 없어 둘 다 가진다.
// 규칙을 고치면 양쪽을 같이 고친다). 클라이언트는 그리기만 하므로 읽기만 있다.

export const CARD_KINDS = ['개념', '절차', '비교', '문제 해결'] as const;
export type CardKind = (typeof CARD_KINDS)[number];

export type CardFrontmatter = {
  oneLine: string;
  aliases: string[];
  kind: CardKind;
  topic: string;
  tags: string[];
  links: string[];
  sources: string[];
};

const EMPTY: CardFrontmatter = { oneLine: '', aliases: [], kind: '개념', topic: '', tags: [], links: [], sources: [] };

function parseList(raw: string): string[] {
  return raw
    .trim()
    .replace(/^\[/, '')
    .replace(/\]$/, '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

/** 파일 본문을 머리말과 본문으로 — 머리말이 없으면 전체가 본문 */
export function splitCard(content: string): { front: CardFrontmatter; body: string; hasFront: boolean } {
  const lines = content.split(/\r?\n/);
  if (lines[0]?.trim() !== '---') return { front: { ...EMPTY }, body: content, hasFront: false };
  const end = lines.findIndex((l, i) => i > 0 && l.trim() === '---');
  if (end === -1) return { front: { ...EMPTY }, body: content, hasFront: false };
  const front: CardFrontmatter = { ...EMPTY, aliases: [], tags: [], links: [], sources: [] };
  let listKey: 'sources' | null = null;
  for (const line of lines.slice(1, end)) {
    const item = /^\s+-\s+(.*)$/.exec(line);
    if (item && listKey) {
      front[listKey].push(item[1]!.trim());
      continue;
    }
    listKey = null;
    const m = /^([^:]+):\s*(.*)$/.exec(line);
    if (!m) continue;
    const key = m[1]!.trim();
    const value = m[2]!.trim();
    if (key === '한 줄') front.oneLine = value;
    else if (key === '종류') front.kind = (CARD_KINDS as readonly string[]).includes(value) ? (value as CardKind) : '개념';
    else if (key === '주제') front.topic = value;
    else if (key === '별칭') front.aliases = parseList(value);
    else if (key === '태그') front.tags = parseList(value);
    else if (key === '연결') front.links = parseList(value);
    else if (key === '출처') {
      front.sources = value ? parseList(value) : [];
      if (!value) listKey = 'sources';
    }
  }
  return { front, body: lines.slice(end + 1).join('\n').replace(/^\n+/, ''), hasFront: true };
}

/** 카드 제목 = 파일 이름에서 .md를 뗀 것 (서버와 같은 규칙) */
export function cardTitle(name: string): string {
  return name.replace(/\.md$/i, '');
}
