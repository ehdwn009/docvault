import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import { applyAppTheme, getAppTheme } from './lib/appTheme';
import { registerServiceWorker } from './lib/push';
import './index.css';

// 첫 페인트 전에 저장된 앱 테마를 입힌다 — 렌더 후에 하면 기본색이 한 번 번쩍인다
applyAppTheme(getAppTheme());

// 푸시를 받을 귀 — 켜 둔 기기는 앱이 열릴 때마다 워커가 살아 있어야 한다. 실패해도 앱은 그대로 (알림 2단계)
void registerServiceWorker()?.catch(() => {});

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
