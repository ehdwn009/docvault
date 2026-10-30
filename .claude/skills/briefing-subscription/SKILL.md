---
name: briefing-subscription
description: docvault 뉴스 브리핑 회차를 Claude 구독(예약 작업)으로 만든다. 지시서를 받아 저장소 코드로 수집·원문 읽기를 하고, 에이전트가 분류·선별·요약·검수를 쓴 뒤, 같은 코드로 숫자 검사를 거친 완성본을 docvault에 보낸다(시험 모드에서는 브랜치에 커밋). "브리핑 스킬 실행", "뉴스 브리핑 만들어", "briefing-subscription"에 트리거.
---

# 뉴스 브리핑 — 구독 생성 방식 (skillVersion 2)

설계: `docs/design/뉴스브리핑_docvault_20261001.md` "구독 생성 방식". 이 스킬은 **판단과 글쓰기**만 하고, 기계적인 일(수집·입력 자르기·원문 읽기·숫자 검사·건강 숫자)은 저장소의 `npm run briefing:job -w server -- <명령>`이 서버와 **같은 코드**로 한다. 숫자는 코드가 센 값만 쓴다.

## 두 모드

| | 시험 (`BRIEFING_JOB_MODE=test` 또는 지시서 파일이 주어짐) | 실전 (`DOCVAULT_URL`·`DOCVAULT_TOKEN`·`BRIEFING_JOB_ID`가 있음) |
|---|---|---|
| 지시서 | `npm run briefing:job -w server -- instruction .briefing-job --hours 24 --slot morning --config A` 로 직접 만든다. 수집 목록 파일이 있으면 `--sources <파일>`, API 회차와 같은 범위로 비교하려면 `--since 2026-10-29T06:30+09:00 --until 2026-10-30T06:30+09:00`, 꺼 둔 후보 출처까지 재 보려면 `--all-candidates` | `curl -sS -H "Authorization: Bearer $DOCVAULT_TOKEN" "$DOCVAULT_URL/api/v1/briefing/jobs/$BRIEFING_JOB_ID" > .briefing-job/instruction.json` |
| 진행 보고 | 하지 않는다(화면 없음) | 단계가 끝날 때마다 `POST …/jobs/$BRIEFING_JOB_ID/progress` `{ "text": "수집 끝 — 후보 640건", "stage": "collect" }` |
| 완성본 | 브랜치 `claude/briefing-test-<날짜>-<구성>`을 만들어 `git add -f .briefing-job/result.json .briefing-job/verify-report.txt .briefing-job/instruction.json`(폴더는 gitignore라 `-f` 필요, 다른 중간 파일은 넣지 않는다) → 커밋 `docs: 브리핑 구독 시험 결과 <날짜> 구성 <A|B>` → push | `POST …/jobs/$BRIEFING_JOB_ID/result` 에 `result.json` 본문. 400/422면 메시지대로 고쳐 최대 2번 다시 보낸다 |

`DOCVAULT_URL`이 `https://`로 시작하지 않으면 **중단**한다(평문으로 열쇠가 나간다). 열쇠 값은 어떤 파일·커밋·출력에도 적지 않는다.

## 준비

```
npm ci -w server
mkdir -p .briefing-job
npm run briefing:job -w server -- rules        # 공통 지시 — 아래 단계마다 다시 읽지 말고 처음 한 번 읽어 둔다
```

지시서의 `deadline`(unix ms)을 기억한다. **마감 20분 전**(`wrapUpBefore`)이 되면 남은 요약 묶음은 버리고(그 기사는 written.json에서 빼면 verify가 싣지 않는다) 바로 5단계로 간다 — 빈손보다 얇은 회차가 낫다.

## 모델 구성

지시서 `generator.config`:
- **A**: 모든 단계를 Opus(effort high)로.
- **B**: 분류·선별 하위 에이전트는 Sonnet, 최종 요약·검수는 Opus. **Haiku는 쓰지 않는다**(사용자 결정).

하위 에이전트를 쓸 때는 각 에이전트에 이 SKILL.md의 해당 단계 절과 입력 파일 경로만 넘긴다. 백그라운드 에이전트는 도구가 적으니 파일을 읽고 쓰는 에이전트는 포그라운드로.

## 1. 수집 (코드)

```
npm run briefing:job -w server -- collect .briefing-job
```
→ `candidates.json`(후보 전부, 전역 번호 `i`) + `classify-NN.txt`(분야를 모르는 후보 80건씩). 명령이 10분을 넘길 수 있으니 **백그라운드로 실행하고 끝날 때까지 기다린다**. "경고: 언론사 피드 성공 비율" 이 뜨면 그대로 진행하되 완성본 `log`에 남긴다.

## 2. 분류 (에이전트)

`classify-NN.txt`마다 파일 머리의 지시대로 기사마다 세부 분야 id 하나를 고른다. 스포츠·연예·광고·홍보성은 빈 문자열. 결과를 **하나의** `classified.json`에 모은다:

```json
{ "assignments": [ { "i": 12, "subId": "kr.econ.stock" }, { "i": 13, "subId": "" } ] }
```

파일이 여러 개면 하위 에이전트에 하나씩 맡기고 합친다. 번호는 전역 번호라 그대로 쓴다.

```
npm run briefing:job -w server -- group .briefing-job
```
→ `select/<분야id>.txt`(분야마다 선별 지시 + 직전 회차 이슈 + 기사 최대 60건).

## 3. 선별 (에이전트)

`select/*.txt`마다 파일 머리의 지시대로 고른다. **분야를 넘는 같은 사건**은 분야별로 보면 안 보인다 — 전부 고른 뒤 전체 목록을 한 번 훑어 같은 사건이 두 분야에 있으면 더 맞는 분야 하나만 남기고 나머지의 `main`·`related`를 그쪽 `related`로 합친다(서버의 ③-2 합치기). 결과는 하나의 `selected.json`:

```json
{ "stories": [
  { "subId": "kr.econ.stock", "main": 12, "related": [40, 77], "importance": 3, "prevStoryId": null },
  { "subId": "kr.soc.life", "main": 201, "related": [], "importance": 1, "prevStoryId": null,
    "title": "한국어 제목", "summary": "무슨 일인지 한 문장", "why": "왜 중요한지 한 줄(일반론이면 빈 문자열)" }
] }
```

- `importance` 1(참고)만 `title`·`summary`·`why`를 쓴다. 발췌 없는 참고는 `summary`를 빈 문자열로.
- `prevStoryId`는 지시서 `prevStories`에 있는 id만.
- `moveTo`는 여기서 바로 `subId`를 맞는 분야로 바꿔 적는다.

```
npm run briefing:job -w server -- read .briefing-job
```
→ 핵심·주요 기사의 원문을 받아 `materials.json`, 요약 입력 `summarize/core-NN.txt`(3건씩)·`major-NN.txt`(6건씩), 재료가 없어 참고로 내려간 기사 `fallback.txt`, **웹 검색 대상 `webfill-targets.txt`**. 이것도 **백그라운드 + 대기**.

## 3-1. 웹 검색으로 재료 채우기 (에이전트) — 구독이라 비용 없이 전부 한다

클라우드에서는 연합뉴스·동아일보·BBC·NYT 같은 곳의 피드·원문이 막혀(403) 핵심·주요가 재료 없이 참고로 내려가는 일이 많다. `webfill-targets.txt`의 기사마다 **웹 검색·웹 읽기 도구**로 같은 사건을 다룬 보도를 찾는다. 대상은 두 가지다.

- **재료 없음** — 참고로 내려간 핵심·주요. 재료를 찾으면 다시 핵심·주요로 올라간다.
- **교차 확인** — 재료가 1곳뿐인 핵심. 다른 언론 보도를 붙여 요약 단계에서 숫자·사실을 서로 대조하게 한다(언론사마다 다르면 "A 기준 x, B 기준 y").

규칙 (서버의 웹 검색 보강과 같다 — 어기면 다음 명령이 버린다):
- **허용 도메인 안에서만** 찾는다(`instruction.json`의 `allowedDomains`). 검색어에 `site:` 조건을 붙여도 된다.
- **같은 사건**만: 같은 발표·결정·사고·수치. 파일 머리의 날짜 범위 밖 기사는 쓰지 않는다.
- `text`에는 페이지에 적힌 문장을 **그대로 옮겨** 적는다. 요약·번역·의견을 섞지 않는다 — 이 글이 요약의 재료이자 숫자 검사의 기준이다. 200자 이상, 기사 핵심 문단 위주로.
- 기사당 2~3개면 충분하다. 못 찾으면 그 기사는 적지 않는다(참고로 남는다).
- 페이지가 막혀 못 읽으면 검색 결과에 보이는 문장만 쓰지 말고 다른 언론사를 찾는다.

결과는 `webfill.json`:
```json
{ "stories": [ { "story": 12, "materials": [
  { "source": "경향신문", "url": "https://www.khan.co.kr/article/…", "title": "그 페이지의 제목", "publishedAt": 1793250000000, "text": "페이지 문장 그대로 …" }
] } ] }
```
(`publishedAt`은 알면 unix ms, 모르면 빼도 된다.) 하위 에이전트 여러 명에게 대상을 나눠 맡기고 합쳐도 된다.

```
npm run briefing:job -w server -- webfill .briefing-job
```
→ 허용 도메인·글 길이·날짜·제목 겹침을 검사해 통과한 것만 `W1·W2…` 재료로 붙이고, 요약 입력(`summarize/*.txt`·`fallback.txt`)을 **다시 쓴다.** 버린 것과 이유가 출력된다 — 이유가 "제목과 안 겹침"이면 다른 사건을 가져온 것이다.

## 4. 요약 (에이전트) — 원문을 보는 유일한 단계

`summarize/*.txt`마다 파일 머리의 지시대로 쓴다(3-1을 했으면 **다시 쓰인 파일**을 읽는다). 기사마다 `[A 언론사] 본문: …`, `[W1 언론사] 웹 검색 보도: …` 같은 재료가 붙어 있다. 재료에 **없는** 사실·수치·고유명사는 절대 쓰지 않는다 — 다음 단계의 코드 검사가 지우고, 지워진 수가 실행 기록에 남는다. 글머리표(`bullets` 3~5줄)는 **자기가 쓴 리드·왜·칸만** 재료로 다시 쓴다(요약에 없는 숫자가 든 줄은 코드가 지운다).

결과는 하나의 `written.json`. `items[]`의 칸은 서버 요약 출력과 같다(`k` 대신 `story` = 기사 번호, `bullets` 추가):

```json
{ "items": [ {
  "story": 12, "title": "…", "lead": "…", "leadSrc": "A,B", "why": "…", "whySrc": "A",
  "blocks": [ { "kind": "numbers", "text": "", "pairs": [ { "label": "…", "value": "…" } ], "items": [], "src": "A" } ],
  "sidesKind": "", "sides": [], "changed": "",
  "w5": { "who": "…", "what": "…", "when": "", "where": "", "why": "", "src": "A" },
  "impact": [ { "target": "수출 기업", "direction": "down", "text": "…할 수 있다", "src": "A" } ],
  "explain": { "terms": [ { "term": "…", "text": "…" } ], "why": "…", "whySrc": "", "effect": "", "effectSrc": "", "watch": "", "watchSrc": "" },
  "bullets": [ "…", "…", "…" ]
} ],
"fallbacks": [ { "story": 55, "title": "한국어 제목", "summary": "발췌가 있으면 한 문장, 없으면 빈 문자열" } ] }
```

- 모든 칸을 적는다(없으면 빈 문자열·빈 배열). `fallback.txt`에 적힌 기사는 `fallbacks`에.
- **해외 기사 표기**: 금액은 한국어 단위로 바꾼다 — "$6.3 billion" → "63억 달러", "$78,516" → "7만8516달러", "€2.5bn" → "25억 유로"(값이 같으면 숫자 검사를 통과한다). 날짜는 "11월 10일(현지시간)"처럼 한국어로 쓰되 **숫자 칩(numbers)에는 날짜를 넣지 않는다**(칩은 재료 표기와 값이 그대로 같아야 남는다). 원문 영어 표기를 그대로 두지 않는다.
- **검수 — 핵심·주요 전부**: 요약을 다 쓴 뒤 검수 에이전트(Opus)가 **핵심·주요 기사 전부**를 `summarize/*.txt`의 재료와 문장 단위로 대조한다(10건 표본이 아니다 — 1회 시험에서 10건 중 4문장이 틀렸다). 재료에 없는 사실·인과·수치가 있으면 그 문장을 고치거나 지운다. 재료가 2곳 이상인 기사는 숫자가 서로 맞는지도 본다. 고친 문장 수를 완성본 `log`에 한 줄로 남긴다. 기사가 많으면 검수 에이전트 여러 명에게 나눠 맡긴다.

```
npm run briefing:job -w server -- verify .briefing-job --models claude-opus-5-5,claude-sonnet-5-5 --skill-version 2
```
→ `result.json`(완성본, API-153 본문)과 `verify-report.txt`. `--all-candidates`로 돌렸으면 보고 머리에 **받아진 후보 출처 이름**이 나온다 — 완성본 `log`에도 한 줄로 옮겨 적는다(사용자가 수집 목록에서 켤 근거). 보고에 "주소 검사 실패"가 **전체 기사의 30%에 가까우면** 서버가 통째로 거절한다 — 그 기사들의 주소를 확인하고(허용 도메인 밖 출처를 대표로 골랐는지) `selected.json`을 고쳐 3단계부터 다시 한다. "written.json에 요약이 없음"은 그 기사가 빠진다는 뜻이다.

## 5. 보내기

위 "두 모드" 표대로. 실전에서 400이면 응답 메시지의 위치를 고쳐 다시, 422(30% 초과)면 주소를 고쳐 다시 — 합쳐 2번까지. 200이면 `fileId`를 진행 보고 마지막 줄에 적고 끝낸다.

## 하지 않는 것

- 허용 도메인(`instruction.allowedDomains`) 밖의 사이트를 재료로 쓰지 않는다. 웹 검색 보강이 필요하면 그 안에서만.
- 막힌 사이트를 우회하지 않는다 — 브라우저인 척 신분을 바꾸거나, 차단·유료벽을 피하는 주소를 쓰지 않는다. 막혔으면 다른 언론사 보도를 찾는다.
- 원문 글을 어디에도 저장하지 않는다(`materials.json`은 작업 중 임시 파일 — 시험 커밋에서 제외).
- `DOCVAULT_TOKEN` 값을 출력·파일·커밋에 적지 않는다.
- 숫자(건수·비율)를 어림잡아 쓰지 않는다 — `result.json`의 `stats`는 코드가 센 값이다.
