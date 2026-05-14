// TAG: BOX-CHANNELS-001
/**
 * POST /api/boxes/:id/channels/:channelId/start
 *
 * 채널 활성화 프록시 라우트.
 * INTERNAL_API_URL을 통해 Hono 백엔드로 요청을 전달한다.
 */

import type { RequestHandler } from './$types';

const INTERNAL_API_URL = process.env.INTERNAL_API_URL ?? 'http://localhost:3000';

export const POST: RequestHandler = async ({ params, cookies }) => {
  const token = cookies.get('access_token');
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };
  if (token) {
    headers.Cookie = `access_token=${token}`;
  }

  const upstream = await fetch(
    `${INTERNAL_API_URL}/api/boxes/${params.id}/channels/${params.channelId}/start`,
    {
      method: 'POST',
      headers,
    },
  );

  const body = await upstream.text();
  return new Response(body, {
    status: upstream.status,
    headers: {
      'Content-Type': upstream.headers.get('Content-Type') ?? 'application/json',
    },
  });
};
