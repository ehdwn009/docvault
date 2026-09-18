import { useEffect, useState } from 'react';

type VV = { height: number; offsetTop: number };

function read(): VV {
  const v = window.visualViewport;
  return v ? { height: v.height, offsetTop: v.offsetTop } : { height: window.innerHeight, offsetTop: 0 };
}

/**
 * 지금 실제로 보이는 영역(visual viewport)의 높이·시작 위치.
 *
 * 폰에서 키보드가 올라오면 `100vh`·`position: fixed; bottom: 0`은 그대로인데 **보이는 영역만 줄어든다** —
 * 그래서 아래에 붙인 시트의 머리가 화면 밖으로 밀려 나가고 입력창 위가 텅 비어 보인다 (v0.23.0 아이폰에서 실제로 겪음).
 * `visualViewport`는 브라우저가 알려 주는 "지금 보이는 사각형"이라, 시트를 이 값에 맞추면 키보드 위에 정확히 앉는다.
 * enabled=false면 구독하지 않고 초기값만 돌려준다 (PC에서는 필요 없다).
 */
export function useVisualViewport(enabled: boolean): VV {
  const [vv, setVv] = useState<VV>(read);
  useEffect(() => {
    const v = window.visualViewport;
    if (!enabled || !v) return;
    const update = () => setVv(read());
    update();
    v.addEventListener('resize', update);
    v.addEventListener('scroll', update);
    return () => {
      v.removeEventListener('resize', update);
      v.removeEventListener('scroll', update);
    };
  }, [enabled]);
  return vv;
}
