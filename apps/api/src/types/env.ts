/**
 * 전역 환경 변수 타입 보강.
 * `import 'apps/api/src/types/env'` 하지 않아도 모듈 그래프에 포함되면
 * 자동으로 process.env 에 타입 정보가 추가된다.
 */

declare global {
  namespace NodeJS {
    interface ProcessEnv {
      DATABASE_PATH?: string;
      API_PORT?: string;
      NODE_ENV?: 'development' | 'test' | 'production';
      JWT_SECRET?: string;
      BOX_VAULT_KEY?: string;
      ADMIN_USERNAME?: string;
      ADMIN_PASSWORD?: string;
    }
  }
}

export {};
