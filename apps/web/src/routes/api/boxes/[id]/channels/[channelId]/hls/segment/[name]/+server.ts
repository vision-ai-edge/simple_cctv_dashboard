// TAG: BOX-CHANNELS-001
/**
 * GET /api/boxes/:id/channels/:channelId/hls/segment/:name
 *
 * HLS ts 세그먼트 프록시 라우트.
 * 세그먼트 바이트를 ReadableStream으로 클라이언트에 청크 파이프한다 (메모리 버퍼링 금지).
 *
 * AC-014: 서버 메모리에 전체 세그먼트를 버퍼링하지 않고 pipe/stream 방식 사용.
 * AC-015: 자격증명은 절대 클라이언트에 노출되지 않는다.
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
    `${INTERNAL_API_URL}/api/boxes/${params.id}/channels/${params.channelId}/hls/segment/${params.name}`,
    { headers },
  );

  if (!upstream.ok) {
    const body = await upstream.text();
    return new Response(body, {
      status: upstream.status,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // ReadableStream으로 ts 세그먼트를 청크 파이프 (메모리 버퍼링 없음)
  return new Response(upstream.body, {
    status: 200,
    headers: {
      'Content-Type': 'video/mp2t',
      'Cache-Control': 'no-store',
    },
  });
};
