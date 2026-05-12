import { describe, expect, test } from 'bun:test';
import { loadConfig } from '../config';

describe('loadConfig', () => {
  test('유효한 환경 변수에서 검증된 설정을 반환한다', () => {
    const config = loadConfig({
      DATABASE_PATH: './test.sqlite',
      API_PORT: '4000',
      NODE_ENV: 'test',
    } as NodeJS.ProcessEnv);
    expect(config.DATABASE_PATH).toBe('./test.sqlite');
    expect(config.API_PORT).toBe(4000);
    expect(config.NODE_ENV).toBe('test');
  });

  test('API_PORT 기본값 3000', () => {
    const config = loadConfig({
      DATABASE_PATH: './test.sqlite',
    } as NodeJS.ProcessEnv);
    expect(config.API_PORT).toBe(3000);
    expect(config.NODE_ENV).toBe('development');
  });

  test('DATABASE_PATH 누락 시 process.exit(1)', () => {
    const originalExit = process.exit;
    const exitCodes: Array<number | undefined> = [];
    const mockExit = ((code?: number): never => {
      exitCodes.push(code);
      throw new Error('__test_exit__');
    }) as typeof process.exit;
    process.exit = mockExit;
    const originalErr = console.error;
    console.error = () => {};
    try {
      loadConfig({} as NodeJS.ProcessEnv);
    } catch (e) {
      expect((e as Error).message).toBe('__test_exit__');
    }
    process.exit = originalExit;
    console.error = originalErr;
    expect(exitCodes[0]).toBe(1);
  });
});
