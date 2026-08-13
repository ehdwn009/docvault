/** 인증 미들웨어가 컨텍스트에 실어주는 로그인 사용자 정보 */
export type SessionUser = {
  id: number;
  username: string;
  displayName: string | null;
  role: 'user' | 'admin';
};

/** 모든 라우트가 공유하는 Hono 환경 타입 */
export type AppEnv = {
  Variables: {
    user: SessionUser;
  };
};
