/**
 * SPEC-BOX-001 — Box 등록 및 자격증명 관리 서비스.
 *
 * 책임:
 *   - REQ-MOD-1: 모든 자격증명을 AES-GCM 볼트로 암호화하여 DB 저장
 *   - REQ-MOD-2: 등록 시 /auth/login 헬스체크 — 성공 시 저장, 실패 시 미저장
 *   - REQ-MOD-3: withAuthRetry — 401 발생 시 1회 재인증 후 재시도
 *   - REQ-MOD-5: useApiKey=true 시 /auth/apikey/regenerate 호출 후 암호화 저장
 *
 * 보안 원칙:
 *   - BOX_VAULT_KEY 를 process.env 에서 직접 읽지 않음 (DI deps 로 수신)
 *   - 자격증명 평문을 로그에 절대 미포함
 *   - BoxSummary 에 password/jwt/apiKey 평문 미포함
 *   - 401 재시도 최대 1회 (무한 루프 방지)
 */

import type { Db } from '@cctv/db';
import { BoxApiError, type BoxClient } from '@cctv/shared';
import { decryptWithVault, encryptWithVault } from '@cctv/shared/crypto/vault';
import { ulid } from 'ulid';

// ---------------------------------------------------------------------------
// 공개 타입
// ---------------------------------------------------------------------------

/** Box 등록 입력 */
export type RegisterBoxInput = {
  name: string;
  host: string;
  port: number;
  username: string;
  password: string;
  useApiKey?: boolean;
};

/**
 * 외부에 노출하는 Box 요약 정보.
 * 자격증명(password, jwt, apiKey) 평문은 절대 포함하지 않는다.
 */
export type BoxSummary = {
  id: string;
  name: string;
  baseUrl: string;
  username: string;
  status: 'active' | 'inactive' | 'error';
  lastSyncAt: Date | null;
  createdAt: Date;
};

/**
 * boxService 의존성 주입 컨테이너.
 * BOX_VAULT_KEY 를 외부에서 주입받아 process.env 직접 접근을 차단한다.
 */
export type BoxServiceDeps = {
  /** Drizzle DB 인스턴스 */
  db: Db;
  /** BOX_VAULT_KEY — 64자 hex 볼트 키 */
  vaultKey: string;
  /** BoxClient 팩토리 (테스트 mock 용이) */
  createBoxClient: (baseUrl: string, token?: string) => BoxClient;
  /**
   * SPEC-BOX-CHANNELS-001 REQ-CHAN-001: Box 등록 완료 후 fire-and-forget 훅.
   * 채널 동기화를 비동기로 실행한다. 오류 발생 시 응답에 영향 없음.
   */
  onBoxRegistered?: (boxId: string) => Promise<void>;
};

// ---------------------------------------------------------------------------
// 내부 에러 클래스
// ---------------------------------------------------------------------------

/** Box 등록 실패 에러 */
export class BoxRegistrationError extends Error {
  /** HTTP 상태 코드 (기본값: 400). 중복 등록 시 409 사용. */
  public readonly statusCode: number;
  /** 에러 코드 (예: 'BOX_ALREADY_EXISTS') */
  public readonly code: string;

  constructor(
    message: string,
    options?: {
      code?: string;
      statusCode?: number;
      cause?: unknown;
    },
  ) {
    super(message);
    this.name = 'BoxRegistrationError';
    this.statusCode = options?.statusCode ?? 400;
    this.code = options?.code ?? 'BOX_REGISTRATION_ERROR';
    if (options?.cause !== undefined) {
      // cause 는 Error.cause (ES2022)
      Object.defineProperty(this, 'cause', { value: options.cause, enumerable: false });
    }
  }
}

/** Box 미발견 에러 */
export class BoxNotFoundError extends Error {
  constructor(public readonly boxId: string) {
    super(`Box 를 찾을 수 없습니다: ${boxId}`);
    this.name = 'BoxNotFoundError';
  }
}

// ---------------------------------------------------------------------------
// 내부 타입 (raw sqlite 행 형태)
// ---------------------------------------------------------------------------

/** SELECT 에서 사용할 공개 컬럼 목록 (자격증명 제외) */
const BOX_SUMMARY_SQL = `
  SELECT id, name, base_url as baseUrl, username, status,
         last_sync_at as lastSyncAt, created_at as createdAt
  FROM boxes
`.trim();

/** 공개 컬럼 raw 행 타입 */
type BoxSummaryRow = {
  id: string;
  name: string;
  baseUrl: string;
  username: string;
  status: 'active' | 'inactive' | 'error';
  lastSyncAt: number | null;
  createdAt: number;
};

/** 자격증명 포함 raw 행 타입 (내부 + channelSyncService 공유) */
export type BoxCredentialRow = {
  id: string;
  baseUrl: string;
  username: string;
  passwordEnc: Uint8Array;
  jwtCachedEnc: Uint8Array | null;
  /** SPEC-BOX-CHANNELS-001: API Key 암호화 blob (채널 동기화용) */
  apiKeyCachedEnc?: Uint8Array | null;
};

// ---------------------------------------------------------------------------
// 내부 헬퍼
// ---------------------------------------------------------------------------

/**
 * host + port 로부터 baseUrl 을 생성한다.
 * 형식: `https://{host}:{port}/api`
 *
 * 방어적: 사용자가 host 필드에 스키마(https://, http://)나 경로(/api 등)를
 * 포함하더라도 baseUrl 이 이중 스키마(`https://https://...`)가 되지 않도록 정규화한다.
 */
function buildBaseUrl(host: string, port: number): string {
  // 스키마 제거 + 후행 슬래시/경로 제거 + 양끝 공백 제거
  const cleanHost = host
    .trim()
    .replace(/^https?:\/\//i, '')
    .replace(/\/.*$/, '');
  return `https://${cleanHost}:${port}/api`;
}

/**
 * DB 행을 BoxSummary 로 변환한다.
 * epoch ms (INTEGER) 를 Date 로 변환하며, 자격증명 컬럼은 포함하지 않는다.
 */
function toBoxSummary(row: BoxSummaryRow): BoxSummary {
  return {
    id: row.id,
    name: row.name,
    baseUrl: row.baseUrl,
    username: row.username,
    status: row.status,
    lastSyncAt: row.lastSyncAt !== null ? new Date(row.lastSyncAt) : null,
    createdAt: new Date(row.createdAt),
  };
}

/**
 * ID 로 BoxSummaryRow 를 조회한다.
 * @throws BoxNotFoundError — 미발견 시
 */
function querySummaryRow(db: Db, id: string): BoxSummaryRow {
  const row = db.$client.query(`${BOX_SUMMARY_SQL} WHERE id = ?`).get(id) as BoxSummaryRow | null;
  if (!row) throw new BoxNotFoundError(id);
  return row;
}

/**
 * ID 로 자격증명 포함 행을 조회한다.
 * channelSyncService 에서도 사용하므로 export 처리.
 * @throws BoxNotFoundError — 미발견 시
 */
export function queryCredentialRow(db: Db, id: string): BoxCredentialRow {
  const row = db.$client
    .query(
      `SELECT id, base_url as baseUrl, username,
              password_enc as passwordEnc, jwt_cached_enc as jwtCachedEnc,
              api_key_cached_enc as apiKeyCachedEnc
       FROM boxes WHERE id = ?`,
    )
    .get(id) as BoxCredentialRow | null;
  if (!row) throw new BoxNotFoundError(id);
  return row;
}

// ---------------------------------------------------------------------------
// 공개 API
// ---------------------------------------------------------------------------

/**
 * EdgeAI Box 를 등록한다.
 *
 * 처리 순서:
 *  1. baseUrl 생성 (`https://{host}:{port}/api`)
 *  2. BoxClient 를 생성하여 /auth/login 헬스체크
 *  3. 성공 시 password, JWT 를 볼트 암호화 후 DB INSERT
 *  4. useApiKey=true 면 /auth/apikey/regenerate 호출 후 api_key_cached_enc 갱신
 *
 * @throws BoxApiError — 헬스체크 실패 시 (DB 미저장 보장)
 */
export async function registerBox(
  input: RegisterBoxInput,
  deps: BoxServiceDeps,
): Promise<BoxSummary> {
  const { db, vaultKey, createBoxClient } = deps;
  const baseUrl = buildBaseUrl(input.host, input.port);
  const now = Date.now();
  const id = ulid();

  // EC-BOX-003: 동일 base_url 중복 등록 사전 검사 (login 호출 이전)
  const existing = db.$client
    .query('SELECT id FROM boxes WHERE base_url = ? LIMIT 1')
    .get(baseUrl) as { id: string } | null;
  if (existing) {
    throw new BoxRegistrationError('이미 등록된 Box입니다', {
      code: 'BOX_ALREADY_EXISTS',
      statusCode: 409,
    });
  }

  // 헬스체크: /auth/login 호출 (실패 시 BoxApiError 전파 — DB 미저장)
  const client = createBoxClient(baseUrl);
  const loginResult = await client.auth.login(input.username, input.password);
  const jwt = loginResult.token;

  // 자격증명 볼트 암호화
  const [passwordEnc, jwtCachedEnc] = await Promise.all([
    encryptWithVault(input.password, vaultKey),
    encryptWithVault(jwt, vaultKey),
  ]);

  // DB INSERT
  db.$client
    .prepare(
      `INSERT INTO boxes (id, name, base_url, username, password_enc, jwt_cached_enc,
                          jwt_obtained_at, status, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      id,
      input.name,
      baseUrl,
      input.username,
      passwordEnc,
      jwtCachedEnc,
      now,
      'active',
      now,
      now,
    );

  // useApiKey=true 시 API Key 발급 및 암호화 저장
  if (input.useApiKey) {
    const apiKeyClient = createBoxClient(baseUrl, jwt);
    const apiKeyResult = await apiKeyClient.auth.regenerateApiKey();
    const apiKeyCachedEnc = await encryptWithVault(apiKeyResult.apiKey, vaultKey);

    db.$client
      .prepare('UPDATE boxes SET api_key_cached_enc = ?, updated_at = ? WHERE id = ?')
      .run(apiKeyCachedEnc, Date.now(), id);
  }

  const summary = toBoxSummary(querySummaryRow(db, id));

  // SPEC-BOX-CHANNELS-001 REQ-CHAN-001: 등록 직후 채널 동기화 fire-and-forget
  // await 없이 호출하여 응답에 영향을 주지 않음. Promise rejection은 로그로만 처리.
  if (deps.onBoxRegistered) {
    deps.onBoxRegistered(id).catch((err: unknown) => {
      console.error('[boxService] 채널 동기화 fire-and-forget 오류:', {
        boxId: id,
        error: err instanceof Error ? err.message : String(err),
      });
    });
  }

  return summary;
}

/**
 * 저장된 Box 목록을 반환한다.
 * 자격증명 컬럼은 SELECT 에서 제외하여 노출 방지.
 */
export async function listBoxes(deps: BoxServiceDeps): Promise<BoxSummary[]> {
  const { db } = deps;
  const rows = db.$client
    .query(`${BOX_SUMMARY_SQL} ORDER BY created_at ASC`)
    .all() as BoxSummaryRow[];
  return rows.map(toBoxSummary);
}

/**
 * ID 로 단일 Box 를 조회한다.
 * @throws BoxNotFoundError — 미발견 시
 */
export async function getBox(id: string, deps: BoxServiceDeps): Promise<BoxSummary> {
  return toBoxSummary(querySummaryRow(deps.db, id));
}

/**
 * Box 를 삭제한다.
 * @throws BoxNotFoundError — 미발견 시
 */
export async function deleteBox(id: string, deps: BoxServiceDeps): Promise<void> {
  const { db } = deps;
  // 존재 확인 (BoxNotFoundError 전파)
  querySummaryRow(db, id);
  db.$client.prepare('DELETE FROM boxes WHERE id = ?').run(id);
}

/**
 * 저장된 비밀번호로 재로그인하여 JWT 를 갱신한다.
 *
 * @throws BoxNotFoundError — 미발견 시
 * @throws BoxApiError — 재로그인 실패 시
 */
export async function refreshTokens(id: string, deps: BoxServiceDeps): Promise<BoxSummary> {
  const { db, vaultKey, createBoxClient } = deps;

  // 자격증명 로드
  const credRow = db.$client
    .query(
      `SELECT id, base_url as baseUrl, username, password_enc as passwordEnc
       FROM boxes WHERE id = ?`,
    )
    .get(id) as Omit<BoxCredentialRow, 'jwtCachedEnc'> | null;
  if (!credRow) throw new BoxNotFoundError(id);

  // 비밀번호 복호화 → 재로그인 → 새 JWT 암호화 저장
  const password = await decryptWithVault(credRow.passwordEnc, vaultKey);
  const client = createBoxClient(credRow.baseUrl);
  const loginResult = await client.auth.login(credRow.username, password);

  const newJwtEnc = await encryptWithVault(loginResult.token, vaultKey);
  const now = Date.now();

  db.$client
    .prepare(
      'UPDATE boxes SET jwt_cached_enc = ?, jwt_obtained_at = ?, status = ?, updated_at = ? WHERE id = ?',
    )
    .run(newJwtEnc, now, 'active', now, id);

  return toBoxSummary(querySummaryRow(db, id));
}

/**
 * BoxClient 가 필요한 작업을 실행하며 401 발생 시 1회 재인증 후 재시도한다.
 *
 * 처리 순서:
 *  1. DB 에서 저장된 JWT 복호화하여 BoxClient 생성
 *  2. fn(client) 실행
 *  3. BoxApiError(401) 발생 시:
 *     a. 저장된 비밀번호 복호화 → 재로그인 → 새 JWT 암호화 저장
 *     b. 재로그인 실패 시: boxes.status='error' 갱신 후 에러 전파
 *     c. 재로그인 성공 시: fn(newClient) 재실행 (1회 한정)
 *  4. 401 외 에러는 즉시 전파 (재시도 없음)
 *
 * @param boxId 대상 Box ID
 * @param fn 실행할 함수 (BoxClient 를 인자로 받음)
 * @param deps 서비스 의존성
 * @throws BoxNotFoundError — Box 미발견
 * @throws BoxApiError — 재로그인 실패 또는 fn 에서 401 외 에러 발생
 */
export async function withAuthRetry<T>(
  boxId: string,
  fn: (client: BoxClient) => Promise<T>,
  deps: BoxServiceDeps,
): Promise<T> {
  const { db, vaultKey, createBoxClient } = deps;

  // Box 자격증명 로드
  const row = queryCredentialRow(db, boxId);

  // 저장된 JWT 복호화 (실패 시 undefined 로 폴백 — 재로그인으로 해결)
  let currentJwt: string | undefined;
  if (row.jwtCachedEnc) {
    try {
      currentJwt = await decryptWithVault(row.jwtCachedEnc, vaultKey);
    } catch {
      currentJwt = undefined;
    }
  }

  // 1차 실행
  const client = createBoxClient(row.baseUrl, currentJwt);
  try {
    return await fn(client);
  } catch (err) {
    // 401 외 에러는 즉시 전파 (재시도 없음)
    if (!(err instanceof BoxApiError) || err.statusCode !== 401) {
      throw err;
    }

    // 401: 비밀번호 복호화 → 재로그인
    const password = await decryptWithVault(row.passwordEnc, vaultKey);
    const reAuthClient = createBoxClient(row.baseUrl);

    let newJwt: string;
    try {
      const loginResult = await reAuthClient.auth.login(row.username, password);
      newJwt = loginResult.token;
    } catch (reAuthErr) {
      // 재로그인 실패: status='error' 갱신 후 에러 전파
      db.$client
        .prepare('UPDATE boxes SET status = ?, updated_at = ? WHERE id = ?')
        .run('error', Date.now(), boxId);
      throw reAuthErr;
    }

    // 새 JWT 암호화 후 DB 갱신
    const newJwtEnc = await encryptWithVault(newJwt, vaultKey);
    db.$client
      .prepare(
        'UPDATE boxes SET jwt_cached_enc = ?, jwt_obtained_at = ?, updated_at = ? WHERE id = ?',
      )
      .run(newJwtEnc, Date.now(), Date.now(), boxId);

    // 새 클라이언트로 재시도 (1회 한정)
    const newClient = createBoxClient(row.baseUrl, newJwt);
    return await fn(newClient);
  }
}
