// TAG: BOX-CHANNELS-001
/**
 * SPEC-BOX-CHANNELS-001 — 채널 관리 Hono 서브라우터.
 *
 * 엔드포인트 (모두 requireAuth 보호, WebRTC 라우트는 제외):
 *   POST   /sync                           — 채널 동기화 트리거
 *   GET    /                               — 채널 목록 조회 (DB 기반)
 *   POST   /:channelId/start               — 채널 활성화
 *   POST   /:channelId/stop                — 채널 비활성화
 *   GET    /:channelId/snapshot            — 스냅샷 프록시
 *   GET    /:channelId/hls/playlist.m3u8   — HLS m3u8 플레이리스트 프록시 (세그먼트 URL 재작성)
 *   GET    /:channelId/hls/segment/:name   — HLS ts 세그먼트 프록시 (스트리밍)
 *
 * 보안 원칙:
 *   - 자격증명 (API Key, JWT) 원문 클라이언트 노출 금지
 *   - HLS 세그먼트 URL 재작성으로 Box 직접 접근 차단
 *   - 모든 요청 파라미터 Zod 스키마 검증
 *   - AbortController + 10초 타임아웃
 */

import type { BoxClient } from '@cctv/shared';
import { decryptWithVault } from '@cctv/shared/crypto/vault';
import { Hono } from 'hono';
import { z } from 'zod';
import { createRequireAuth } from '../middleware/requireAuth';
import type { BoxServiceDeps } from '../services/boxService';
import { BoxNotFoundError, queryCredentialRow } from '../services/boxService';
import { syncChannelsForBox } from '../services/channelSyncService';

// ---------------------------------------------------------------------------
// 입력 스키마
// ---------------------------------------------------------------------------

const SnapshotQuerySchema = z.object({
  type: z.enum(['preview', 'fullsize']).optional(),
});

const ChannelIdParamSchema = z.object({
  channelId: z.string().min(1),
});

const SegmentNameParamSchema = z.object({
  channelId: z.string().min(1),
  name: z.string().min(1),
});

// vision-ai 모델 슬롯 라우트용 스키마 (M4-2)
const ChannelModelSlotBodySchema = z.object({
  modelId: z.string().min(1),
  enabled: z.boolean().optional(),
});

const ChannelModelIdParamSchema = z.object({
  channelId: z.string().min(1),
  modelId: z.string().min(1),
});

// ---------------------------------------------------------------------------
// 에러 응답 헬퍼
// ---------------------------------------------------------------------------

function errorEnvelope(message: string) {
  return { success: false, message, timestamp: Date.now() } as const;
}

// ---------------------------------------------------------------------------
// 라우트 팩토리 옵션
// ---------------------------------------------------------------------------

export interface CreateChannelRoutesOptions {
  /** boxService 의존성 주입 컨테이너 */
  deps: BoxServiceDeps;
  /** JWT 시크릿 (requireAuth 생성에 사용) */
  jwtSecret?: string;
}

// ---------------------------------------------------------------------------
// 내부 헬퍼: 자격증명 로드 및 BoxClient 생성
// ---------------------------------------------------------------------------

async function resolveClientForBox(
  boxId: string,
  deps: BoxServiceDeps,
): Promise<{ client: BoxClient; baseUrl: string; jwt?: string; apiKey?: string }> {
  const { db, vaultKey, createBoxClient } = deps;
  const credRow = queryCredentialRow(db, boxId);

  let jwt: string | undefined;
  if (credRow.jwtCachedEnc) {
    try {
      jwt = await decryptWithVault(credRow.jwtCachedEnc, vaultKey);
    } catch {
      jwt = undefined;
    }
  }

  let apiKey: string | undefined;
  if (credRow.apiKeyCachedEnc) {
    try {
      apiKey = await decryptWithVault(credRow.apiKeyCachedEnc, vaultKey);
    } catch {
      apiKey = undefined;
    }
  }

  const client = createBoxClient(credRow.baseUrl, jwt);
  return { client, baseUrl: credRow.baseUrl, jwt, apiKey };
}

// ---------------------------------------------------------------------------
// 내부 헬퍼: 부모 라우터 파라미터 추출
// ---------------------------------------------------------------------------

/**
 * Hono 서브라우터에서 부모 :id 파라미터를 가져온다.
 * c.req.param('id') 는 string | undefined 이므로 undefined 시 null 반환.
 */
function getBoxId(c: { req: { param: (key: string) => string | undefined } }): string | null {
  const id = c.req.param('id');
  return id ?? null;
}

// ---------------------------------------------------------------------------
// 라우트 팩토리
// ---------------------------------------------------------------------------

/**
 * 채널 라우트 팩토리.
 *
 * 사용법 (boxes.ts에서 마운트):
 * ```ts
 * import { createChannelRoutes } from './channels';
 * router.route('/:id/channels', createChannelRoutes({ deps, jwtSecret }));
 * ```
 *
 * 주의: 이 라우터는 /:id 파라미터 컨텍스트 외부에서 마운트된다.
 * Hono의 인접 파라미터 전파를 위해 boxId는 req.param('id')로 접근한다.
 */
export function createChannelRoutes(opts: CreateChannelRoutesOptions): Hono {
  const { deps } = opts;
  const { db } = deps;

  const jwtSecret = opts.jwtSecret ?? process.env.JWT_SECRET ?? '';
  const requireAuth = createRequireAuth({ db, jwtSecret });

  const router = new Hono();

  // 모든 채널 라우트에 requireAuth 적용
  router.use('*', requireAuth);

  // -------------------------------------------------------------------------
  // POST /sync — 채널 동기화 트리거 (REQ-CHAN-009)
  // -------------------------------------------------------------------------
  router.post('/sync', async (c) => {
    const boxId = getBoxId(c);
    if (!boxId) {
      return c.json(errorEnvelope('Box ID가 없습니다'), 400);
    }

    try {
      const result = await syncChannelsForBox(boxId, deps);
      if (!result.success) {
        return c.json({ ...result }, 502);
      }
      return c.json(result, 200);
    } catch (err) {
      if (err instanceof BoxNotFoundError) {
        return c.json(errorEnvelope(`Box 를 찾을 수 없습니다: ${boxId}`), 404);
      }
      throw err;
    }
  });

  // -------------------------------------------------------------------------
  // GET / — 채널 목록 조회 (DB 기반, REQ-CHAN-005)
  // -------------------------------------------------------------------------
  router.get('/', async (c) => {
    const boxId = getBoxId(c);
    if (!boxId) {
      return c.json(errorEnvelope('Box ID가 없습니다'), 400);
    }

    // Box 존재 확인
    const boxRow = db.$client.query('SELECT id FROM boxes WHERE id = ?').get(boxId) as {
      id: string;
    } | null;
    if (!boxRow) {
      return c.json(errorEnvelope(`Box 를 찾을 수 없습니다: ${boxId}`), 404);
    }

    type CameraDbRow = {
      id: string;
      channelId: string;
      name: string;
      status: string;
      resolution: string | null;
      streamUrl: string | null;
      lastSyncedAt: number | null;
      syncError: string | null;
    };

    const channels = db.$client
      .query(
        `SELECT id, channel_id as channelId, name, status, resolution,
                stream_url as streamUrl, last_synced_at as lastSyncedAt, sync_error as syncError
         FROM cameras WHERE box_id = ? ORDER BY created_at ASC`,
      )
      .all(boxId) as CameraDbRow[];

    return c.json({ channels }, 200);
  });

  // -------------------------------------------------------------------------
  // POST /:channelId/start — 채널 활성화 (REQ-CHAN-006)
  // -------------------------------------------------------------------------
  router.post('/:channelId/start', async (c) => {
    const boxId = getBoxId(c);
    if (!boxId) return c.json(errorEnvelope('Box ID가 없습니다'), 400);
    const rawParams = c.req.param();
    const parsed = ChannelIdParamSchema.safeParse(rawParams);
    if (!parsed.success) {
      return c.json(errorEnvelope('channelId가 유효하지 않습니다'), 400);
    }
    const { channelId } = parsed.data;

    try {
      const { client } = await resolveClientForBox(boxId, deps);

      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 10_000);
      try {
        await Promise.race([
          client.channels.start(channelId),
          new Promise<never>((_, reject) =>
            controller.signal.addEventListener('abort', () => reject(new Error('Timeout'))),
          ),
        ]);
        return c.json({ success: true }, 200);
      } finally {
        clearTimeout(timeoutId);
      }
    } catch (err) {
      if (err instanceof BoxNotFoundError) {
        return c.json(errorEnvelope(`Box 를 찾을 수 없습니다: ${boxId}`), 404);
      }
      return c.json(errorEnvelope('채널 활성화 요청에 실패했습니다'), 502);
    }
  });

  // -------------------------------------------------------------------------
  // POST /:channelId/stop — 채널 비활성화 (REQ-CHAN-006)
  // -------------------------------------------------------------------------
  router.post('/:channelId/stop', async (c) => {
    const boxId = getBoxId(c);
    if (!boxId) return c.json(errorEnvelope('Box ID가 없습니다'), 400);
    const rawParams = c.req.param();
    const parsed = ChannelIdParamSchema.safeParse(rawParams);
    if (!parsed.success) {
      return c.json(errorEnvelope('channelId가 유효하지 않습니다'), 400);
    }
    const { channelId } = parsed.data;

    try {
      const { client } = await resolveClientForBox(boxId, deps);

      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 10_000);
      try {
        await Promise.race([
          client.channels.stop(channelId),
          new Promise<never>((_, reject) =>
            controller.signal.addEventListener('abort', () => reject(new Error('Timeout'))),
          ),
        ]);
        return c.json({ success: true }, 200);
      } finally {
        clearTimeout(timeoutId);
      }
    } catch (err) {
      if (err instanceof BoxNotFoundError) {
        return c.json(errorEnvelope(`Box 를 찾을 수 없습니다: ${boxId}`), 404);
      }
      return c.json(errorEnvelope('채널 비활성화 요청에 실패했습니다'), 502);
    }
  });

  // -------------------------------------------------------------------------
  // GET /:channelId/snapshot — 스냅샷 프록시 (REQ-CHAN-008)
  // -------------------------------------------------------------------------
  router.get('/:channelId/snapshot', async (c) => {
    const boxId = getBoxId(c);
    if (!boxId) return c.json(errorEnvelope('Box ID가 없습니다'), 400);
    const rawParams = c.req.param();
    const parsed = ChannelIdParamSchema.safeParse(rawParams);
    if (!parsed.success) {
      return c.json(errorEnvelope('channelId가 유효하지 않습니다'), 400);
    }
    const { channelId } = parsed.data;

    const queryParsed = SnapshotQuerySchema.safeParse(
      Object.fromEntries(new URL(c.req.url).searchParams),
    );
    const snapshotType = queryParsed.success ? queryParsed.data.type : undefined;

    try {
      const { baseUrl, jwt, apiKey } = await resolveClientForBox(boxId, deps);

      // 스냅샷 URL 구성 (자격증명은 서버 측에서만 사용).
      // 박스 OpenAPI v1.3.6 servers: <host>/api — 모든 path 는 그 base 에 *덧붙여*진다.
      // `new URL('/channels/...', baseUrl)` 는 absolute path 가 base 의 `/api` 를 제거해 404 유발.
      // string 결합으로 prefix 를 유지한다 (boxClient.#request 와 동일한 패턴).
      // 박스 ?type=original|processed (기본 processed). FE 의 preview/fullsize 는 UI 용어이므로 미전달.
      const snapshotUrl = new URL(`${baseUrl}/channels/${encodeURIComponent(channelId)}/snapshot`);
      void snapshotType; // 현재 SPEC 범위에서는 박스에 미전달 (FE 호환 입력만 유지)

      const headers: Record<string, string> = {
        Accept: 'image/*',
      };
      if (jwt) {
        headers.Authorization = `Bearer ${jwt}`;
      } else if (apiKey) {
        headers['X-API-Key'] = apiKey;
      }

      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 10_000);

      let boxResponse: Response;
      try {
        boxResponse = await fetch(snapshotUrl.toString(), {
          headers,
          signal: controller.signal,
        });
      } finally {
        clearTimeout(timeoutId);
      }

      if (!boxResponse.ok) {
        // 관측성: 박스가 무엇으로 거부했는지 콘솔에 노출 (자격증명은 헤더만 사용했으므로 body 안전).
        const errBody = await boxResponse.text().catch(() => '');
        console.warn(`[channels] snapshot 프록시 실패`, {
          boxId,
          channelId,
          upstreamStatus: boxResponse.status,
          upstreamBody: errBody.slice(0, 300),
        });
        return c.json(errorEnvelope('스냅샷 취득에 실패했습니다'), 502);
      }

      const contentType = boxResponse.headers.get('content-type') ?? 'image/jpeg';
      const imageBytes = await boxResponse.arrayBuffer();

      return new Response(imageBytes, {
        status: 200,
        headers: {
          'Content-Type': contentType,
          'Cache-Control': 'no-store',
        },
      });
    } catch (err) {
      if (err instanceof BoxNotFoundError) {
        return c.json(errorEnvelope(`Box 를 찾을 수 없습니다: ${boxId}`), 404);
      }
      return c.json(errorEnvelope('스냅샷 프록시 오류'), 502);
    }
  });

  // -------------------------------------------------------------------------
  // GET /:channelId/hls/playlist.m3u8 — HLS 플레이리스트 프록시 (REQ-CHAN-007)
  // 세그먼트 URL을 자체 도메인으로 재작성하여 자격증명 비노출
  // -------------------------------------------------------------------------
  router.get('/:channelId/hls/playlist.m3u8', async (c) => {
    const boxId = getBoxId(c);
    if (!boxId) return c.json(errorEnvelope('Box ID가 없습니다'), 400);
    const rawParams = c.req.param();
    const parsed = ChannelIdParamSchema.safeParse(rawParams);
    if (!parsed.success) {
      return c.json(errorEnvelope('channelId가 유효하지 않습니다'), 400);
    }
    const { channelId } = parsed.data;

    try {
      const { baseUrl, jwt, apiKey } = await resolveClientForBox(boxId, deps);

      // Box HLS URL 구성 (자격증명은 서버측에서만 사용).
      // OpenAPI servers base = <host>/api → HLS 도 /api/hls/{id}/playlist.m3u8.
      // (snapshot 과 동일하게 absolute path + base 함정 회피)
      const playlistUrl = new URL(`${baseUrl}/hls/${encodeURIComponent(channelId)}/playlist.m3u8`);
      if (jwt) {
        playlistUrl.searchParams.set('token', jwt);
      } else if (apiKey) {
        playlistUrl.searchParams.set('apikey', apiKey);
      }

      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 10_000);

      let boxResponse: Response;
      try {
        boxResponse = await fetch(playlistUrl.toString(), {
          signal: controller.signal,
        });
      } finally {
        clearTimeout(timeoutId);
      }

      if (!boxResponse.ok) {
        // 관측성: 박스 upstream 상태/메시지 노출 (token/apikey 는 URL 쿼리스트링으로 갔으므로
        // upstream body 자체에는 자격증명이 포함되지 않는다).
        const errBody = await boxResponse.text().catch(() => '');
        console.warn(`[channels] HLS playlist 프록시 실패`, {
          boxId,
          channelId,
          upstreamStatus: boxResponse.status,
          upstreamBody: errBody.slice(0, 300),
        });
        return c.json(errorEnvelope('HLS 플레이리스트 취득에 실패했습니다'), 502);
      }

      const m3u8Text = await boxResponse.text();

      // 세그먼트 URL 재작성:
      // Box 원본 URL → /api/boxes/:boxId/channels/:channelId/hls/segment/:name
      const rewritten = rewriteM3u8SegmentUrls(m3u8Text, boxId, channelId);

      return new Response(rewritten, {
        status: 200,
        headers: {
          'Content-Type': 'application/vnd.apple.mpegurl',
          'Cache-Control': 'no-store',
        },
      });
    } catch (err) {
      if (err instanceof BoxNotFoundError) {
        return c.json(errorEnvelope(`Box 를 찾을 수 없습니다: ${boxId}`), 404);
      }
      return c.json(errorEnvelope('HLS 플레이리스트 프록시 오류'), 502);
    }
  });

  // -------------------------------------------------------------------------
  // SPEC-ALERTS-001 M4-2: 채널별 vision-ai 모델 슬롯 라우트
  // -------------------------------------------------------------------------

  // GET /:channelId/vision-ai/models — 채널 모델 슬롯 목록 조회
  router.get('/:channelId/vision-ai/models', async (c) => {
    const boxId = getBoxId(c);
    if (!boxId) return c.json(errorEnvelope('Box ID가 없습니다'), 400);
    const rawParams = c.req.param();
    const parsed = ChannelIdParamSchema.safeParse(rawParams);
    if (!parsed.success) {
      return c.json(errorEnvelope('channelId가 유효하지 않습니다'), 400);
    }
    const { channelId } = parsed.data;

    try {
      const { client } = await resolveClientForBox(boxId, deps);
      const models = await client.visionAi.listChannelModels(channelId);
      return c.json({ models }, 200);
    } catch (err) {
      if (err instanceof BoxNotFoundError) {
        return c.json(errorEnvelope(`Box 를 찾을 수 없습니다: ${boxId}`), 404);
      }
      return c.json(errorEnvelope('채널 모델 목록 조회에 실패했습니다'), 502);
    }
  });

  // POST /:channelId/vision-ai/models — 채널 모델 슬롯 추가
  router.post('/:channelId/vision-ai/models', async (c) => {
    const boxId = getBoxId(c);
    if (!boxId) return c.json(errorEnvelope('Box ID가 없습니다'), 400);
    const rawParams = c.req.param();
    const channelParsed = ChannelIdParamSchema.safeParse(rawParams);
    if (!channelParsed.success) {
      return c.json(errorEnvelope('channelId가 유효하지 않습니다'), 400);
    }
    const { channelId } = channelParsed.data;

    let body: { modelId: string; enabled?: boolean };
    try {
      const raw = await c.req.json();
      const bodyParsed = ChannelModelSlotBodySchema.safeParse(raw);
      if (!bodyParsed.success) {
        return c.json(errorEnvelope('요청 본문이 유효하지 않습니다'), 400);
      }
      body = bodyParsed.data;
    } catch {
      return c.json(errorEnvelope('요청 본문을 파싱할 수 없습니다'), 400);
    }

    try {
      const { client } = await resolveClientForBox(boxId, deps);
      const slot = await client.visionAi.addChannelModel(channelId, body);
      return c.json(slot, 200);
    } catch (err) {
      if (err instanceof BoxNotFoundError) {
        return c.json(errorEnvelope(`Box 를 찾을 수 없습니다: ${boxId}`), 404);
      }
      return c.json(errorEnvelope('채널 모델 추가에 실패했습니다'), 502);
    }
  });

  // DELETE /:channelId/vision-ai/models/:modelId — 채널 모델 슬롯 제거
  router.delete('/:channelId/vision-ai/models/:modelId', async (c) => {
    const boxId = getBoxId(c);
    if (!boxId) return c.json(errorEnvelope('Box ID가 없습니다'), 400);
    const rawParams = c.req.param();
    const parsed = ChannelModelIdParamSchema.safeParse(rawParams);
    if (!parsed.success) {
      return c.json(errorEnvelope('channelId 또는 modelId가 유효하지 않습니다'), 400);
    }
    const { channelId, modelId } = parsed.data;

    try {
      const { client } = await resolveClientForBox(boxId, deps);
      await client.visionAi.removeChannelModel(channelId, modelId);
      return c.json({ success: true }, 200);
    } catch (err) {
      if (err instanceof BoxNotFoundError) {
        return c.json(errorEnvelope(`Box 를 찾을 수 없습니다: ${boxId}`), 404);
      }
      return c.json(errorEnvelope('채널 모델 제거에 실패했습니다'), 502);
    }
  });

  // -------------------------------------------------------------------------
  // GET /:channelId/hls/segment/:name — HLS 세그먼트 프록시 (REQ-CHAN-007)
  // 바이트 스트리밍 (메모리 버퍼링 금지)
  // -------------------------------------------------------------------------
  router.get('/:channelId/hls/segment/:name', async (c) => {
    const boxId = getBoxId(c);
    if (!boxId) return c.json(errorEnvelope('Box ID가 없습니다'), 400);
    const rawParams = c.req.param();
    const parsed = SegmentNameParamSchema.safeParse(rawParams);
    if (!parsed.success) {
      return c.json(errorEnvelope('파라미터가 유효하지 않습니다'), 400);
    }
    const { channelId, name } = parsed.data;

    try {
      const { baseUrl, jwt, apiKey } = await resolveClientForBox(boxId, deps);

      // 세그먼트 URL 구성 (자격증명 서버측 주입).
      // OpenAPI servers base = <host>/api → 세그먼트도 /api/hls/{id}/{seg}.
      const segmentUrl = new URL(
        `${baseUrl}/hls/${encodeURIComponent(channelId)}/${encodeURIComponent(name)}`,
      );
      if (jwt) {
        segmentUrl.searchParams.set('token', jwt);
      } else if (apiKey) {
        segmentUrl.searchParams.set('apikey', apiKey);
      }

      const headers: Record<string, string> = {};
      if (jwt) {
        headers.Authorization = `Bearer ${jwt}`;
      } else if (apiKey) {
        headers['X-API-Key'] = apiKey;
      }

      // 핸드셰이크 타임아웃 (스트리밍 자체는 청크 단위이므로 연결 확립에만 적용)
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 10_000);

      let boxResponse: Response;
      try {
        boxResponse = await fetch(segmentUrl.toString(), {
          headers,
          signal: controller.signal,
        });
        clearTimeout(timeoutId);
      } catch (err) {
        clearTimeout(timeoutId);
        return c.json(errorEnvelope('HLS 세그먼트 접근 실패'), 502);
      }

      if (!boxResponse.ok) {
        return c.json(errorEnvelope('HLS 세그먼트 취득에 실패했습니다'), 502);
      }

      // ReadableStream으로 청크 스트리밍 (메모리 버퍼링 금지)
      return new Response(boxResponse.body, {
        status: 200,
        headers: {
          'Content-Type': 'video/mp2t',
          'Cache-Control': 'no-store',
        },
      });
    } catch (err) {
      if (err instanceof BoxNotFoundError) {
        return c.json(errorEnvelope(`Box 를 찾을 수 없습니다: ${boxId}`), 404);
      }
      return c.json(errorEnvelope('HLS 세그먼트 프록시 오류'), 502);
    }
  });

  return router;
}

// ---------------------------------------------------------------------------
// 내부 헬퍼: m3u8 세그먼트 URL 재작성
// ---------------------------------------------------------------------------

/**
 * m3u8 플레이리스트 내 세그먼트 URL을 자체 도메인 프록시 경로로 재작성한다.
 *
 * 입력: `https://box-host/hls/ch-001/seg-001.ts?apikey=KEY`
 * 출력: `/api/boxes/:boxId/channels/:channelId/hls/segment/seg-001.ts`
 *
 * 자격증명 파라미터(apikey, token, jwt)를 제거하여 클라이언트 노출 방지.
 */
export function rewriteM3u8SegmentUrls(m3u8Text: string, boxId: string, channelId: string): string {
  const lines = m3u8Text.split('\n');
  const rewritten = lines.map((line) => {
    const trimmed = line.trim();
    // 세그먼트 URI 라인: .ts로 끝나거나 URI=로 시작하는 태그의 값
    if (trimmed.startsWith('#')) {
      // URI 속성 재작성 (예: #EXT-X-MAP:URI="...")
      return line.replace(/URI="([^"]+)"/g, (_match, uri) => {
        const segName = extractSegmentName(uri);
        if (!segName) return `URI="${uri}"`;
        return `URI="/api/boxes/${encodeURIComponent(boxId)}/channels/${encodeURIComponent(channelId)}/hls/segment/${encodeURIComponent(segName)}"`;
      });
    }
    // .ts 세그먼트 라인 (절대 URL 또는 상대 경로)
    if (trimmed.endsWith('.ts') || trimmed.includes('.ts?')) {
      const segName = extractSegmentName(trimmed);
      if (!segName) return line;
      return `/api/boxes/${encodeURIComponent(boxId)}/channels/${encodeURIComponent(channelId)}/hls/segment/${encodeURIComponent(segName)}`;
    }
    return line;
  });
  return rewritten.join('\n');
}

/**
 * URL 또는 경로에서 세그먼트 파일명을 추출한다.
 * 쿼리 파라미터(apikey, token)를 제거한다.
 */
function extractSegmentName(uri: string): string | null {
  try {
    // 절대 URL인 경우
    let pathname: string;
    if (uri.startsWith('http://') || uri.startsWith('https://')) {
      const url = new URL(uri);
      pathname = url.pathname;
    } else {
      // 쿼리 스트링 제거 (noUncheckedIndexedAccess 대응: ?? 사용)
      pathname = uri.split('?')[0] ?? uri;
    }
    // 마지막 경로 컴포넌트 추출 (noUncheckedIndexedAccess 대응)
    const parts = pathname.split('/');
    const fileName = parts.length > 0 ? parts[parts.length - 1] : undefined;
    return fileName && fileName.length > 0 ? fileName : null;
  } catch {
    return null;
  }
}
