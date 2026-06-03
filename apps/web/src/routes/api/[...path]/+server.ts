import { getApiUpstreamUrl } from '$lib/server/apiUrl';
import type { RequestHandler } from './$types';

async function handle(request: Request): Promise<Response> {
  const incomingUrl = new URL(request.url);
  const upstreamUrl = new URL(`${incomingUrl.pathname}${incomingUrl.search}`, getApiUpstreamUrl());
  const headers = new Headers(request.headers);
  headers.set('host', upstreamUrl.host);

  const upstream = await fetch(upstreamUrl, {
    method: request.method,
    headers,
    body: request.method === 'GET' || request.method === 'HEAD' ? undefined : request.body,
    duplex: 'half',
  } as RequestInit & { duplex: 'half' });

  return new Response(upstream.body, {
    status: upstream.status,
    statusText: upstream.statusText,
    headers: upstream.headers,
  });
}

export const GET: RequestHandler = ({ request }) => handle(request);
export const POST: RequestHandler = ({ request }) => handle(request);
export const PUT: RequestHandler = ({ request }) => handle(request);
export const PATCH: RequestHandler = ({ request }) => handle(request);
export const DELETE: RequestHandler = ({ request }) => handle(request);
export const OPTIONS: RequestHandler = ({ request }) => handle(request);
