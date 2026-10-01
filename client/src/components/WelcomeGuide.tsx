import { useState } from 'react';
import Icon, { type IconName } from './Icon';

type Props = {
  /** 터치 기기면 "☰ 서랍", PC면 "왼쪽 아이콘 줄"로 안내한다 */
  touch: boolean;
  onOpenSettings: () => void;
  onClose: () => void;
};

type Step = { icon: IconName; title: string; body: string[] };

// SCR-148 첫 사용 안내 — 새 계정의 첫 화면에 패치노트(개발 기록)가 떠서 앱 사용법보다 먼저 보였다 (사용성 평가 2026-10-01).
// 세 장만 넘기고 끝낸다. 닫으면 지금 버전을 본 것으로 기록해 이후에는 새 버전의 패치노트만 뜬다
export default function WelcomeGuide({ touch, onOpenSettings, onClose }: Props) {
  const [i, setI] = useState(0);
  const steps: Step[] = [
    {
      icon: 'files',
      title: '내 문서는 여기서 찾아요',
      body: [
        touch
          ? '왼쪽 위 ☰ 버튼을 누르면 내 파일·공유·검색이 담긴 서랍이 열려요.'
          : '왼쪽 아이콘 줄에서 내 파일·공유·검색을 고를 수 있어요.',
        '파일을 누르면 바로 열리고, [+ 새 문서]로 글을 새로 쓸 수 있어요.',
      ],
    },
    {
      icon: 'users',
      title: '함께 보는 파일 · 이어 읽기',
      body: [
        '다른 사람이 나에게 보여 준 문서는 [공유]에 모여요.',
        '읽던 문서는 다음에 들어와도 읽던 자리에서 이어져요.',
        touch ? '찾는 문서는 돋보기(검색)로 이름·내용을 찾아요.' : '찾는 문서는 Ctrl+K로 이름·내용을 찾아요.',
      ],
    },
    {
      icon: 'settings',
      title: '처음 받은 비밀번호를 바꿔 주세요',
      body: [
        '관리자가 알려 준 비밀번호는 나만 아는 것으로 바꾸는 게 안전해요.',
        '[설정] → 비밀번호 변경에서 바꿀 수 있어요.',
      ],
    },
  ];
  const step = steps[i]!;
  const last = i === steps.length - 1;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
      <div className="flex w-full max-w-sm flex-col rounded-xl border border-slate-700 bg-slate-900 shadow-2xl">
        <div className="flex items-center gap-2 px-5 pt-4">
          <span className="text-xs text-slate-500">
            처음 오셨네요 · {i + 1}/{steps.length}
          </span>
          <button onClick={onClose} className="ml-auto flex h-8 w-8 items-center justify-center text-slate-500 hover:text-slate-300" title="닫기">
            ✕
          </button>
        </div>
        <div className="flex flex-col items-center gap-3 px-6 pb-2 pt-3 text-center">
          <span className="flex h-14 w-14 items-center justify-center rounded-2xl bg-slate-800 text-sky-300">
            <Icon name={step.icon} size={28} />
          </span>
          <h3 className="text-base font-semibold text-slate-100">{step.title}</h3>
          <div className="flex flex-col gap-1.5 text-sm leading-relaxed text-slate-400">
            {step.body.map((line) => (
              <p key={line}>{line}</p>
            ))}
          </div>
        </div>
        <div className="flex justify-center gap-1.5 py-3" aria-hidden="true">
          {steps.map((_, n) => (
            <span key={n} className={`h-1.5 w-1.5 rounded-full ${n === i ? 'bg-sky-400' : 'bg-slate-700'}`} />
          ))}
        </div>
        <div className="flex gap-2 border-t border-slate-800 px-5 py-3">
          {i > 0 && (
            <button
              onClick={() => setI(i - 1)}
              className={`min-h-11 rounded-md border border-slate-700 text-sm text-slate-300 hover:bg-slate-800 ${last ? 'px-4' : 'flex-1'}`}
            >
              이전
            </button>
          )}
          {last ? (
            <>
              <button
                onClick={onOpenSettings}
                className="min-h-11 flex-1 whitespace-nowrap rounded-md border border-slate-700 text-sm text-slate-300 hover:bg-slate-800"
              >
                비밀번호 바꾸기
              </button>
              <button
                onClick={onClose}
                className="min-h-11 flex-1 rounded-md bg-slate-100 text-sm font-medium text-slate-900 hover:bg-white"
              >
                시작하기
              </button>
            </>
          ) : (
            <button
              onClick={() => setI(i + 1)}
              className="min-h-11 flex-1 rounded-md bg-slate-100 text-sm font-medium text-slate-900 hover:bg-white"
            >
              다음
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
