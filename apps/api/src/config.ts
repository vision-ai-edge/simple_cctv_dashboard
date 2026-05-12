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
  JWT_SECRET: z.string().min(1).optional(),
  BOX_VAULT_KEY: z.string().optional(),
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
