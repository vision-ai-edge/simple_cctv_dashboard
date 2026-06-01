/**
 * CCTV Dashboard 백엔드 API 호출용 경량 클라이언트.
 *
 * 개발/운영 환경에서는 SvelteKit `/api` catch-all 이 in-process Hono 앱을 호출하며,
 * 빌드 후 동일 오리진 배포에서도 동일한 경로가 유효하다.
 */

export type HealthState =
  | { status: 'loading' }
  | { status: 'ok'; version: string }
  | { status: 'error'; message: string };

const API_BASE = '/api';

export async function fetchHealth(): Promise<HealthState> {
  try {
    const res = await fetch(`${API_BASE}/health`, { headers: { accept: 'application/json' } });
    if (!res.ok) {
      return { status: 'error', message: `HTTP ${res.status}` };
    }
    const body = (await res.json()) as { ok?: boolean; version?: string };
    if (body.ok === true && typeof body.version === 'string') {
      return { status: 'ok', version: body.version };
    }
    return { status: 'error', message: 'unexpected response shape' };
  } catch (err) {
    return { status: 'error', message: err instanceof Error ? err.message : 'network error' };
  }
}
