// vite의 특수 import(?url 등) 타입 — PDF 워커를 별도 파일 URL로 받는 데 필요
/// <reference types="vite/client" />

// vite.config.ts의 define으로 빌드 시점에 주입되는 상수들
declare const __APP_VERSION__: string;
declare const __BUILD_DATE__: string;
