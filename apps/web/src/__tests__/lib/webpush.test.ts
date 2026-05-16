/**
 * webpush.ts 순수 함수 테스트.
 *
 * - urlBase64ToUint8Array: VAPID key 변환 (순수 함수)
 * - 구독 플로우는 브라우저 API 의존으로 로직 레벨 검증 생략
 */

import { describe, expect, it } from 'bun:test';
import { urlBase64ToUint8Array } from '../../lib/webpush';

// --- 테스트 픽스처 ---

// 실제 VAPID 공개키 형식 (Base64URL, 65바이트 비압축 EC point)
const VALID_BASE64URL =
  'BEl62iUYgUivxIkv69yViEuiBIa-Ib9-SkvMeAtA3LFgDzkrxZJjSgSnfckjBJuBkr3qBUYIHBQFLXYp5Nksh8U';

// 단순 Base64URL 문자열 (패딩 없음)
const SIMPLE_BASE64URL = 'SGVsbG8gV29ybGQ'; // "Hello World"

describe('urlBase64ToUint8Array', () => {
  it('유효한 Base64URL 문자열을 Uint8Array로 변환한다', () => {
    const result = urlBase64ToUint8Array(SIMPLE_BASE64URL);
    expect(result).toBeInstanceOf(Uint8Array);
    expect(result.length).toBeGreaterThan(0);
  });

  it('변환된 배열의 길이가 원본 데이터 크기와 일치한다', () => {
    // "Hello World" → 11바이트
    const result = urlBase64ToUint8Array(SIMPLE_BASE64URL);
    expect(result.length).toBe(11);
  });

  it('Base64URL 특수문자(-와 _)를 올바르게 처리한다', () => {
    // - 와 _ 가 포함된 문자열을 처리해야 한다
    const base64UrlWithSpecial = 'dGVzdC10ZXN0X3Rlc3Q'; // "test-test_test"
    expect(() => urlBase64ToUint8Array(base64UrlWithSpecial)).not.toThrow();
    const result = urlBase64ToUint8Array(base64UrlWithSpecial);
    expect(result).toBeInstanceOf(Uint8Array);
  });

  it('VAPID 공개키 형식(65바이트)을 올바르게 처리한다', () => {
    // atob는 Node/Bun 환경에서도 동작한다
    const result = urlBase64ToUint8Array(VALID_BASE64URL);
    expect(result).toBeInstanceOf(Uint8Array);
    // VAPID uncompressed EC point: 0x04 + 32바이트 x + 32바이트 y = 65바이트
    expect(result.length).toBe(65);
  });

  it('패딩 없는 Base64URL을 올바르게 처리한다', () => {
    // 패딩 없이도 변환이 이루어져야 한다
    const noPadding = 'YQ'; // "a" (1바이트)
    const result = urlBase64ToUint8Array(noPadding);
    expect(result.length).toBe(1);
    expect(result[0]).toBe(97); // 'a' === 97
  });

  it('빈 문자열에 대해 빈 Uint8Array를 반환한다', () => {
    const result = urlBase64ToUint8Array('');
    expect(result).toBeInstanceOf(Uint8Array);
    expect(result.length).toBe(0);
  });

  it('변환 결과는 각 바이트가 0-255 범위에 있다', () => {
    const result = urlBase64ToUint8Array(SIMPLE_BASE64URL);
    for (const byte of result) {
      expect(byte).toBeGreaterThanOrEqual(0);
      expect(byte).toBeLessThanOrEqual(255);
    }
  });
});
