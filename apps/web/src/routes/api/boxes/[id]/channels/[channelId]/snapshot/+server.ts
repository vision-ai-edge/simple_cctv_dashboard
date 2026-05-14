// TAG: BOX-CHANNELS-001
/**
 * GET /api/boxes/:id/channels/:channelId/snapshot?type=preview|fullsize
 *
 * 스냅샷 이미지 프록시 라우트.
 * 이미지 바이트를 메모리에 버퍼링하지 않고 ReadableStream으로 클라이언트에 파이프한다.
 * AC-007, AC-015: 자격증명은 절대 클라이언트에 노출되지 않는다.
 */

import type { RequestHandler } from './$types';

const INTERNAL_API_URL = process.env.INTERNAL_API_URL ?? 'http://localhost:3000';

export const GET: RequestHandler = async ({ params, cookies, url }) => {
  const token = cookies.get('access_token');
  const headers: Record<string, string> = {};
  if (token) {
    headers.Cookie = `access_token=${token}`;
  }

  const type = url.searchParams.get('type') ?? 'preview';
  const upstreamUrl = new URL(
    `${INTERNAL_API_URL}/api/boxes/${params.id}/channels/${params.channelId}/snapshot`,
  );
  upstreamUrl.searchParams.set('type', type);

  const upstream = await fetch(upstreamUrl.toString(), { headers });

  if (!upstream.ok) {
    const body = await upstream.text();
    return new Response(body, {
      status: upstream.status,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // 이미지 바이트를 스트리밍으로 파이프 (메모리 버퍼링 금지)
  const contentType = upstream.headers.get('Content-Type') ?? 'image/jpeg';
  return new Response(upstream.body, {
    status: 200,
    headers: {
      'Content-Type': contentType,
      'Cache-Control': 'no-store',
    },
  });
};
