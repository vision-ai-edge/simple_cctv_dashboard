// TAG: ALERTS-001
/**
 * SPEC-ALERTS-001 M3 — 알림 API Hono 서브라우터.
 *
 * 엔드포인트 (모두 requireAuth 보호):
 *   GET    /stream                         — SSE 실시간 알림 스트림
 *   GET    /                               — 알림 이력 조회 (페이지네이션)
 *   GET    /webpush/vapid-public-key       — VAPID 공개 키 반환
 *   POST   /webpush/subscribe              — WebPush 구독 등록 (UPSERT)
 *   DELETE /webpush/subscribe              — WebPush 구독 해제
 *   GET    /destinations                   — 알림 수신처 목록 조회
 *   PUT    /destinations/:channel          — 알림 수신처 설정 업데이트
 *
 * 설계 원칙:
 *   - SSE: Map<userId, Set<controller>> 레지스트리는 alertDispatcher 위임
 *   - 모든 입력 Zod 검증, 오류는 errorEnvelope 형식
 *   - Telegram 채널은 enabled=true 시 config.chat_id 필수
 *   - destinations 미설정 사용자 → 기본값 3개 in-memory 반환 (DB 미저장)
 */

import type { Db } from '@cctv/db';
import { Hono } from 'hono';
import { z } from 'zod';
import { createRequireAuth } from '../middleware/requireAuth';
import type { AlertDispatcher } from '../services/alertDispatcher';

// ---------------------------------------------------------------------------
// 공개 인터페이스
// ---------------------------------------------------------------------------

export interface CreateAlertRoutesOptions {
  /** 의존성 주입 컨테이너 (DB) */
  deps: { db: Db };
  /** JWT 시크릿 (requireAuth 생성에 사용) */
  jwtSecret?: string;
  /** AlertDispatcher 인스턴스 (SSE 레지스트리 접근) */
  dispatcher?: AlertDispatcher;
}

// ---------------------------------------------------------------------------
// 입력 스키마
// ---------------------------------------------------------------------------

const HistoryQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});

const WebPushSubscribeBodySchema = z.object({
  endpoint: z.string().url({ message: 'endpoint 는 유효한 URL 이어야 합니다' }),
  keys: z.object({
    p256dh: z.string().min(1),
    auth: z.string().min(1),
  }),
});

const WebPushUnsubscribeSchema = z.object({
  endpoint: z.string().min(1),
});

const DestinationChannelSchema = z.enum(['toast', 'webpush', 'telegram']);

const DestinationBodySchema = z
  .object({
    enabled: z.boolean(),
    config: z
      .object({
        chat_id: z.string().optional(),
      })
      .optional(),
  })
  .superRefine((data, ctx) => {
    // telegram + enabled=true → config.chat_id 필수
    // NOTE: 채널 자체는 path param 으로 전달되므로 여기서는 chat_id 존재 여부만 검증
    // (telegram 채널 검증은 라우트 핸들러에서 channel param 과 함께 수행)
    if (data.config !== undefined) {
      // config 가 있을 때 chat_id 의 타입만 확인 (empty string 방지)
      if (data.config.chat_id !== undefined && data.config.chat_id.trim() === '') {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'config.chat_id 는 빈 문자열일 수 없습니다',
        });
      }
    }
  });

// ---------------------------------------------------------------------------
// 에러 응답 헬퍼
// ---------------------------------------------------------------------------

function errorEnvelope(message: string) {
  return { success: false, message, timestamp: Date.now() } as const;
}

// ---------------------------------------------------------------------------
// ULID 생성 (ulid 패키지 사용)
// ---------------------------------------------------------------------------

function generateId(): string {
  // ulid 는 대문자 Crockford's Base32 — crypto.randomUUID 대안
  const chars = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
  const now = Date.now();

  // 10자리 타임스탬프 (48비트)
  let tsStr = '';
  let ts = now;
  for (let i = 9; i >= 0; i--) {
    tsStr = (chars[ts % 32] ?? '0') + tsStr;
    ts = Math.floor(ts / 32);
  }

  // 16자리 랜덤
  const randBytes = new Uint8Array(10);
  crypto.getRandomValues(randBytes);
  let randStr = '';
  for (const b of randBytes) {
    randStr += chars[b % 32] ?? '0';
  }

  return tsStr + randStr;
}

// ---------------------------------------------------------------------------
// 기본 destinations (DB 미설정 사용자용)
// ---------------------------------------------------------------------------

const DEFAULT_DESTINATIONS = [
  { channel: 'toast' as const, enabled: true, config: null },
  { channel: 'webpush' as const, enabled: false, config: null },
  { channel: 'telegram' as const, enabled: false, config: null },
];

// ---------------------------------------------------------------------------
// 내부 DB 타입
// ---------------------------------------------------------------------------

type DetectionAlertRow = {
  id: string;
  boxId: string;
  channelId: string;
  type: string;
  payloadJson: string;
  firedAt: number;
  status: string;
  createdAt: number;
};

type AlertDestinationRow = {
  id: string;
  userId: string;
  channel: 'toast' | 'webpush' | 'telegram';
  enabled: number;
  configJson: string | null;
  createdAt: number;
  updatedAt: number;
};

// ---------------------------------------------------------------------------
// 라우트 팩토리
// ---------------------------------------------------------------------------

/**
 * 알림 라우트 팩토리.
 *
 * 사용법 (app.ts 에서 마운트):
 * ```ts
 * import { createAlertRoutes } from './routes/alerts';
 * app.route('/api/alerts', createAlertRoutes({ deps: { db }, jwtSecret, dispatcher }));
 * ```
 */
export function createAlertRoutes(opts: CreateAlertRoutesOptions): Hono {
  const { deps, dispatcher } = opts;
  const { db } = deps;

  const jwtSecret = opts.jwtSecret ?? process.env.JWT_SECRET ?? '';
  const requireAuth = createRequireAuth({ db, jwtSecret });

  const router = new Hono();

  // 모든 알림 라우트에 requireAuth 적용
  router.use('*', requireAuth);

  // -------------------------------------------------------------------------
  // GET /stream — SSE 실시간 알림 스트림 (REQ-ALERT-004, REQ-ALERT-005)
  // -------------------------------------------------------------------------
  router.get('/stream', async (c) => {
    const userId = c.get('userId');

    const HEARTBEAT_INTERVAL_MS = 30_000;

    const stream = new ReadableStream({
      start(controller) {
        // 초기 연결 확인 이벤트
        const initial = `event: connected\ndata: ${JSON.stringify({ userId, timestamp: Date.now() })}\n\n`;
        controller.enqueue(initial);

        // alertDispatcher 에 SSE 클라이언트 등록
        let unregister: (() => void) | undefined;
        if (dispatcher) {
          unregister = dispatcher.registerSSEClient(userId, controller);
        }

        // 30초 주기 heartbeat
        const heartbeatTimer = setInterval(() => {
          try {
            controller.enqueue(': keep-alive\n\n');
          } catch {
            // 연결 끊김 — 정리
            clearInterval(heartbeatTimer);
            unregister?.();
          }
        }, HEARTBEAT_INTERVAL_MS);

        // 요청 abort 시 정리
        c.req.raw.signal?.addEventListener('abort', () => {
          clearInterval(heartbeatTimer);
          unregister?.();
          try {
            controller.close();
          } catch {
            // 이미 닫힌 경우 무시
          }
        });
      },
      cancel() {
        // 클라이언트가 스트림을 취소한 경우 — start 내 abort 리스너가 처리
      },
    });

    return new Response(stream, {
      status: 200,
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
        'X-Accel-Buffering': 'no',
      },
    });
  });

  // -------------------------------------------------------------------------
  // GET / — 알림 이력 조회 (페이지네이션, REQ-ALERT-005)
  // -------------------------------------------------------------------------
  router.get('/', async (c) => {
    const rawQuery = Object.fromEntries(new URL(c.req.url).searchParams);
    const parsed = HistoryQuerySchema.safeParse(rawQuery);
    if (!parsed.success) {
      return c.json(errorEnvelope('쿼리 파라미터가 유효하지 않습니다'), 400);
    }
    const { limit, offset } = parsed.data;

    // detection_alerts 에서 fired_at DESC 순 페이지네이션
    const totalRow = db.$client.query('SELECT COUNT(*) as total FROM detection_alerts').get() as {
      total: number;
    };
    const total = totalRow?.total ?? 0;

    const rows = db.$client
      .query(
        `SELECT id, box_id as boxId, channel_id as channelId, type, payload_json as payloadJson,
                fired_at as firedAt, status, created_at as createdAt
         FROM detection_alerts
         ORDER BY fired_at DESC
         LIMIT ? OFFSET ?`,
      )
      .all(limit, offset) as DetectionAlertRow[];

    return c.json(
      {
        alerts: rows,
        pagination: {
          total,
          limit,
          offset,
          hasMore: offset + limit < total,
        },
      },
      200,
    );
  });

  // -------------------------------------------------------------------------
  // GET /webpush/vapid-public-key — VAPID 공개 키 반환 (REQ-ALERT-006)
  // -------------------------------------------------------------------------
  router.get('/webpush/vapid-public-key', async (c) => {
    const key = process.env.VAPID_PUBLIC_KEY;
    if (!key) {
      return c.json(errorEnvelope('VAPID 공개 키가 설정되지 않았습니다'), 503);
    }
    return c.json({ key }, 200);
  });

  // -------------------------------------------------------------------------
  // POST /webpush/subscribe — WebPush 구독 등록 UPSERT (REQ-ALERT-006)
  // -------------------------------------------------------------------------
  router.post('/webpush/subscribe', async (c) => {
    const userId = c.get('userId');

    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return c.json(errorEnvelope('요청 바디를 파싱할 수 없습니다'), 400);
    }

    const parsed = WebPushSubscribeBodySchema.safeParse(body);
    if (!parsed.success) {
      const message = parsed.error.issues[0]?.message ?? '요청 바디가 유효하지 않습니다';
      return c.json(errorEnvelope(message), 400);
    }

    const { endpoint, keys } = parsed.data;
    const now = Date.now();
    const id = generateId();

    // UPSERT: user_id + endpoint UNIQUE 제약 활용 (INSERT OR REPLACE)
    db.$client
      .prepare(
        `INSERT INTO webpush_subscriptions (id, user_id, endpoint, p256dh, auth, created_at)
         VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT(user_id, endpoint) DO UPDATE SET
           p256dh = excluded.p256dh,
           auth = excluded.auth`,
      )
      .run(id, userId, endpoint, keys.p256dh, keys.auth, now);

    return c.json({ success: true, endpoint }, 200);
  });

  // -------------------------------------------------------------------------
  // DELETE /webpush/subscribe — WebPush 구독 해제 (REQ-ALERT-006)
  // -------------------------------------------------------------------------
  router.delete('/webpush/subscribe', async (c) => {
    const userId = c.get('userId');

    // body 또는 query 에서 endpoint 추출
    let endpoint: string | undefined;

    // 먼저 query param 시도
    const queryEndpoint = new URL(c.req.url).searchParams.get('endpoint');
    if (queryEndpoint) {
      endpoint = queryEndpoint;
    } else {
      // body 에서 시도
      try {
        const body = await c.req.json();
        const parsed = WebPushUnsubscribeSchema.safeParse(body);
        if (parsed.success) {
          endpoint = parsed.data.endpoint;
        }
      } catch {
        // body 파싱 실패 시 무시
      }
    }

    if (!endpoint) {
      return c.json(errorEnvelope('endpoint 가 필요합니다'), 400);
    }

    db.$client
      .prepare('DELETE FROM webpush_subscriptions WHERE user_id = ? AND endpoint = ?')
      .run(userId, endpoint);

    return c.json({ success: true }, 200);
  });

  // -------------------------------------------------------------------------
  // GET /destinations — 알림 수신처 목록 조회 (REQ-ALERT-008)
  // -------------------------------------------------------------------------
  router.get('/destinations', async (c) => {
    const userId = c.get('userId');

    const rows = db.$client
      .query(
        `SELECT id, user_id as userId, channel, enabled, config_json as configJson,
                created_at as createdAt, updated_at as updatedAt
         FROM alert_destinations
         WHERE user_id = ?`,
      )
      .all(userId) as AlertDestinationRow[];

    if (rows.length === 0) {
      // DB 미설정 사용자 → 기본값 3개 in-memory 반환 (저장하지 않음)
      return c.json({ destinations: DEFAULT_DESTINATIONS }, 200);
    }

    const destinations = rows.map((r) => ({
      channel: r.channel,
      enabled: r.enabled === 1,
      config: r.configJson ? JSON.parse(r.configJson) : null,
    }));

    return c.json({ destinations }, 200);
  });

  // -------------------------------------------------------------------------
  // PUT /destinations/:channel — 알림 수신처 업데이트 UPSERT (REQ-ALERT-008)
  // -------------------------------------------------------------------------
  router.put('/destinations/:channel', async (c) => {
    const userId = c.get('userId');
    const rawChannel = c.req.param('channel');

    const channelParsed = DestinationChannelSchema.safeParse(rawChannel);
    if (!channelParsed.success) {
      return c.json(
        errorEnvelope("channel 은 'toast', 'webpush', 'telegram' 중 하나여야 합니다"),
        400,
      );
    }
    const channel = channelParsed.data;

    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return c.json(errorEnvelope('요청 바디를 파싱할 수 없습니다'), 400);
    }

    const parsed = DestinationBodySchema.safeParse(body);
    if (!parsed.success) {
      const message = parsed.error.issues[0]?.message ?? '요청 바디가 유효하지 않습니다';
      return c.json(errorEnvelope(message), 400);
    }

    const { enabled, config } = parsed.data;

    // telegram + enabled=true → chat_id 필수
    if (channel === 'telegram' && enabled) {
      const chatId = config?.chat_id?.trim();
      if (!chatId) {
        return c.json(errorEnvelope('Telegram 채널 활성화 시 config.chat_id 가 필요합니다'), 400);
      }
    }

    const configJson = config !== undefined ? JSON.stringify(config) : null;
    const now = Date.now();
    const id = generateId();

    // UPSERT: user_id + channel UNIQUE 제약 활용
    db.$client
      .prepare(
        `INSERT INTO alert_destinations (id, user_id, channel, enabled, config_json, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(user_id, channel) DO UPDATE SET
           enabled = excluded.enabled,
           config_json = excluded.config_json,
           updated_at = excluded.updated_at`,
      )
      .run(id, userId, channel, enabled ? 1 : 0, configJson, now, now);

    // 갱신된 행 반환
    const updatedRow = db.$client
      .query(
        `SELECT channel, enabled, config_json as configJson
         FROM alert_destinations
         WHERE user_id = ? AND channel = ?`,
      )
      .get(userId, channel) as { channel: string; enabled: number; configJson: string | null };

    return c.json(
      {
        channel: updatedRow.channel,
        enabled: updatedRow.enabled === 1,
        config: updatedRow.configJson ? JSON.parse(updatedRow.configJson) : null,
      },
      200,
    );
  });

  return router;
}
