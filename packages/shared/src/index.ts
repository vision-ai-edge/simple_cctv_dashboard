/**
 * @cctv/shared — CCTV Dashboard 전역 공유 패키지.
 *
 * - EdgeAI Box REST API 타입 클라이언트
 * - SPEC-AUTH-001: JWT 유틸리티 (signAccessToken, signRefreshToken, verifyToken 등)
 * - SPEC-BOX-001: AES-GCM 자격증명 볼트 (encryptWithVault, decryptWithVault, assertBoxVaultKey)
 */

export * from './edgeai-box-client';
export * from './jwt';
export * from './crypto/vault';
