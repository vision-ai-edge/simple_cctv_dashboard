// TAG: BOX-CHANNELS-001
/**
 * GET /api/boxes/:id/channels
 *
 * 채널 목록 조회 프록시 라우트 (T5 누락 보완).
 * INTERNAL_API_URL 을 통해 Hono 백엔드로 요청을 전달하고 응답을 그대로 반환한다.
 * 세션 쿠키(access_token)를 Cookie 헤더로 포워딩한다.
 */

import type { RequestHandler } from './$types';

const INTERNAL_API_URL = process.env.INTERNAL_API_URL ?? 'http://localhost:3000';

export const GET: RequestHandler = async ({ params, cookies }) => {
  const token = cookies.get('access_token');
  const headers: Record<string, string> = {};
  if (token) {
    headers.Cookie = `access_token=${token}`;
  }

  const upstream = await fetch(`${INTERNAL_API_URL}/api/boxes/${params.id}/channels`, {
    method: 'GET',
    headers,
  });

  const body = await upstream.text();
  return new Response(body, {
    status: upstream.status,
    headers: {
      'Content-Type': upstream.headers.get('Content-Type') ?? 'application/json',
    },
  });
};
