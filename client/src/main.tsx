import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import { applyAppTheme, getAppTheme } from './lib/appTheme';
import './index.css';

// 첫 페인트 전에 저장된 앱 테마를 입힌다 — 렌더 후에 하면 기본색이 한 번 번쩍인다
applyAppTheme(getAppTheme());

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
