---
name: trade-report
description: 산업통상부 「월간 수출입 동향」 보도자료(약 36쪽)를 끝까지 읽고 1쪽 헤드라인을 문장 단위로 해부한다 — 근거 쪽, 풀어보기, 헤드라인이 말하지 않는 것, 전월 호 비교, 쪽을 넘나드는 연결. 매번 같은 에이전트 분담·같은 결과 형식·같은 원문 대조로 만든다. 자동(서버가 예약 작업을 켬 — 지시서 kind가 trade)과 수동("수출입 동향 해부해 줘") 두 모드. "수출입 동향 해부", "이번 달 수출입 분석", "trade-report", "수출입동향 스킬"에 트리거.
---

# 수출입 동향 해부 (trade-report, skillVersion 2)

설계: `docs/design/수출입동향_docvault_20261120.md`. 이 스킬의 목적은 **매번 같은 방식**이다 — 에이전트 지시문(`references/agents.md`)과 결과 형식(`references/schema.md`)과 화면 틀(`server/assets/trade-template.html`)을 고정해, 달이 바뀌어도 조사의 깊이와 모양이 흔들리지 않게 한다. 지시문을 그때그때 고쳐 쓰지 않는다. 고칠 일이 생기면 이 파일들을 고치고 skillVersion을 올린다.

이 스킬은 **읽기·잇기·쓰기**만 한다. 기계적인 일(PDF 받기, 쪽 텍스트, 인용 대조, 서버와 주고받기)은 저장소의 `npm run trade:fetch`·`npm run trade:job`이 서버와 **같은 코드**로 한다.

## 원칙

- **원문이 근거다.** 인용은 글자 그대로, 그 쪽에 있는 것만. `trade:job build`가 쪽 텍스트와 대조해 틀린 것은 버리고, 서버가 완성본을 받을 때 **같은 함수로 다시** 대조한다. 숫자는 새로 만들지 않고, 계산한 값은 식과 함께 "✎ 계산"으로.
- **해설 문장을 다 읽는다.** 숫자 추이만이 아니라 품목·지역 해설, 각주, 장관 코멘트까지. 요약 쪽만 보고 쓰지 않는다.
- **떨어진 쪽을 잇는다.** 3쪽과 7쪽이 따로 말하는 것을 같이 봐야 할 때가 핵심이다.

## 두 모드

| | 자동 (서버가 예약 작업을 켬) | 수동 (사람이 부름) |
|---|---|---|
| 시작 | briefing-subscription 스킬이 받은 지시서의 `kind`가 `"trade"`일 때 이 스킬로 넘어온다. job id는 그 지시서의 `jobId`(= `<routine-fire-payload>`의 `BRIEFING_JOB_ID=` 줄) | "이번 달 수출입 동향 해부해 줘", "2026-09 호로" |
| 원문 | `npm run trade:job -w server -- pull <jobId> $W` — 서버가 쪽별 텍스트를 준다(이번 호·전월 호). 산업통상부 사이트에 접속하지 않는다 | `npm run trade:fetch -w server -- <YYYY-MM\|latest> $W` 뒤 `npm run trade:job -w server -- pages $W` (pdftotext 필요) |
| 내놓기 | `npm run trade:job -w server -- send <jobId> $W` → 서버가 다시 대조해 저장하고 모든 계정에 알린다 | 화면 틀 + `data.json`으로 페이지를 만들어 링크를 준다 |
| 서버 주소·열쇠 | `DOCVAULT_URL`은 환경 변수, 연결 열쇠는 네트워크 시크릿이 붙인다(briefing-subscription과 같은 규칙 — 값은 어떤 파일·출력에도 적지 않는다). 401이면 우회하지 말고 멈추고 보고 | 쓰지 않는다 |

**자동 모드에서 멈추는 경우**: `pull`·`send`가 409(`TRADE_JOB_CLOSED` — 마감이 지났거나 이미 저장됨)·404를 주면 거기서 멈추고 보고한다. 지시서의 `deadline`(unix ms) **30분 전**이 되면 검수(D)를 건너뛰고 바로 보낸다 — 빈손보다 대조를 통과한 얇은 결과가 낫다.

예약 시각을 따로 두지 않는 이유: 보도는 1일 11:00이지만 게시판에 오르는 시각을 모른다. 서버가 1일 11:10·13:00·18:00, 2~10일 10:00에 확인하다 **찾는 순간** 이 스킬을 켜고, 못 찾으면 서버가 관리자에게 알린다.

## 단계

작업 폴더 `W=.trade-report/<YYYY-MM>`(저장소 루트 기준, gitignore — 커밋하지 않는다). 준비: `npm ci -w server` 한 번.

### 1. 원문 받기 (코드)

```
# 자동
npm run trade:job -w server -- pull <jobId> .trade-report/<지시서의 period>
# 수동 — 받은 뒤 출력의 cur.period로 폴더 이름을 정한다
npm run trade:fetch -w server -- latest .trade-report/tmp      # 또는 2026-09
npm run trade:job -w server -- pages .trade-report/<YYYY-MM>
```
→ `pages/cur/01.txt…`·`all.txt`, `pages/prev/…`(전월 호가 없으면 "전월 호 없음" — 그때는 vsPrev·changes를 비운다). 쪽 번호는 PDF 쪽(1부터)이고 하단 인쇄 쪽번호와 같다(실측).

### 2. 조사 (에이전트 A·B·C 동시)

`references/agents.md`의 공통 머리 + A / B / C 지시문을 `{WORK}`만 바꿔 **그대로** 세 에이전트에게 한 번에 넘긴다. 결과: `out/headline.json`, `out/links.json`, `out/changes.json`, `out/tables.json`.

### 3. 엮기 (리더 = 이 세션)

1. A의 `claims`에 B·C의 id를 채운다: `related_links`(그 주장과 같은 주제·같은 쪽을 다루는 연결), `related_changes`, `prev`(vsPrev 중 같은 1쪽 문장).
2. `out/meta.json`을 쓴다(`references/schema.md`). 카드는 헤드라인 줄(H*)과 분해 주장 하나(보통 반도체 vs 반도체 외) 4~6개, `pair`는 그 주장의 `nih` 중 가장 무거운 것들을 60자 안으로. 반대 신호가 정말 없으면 `pair: null`과 `none`에 그렇다고 — 억지로 만들지 않는다. `viz`는 표의 종류에서 고르고 숫자는 A의 underneath·C의 tables에서 옮긴다.
3. `startClaim`은 풀어볼 거리가 가장 많은 카드.

### 4. 대조 (코드) → 검수

```
npm run trade:job -w server -- build $W
```
→ `data.json`, `verify-report.txt`. 빠진 항목은 보고서에 이름과 함께 남는다. "고쳐야 받습니다"가 나오면(1쪽 문장 인용이 틀림, 숫자 표가 출처 줄과 다름, 뺀 항목이 30% 초과) 해당 에이전트 결과를 고쳐 다시 돌린다 — **두 번까지**. 그다음 D(검수) 에이전트를 돌리고 `review.txt`의 지적을 리더가 `out/`에 반영한 뒤 build를 한 번 더.

### 5. 내놓기

- **자동**: `npm run trade:job -w server -- send <jobId> $W`. 200 `{ fileId, checked, passed, dropped, already }`면 끝. 422 `TRADE_JOB_REJECTED`(서버 대조에서 거절 — `fatal`에 이유)면 고쳐서 build부터 다시, **합쳐 2번까지**(지시서 `limits.resendMax`). 400은 형식(메시지가 `<경로>: <이유>`), 413은 2MB 초과.
- **수동**: `server/assets/trade-template.html`을 그대로 `index.html`로, `data.json`을 옆에 두고 Artifact로 게시한다(`files: {"data.json": "<W>/data.json"}`). 틀은 고치지 않는다.
- 보고: 인용 대조 결과(`n/n`), 뺀 항목 수, 가장 눈여겨볼 것 3~5개(헤드라인이 말하지 않는 것·쪽 넘는 연결에서), 검수에서 고친 것. 수동이면 링크도.

## 알려진 함정 (실측)

- 제목 띄어쓰기가 흔들린다(2026년 8월호 「수출입동향」). 같은 달 「정보통신산업(ICT) 수출입 동향」이 따로 있다 — 판정은 서버·`trade:fetch`가 한다.
- 1월 1일 호는 「연간 및 12월」(48쪽 안팎)이라 표 모양이 다르다. 숫자 표는 찾은 줄만, 못 찾은 것은 보고.
- 지역별 품목 숫자는 그달 1~25일 기준(16쪽 안내문) — 월 전체와 나란히 놓지 않는다.
- 품목 표의 '역대순위'는 **같은 달끼리** 순위다(2026년 10월 반도체: 표 1위, 전 기간 2위).
- 지난달 숫자는 이번 호에서 정정된다(9월→10월호 겹치는 396칸 중 약 100칸). 전월 값은 이번 호 표의 정정값을 쓰고, 다르면 둘 다 적는다.
- 그래프는 이미지라 텍스트로 안 나온다(27쪽 등) — 같은 숫자가 있는 표를 인용한다.
- 표의 줄을 인용할 때 pdftotext가 품목 이름과 숫자를 다른 줄로 가르는 일이 있다 — 숫자 줄을 인용한다.
