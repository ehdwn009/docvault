// SCR-404 안의 "이름 이야기" — 왜 Loft인지, 사다리는 어디서 왔는지 (이름·아이콘 결정 2026-11-04).
// 설정 화면의 유일한 "읽을거리"라 톤이 다르다: 설명서가 아니라 집 짓는 사람의 메모처럼.

const CANDIDATES: { name: string; meaning: string; verdict: string }[] = [
  { name: '마루', meaning: '집 한가운데, 방들을 잇는 바닥', verdict: '뜻은 제일 넓었지만 검색하면 다른 마루가 너무 많았다' },
  { name: '다락', meaning: '지붕 밑 나만의 방', verdict: '"숨겨 둔 창고"로 읽히면 매일 아침 오는 브리핑과 안 어울렸다' },
  { name: '터', meaning: '집을 짓는 자리', verdict: '"터 켜 봐"가 입에 안 붙었다' },
  { name: 'Den', meaning: '작은 서재, 아지트', verdict: '한국어로 뜻이 바로 안 오고, 영어로는 짐승 굴이기도 하다' },
  { name: 'Nook', meaning: '아늑한 구석', verdict: '같은 이름의 전자책 단말기가 있었다' },
];

export default function NameStory() {
  return (
    <div className="space-y-5 text-sm leading-relaxed text-slate-300">
      <section className="space-y-2">
        <h4 className="font-semibold text-slate-100">방 하나, 집은 짓는 중</h4>
        <p>
          이 앱은 문서를 넣어 두는 금고로 시작했다. 그래서 첫 이름이 docvault였다. 그런데 어느새 아침마다 뉴스 브리핑이 오고, 읽다가 AI에게 묻고, 배운 걸 카드로
          남기게 됐다. 금고라기엔 안에서 사람이 너무 많은 일을 한다.
        </p>
        <p>
          만든 사람의 말을 빌리면 "문서와 AI가 함께 있는 작업실인데, 이것도 하나의 방일 뿐이야. 집은 아직 완성되지 않았어." 그래서 기능 이름 대신{' '}
          <b className="text-slate-100">집 안의 공간 이름</b>을 찾기로 했다. 방이 더 생겨도 좁아지지 않을 이름으로.
        </p>
      </section>

      <section className="space-y-2">
        <h4 className="font-semibold text-slate-100">왜 Loft인가</h4>
        <p>
          로프트는 원래 비어 있던 위층이다. 창고였다가, 누가 올라가 책상을 놓으면 작업실이 되고, 침대를 들이면 방이 된다. 정해진 용도가 없어서 뭐든
          된다. 지금 이 앱이 딱 그렇다. 위층 하나를 먼저 쓰고 있고, 아래층은 아직 공사 중이다.
        </p>
        <p>네 글자라 폰 홈 화면 아래 11px 글씨로도 읽히고, 주소로 써도 깔끔하다. 그리고 "로프트에 올라간다"는 말에는 한 칸씩 오른다는 뜻이 들어 있다.</p>
      </section>

      <section className="space-y-2">
        <h4 className="font-semibold text-slate-100">아이콘은 왜 사다리인가</h4>
        <p>
          처음 그린 아이콘은 지붕이었다. 보자마자 아파트 분양 광고 같다는 말이 나왔다. 맞는 말이었다. 지붕을 그리면 "집"이 되지, "로프트"가 되지 않는다.
        </p>
        <p>
          로프트에만 있고 다른 방에는 없는 것이 뭘까. <b className="text-slate-100">사다리</b>다. 사다리가 없으면 로프트에 못 올라간다. 그래서 지붕을
          지우고 사다리 하나만 남겼다. 살짝 기울인 건 벽에 기대어 세워 둔, 지금 누가 오르는 중인 사다리라서.
        </p>
        <p className="text-slate-400">
          색은 바꾸지 않았다. 남색 바탕에 하늘색. 이름이 바뀌어도 홈 화면에서 "어, 그 앱" 하고 알아보라고.
        </p>
      </section>

      <section className="space-y-2">
        <h4 className="font-semibold text-slate-100">떨어진 후보들</h4>
        <ul className="space-y-1.5">
          {CANDIDATES.map((c) => (
            <li key={c.name} className="flex gap-2">
              <span className="w-12 shrink-0 font-semibold text-slate-200">{c.name}</span>
              <span className="min-w-0">
                <span className="text-slate-300">{c.meaning}</span>
                <span className="block text-xs text-slate-500">{c.verdict}</span>
              </span>
            </li>
          ))}
        </ul>
      </section>

      <p className="text-xs text-slate-500">
        저장소와 서버 주소는 docvault 그대로다. 이름은 문패이고, 문패를 바꿨다고 집을 옮기지는 않는다.
      </p>
    </div>
  );
}
