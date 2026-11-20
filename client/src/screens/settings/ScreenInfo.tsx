import { useEffect, useState } from 'react';
import { EDGE_PATH } from '../../lib/constants';
import { coversScreenTop, getEdgeFill, setEdgeFill, STARTED_FROM_EDGE, withheldWidth } from '../../lib/screenEdge';
import { btnClass, Switch } from './SettingRow';

type Info = { label: string; value: string }[];

/** 기기가 알려 주는 가장자리 여백을 px로 — env()는 JS에서 바로 읽을 수 없어, 그 값을 padding으로 준 보이지 않는 상자를 재 본다 */
function readInsets(): { top: number; right: number; bottom: number; left: number } {
  const probe = document.createElement('div');
  probe.style.cssText =
    'position:fixed;visibility:hidden;pointer-events:none;padding:env(safe-area-inset-top,0px) env(safe-area-inset-right,0px) env(safe-area-inset-bottom,0px) env(safe-area-inset-left,0px)';
  document.body.appendChild(probe);
  const cs = getComputedStyle(probe);
  const px = (v: string) => Math.round(parseFloat(v) * 10) / 10 || 0;
  const out = { top: px(cs.paddingTop), right: px(cs.paddingRight), bottom: px(cs.paddingBottom), left: px(cs.paddingLeft) };
  probe.remove();
  return out;
}

function collect(): Info {
  const vv = window.visualViewport;
  const sa = readInsets();
  const standalone = window.matchMedia('(display-mode: standalone)').matches || (navigator as { standalone?: boolean }).standalone === true;
  // 접는 기기의 자세·화면 조각 — 아직 시험 기능이라 없는 브라우저가 대부분이다
  const posture = (navigator as { devicePosture?: { type?: string } }).devicePosture?.type;
  const segments = (window as { viewport?: { segments?: unknown[] } }).viewport?.segments?.length;
  return [
    { label: '기기 화면', value: `${screen.width} × ${screen.height} (배율 ${window.devicePixelRatio})` },
    { label: '앱이 받은 영역', value: `${window.innerWidth} × ${window.innerHeight}` },
    { label: '지금 보이는 영역', value: vv ? `${Math.round(vv.width)} × ${Math.round(vv.height)}` : '알 수 없음' },
    { label: '가장자리 여백', value: `위 ${sa.top} · 오른쪽 ${sa.right} · 아래 ${sa.bottom} · 왼쪽 ${sa.left}` },
    { label: '화면 가로', value: withheldWidth() === 0 ? '앱이 가로 끝까지 받음' : `기기가 ${withheldWidth()}만큼 내주지 않음 (옆 띠·창 나눔)` },
    // 비킴은 위 여백이 12px보다 작을 때만 실제로 내려 앉힌다(index.css의 max())
    { label: '화면 맨 위', value: !coversScreenTop() ? '위에 상태 표시·주소창이 있음' : sa.top < 12 ? '앱이 맨 위까지 덮음 (모서리 비킴 켜짐)' : '앱이 맨 위까지 덮음 (위 여백이 있어 비킴 없음)' },
    { label: '여는 방식', value: `${standalone ? '홈 화면 앱' : '브라우저'}${STARTED_FROM_EDGE ? ' · 시험 입구' : ''}` },
    { label: '접힘 상태', value: `${posture ?? '알 수 없음'}${segments ? ` · 화면 조각 ${segments}` : ''}` },
    { label: '기기 정보', value: navigator.userAgent },
  ];
}

// 나 › 정보의 「화면 정보」 — 화면 크기가 낯선 기기에서 앱이 실제로 받은 영역과 여백을 보여 준다.
// 기기 이름이 아니라 이 값으로 배치를 정하려고, 실기기 값을 사람이 읽어 전해 줄 수 있게 둔 칸이다 (IA — 화면 가장자리 2026-11-20)
export default function ScreenInfo() {
  const [info, setInfo] = useState<Info>(collect);
  const [fill, setFill] = useState(getEdgeFill);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    const update = () => setInfo(collect());
    window.addEventListener('resize', update);
    window.visualViewport?.addEventListener('resize', update);
    return () => {
      window.removeEventListener('resize', update);
      window.visualViewport?.removeEventListener('resize', update);
    };
  }, []);

  const copy = () => {
    const text = info.map((r) => `${r.label}: ${r.value}`).join('\n');
    void navigator.clipboard
      ?.writeText(text)
      .then(() => setCopied(true))
      .catch(() => setCopied(false));
  };

  return (
    <div className="space-y-3 text-sm">
      <dl className="divide-y divide-slate-800 rounded-lg border border-slate-800">
        {info.map((r) => (
          <div key={r.label} className="flex gap-3 px-3 py-2">
            <dt className="w-28 shrink-0 text-slate-500">{r.label}</dt>
            <dd className="min-w-0 flex-1 break-words text-slate-200">{r.value}</dd>
          </div>
        ))}
      </dl>
      <div className="flex flex-wrap items-center gap-2">
        <button onClick={copy} className={btnClass}>값 복사</button>
        {copied && <span role="status" className="text-xs text-accent-400">복사했어요</span>}
      </div>
      <div className="flex items-center gap-3">
        <p className="min-w-0 flex-1 text-xs leading-relaxed text-slate-500">
          <span className="text-slate-300">오른쪽 여백까지 넓히기 (시험)</span>
          <br />
          오른쪽 여백을 비워 두지 않고 내용을 화면 끝까지 넓힙니다. 여백이 0인 기기에서는 달라지지 않아요
        </p>
        <Switch
          checked={fill}
          label="오른쪽 여백까지 넓히기"
          onChange={(v) => {
            setEdgeFill(v);
            setFill(v);
          }}
        />
      </div>
      <p className="text-xs leading-relaxed text-slate-500">
        시험 입구(아이폰): Safari에서 <span className="break-all text-slate-300">{location.origin + EDGE_PATH}</span> 를 열고 공유 → 「홈 화면에 추가」를 하면 「Loft 시험」 아이콘이 생깁니다. 그
        아이콘으로 열면 상태 표시(시계·배터리) 아래까지 화면을 쓰도록 요청합니다. 원래 아이콘은 그대로예요. 시험 아이콘에서 다시 로그인한 뒤 이 칸을 열어, 「앱이 받은 영역」의 가로
        숫자가 원래 아이콘에서 볼 때보다 커졌는지 비교하면 됩니다 — 커졌으면 옆 띠 뒤까지 화면을 받은 것입니다
      </p>
    </div>
  );
}
