# data.json 형식 (trade-report)

화면 템플릿(`assets/template.html`)이 읽는 한 파일. 에이전트들은 이것을 조각으로 나눠 `out/`에 쓰고, `verify.py`가 대조한 뒤 합친다. 완성 예: `assets/example-data.json`(2026년 10월호, 인용 420개 대조 통과).

## 공통 규칙

- **쪽 번호는 PDF 쪽(1부터)**, `pages/cur/NN.txt`의 NN과 같다.
- **인용 객체** `{ "page": 7, "quote": "원문 그대로" }` — quote는 그 쪽 텍스트에 **글자 그대로** 있어야 한다(띄어쓰기·줄바꿈만 무시). 120자 이내. 요약하거나 고쳐 쓰지 않는다. 표의 줄을 인용할 때는 그 줄을 그대로 옮긴다.
- **전월 호 인용**은 객체에 `"doc": "prev"`를 붙이거나 `prev` 열쇠 아래에 둔다.
- **숫자는 새로 만들지 않는다.** 원문에 있는 숫자는 인용과 함께, 원문 숫자로 계산한 값은 `"basis": "원문 숫자로 계산"`과 `"calc": "식 = 값"`을 함께.
- 감소는 음수(원문의 △). 금액은 억 달러(품목 13개월 추이만 백만 달러 — 원문 표 단위 그대로).
- 서로 가리킬 때는 순번이 아니라 **id**로(검증에서 빠진 항목이 생겨도 어긋나지 않게).

## out/headline.json — 에이전트 A

```json
{
  "claims": [{
    "id": "H1",                       // 헤드라인 줄 H1~, 요약 줄 S1~, 【총괄】 T1, 【수출】 X1~, 역대 순위 각주 R1~, 1쪽 반도체 문단·각주 B1~
    "short": "앱에 띄울 짧은 제목 (20자 안팎)",
    "claim": {"page": 1, "quote": "1쪽 원문 문장 그대로"},
    "evidence": [{"page": 5, "quote": "…"}],          // 같은 주장을 뒷받침하는 다른 쪽 2~4개
    "underneath": [{                                  // 풀어보기 — 뭉뚱그린 것을 구체적으로
      "label": "9월 수출(정정값)", "value": "1,210.5억 달러 (…)",
      "page": 19, "quote": "1,210.5 1,152.8", "basis": "원문",
      // 또는 "basis": "원문 숫자로 계산", "calc": "(115,276 ÷ 121,050 − 1) × 100 = -4.8%"
      // 전월 호 인용이면 "doc": "prev"
    }],
    "related_links": ["L05"], "related_changes": ["C01"],
    "prev": ["V01"],                                   // vsPrev의 id
    "nih": ["N01", "N02"]                              // 이 주장 옆에 붙일 "말하지 않는 것" (카드로 쓰는 주장만)
  }],
  "items20": [{                                        // 1쪽·6쪽·11쪽·20~21쪽 품목 표를 교차 확인해 전부
    "name": "반도체", "amt": 564.4, "yoy": 259.4, "share": 49.0,
    "prev_yoy": 262.8, "prev_yoy_revised": 262.8,      // 전월 호 발표값 / 이번 호 표의 정정값
    "mom_pct": -6.4, "increase": 407.4,
    "dir_change": "유지 | 전환↑ | 전환↓",                // 전월 대비 증감 방향
    "record_rank_same_month": "1위",                   // 표의 '역대순위'는 같은 달끼리 비교 — 기준을 꼭 구분
    "why": {"page": 12, "quote": "원문 해설"}, "note": "한두 문장"
  }],
  "items20_summary": {"increased": 18, "decreased": ["선박 -43.6"], "prev_increased": 11, "turned_up": ["…"], "turned_down": ["…"]},
  "regions": [{"name": "중국", "amt": 269.8, "yoy": 133.6, "prev_yoy": 122.7, "prev_yoy_revised": 123.1, "dir_change": "유지", "balance": 88}],
  "nih": [{"id": "N01", "title": "수출 금액은 두 배, 무게는 3.1% 감소", "page": 18, "quote": "…", "why": "왜 중요한지", "related": ["L12", "C04"]}]
}
```

## out/links.json — 에이전트 B

```json
{
  "pages": [{"page": 1, "title": "그 쪽에 무엇이 있나 한 줄", "note": "인용이 없을 때 이유(선택)"}],
  "topics": [{"id": "semiconductor", "name": "반도체", "group": "총괄|품목|지역|요인",
              "mentions": [{"page": 12, "kind": "text|table|footnote", "figure": "핵심 수치 한 줄", "quote": "…"}]}],
  "links": [{"id": "L01", "title": "짧은 제목", "relation": "원인→결과 / 금액 vs 물량 / 기간 기준 차이 / 상충·긴장 / 같은 사실 다른 각도 …",
             "from": {"topic": "oil_price", "page": 2, "quote": "…"}, "to": {"topic": "petro", "page": 8, "quote": "…"},
             "explain": "비개발자용 2~3문장 — 왜 둘을 같이 봐야 하나", "confidence": "원문이 직접 말함 | 원문 숫자로 추론"}]
}
```
주제 id는 화면이 품목·지역 칸과 잇는 데 쓴다 — 품목은 `semiconductor computer auto ship petro cosmetics`, 지역은 `china usa asean eu mideast`를 그대로 쓰고, 그 밖의 주제(총괄·요인)는 자유(`export import balance memory_price oil_price workdays fx` 등).

## out/changes.json — 에이전트 C

```json
{
  "vsPrev": [{"id": "V01", "kind": "유지|신규|사라짐|숫자변화", "prev": {"page": 1, "quote": "전월 호"}, "cur": {"page": 1, "quote": "이번 호"}, "note": "무엇이 왜 바뀌었나"}],
  "changes": [{"id": "C01", "what": "한 줄", "prev": {"page": 1, "quote": "…"}, "cur": {"page": 19, "quote": "…"}, "why": "왜 중요한가"}]
}
```
vsPrev는 1쪽 문장끼리, changes는 문서 전체에서 **헤드라인 말고 작은 데서** 바뀐 것(지난달 숫자 정정, 작은 품목 방향 전환, 연속 기록이 이어지거나 끊김, 새로 생기거나 사라진 문구·각주, 본문과 표의 불일치).

## out/tables.json — 에이전트 C

```json
{
  "series": {"months": ["’25.10", "11", "…", "10"], "exp": [595, …], "imp": [535, …], "bal": [60, …], "daily": [29.8, …]},
  "itemSeries": {"반도체": [15701, …13개]},
  "rows": {
    "exp": {"source": {"page": 18, "quote": "수출액 595 608 … 1,153"}, "values": [595, …]},
    "item:반도체": {"source": {"page": 20, "quote": "173,406 15,701 … 56,438"}, "values": [15701, …]}
  }
}
```
`rows`의 각 값은 출처 줄에 그대로(쉼표 무시) 있어야 한다 — 아니면 verify가 멈춘다. series·itemSeries의 숫자는 rows에서 옮긴다.

## out/meta.json — 리더(이 세션)가 A~C를 읽고 쓴다

```json
{
  "period": "2026-10", "label": "2026년 10월", "month": "10월", "prevMonth": "9월", "nextMonth": "11월",
  "published": "2026. 11. 1.(일) 11:00", "dept": "수출입과", "articleUrl": "release.json의 cur.articleUrl", "pdfPages": 36,
  "sourceTitle": "「2026년 10월 수출입 동향」(2026.11.1, 36쪽)", "compareTitle": "「2026년 9월 수출입 동향」(2026.10.1)",
  "startClaim": "H3",                                  // 처음 열어 둘 카드 — 풀어볼 거리가 가장 많은 것
  "kpis": [{"claim": "H1", "label": "수출", "value": "1,152.8억 달러", "sub": [["▲93.7%", "up"], [" · 9월 대비 ▼4.8% ✎", "muted"]], "spark": "exp|imp|bal|daily"}],
  "cards": [{"id": "H1", "pair": "같이 봐야 할 신호 한 줄 (60자 안)"}, {"id": "H4", "pair": null, "none": "원문에서 맞설 신호를 찾지 못했습니다 · 근거는 …"}],
  "headlineCompare": ["V01", "V03"],                  // 맞대기 상자에 넣을 1쪽 헤드라인 비교
  "vizAlias": {"X1": "H1"},                            // 같은 그림을 쓰는 주장
  "viz": {"H1": [ { "type": "bars13", … } ] }
}
```

`viz` 종류 (주장마다 0~3개, 숫자는 전부 A의 underneath·tables에서 옮긴다 — 그림을 위해 숫자를 새로 만들지 않는다):

| type | 칸 | 쓰는 곳 |
|---|---|---|
| `bars13` | `series`(exp·imp·bal·daily), `caption`, `page`, `highlight`(끝에서 몇 개 강조) | 총액 추이 |
| `hbars` | `rows[{label, value, page}]`, `unit: "%"`, `caption`, `note` | 같은 숫자를 기준 여럿으로 (총액·일평균·원화·물량) |
| `waterfall` | `rows[{label, from, to, tone?: "hi"\|"lo"}]`, `max`, `caption`, `page`, `calc: true`, `note` | 흑자 변화 분해 |
| `stack` | `segments[{label, pct, tone}]`, `caption`, `page?`, `calc?`, `note?` | 구성비 (반도체 vs 그 외) |
| `progress` | `value`, `total`, `labels[3]`, `caption`, `page`, `note` | 연간 목표까지 거리 |
| `grid20` | `note` | 품목 수 주장 — 품목 격자와 감소 품목 이유 |

`caption`·`note`의 숫자도 원문에 있거나 underneath의 계산과 같아야 한다(리더가 확인한다 — 자동 대조는 인용만 한다).
