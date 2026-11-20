"""PDF를 쪽별 텍스트로 — 에이전트가 읽고 verify.py가 인용을 대조하는 바탕.

사용: python3 -I pages.py <작업폴더>
  <작업폴더>/cur.pdf, prev.pdf (trade:fetch가 받아 둔 것)
  → <작업폴더>/pages/cur/01.txt … , pages/cur/all.txt (쪽 머리 "===== 7쪽 =====" 로 이어 붙인 전문), prev도 같게
쪽 번호는 PDF 쪽(1부터). 실측으로 하단 인쇄 쪽번호 "- N -"와 1:1이다(2026년 9·10월호).
"""
import os
import subprocess
import sys


def page_count(pdf: str) -> int:
    out = subprocess.run(["pdfinfo", pdf], capture_output=True, text=True, check=True).stdout
    for line in out.splitlines():
        if line.startswith("Pages:"):
            return int(line.split()[1])
    raise SystemExit(f"쪽 수를 읽지 못했습니다: {pdf}")


def split(pdf: str, out_dir: str) -> int:
    os.makedirs(out_dir, exist_ok=True)
    n = page_count(pdf)
    whole = []
    for p in range(1, n + 1):
        text = subprocess.run(
            ["pdftotext", "-layout", "-f", str(p), "-l", str(p), pdf, "-"],
            capture_output=True, text=True, check=True,
        ).stdout
        with open(os.path.join(out_dir, f"{p:02d}.txt"), "w", encoding="utf-8") as f:
            f.write(text)
        whole.append(f"===== {p}쪽 =====\n{text}")
    with open(os.path.join(out_dir, "all.txt"), "w", encoding="utf-8") as f:
        f.write("\n".join(whole))
    return n


def main() -> None:
    if len(sys.argv) != 2:
        raise SystemExit("사용: python3 -I pages.py <작업폴더>")
    work = sys.argv[1]
    for name in ("cur", "prev"):
        pdf = os.path.join(work, f"{name}.pdf")
        if not os.path.exists(pdf):
            if name == "cur":
                raise SystemExit(f"{pdf}가 없습니다 — 먼저 npm run trade:fetch")
            print("prev.pdf 없음 — 전월 비교(vsPrev·changes)는 비워 둡니다")
            continue
        n = split(pdf, os.path.join(work, "pages", name))
        print(f"{name}: {n}쪽")


if __name__ == "__main__":
    main()
