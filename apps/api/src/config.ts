/**
 * 환경 변수 로드 + Zod 검증.
 * 누락 시 명확한 에러 메시지와 함께 프로세스를 종료한다.
 */

import { z } from 'zod';

const EnvSchema = z.object({
  DATABASE_PATH: z
    .string({ required_error: 'DATABASE_PATH 환경 변수가 필요합니다.' })
    .min(1, 'DATABASE_PATH 는 비어 있을 수 없습니다.'),
  API_PORT: z
    .preprocess((v) => (v === undefined ? '3000' : v), z.coerce.number().int().positive())
    .default(3000),
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  // SPEC-AUTH-001: JWT_SECRET 는 필수이며 최소 32바이트 이상이어야 한다
  JWT_SECRET: z
    .string({ required_error: 'JWT_SECRET 환경 변수가 필요합니다.' })
    .min(32, 'JWT_SECRET 는 최소 32바이트 이상이어야 합니다.'),
  // SPEC-BOX-001 REQ-MOD-1: AES-GCM 자격증명 볼트 키 (32바이트 = 64자 hex)
  BOX_VAULT_KEY: z
    .string({ required_error: 'BOX_VAULT_KEY 환경 변수가 필요합니다.' })
    .length(64, 'BOX_VAULT_KEY 는 64자 hex 문자열이어야 합니다.')
    .regex(/^[0-9a-fA-F]{64}$/, 'BOX_VAULT_KEY 는 hex 문자열이어야 합니다.'),
  // SPEC-BOX-001 REQ-MOD-4: Box 상태 폴링 주기 (ms, 기본 60초)
  BOX_STATUS_POLL_INTERVAL_MS: z.coerce.number().int().positive().default(60_000),
  // SPEC-ALERTS-001 D3: detection 폴링 주기 (ms, 기본 3초, 최소 1초)
  DETECTION_POLL_INTERVAL_MS: z.coerce.number().int().min(1000).default(3000),
  // SPEC-ALERTS-001 D6: WebPush VAPID 키 (선택, 미설정 시 WebPush 비활성)
  VAPID_PUBLIC_KEY: z.string().optional(),
  VAPID_PRIVATE_KEY: z.string().optional(),
  VAPID_CONTACT: z.string().optional(),
  // SPEC-ALERTS-001 D5: Telegram Bot 토큰 (선택, 미설정 시 Telegram 비활성)
  TELEGRAM_BOT_TOKEN: z.string().optional(),
});

export type AppConfig = z.infer<typeof EnvSchema>;

/**
 * 환경 변수를 검증하여 AppConfig 를 반환한다.
 * 검증 실패 시 즉시 프로세스를 종료한다.
 */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const result = EnvSchema.safeParse(env);
  if (!result.success) {
    const errors = result.error.issues
      .map((issue) => `  - ${issue.path.join('.')}: ${issue.message}`)
      .join('\n');
    console.error(`[error] 환경 변수 검증 실패:\n${errors}`);
    process.exit(1);
  }
  return result.data;
}
