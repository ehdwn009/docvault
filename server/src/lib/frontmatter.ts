// 카드 파일의 머리말(frontmatter) 읽고 쓰기 (배움 카드 2판 — 설계 "카드의 모양").
// 앱이 읽는 부분은 머리말뿐이고 본문은 자유다 — 그래서 파서도 머리말만 안다.
// 형식은 일부러 좁다: `키: 값`, `키: [a, b]`, 그리고 `키:` 아래 `  - 항목` 줄. YAML 전체를 지원하지 않는다 —
// 사람이 편집기에서 손으로 고칠 수 있을 만큼 단순해야 하고, 라이브러리 없이 클라이언트도 같은 규칙을 갖기 위해.

export type CardFrontmatter = {
  oneLine: string;
  aliases: string[];
  kind: CardKind;
  topic: string;
  tags: string[];
  links: string[];
  sources: string[];
};

/** 주제 = 개념 카드들을 엮는 요약 한 장 (대화 정리가 만든다). 나머지는 개념 카드의 모양 */
export const CARD_KINDS = ['개념', '절차', '비교', '문제 해결', '주제'] as const;
export type CardKind = (typeof CARD_KINDS)[number];

/** 머리말 키 — 사용자가 편집기에서 읽는 이름이라 한국어 */
const KEYS = {
  oneLine: '한 줄',
  aliases: '별칭',
  kind: '종류',
  topic: '주제',
  tags: '태그',
  links: '연결',
  sources: '출처',
} as const;

export const EMPTY_FRONTMATTER: CardFrontmatter = {
  oneLine: '',
  aliases: [],
  kind: '개념',
  topic: '',
  tags: [],
  links: [],
  sources: [],
};

/** `[a, b]` 또는 `a, b` → 배열. 빈 항목은 버린다 */
function parseList(raw: string): string[] {
  const inner = raw.trim().replace(/^\[/, '').replace(/\]$/, '');
  return inner
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

/** 파일 본문을 머리말과 본문으로 나눈다. 머리말이 없으면 기본값 + 전체를 본문으로 */
export function splitCard(content: string): { front: CardFrontmatter; body: string; hasFront: boolean } {
  const lines = content.split(/\r?\n/);
  if (lines[0]?.trim() !== '---') return { front: { ...EMPTY_FRONTMATTER }, body: content, hasFront: false };
  const end = lines.findIndex((l, i) => i > 0 && l.trim() === '---');
  if (end === -1) return { front: { ...EMPTY_FRONTMATTER }, body: content, hasFront: false };

  const front: CardFrontmatter = { ...EMPTY_FRONTMATTER, aliases: [], tags: [], links: [], sources: [] };
  let listKey: keyof CardFrontmatter | null = null;
  for (const line of lines.slice(1, end)) {
    const item = /^\s+-\s+(.*)$/.exec(line);
    if (item && listKey) {
      (front[listKey] as string[]).push(item[1]!.trim());
      continue;
    }
    listKey = null;
    const m = /^([^:]+):\s*(.*)$/.exec(line);
    if (!m) continue;
    const key = m[1]!.trim();
    const value = m[2]!.trim();
    if (key === KEYS.oneLine) front.oneLine = value;
    else if (key === KEYS.kind) front.kind = (CARD_KINDS as readonly string[]).includes(value) ? (value as CardKind) : '개념';
    else if (key === KEYS.topic) front.topic = value;
    else if (key === KEYS.aliases) front.aliases = parseList(value);
    else if (key === KEYS.tags) front.tags = parseList(value);
    else if (key === KEYS.links) front.links = parseList(value);
    else if (key === KEYS.sources) {
      front.sources = value ? parseList(value) : [];
      if (!value) listKey = 'sources';
    }
  }
  const body = lines.slice(end + 1).join('\n').replace(/^\n+/, '');
  return { front, body, hasFront: true };
}

/** 머리말 + 본문 → 파일 내용. 빈 칸은 쓰지 않는다 — "없는 건 안 쓴다" */
export function joinCard(front: CardFrontmatter, body: string): string {
  const out = ['---'];
  out.push(`${KEYS.oneLine}: ${front.oneLine.trim()}`);
  if (front.aliases.length) out.push(`${KEYS.aliases}: [${front.aliases.join(', ')}]`);
  out.push(`${KEYS.kind}: ${front.kind}`);
  if (front.topic.trim()) out.push(`${KEYS.topic}: ${front.topic.trim()}`);
  if (front.tags.length) out.push(`${KEYS.tags}: [${front.tags.join(', ')}]`);
  if (front.links.length) out.push(`${KEYS.links}: [${front.links.join(', ')}]`);
  if (front.sources.length) {
    out.push(`${KEYS.sources}:`);
    for (const s of front.sources) out.push(`  - ${s}`);
  }
  out.push('---', '');
  return out.join('\n') + body.replace(/^\n+/, '').replace(/\s+$/, '') + '\n';
}

/** 쉼표·대괄호가 들어간 항목은 목록 표기를 깨뜨린다 — 저장 전에 걷어낸다 */
export function cleanListItem(s: string): string {
  return s.replace(/[[\],]/g, ' ').replace(/\s+/g, ' ').trim();
}
