---
name: briefing-subscription
description: docvault 뉴스 브리핑 회차를 Claude 구독(예약 작업)으로 만든다. 지시서를 받아 저장소 코드로 수집·원문 읽기를 하고, 에이전트가 분류·선별·요약·검수를 쓴 뒤, 같은 코드로 숫자 검사를 거친 완성본을 docvault에 보낸다(시험 모드에서는 브랜치에 커밋). "브리핑 스킬 실행", "뉴스 브리핑 만들어", "briefing-subscription"에 트리거.
---

# 뉴스 브리핑 — 구독 생성 방식 (skillVersion 1)

설계: `docs/design/뉴스브리핑_docvault_20261001.md` "구독 생성 방식". 이 스킬은 **판단과 글쓰기**만 하고, 기계적인 일(수집·입력 자르기·원문 읽기·숫자 검사·건강 숫자)은 저장소의 `npm run briefing:job -w server -- <명령>`이 서버와 **같은 코드**로 한다. 숫자는 코드가 센 값만 쓴다.

## 두 모드

| | 시험 (`BRIEFING_JOB_MODE=test` 또는 지시서 파일이 주어짐) | 실전 (`DOCVAULT_URL`·`DOCVAULT_TOKEN`·`BRIEFING_JOB_ID`가 있음) |
|---|---|---|
| 지시서 | `npm run briefing:job -w server -- instruction .briefing-job --hours 24 --slot morning --config A` 로 직접 만든다. 수집 목록 파일이 있으면 `--sources <파일>` | `curl -sS -H "Authorization: Bearer $DOCVAULT_TOKEN" "$DOCVAULT_URL/api/v1/briefing/jobs/$BRIEFING_JOB_ID" > .briefing-job/instruction.json` |
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
→ 핵심·주요 기사의 원문을 받아 `materials.json`, 요약 입력 `summarize/core-NN.txt`(3건씩)·`major-NN.txt`(6건씩), 재료가 없어 참고로 내려간 기사 `fallback.txt`. 이것도 **백그라운드 + 대기**.

## 4. 요약 (에이전트) — 원문을 보는 유일한 단계

`summarize/*.txt`마다 파일 머리의 지시대로 쓴다. 기사마다 `[A 언론사] 본문: …` 같은 재료가 붙어 있다. 재료에 **없는** 사실·수치·고유명사는 절대 쓰지 않는다 — 다음 단계의 코드 검사가 지우고, 지워진 수가 실행 기록에 남는다. 글머리표(`bullets` 3~5줄)는 **자기가 쓴 리드·왜·칸만** 재료로 다시 쓴다(요약에 없는 숫자가 든 줄은 코드가 지운다).

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
- **검수**: 요약을 다 쓴 뒤 검수 에이전트(Opus)가 기사 10건을 무작위로 골라 `summarize/*.txt`의 재료와 문장 단위로 대조한다 — 재료에 없는 사실이 있으면 그 문장을 고치거나 지운다. 틀린 수를 완성본 `log`에 한 줄로 남긴다.

```
npm run briefing:job -w server -- verify .briefing-job --models claude-opus-5-5,claude-sonnet-5-5 --skill-version 1
```
→ `result.json`(완성본, API-153 본문)과 `verify-report.txt`. 보고에 "주소 검사 실패"가 **전체 기사의 30%에 가까우면** 서버가 통째로 거절한다 — 그 기사들의 주소를 확인하고(허용 도메인 밖 출처를 대표로 골랐는지) `selected.json`을 고쳐 3단계부터 다시 한다. "written.json에 요약이 없음"은 그 기사가 빠진다는 뜻이다.

## 5. 보내기

위 "두 모드" 표대로. 실전에서 400이면 응답 메시지의 위치를 고쳐 다시, 422(30% 초과)면 주소를 고쳐 다시 — 합쳐 2번까지. 200이면 `fileId`를 진행 보고 마지막 줄에 적고 끝낸다.

## 하지 않는 것

- 허용 도메인(`instruction.allowedDomains`) 밖의 사이트를 재료로 쓰지 않는다. 웹 검색 보강이 필요하면 그 안에서만.
- 원문 글을 어디에도 저장하지 않는다(`materials.json`은 작업 중 임시 파일 — 시험 커밋에서 제외).
- `DOCVAULT_TOKEN` 값을 출력·파일·커밋에 적지 않는다.
- 숫자(건수·비율)를 어림잡아 쓰지 않는다 — `result.json`의 `stats`는 코드가 센 값이다.
