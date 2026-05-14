// TAG: BOX-CHANNELS-001
/**
 * GET /api/boxes/:id/channels/:channelId/hls/playlist.m3u8
 *
 * HLS 플레이리스트 프록시 라우트.
 * Hono 백엔드에서 m3u8을 가져와 클라이언트에 전달한다.
 * Hono에서 세그먼트 URL이 이미 자체 도메인으로 재작성된 상태로 반환된다.
 *
 * AC-008, AC-015: 자격증명은 서버-Box 구간에서만 사용. 클라이언트는 /api/... URL만 사용.
 * Cache-Control: no-store 강제 적용.
 */

import type { RequestHandler } from './$types';

const INTERNAL_API_URL = process.env.INTERNAL_API_URL ?? 'http://localhost:3000';

export const GET: RequestHandler = async ({ params, cookies }) => {
  const token = cookies.get('access_token');
  const headers: Record<string, string> = {};
  if (token) {
    headers.Cookie = `access_token=${token}`;
  }

  const upstream = await fetch(
    `${INTERNAL_API_URL}/api/boxes/${params.id}/channels/${params.channelId}/hls/playlist.m3u8`,
    { headers },
  );

  if (!upstream.ok) {
    const body = await upstream.text();
    return new Response(body, {
      status: upstream.status,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const m3u8Text = await upstream.text();
  return new Response(m3u8Text, {
    status: 200,
    headers: {
      'Content-Type': 'application/vnd.apple.mpegurl',
      'Cache-Control': 'no-store',
    },
  });
};
