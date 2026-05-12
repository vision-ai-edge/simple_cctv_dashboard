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
      // SPEC-BOX-001 REQ-MOD-1: AES-GCM 볼트 키 (64자 hex, 필수)
      BOX_VAULT_KEY?: string;
      // SPEC-BOX-001 REQ-MOD-4: Box 상태 폴링 주기 (ms, 선택, 기본 60000)
      BOX_STATUS_POLL_INTERVAL_MS?: string;
      ADMIN_USERNAME?: string;
      ADMIN_PASSWORD?: string;
    }
  }
}

export {};
