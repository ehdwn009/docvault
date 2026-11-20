"""에이전트 결과를 원문과 대조하고 화면용 data.json 하나로 묶는다.

사용: python3 -I verify.py <작업폴더>
  읽는 것: <작업폴더>/out/{headline,links,changes,tables,meta}.json, pages/{cur,prev}/NN.txt
  쓰는 것: <작업폴더>/data.json, verify-report.txt

규칙 (references/schema.md "검증"):
- {page, quote}가 있는 모든 객체는 그 쪽 텍스트에 quote가 있어야 한다. 전월 호 인용은 객체에 "doc": "prev"(또는 경로의 prev 열쇠). 띄어쓰기·줄바꿈을 모두 지우고 부분 문자열로 비교한다
  (원문은 단어 중간에서 줄이 바뀌는 일이 많다). 경로에 prev가 들어 있으면 전월 호, 아니면 이번 호를 본다.
- 목록의 한 항목이 실패하면 그 항목을 뺀다. 목록이 아닌 자리(claims[].claim 등)가 실패하면 고칠 때까지 data.json을 만들지 않는다.
- 숫자 표(tables)는 행마다 source{page, quote}가 있어야 하고, 행의 값은 그 quote 안에 그대로(쉼표 무시) 있어야 한다.
- 뺀 항목을 가리키던 id(related_links, related_changes, prev, nih, headlineCompare, related)는 걷어 낸다.
"""
import json
import os
import re
import sys

WS = re.compile(r"\s+")


def norm(s: str) -> str:
    return WS.sub("", s or "")


class Pages:
    def __init__(self, work: str):
        self.text = {}
        for doc in ("cur", "prev"):
            d = os.path.join(work, "pages", doc)
            if not os.path.isdir(d):
                continue
            for f in os.listdir(d):
                if re.fullmatch(r"\d+\.txt", f):
                    with open(os.path.join(d, f), encoding="utf-8") as fh:
                        self.text[(doc, int(f[:-4]))] = norm(fh.read())

    def has(self, doc: str, page, quote: str) -> bool:
        if not isinstance(page, int) or not quote:
            return False
        return norm(quote) in self.text.get((doc, page), "")


def check_tree(node, path, pages, report, fatal):
    """{page, quote}를 찾아 대조. 실패한 목록 항목은 None으로 표시해 두고 나중에 걷어 낸다"""
    if isinstance(node, dict):
        if "page" in node and "quote" in node and isinstance(node.get("quote"), str):
            doc = node.get("doc") or ("prev" if any(p in ("prev", "sep") for p in path) else "cur")
            report["checked"] += 1
            if pages.has(doc, node["page"], node["quote"]):
                report["passed"] += 1
            else:
                return False
        for k, v in list(node.items()):
            ok = check_tree(v, path + [k], pages, report, fatal)
            if ok is False:
                if isinstance(v, dict) and "page" in v and "quote" in v:
                    # 목록이 아닌 자리의 인용 — 항목 전체를 버릴 수 없으면 치명. underneath의 quote처럼 선택 칸이면 그 칸만 지운다
                    if k in OPTIONAL_QUOTE_HOLDERS:
                        node.pop(k)
                        report["dropped"].append("/".join(path + [k]))
                    else:
                        return False
                else:
                    return False
        return True
    if isinstance(node, list):
        keep = []
        for i, v in enumerate(node):
            ok = check_tree(v, path + [str(i)], pages, report, fatal)
            if ok is False:
                report["dropped"].append("/".join(path + [str(i)]) + _label(v))
            else:
                keep.append(v)
        node[:] = keep
        return True
    return True


# 이 열쇠의 인용이 틀리면 열쇠만 지우고 부모는 살린다 (예: 품목의 why가 틀려도 품목 숫자 칸은 남긴다)
OPTIONAL_QUOTE_HOLDERS = {"why"}


def _label(v) -> str:
    if isinstance(v, dict):
        for k in ("id", "title", "label", "name", "what"):
            if k in v:
                return f" ({v[k]})"
    return ""


def check_quote_only_underneath(claims, pages, report):
    """underneath는 quote가 선택 칸이라 dict 검사 경로와 따로 — 있는데 틀리면 quote만 지우고 basis를 '원문 숫자로 계산'으로 낮추지 않는다(근거 없는 행은 뺀다)"""
    for c in claims:
        keep = []
        for u in c.get("underneath", []):
            if "quote" in u:
                report["checked"] += 1
                if pages.has(u.get("doc", "cur"), u.get("page"), u["quote"]):
                    report["passed"] += 1
                else:
                    report["dropped"].append(f"claims/{c.get('id')}/underneath ({u.get('label')})")
                    continue
            elif u.get("basis") != "원문 숫자로 계산" or not u.get("calc"):
                report["dropped"].append(f"claims/{c.get('id')}/underneath ({u.get('label')}) — 인용도 계산식도 없음")
                continue
            keep.append(u)
        c["underneath"] = keep


def check_tables(tables, pages, report):
    bad = []
    for key, row in list(tables.get("rows", {}).items()):
        src = row.get("source") or {}
        report["checked"] += 1
        q = src.get("quote", "")
        if not pages.has("cur", src.get("page"), q):
            bad.append(f"tables/{key}: 출처 인용이 {src.get('page')}쪽에 없음")
            continue
        flat = norm(q).replace(",", "")
        missing = [v for v in row.get("values", []) if v is not None and norm(str(v)).replace(",", "") not in flat]
        if missing:
            bad.append(f"tables/{key}: 값 {missing[:3]}이 출처 줄에 없음")
            continue
        report["passed"] += 1
    return bad


def prune_refs(data):
    ids = lambda xs: {x.get("id") for x in xs}
    links, changes, vs, nih = ids(data["links"]), ids(data["changes"]), ids(data["vsPrev"]), ids(data["nih"])
    for c in data["claims"]:
        c["related_links"] = [x for x in c.get("related_links", []) if x in links]
        c["related_changes"] = [x for x in c.get("related_changes", []) if x in changes]
        c["prev"] = [x for x in c.get("prev", []) if x in vs]
        if "nih" in c:
            c["nih"] = [x for x in c["nih"] if x in nih]
    for n in data["nih"]:
        n["related"] = [x for x in n.get("related", []) if x in links or x in changes]
    m = data["meta"]
    m["headlineCompare"] = [x for x in m.get("headlineCompare", []) if x in vs]
    claim_ids = ids(data["claims"])
    m["cards"] = [c for c in m.get("cards", []) if c.get("id") in claim_ids]
    m["kpis"] = [k for k in m.get("kpis", []) if k.get("claim") in claim_ids]


def load(work, name, default=None):
    p = os.path.join(work, "out", f"{name}.json")
    if not os.path.exists(p):
        if default is not None:
            return default
        raise SystemExit(f"{p}가 없습니다")
    with open(p, encoding="utf-8") as f:
        return json.load(f)


def main() -> None:
    if len(sys.argv) != 2:
        raise SystemExit("사용: python3 -I verify.py <작업폴더>")
    work = sys.argv[1]
    pages = Pages(work)
    if not any(k[0] == "cur" for k in pages.text):
        raise SystemExit("pages/cur가 없습니다 — 먼저 pages.py")
    h, l, ch, tb, meta = load(work, "headline"), load(work, "links"), load(work, "changes", {"changes": [], "vsPrev": []}), load(work, "tables"), load(work, "meta")
    report = {"checked": 0, "passed": 0, "dropped": []}
    fatal = []

    check_quote_only_underneath(h.get("claims", []), pages, report)
    for c in h.get("claims", []):
        u = c.pop("underneath", [])
        if check_tree(c, ["claims", c.get("id", "?")], pages, report, fatal) is False:
            fatal.append(f"claims/{c.get('id')}: 원문 문장(claim)이나 근거 인용이 원문에 없음")
        c["underneath"] = u
    for key in ("items20", "regions", "nih"):
        check_tree(h.get(key, []), [key], pages, report, fatal)
    vs_prev = ch.get("vsPrev", h.get("vsPrev", []))
    check_tree(vs_prev, ["vsPrev"], pages, report, fatal)
    check_tree(ch.get("changes", []), ["changes"], pages, report, fatal)
    for key in ("topics", "links"):
        check_tree(l.get(key, []), [key], pages, report, fatal)
    fatal += check_tables(tb, pages, report)

    data = {
        "meta": meta,
        "claims": h["claims"],
        "vsPrev": vs_prev,
        "items20": h.get("items20", []),
        "items20_summary": h.get("items20_summary", {}),
        "regions": h.get("regions", []),
        "nih": h.get("nih", []),
        "links": l.get("links", []),
        "changes": ch.get("changes", []),
        "topics": [t for t in l.get("topics", []) if t.get("mentions")],
        "pages": l.get("pages", []),
        "series": tb.get("series", {}),
        "itemSeries": tb.get("itemSeries", {}),
    }
    prune_refs(data)
    meta["quotesChecked"] = report["passed"]

    lines = [f"인용·출처 대조 {report['passed']}/{report['checked']} 통과", f"뺀 항목 {len(report['dropped'])}개"]
    lines += [f"  - {d}" for d in report["dropped"]]
    if fatal:
        lines += ["고쳐야 data.json을 만듭니다:"] + [f"  ! {f}" for f in fatal]
    with open(os.path.join(work, "verify-report.txt"), "w", encoding="utf-8") as f:
        f.write("\n".join(lines) + "\n")
    print("\n".join(lines))
    if fatal:
        raise SystemExit(1)
    with open(os.path.join(work, "data.json"), "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False)
    print(f"→ {os.path.join(work, 'data.json')}")


if __name__ == "__main__":
    main()
