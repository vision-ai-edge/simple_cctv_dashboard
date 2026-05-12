/**
 * SPEC-BOX-001 REQ-MOD-1 — AES-GCM 자격증명 볼트 유틸리티.
 *
 * 볼트 키 형식: 64자 hex 문자열 (= 32바이트 원시 키)
 * 암호화 알고리즘: AES-256-GCM
 * blob 포맷: [12B IV ‖ ciphertext ‖ 16B GCM auth tag]
 *
 * 보안 원칙:
 * - 에러 메시지/로그에 키 값 또는 평문 절대 미포함
 * - IV는 매 호출 시 crypto.getRandomValues로 생성 (랜덤성 보장)
 * - 외부 npm 패키지 사용 없음 (Bun 내장 Web Crypto API 사용)
 */

// ---------------------------------------------------------------------------
// 내부 상수
// ---------------------------------------------------------------------------

/** AES-GCM IV 길이 (바이트) */
const IV_LENGTH_BYTES = 12;

/** AES-GCM 키 길이 (비트) */
const KEY_LENGTH_BITS = 256;

/** 볼트 키 hex 문자열 길이 (32바이트 = 64 hex chars) */
const VAULT_KEY_HEX_LENGTH = 64;

/** 64자 hex 문자열을 검증하는 정규식 */
const HEX_64_RE = /^[0-9a-fA-F]{64}$/;

// ---------------------------------------------------------------------------
// 에러 클래스
// ---------------------------------------------------------------------------

/**
 * 볼트 키 유효성 오류.
 * 에러 메시지에 키 값을 절대 포함하지 않는다.
 */
export class VaultKeyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'VaultKeyError';
  }
}

// ---------------------------------------------------------------------------
// 내부 헬퍼 함수 (모듈 비공개)
// ---------------------------------------------------------------------------

/**
 * hex 문자열을 ArrayBuffer로 변환한다.
 * @param hex - 짝수 길이의 유효한 hex 문자열
 */
function hexToBuffer(hex: string): ArrayBuffer {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < hex.length; i += 2) {
    bytes[i / 2] = Number.parseInt(hex.slice(i, i + 2), 16);
  }
  return bytes.buffer;
}

/**
 * 두 Uint8Array를 하나로 이어 붙인다.
 * @param a - 앞에 놓일 바이트 배열
 * @param b - 뒤에 붙을 바이트 배열
 */
function concatBytes(a: Uint8Array, b: Uint8Array): Uint8Array {
  const result = new Uint8Array(a.length + b.length);
  result.set(a, 0);
  result.set(b, a.length);
  return result;
}

/**
 * hex 키 문자열로부터 AES-GCM CryptoKey를 임포트한다.
 * assertBoxVaultKey 검증 이후에만 호출해야 한다.
 * @param keyHex - 64자 hex 문자열 (사전 검증 완료된 값)
 */
async function importAesGcmKey(keyHex: string): Promise<CryptoKey> {
  return globalThis.crypto.subtle.importKey(
    'raw',
    hexToBuffer(keyHex),
    { name: 'AES-GCM', length: KEY_LENGTH_BITS },
    false, // 키 추출 불가 (extractable: false)
    ['encrypt', 'decrypt'],
  );
}

// ---------------------------------------------------------------------------
// 공개 API
// ---------------------------------------------------------------------------

/**
 * 볼트 키 유효성을 검증한다.
 *
 * 조건:
 * - undefined/null이 아닐 것
 * - 정확히 64자의 hex 문자열일 것 (= 32바이트)
 * - 비hex 문자(a-f, 0-9 외)가 없을 것
 *
 * @param key - 검증할 키 문자열
 * @throws VaultKeyError — 키가 유효하지 않을 때 (에러 메시지에 키 값 미포함)
 */
export function assertBoxVaultKey(key: string | undefined): asserts key is string {
  if (key === undefined || key === null) {
    throw new VaultKeyError(
      `[SPEC-BOX-001] BOX_VAULT_KEY가 설정되지 않았습니다. 정확히 32 bytes (${VAULT_KEY_HEX_LENGTH} hex chars)인 키가 필요합니다.`,
    );
  }
  if (!HEX_64_RE.test(key)) {
    throw new VaultKeyError(
      `[SPEC-BOX-001] BOX_VAULT_KEY가 유효하지 않습니다. 정확히 32 bytes (${VAULT_KEY_HEX_LENGTH} hex chars)인 hex 문자열이어야 합니다.`,
    );
  }
}

/**
 * 평문 문자열을 AES-GCM으로 암호화하여 Uint8Array blob을 반환한다.
 *
 * blob 포맷: [12B IV ‖ ciphertext ‖ 16B GCM auth tag]
 *
 * @param plaintext - 암호화할 평문 문자열 (UTF-8)
 * @param keyHex - 64자 hex 형식의 볼트 키
 * @returns 암호화된 blob (Uint8Array)
 * @throws VaultKeyError — 키가 유효하지 않을 때
 */
export async function encryptWithVault(plaintext: string, keyHex: string): Promise<Uint8Array> {
  assertBoxVaultKey(keyHex);

  const key = await importAesGcmKey(keyHex);

  // IV: 매 호출 시 12바이트 랜덤 생성 (랜덤성 보장)
  const iv = globalThis.crypto.getRandomValues(new Uint8Array(IV_LENGTH_BYTES));

  // AES-GCM 암호화 (출력: ciphertext ‖ 16B auth tag)
  const ciphertextWithTag = await globalThis.crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    key,
    new TextEncoder().encode(plaintext),
  );

  // 최종 blob: IV ‖ ciphertext ‖ auth tag
  return concatBytes(iv, new Uint8Array(ciphertextWithTag));
}

/**
 * encryptWithVault로 생성된 blob을 복호화하여 원본 평문 문자열을 반환한다.
 *
 * @param blob - [12B IV ‖ ciphertext ‖ 16B GCM auth tag] 형식의 Uint8Array
 * @param keyHex - 64자 hex 형식의 볼트 키
 * @returns 원본 평문 문자열 (UTF-8)
 * @throws VaultKeyError — 키가 유효하지 않을 때
 * @throws DOMException (OperationError) — auth tag 검증 실패 시 (변조/잘못된 키 감지)
 */
export async function decryptWithVault(blob: Uint8Array, keyHex: string): Promise<string> {
  assertBoxVaultKey(keyHex);

  const key = await importAesGcmKey(keyHex);

  // blob을 IV(12B)와 ciphertext+tag로 분리
  const iv = blob.slice(0, IV_LENGTH_BYTES);
  const ciphertextWithTag = blob.slice(IV_LENGTH_BYTES);

  // AES-GCM 복호화 (auth tag 자동 검증 — 실패 시 DOMException 발생)
  const plaintextBytes = await globalThis.crypto.subtle.decrypt(
    { name: 'AES-GCM', iv },
    key,
    ciphertextWithTag,
  );

  return new TextDecoder().decode(plaintextBytes);
}
