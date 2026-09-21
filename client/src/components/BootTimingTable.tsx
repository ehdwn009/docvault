import { useState } from 'react';
import { readBoot } from '../lib/bootTiming';

// SCR-306: 관리자 → 성능 — "이 기기의 이번 시작 시간". 설정이 아니라 관리자에 있는 이유: 설정은 내 취향, 이건 운영 진단.
// 서버가 아니라 지금 이 브라우저가 잰 값이라, 관리자 계정으로 연 이 기기의 사정만 보인다 (lib/bootTiming.ts)
export default function BootTimingTable() {
  const [boot] = useState(readBoot);
  if (!boot) return <p className="text-xs text-slate-500">아직 잰 기록이 없습니다. 새로고침하면 다시 잽니다</p>;
  return (
    <div className="rounded-md border border-slate-800 bg-slate-900/60 px-3 py-2 text-xs">
      <div className="flex items-baseline justify-between text-slate-400">
        <span>이 기기의 이번 시작 시간</span>
        <span className="font-medium text-slate-200">{(boot.total / 1000).toFixed(1)}초</span>
      </div>
      <table className="mt-1.5 w-full text-[11px] text-slate-500">
        <tbody>
          {boot.steps.map((st) => (
            <tr key={st.name}>
              <td className="py-0.5 pr-2">{st.name}</td>
              <td className="py-0.5 text-right tabular-nums text-slate-300">{st.ms.toLocaleString()}ms</td>
            </tr>
          ))}
          <tr>
            <td className="py-0.5 pr-2">앱 파일 (JS {boot.jsFiles}개)</td>
            {/* 0KB = 브라우저 캐시에서 꺼냈다 — 압축·1년 캐시가 먹힌 증거라 그렇게 적는다 */}
            <td className="py-0.5 text-right tabular-nums text-slate-300">{boot.jsKB === 0 ? '캐시' : `${boot.jsKB.toLocaleString()}KB`}</td>
          </tr>
        </tbody>
      </table>
      {boot.requests.length > 0 && (
        // 요청 하나를 넷으로 쪼갠 표 — "응답"이 큰데 서버가 작으면 회선, "그 뒤"가 크면 폰이 바쁜 것
        <>
          <div className="mt-2 text-slate-400">요청별 (어디서 시간이 갔나)</div>
          <table className="mt-1 w-full text-[11px] text-slate-500">
            <thead className="text-[10px] text-slate-600">
              <tr>
                <th className="pr-1 text-left font-normal">요청</th>
                <th className="px-1 text-right font-normal">대기</th>
                <th className="px-1 text-right font-normal">응답</th>
                <th className="px-1 text-right font-normal">받기</th>
                <th className="px-1 text-right font-normal">그 뒤</th>
                <th className="pl-1 text-right font-normal">크기</th>
              </tr>
            </thead>
            <tbody className="tabular-nums whitespace-nowrap">
              {boot.requests.map((r) => (
                <tr key={r.path}>
                  <td className="max-w-[9rem] truncate py-0.5 pr-1 text-slate-400">{r.path}</td>
                  <td className="px-1 py-0.5 text-right text-slate-300">{r.beforeMs.toLocaleString()}</td>
                  <td className="px-1 py-0.5 text-right text-slate-300">
                    {r.waitMs.toLocaleString()}
                    {r.serverMs !== null && <span className="text-slate-600"> (서버 {r.serverMs})</span>}
                  </td>
                  <td className="px-1 py-0.5 text-right text-slate-300">{r.downloadMs.toLocaleString()}</td>
                  <td className="px-1 py-0.5 text-right text-slate-300">{r.afterMs === null ? '–' : r.afterMs.toLocaleString()}</td>
                  <td className="py-0.5 pl-1 text-right text-slate-300">{r.bytes === 0 ? '캐시' : `${(r.bytes / 1024).toFixed(r.bytes < 10240 ? 1 : 0)}K`}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
      <p className="mt-1.5 text-[10px] text-slate-600">
        새로고침하면 다시 잽니다. 서버 첫 응답이 크면 서버가 잠에서 깨는 시간, 다운로드가 크면 앱 파일 크기입니다. 요청별 표는 전부 ms — 대기=보내기 전, 응답=답을 기다린 시간(괄호는 그중 서버가 일한 시간), 받기=다운로드, 그 뒤=받고 나서 화면까지, 크기=회선으로 받은 양(압축 후, KB).
        응답이 큰데 괄호의 서버가 작으면 폰과 서버 사이 회선이, "그 뒤"가 크면 폰이 바빠서 응답을 못 챙긴 시간입니다. 서버가 0.5초 넘게 일한 요청은 서버 로그에 [slow]로 부분별 시간이 찍힙니다
      </p>
    </div>
  );
}
