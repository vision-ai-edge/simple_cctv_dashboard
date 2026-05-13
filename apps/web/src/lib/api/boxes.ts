/**
 * Box API 클라이언트 헬퍼.
 *
 * 서버 사이드(+page.server.ts)와 클라이언트 사이드(폴링) 모두에서 사용한다.
 * FetchLike 인터페이스를 통해 event.fetch(서버) 또는 window.fetch(클라이언트)를 주입받는다.
 *
 * 중요: 이 파일은 INTERNAL_API_URL을 사용하지 않는다.
 * +page.server.ts에서는 event.fetch('/api/...')를 사용하며,
 * SvelteKit이 Vite 프록시를 통해 라우팅한다.
 */

/** fetch 함수 타입 (서버의 event.fetch 또는 클라이언트의 window.fetch) */
export type FetchLike = typeof fetch;

/** 백엔드 BoxSummary 응답 타입 */
export interface BoxSummary {
  id: string;
  name: string;
  host: string;
  port: number;
  baseUrl: string;
  username: string;
  status: 'active' | 'inactive' | 'error';
  lastSyncAt: number | null;
  createdAt: number;
  updatedAt: number;
  hasApiKey: boolean;
}

/** Box 에러 kind 태그 */
export type BoxErrorKind =
  | 'auth'
  | 'duplicate'
  | 'unauthorized'
  | 'upstream'
  | 'unknown'
  | 'notFound';

/** Box 에러 객체 */
export interface BoxError {
  kind: BoxErrorKind;
  message: string;
  status: number;
  raw?: unknown;
}

/** 백엔드 에러 응답 바디 (errorEnvelope 또는 BoxRegistrationError 형식) */
interface BoxErrorBody {
  code?: string;
  error?: string;
  message?: string;
  success?: boolean;
}

/** Box 등록 입력 */
export interface RegisterBoxInput {
  name: string;
  host: string;
  port: number;
  username: string;
  password: string;
  useApiKey?: boolean;
}

/**
 * HTTP 상태코드와 파싱된 바디를 기반으로 에러 kind 태그를 결정한다.
 *
 * 매핑 규칙 (spec.md 에러 응답 매핑 테이블 기준):
 * - 400 with code EC-BOX-001 → 'auth' (자격증명 오류)
 * - 400 with code EC-BOX-003 또는 409 → 'duplicate' (중복 등록)
 * - 401 → 'unauthorized' (미인증)
 * - 404 → 'notFound' (Box 없음)
 * - 502 → 'upstream' (연결 불가)
 * - 그 외 → 'unknown'
 */
export function mapBoxErrorStatus(status: number, body: BoxErrorBody): { kind: BoxErrorKind } {
  if (status === 401) return { kind: 'unauthorized' };
  if (status === 404) return { kind: 'notFound' };
  if (status === 502) return { kind: 'upstream' };
  if (status === 409) return { kind: 'duplicate' };
  if (status === 400) {
    if (body.code === 'EC-BOX-003') return { kind: 'duplicate' };
    if (body.code === 'EC-BOX-001') return { kind: 'auth' };
    // code 없는 400 (errorEnvelope 형식 — 입력 검증 실패, 자격증명 오류) → auth 처리
    return { kind: 'auth' };
  }
  return { kind: 'unknown' };
}

/**
 * 에러 kind에 해당하는 한국어 에러 메시지를 반환한다.
 * SPEC-BOX-UI-001 에러 응답 매핑 테이블 기준.
 */
export function boxErrorMessageKo(kind: BoxErrorKind): string {
  const messages: Record<BoxErrorKind, string> = {
    auth: 'EdgeAI Box 자격증명을 확인하세요',
    duplicate: '동일한 Box(host:port)가 이미 등록되어 있습니다',
    unauthorized: '인증이 필요합니다. 다시 로그인해주세요',
    upstream: 'EdgeAI Box에 연결할 수 없습니다. 네트워크 상태를 확인하세요',
    notFound: '해당 Box를 찾을 수 없습니다',
    unknown: '알 수 없는 오류가 발생했습니다',
  };
  return messages[kind];
}

/** 에러 응답 바디를 파싱하여 에러 메시지 문자열을 추출한다. */
function extractErrorMessage(body: BoxErrorBody): string {
  // BoxRegistrationError 형식: { error, code }
  if (body.error) return body.error;
  // errorEnvelope 형식: { message }
  if (body.message) return body.message;
  return '알 수 없는 오류';
}

/**
 * 실패한 응답에서 BoxError를 생성한다.
 */
async function buildBoxError(response: Response): Promise<BoxError> {
  let body: BoxErrorBody = {};
  try {
    body = (await response.json()) as BoxErrorBody;
  } catch {
    // JSON 파싱 실패 시 빈 body 사용
  }
  const { kind } = mapBoxErrorStatus(response.status, body);
  const message = boxErrorMessageKo(kind);
  return { kind, message, status: response.status, raw: body };
}

// ---------------------------------------------------------------------------
// API 함수
// ---------------------------------------------------------------------------

/** Box 목록 조회 */
export async function fetchBoxes(
  fetchImpl: FetchLike,
): Promise<{ ok: true; boxes: BoxSummary[] } | { ok: false; error: BoxError }> {
  try {
    const res = await fetchImpl('/api/boxes');
    if (res.ok) {
      const boxes = (await res.json()) as BoxSummary[];
      return { ok: true, boxes };
    }
    const error = await buildBoxError(res);
    return { ok: false, error };
  } catch {
    return {
      ok: false,
      error: {
        kind: 'unknown',
        message: boxErrorMessageKo('unknown'),
        status: 0,
      },
    };
  }
}

/** 단일 Box 조회 */
export async function fetchBox(
  id: string,
  fetchImpl: FetchLike,
): Promise<{ ok: true; box: BoxSummary } | { ok: false; error: BoxError }> {
  try {
    const res = await fetchImpl(`/api/boxes/${id}`);
    if (res.ok) {
      const box = (await res.json()) as BoxSummary;
      return { ok: true, box };
    }
    const error = await buildBoxError(res);
    return { ok: false, error };
  } catch {
    return {
      ok: false,
      error: {
        kind: 'unknown',
        message: boxErrorMessageKo('unknown'),
        status: 0,
      },
    };
  }
}

/** Box 등록 */
export async function createBox(
  input: RegisterBoxInput,
  fetchImpl: FetchLike,
): Promise<{ ok: true; box: BoxSummary } | { ok: false; error: BoxError }> {
  try {
    const res = await fetchImpl('/api/boxes', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    });
    if (res.ok) {
      const box = (await res.json()) as BoxSummary;
      return { ok: true, box };
    }
    const error = await buildBoxError(res);
    return { ok: false, error };
  } catch {
    return {
      ok: false,
      error: {
        kind: 'unknown',
        message: boxErrorMessageKo('unknown'),
        status: 0,
      },
    };
  }
}

/** Box 삭제 */
export async function deleteBoxById(
  id: string,
  fetchImpl: FetchLike,
): Promise<{ ok: true } | { ok: false; error: BoxError }> {
  try {
    const res = await fetchImpl(`/api/boxes/${id}`, { method: 'DELETE' });
    // 204 No Content 성공
    if (res.status === 204 || res.ok) {
      return { ok: true };
    }
    const error = await buildBoxError(res);
    return { ok: false, error };
  } catch {
    return {
      ok: false,
      error: {
        kind: 'unknown',
        message: boxErrorMessageKo('unknown'),
        status: 0,
      },
    };
  }
}

/** Box 토큰 수동 갱신 */
export async function refreshBoxTokens(
  id: string,
  fetchImpl: FetchLike,
): Promise<{ ok: true; box: BoxSummary } | { ok: false; error: BoxError }> {
  try {
    const res = await fetchImpl(`/api/boxes/${id}/refresh`, { method: 'POST' });
    if (res.ok) {
      const box = (await res.json()) as BoxSummary;
      return { ok: true, box };
    }
    const error = await buildBoxError(res);
    return { ok: false, error };
  } catch {
    return {
      ok: false,
      error: {
        kind: 'unknown',
        message: boxErrorMessageKo('unknown'),
        status: 0,
      },
    };
  }
}
