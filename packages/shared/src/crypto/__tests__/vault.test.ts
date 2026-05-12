/**
 * SPEC-BOX-001 REQ-MOD-1 — AES-GCM 자격증명 볼트 유틸리티 테스트.
 *
 * RED 단계: vault.ts 가 아직 없으므로 import 자체가 실패한다.
 */

import { describe, expect, test } from 'bun:test';
import {
  assertBoxVaultKey,
  decryptWithVault,
  encryptWithVault,
} from '../vault';

// 테스트용 키 (64자 hex = 32바이트)
const TEST_KEY = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
const ALT_KEY = 'fedcba9876543210fedcba9876543210fedcba9876543210fedcba9876543210';

// ---------------------------------------------------------------------------
// assertBoxVaultKey 검증
// ---------------------------------------------------------------------------
describe('assertBoxVaultKey', () => {
  test('64자 hex 문자열은 통과해야 한다', () => {
    expect(() => assertBoxVaultKey('0'.repeat(64))).not.toThrow();
    expect(() => assertBoxVaultKey(TEST_KEY)).not.toThrow();
  });

  test('63자 문자열은 에러를 던져야 한다 (에러 메시지에 키 값 미포함)', () => {
    const shortKey = '0'.repeat(63);
    expect(() => assertBoxVaultKey(shortKey)).toThrow();
    try {
      assertBoxVaultKey(shortKey);
    } catch (e) {
      const msg = (e as Error).message;
      // 에러 메시지에 키 값이 포함되지 않아야 한다 (보안)
      expect(msg).not.toContain(shortKey);
      // 32바이트 또는 64 hex 관련 힌트 포함
      expect(msg.toLowerCase()).toMatch(/32\s*bytes?|64\s*hex/i);
    }
  });

  test('65자 문자열은 에러를 던져야 한다', () => {
    expect(() => assertBoxVaultKey('0'.repeat(65))).toThrow();
  });

  test('비hex 문자(g, h 등) 포함 64자는 에러를 던져야 한다', () => {
    // 마지막 문자를 'g'로 교체 → 비hex
    const invalidHex = '0'.repeat(63) + 'g';
    expect(() => assertBoxVaultKey(invalidHex)).toThrow();
  });

  test('빈 문자열은 에러를 던져야 한다', () => {
    expect(() => assertBoxVaultKey('')).toThrow();
  });

  test('undefined 인자는 에러를 던져야 한다', () => {
    expect(() => assertBoxVaultKey(undefined)).toThrow();
  });

  test('null 인자는 에러를 던져야 한다', () => {
    // TypeScript에서 null은 string | undefined 외의 타입이지만 런타임 검증
    // biome-ignore lint/suspicious/noExplicitAny: null 런타임 검증 테스트
    expect(() => assertBoxVaultKey(null as unknown as undefined)).toThrow();
  });
});

// ---------------------------------------------------------------------------
// encryptWithVault + decryptWithVault round-trip
// ---------------------------------------------------------------------------
describe('encryptWithVault + decryptWithVault round-trip', () => {
  test('동일 키로 암호화 후 복호화하면 원본 평문이 정확히 복원된다', async () => {
    const plaintext = 'hello, vault!';
    const blob = await encryptWithVault(plaintext, TEST_KEY);
    const recovered = await decryptWithVault(blob, TEST_KEY);
    expect(recovered).toBe(plaintext);
  });

  test('빈 문자열 평문도 정상 처리된다', async () => {
    const blob = await encryptWithVault('', TEST_KEY);
    const recovered = await decryptWithVault(blob, TEST_KEY);
    expect(recovered).toBe('');
  });

  test('한국어/유니코드 평문도 정상 처리된다', async () => {
    const plaintext = '비밀번호123!@#';
    const blob = await encryptWithVault(plaintext, TEST_KEY);
    const recovered = await decryptWithVault(blob, TEST_KEY);
    expect(recovered).toBe(plaintext);
  });

  test('다른 키로 복호화 시 에러가 발생해야 한다', async () => {
    const blob = await encryptWithVault('secret', TEST_KEY);
    await expect(decryptWithVault(blob, ALT_KEY)).rejects.toThrow();
  });

  test('동일 평문을 두 번 암호화하면 서로 다른 blob이 나와야 한다 (IV 랜덤성)', async () => {
    const plaintext = 'same plaintext';
    const blob1 = await encryptWithVault(plaintext, TEST_KEY);
    const blob2 = await encryptWithVault(plaintext, TEST_KEY);
    // 두 blob이 동일하지 않아야 한다 (IV 랜덤성)
    expect(Buffer.from(blob1).toString('hex')).not.toBe(Buffer.from(blob2).toString('hex'));
  });

  test('출력 blob은 Uint8Array이며 최소 28바이트(12 IV + 16 tag) 이상이어야 한다', async () => {
    const blob = await encryptWithVault('x', TEST_KEY);
    expect(blob).toBeInstanceOf(Uint8Array);
    // 12(IV) + 최소 1바이트 ciphertext + 16(GCM tag) = 29바이트
    expect(blob.length).toBeGreaterThanOrEqual(28);
  });
});

// ---------------------------------------------------------------------------
// auth tag 변조 검증
// ---------------------------------------------------------------------------
describe('auth tag 변조 검증', () => {
  test('암호화 결과의 마지막 바이트를 변조하면 복호화가 실패해야 한다', async () => {
    const blob = await encryptWithVault('tamper test', TEST_KEY);
    // 마지막 바이트 XOR 0xff로 변조
    const tampered = new Uint8Array(blob);
    const lastIdx = tampered.length - 1;
    // biome-ignore lint/style/noNonNullAssertion: 빈 blob은 불가능 (IV 12B + 최소 16B tag)
    tampered[lastIdx] = tampered[lastIdx]! ^ 0xff;
    await expect(decryptWithVault(tampered, TEST_KEY)).rejects.toThrow();
  });

  test('ciphertext 중간 변조 시에도 복호화가 실패해야 한다 (GCM auth tag 검증)', async () => {
    const blob = await encryptWithVault('ciphertext tamper', TEST_KEY);
    const tampered = new Uint8Array(blob);
    // IV(12바이트) 이후 첫 번째 ciphertext 바이트 변조
    if (tampered.length > 12) {
      // biome-ignore lint/style/noNonNullAssertion: length > 12 조건으로 존재 보장
      tampered[12] = tampered[12]! ^ 0xff;
    }
    await expect(decryptWithVault(tampered, TEST_KEY)).rejects.toThrow();
  });
});

// ---------------------------------------------------------------------------
// IV 구조 검증
// ---------------------------------------------------------------------------
describe('IV 구조 검증', () => {
  test('blob의 처음 12바이트는 IV이며 매 호출마다 다른 값이어야 한다', async () => {
    const blob1 = await encryptWithVault('iv test', TEST_KEY);
    const blob2 = await encryptWithVault('iv test', TEST_KEY);

    // 처음 12바이트 추출 (IV)
    const iv1 = blob1.slice(0, 12);
    const iv2 = blob2.slice(0, 12);

    const iv1Hex = Buffer.from(iv1).toString('hex');
    const iv2Hex = Buffer.from(iv2).toString('hex');

    // 동일한 평문이라도 IV는 달라야 한다
    expect(iv1Hex).not.toBe(iv2Hex);
  });
});
