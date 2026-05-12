/**
 * EdgeAI Box REST API 클라이언트.
 *
 * 인증 헤더(JWT Bearer 또는 X-API-Key)는 생성자 설정에 따라 자동 첨부되며,
 * 응답 봉투 `{ success: false }` 또는 HTTP 4xx/5xx 시 BoxApiError 를 던진다.
 *
 * Zod 스키마는 *유연 검증*: 알 수 없는 필드는 허용하고 필수 필드 누락만 차단한다.
 */

import { z } from 'zod';
import { BoxApiError } from './error';
import {
  ApiKeyResponseSchema,
  type ChannelCreateRequest,
  ChannelListResponseSchema,
  ChannelResponseSchema,
  type ChannelStatus,
  ChannelStatusEnum,
  ChannelStatusResponseSchema,
  type ChannelUpdateRequest,
  DateListResponseSchema,
  DetectionsResponseSchema,
  FilesListResponseSchema,
  LoginResponseSchema,
  ModelInfoSchema,
  ModelListResponseSchema,
  ModelSlotConfigSchema,
  type RoiRegion,
  RoiRegionSchema,
  SimpleResponseSchema,
  SystemHealthResponseSchema,
  SystemInfoResponseSchema,
  TrackingsResponseSchema,
  UserInfoResponseSchema,
  type VisionAIConfig,
  VisionAIConfigSchema,
} from './types';

export interface BoxClientConfig {
  /** EdgeAI Box API 베이스 URL — 예: `https://box.example.com:8443/api` */
  baseUrl: string;
  /** JWT Bearer 토큰 (있으면 `Authorization` 헤더에 우선 사용) */
  jwt?: string;
  /** API Key (jwt 미설정 시 `X-API-Key` 헤더로 사용) */
  apiKey?: string;
  /** 테스트 용도 — fetch 구현 주입. 기본값: globalThis.fetch */
  fetch?: typeof globalThis.fetch;
}

interface FetchOptions extends Omit<RequestInit, 'body'> {
  /** JSON 직렬화 대상 — Headers `content-type: application/json` 자동 첨부 */
  json?: unknown;
  /** multipart/form-data 또는 raw body */
  body?: BodyInit | null;
  /** Query string. undefined 값은 무시 */
  query?: Record<string, string | number | boolean | undefined>;
}

/** RFC 3986: 쿼리 컴포넌트 이스케이프 */
function encodeQuery(query: Record<string, string | number | boolean | undefined>): string {
  const parts: string[] = [];
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined) continue;
    parts.push(`${encodeURIComponent(key)}=${encodeURIComponent(String(value))}`);
  }
  return parts.length === 0 ? '' : `?${parts.join('&')}`;
}

function trimTrailingSlash(url: string): string {
  return url.endsWith('/') ? url.slice(0, -1) : url;
}

function deriveWsUrl(baseUrl: string, channelId: string): string {
  // baseUrl 예: https://box.example.com:8443/api
  // 결과: wss://box.example.com:8443/ws/channels/{channelId}/webrtc
  // 평문 http는 ws://, https는 wss://
  const u = new URL(baseUrl);
  const proto = u.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${proto}//${u.host}/ws/channels/${encodeURIComponent(channelId)}/webrtc`;
}

// =============================================================================
// BoxClient 본체
// =============================================================================

export class BoxClient {
  readonly #config: Required<Pick<BoxClientConfig, 'baseUrl'>> &
    Pick<BoxClientConfig, 'jwt' | 'apiKey'>;
  readonly #fetchImpl: typeof globalThis.fetch;

  constructor(config: BoxClientConfig) {
    if (!config.baseUrl) {
      throw new TypeError('BoxClient: baseUrl 가 비어 있습니다.');
    }
    this.#config = {
      baseUrl: trimTrailingSlash(config.baseUrl),
      jwt: config.jwt,
      apiKey: config.apiKey,
    };
    this.#fetchImpl = config.fetch ?? globalThis.fetch;
  }

  /** 현재 baseUrl 을 반환 (헬퍼 메서드에서 사용) */
  get baseUrl(): string {
    return this.#config.baseUrl;
  }

  /** 인증 자격증명을 즉시 교체 (로그인 직후 호출용) */
  setCredentials(creds: { jwt?: string; apiKey?: string }): void {
    if (creds.jwt !== undefined) this.#config.jwt = creds.jwt;
    if (creds.apiKey !== undefined) this.#config.apiKey = creds.apiKey;
  }

  // ---------------------------------------------------------------------------
  // 내부: 공통 fetch 래퍼
  // ---------------------------------------------------------------------------
  async #request<T>(path: string, schema: z.ZodType<T>, opts: FetchOptions = {}): Promise<T> {
    const headers = new Headers(opts.headers);
    if (!headers.has('accept')) headers.set('accept', 'application/json');

    // 인증 헤더 — jwt 우선, 그다음 apiKey
    if (this.#config.jwt) {
      headers.set('Authorization', `Bearer ${this.#config.jwt}`);
    } else if (this.#config.apiKey) {
      headers.set('X-API-Key', this.#config.apiKey);
    }

    let body: BodyInit | null | undefined = opts.body ?? null;
    if (opts.json !== undefined) {
      headers.set('content-type', 'application/json');
      body = JSON.stringify(opts.json);
    }

    const url = `${this.#config.baseUrl}${path}${opts.query ? encodeQuery(opts.query) : ''}`;

    let response: Response;
    try {
      response = await this.#fetchImpl(url, { ...opts, headers, body });
    } catch (err) {
      throw BoxApiError.fromUnknown(err, 0);
    }

    // 본문 비어 있을 수 있음 (204 No Content)
    if (response.status === 204) {
      return schema.parse(undefined as unknown);
    }

    let payload: unknown = null;
    const contentType = response.headers.get('content-type') ?? '';
    if (contentType.includes('application/json')) {
      try {
        payload = await response.json();
      } catch (err) {
        throw new BoxApiError(
          `응답 JSON 파싱 실패: ${err instanceof Error ? err.message : String(err)}`,
          response.status,
          Date.now(),
          err,
        );
      }
    } else {
      payload = await response.text();
    }

    // 에러 봉투 또는 HTTP 에러
    if (!response.ok || this.#isErrorEnvelope(payload)) {
      const env = payload as { message?: string; timestamp?: number } | string | null;
      const message =
        typeof env === 'string'
          ? env || response.statusText
          : (env?.message ?? response.statusText);
      const ts = (typeof env === 'object' && env?.timestamp) || Date.now();
      throw new BoxApiError(message, response.status, ts);
    }

    const result = schema.safeParse(payload);
    if (!result.success) {
      throw new BoxApiError(
        `응답 스키마 검증 실패: ${result.error.message}`,
        response.status,
        Date.now(),
        result.error,
      );
    }
    return result.data;
  }

  #isErrorEnvelope(value: unknown): boolean {
    return (
      typeof value === 'object' &&
      value !== null &&
      'success' in value &&
      (value as { success: unknown }).success === false
    );
  }

  // ---------------------------------------------------------------------------
  // auth
  // ---------------------------------------------------------------------------
  readonly auth = {
    login: async (username: string, password: string) =>
      this.#request('/auth/login', LoginResponseSchema, {
        method: 'POST',
        json: { username, password },
      }),
    me: async () => this.#request('/auth/me', UserInfoResponseSchema),
    regenerateApiKey: async () =>
      this.#request('/auth/apikey/regenerate', ApiKeyResponseSchema, { method: 'POST' }),
    changePassword: async (currentPassword: string, newPassword: string) => {
      await this.#request('/auth/change-password', SimpleResponseSchema, {
        method: 'POST',
        json: { currentPassword, newPassword },
      });
    },
  };

  // ---------------------------------------------------------------------------
  // system
  // ---------------------------------------------------------------------------
  readonly system = {
    health: () => this.#request('/system/health', SystemHealthResponseSchema),
    info: () => this.#request('/system/info', SystemInfoResponseSchema),
  };

  // ---------------------------------------------------------------------------
  // channels
  // ---------------------------------------------------------------------------
  readonly channels = {
    list: (filter?: { status?: ChannelStatus }) =>
      this.#request('/channels', ChannelListResponseSchema, { query: filter }),
    get: (id: string) =>
      this.#request(`/channels/${encodeURIComponent(id)}`, ChannelResponseSchema),
    create: (data: ChannelCreateRequest) =>
      this.#request('/channels', ChannelResponseSchema, { method: 'POST', json: data }),
    update: (id: string, data: ChannelUpdateRequest) =>
      this.#request(`/channels/${encodeURIComponent(id)}`, ChannelResponseSchema, {
        method: 'PUT',
        json: data,
      }),
    delete: async (id: string) => {
      await this.#request(`/channels/${encodeURIComponent(id)}`, SimpleResponseSchema, {
        method: 'DELETE',
      });
    },
    start: (id: string) =>
      this.#request(`/channels/${encodeURIComponent(id)}/start`, SimpleResponseSchema),
    stop: (id: string) =>
      this.#request(`/channels/${encodeURIComponent(id)}/stop`, SimpleResponseSchema),
    status: (id: string) =>
      this.#request(`/channels/${encodeURIComponent(id)}/status`, ChannelStatusResponseSchema),
    snapshot: (id: string, type?: 'preview' | 'fullsize') =>
      this.#request(
        `/channels/${encodeURIComponent(id)}/snapshot`,
        SimpleResponseSchema.passthrough(),
        { query: { type } },
      ),
  };

  // ---------------------------------------------------------------------------
  // models (전역)
  // ---------------------------------------------------------------------------
  readonly models = {
    list: () => this.#request('/models', ModelListResponseSchema),
    get: (id: string) => this.#request(`/models/${encodeURIComponent(id)}`, ModelInfoSchema),
    upload: async (modelFile: Blob, metadataFile: Blob) => {
      const form = new FormData();
      form.append('modelFile', modelFile);
      form.append('metadataFile', metadataFile);
      return this.#request('/models', ModelInfoSchema, { method: 'POST', body: form });
    },
    delete: async (id: string) => {
      await this.#request(`/models/${encodeURIComponent(id)}`, SimpleResponseSchema, {
        method: 'DELETE',
      });
    },
  };

  // ---------------------------------------------------------------------------
  // visionAi (채널 단위)
  // ---------------------------------------------------------------------------
  readonly visionAi = {
    getDetections: (channelId: string) =>
      this.#request(
        `/channels/${encodeURIComponent(channelId)}/vision-ai/detections`,
        DetectionsResponseSchema,
      ),
    getTrackings: (channelId: string) =>
      this.#request(
        `/channels/${encodeURIComponent(channelId)}/vision-ai/trackings`,
        TrackingsResponseSchema,
      ),
    getVisionConfig: (channelId: string) =>
      this.#request(
        `/channels/${encodeURIComponent(channelId)}/vision-ai/config`,
        VisionAIConfigSchema,
      ),
    setVisionConfig: (channelId: string, config: VisionAIConfig) =>
      this.#request(
        `/channels/${encodeURIComponent(channelId)}/vision-ai/config`,
        VisionAIConfigSchema,
        { method: 'PUT', json: config },
      ),
    listChannelModels: (channelId: string) =>
      this.#request(
        `/channels/${encodeURIComponent(channelId)}/vision-ai/models`,
        z.array(ModelSlotConfigSchema),
      ),
    addChannelModel: (channelId: string, slot: { modelId: string; enabled?: boolean }) =>
      this.#request(
        `/channels/${encodeURIComponent(channelId)}/vision-ai/models`,
        ModelSlotConfigSchema,
        { method: 'POST', json: slot },
      ),
    removeChannelModel: async (channelId: string, modelId: string) => {
      await this.#request(
        `/channels/${encodeURIComponent(channelId)}/vision-ai/models/${encodeURIComponent(modelId)}`,
        SimpleResponseSchema,
        { method: 'DELETE' },
      );
    },
    getRois: (channelId: string, modelId: string) =>
      this.#request(
        `/channels/${encodeURIComponent(channelId)}/vision-ai/models/${encodeURIComponent(modelId)}/roi`,
        z.array(RoiRegionSchema),
      ),
    upsertRoi: (channelId: string, modelId: string, roi: RoiRegion) =>
      this.#request(
        `/channels/${encodeURIComponent(channelId)}/vision-ai/models/${encodeURIComponent(modelId)}/roi`,
        RoiRegionSchema,
        { method: 'POST', json: roi },
      ),
    clearRois: async (channelId: string, modelId: string) => {
      await this.#request(
        `/channels/${encodeURIComponent(channelId)}/vision-ai/models/${encodeURIComponent(modelId)}/roi`,
        SimpleResponseSchema,
        { method: 'DELETE' },
      );
    },
  };

  // ---------------------------------------------------------------------------
  // media (recordings / images / timelapse)
  // ---------------------------------------------------------------------------
  readonly media = {
    recordingDates: (channelId: string) =>
      this.#request(
        `/channels/${encodeURIComponent(channelId)}/recordings/dates`,
        DateListResponseSchema,
      ),
    recordings: (channelId: string, date: string, page?: number) =>
      this.#request(
        `/channels/${encodeURIComponent(channelId)}/recordings`,
        FilesListResponseSchema,
        { query: { date, page } },
      ),
    imageDates: (channelId: string) =>
      this.#request(
        `/channels/${encodeURIComponent(channelId)}/images/dates`,
        DateListResponseSchema,
      ),
    images: (channelId: string, date: string, page?: number) =>
      this.#request(`/channels/${encodeURIComponent(channelId)}/images`, FilesListResponseSchema, {
        query: { date, page },
      }),
    timelapseDates: (channelId: string) =>
      this.#request(
        `/channels/${encodeURIComponent(channelId)}/timelapse/dates`,
        DateListResponseSchema,
      ),
    timelapse: (channelId: string, date: string, page?: number) =>
      this.#request(
        `/channels/${encodeURIComponent(channelId)}/timelapse`,
        FilesListResponseSchema,
        { query: { date, page } },
      ),
  };

  // ---------------------------------------------------------------------------
  // hls / webrtc URL 헬퍼
  // ---------------------------------------------------------------------------
  readonly hls = {
    /**
     * HLS playlist URL 생성.
     * - jwt 우선, 없으면 apiKey 사용.
     * - 어느 쪽도 없으면 인증 파라미터 없이 URL 반환 (테스트/공개 채널).
     *
     * 형식: `{baseUrl}/hls/{channelId}/playlist.m3u8?{token|apikey}`
     */
    buildPlaylistUrl: (channelId: string, auth: { jwt?: string; apiKey?: string } = {}): string => {
      const base = `${this.#config.baseUrl}/hls/${encodeURIComponent(channelId)}/playlist.m3u8`;
      const token = auth.jwt ?? this.#config.jwt;
      if (token) return `${base}?token=${encodeURIComponent(token)}`;
      const key = auth.apiKey ?? this.#config.apiKey;
      if (key) return `${base}?apikey=${encodeURIComponent(key)}`;
      return base;
    },
  };

  readonly webrtc = {
    /**
     * WebRTC player URL 생성.
     * 형식: `{baseUrl}/webrtc/player?channel={channelId}&apikey={key}`
     */
    buildPlayerUrl: (channelId: string, apiKey?: string): string => {
      const key = apiKey ?? this.#config.apiKey ?? '';
      return `${this.#config.baseUrl}/webrtc/player?channel=${encodeURIComponent(
        channelId,
      )}&apikey=${encodeURIComponent(key)}`;
    },

    /**
     * WebRTC signaling WebSocket URL 생성.
     * 형식: `ws://{boxHost}/ws/channels/{channelId}/webrtc` (https 면 `wss://`)
     */
    buildSignalingWsUrl: (channelId: string): string =>
      deriveWsUrl(this.#config.baseUrl, channelId),
  };

  // ---------------------------------------------------------------------------
  // 폴링 유틸: 채널이 targetStatus 에 도달할 때까지 대기
  // ---------------------------------------------------------------------------
  /**
   * `getChannelStatus` 를 주기적으로 호출하여 목표 상태 도달을 대기한다.
   * 시간 초과 시 BoxApiError 를 던진다.
   *
   * @param channelId 대상 채널 ID
   * @param targetStatus 대기할 ChannelStatus
   * @param opts.timeoutMs 전체 타임아웃 (기본 30s)
   * @param opts.intervalMs 폴링 주기 (기본 500ms)
   */
  async waitForChannelStatus(
    channelId: string,
    targetStatus: ChannelStatus,
    opts: { timeoutMs?: number; intervalMs?: number } = {},
  ): Promise<void> {
    const timeoutMs = opts.timeoutMs ?? 30_000;
    const intervalMs = opts.intervalMs ?? 500;
    const deadline = Date.now() + timeoutMs;

    while (Date.now() < deadline) {
      const status = await this.channels.status(channelId);
      if (status.status === targetStatus) return;
      const remaining = deadline - Date.now();
      if (remaining <= 0) break;
      const wait = Math.min(intervalMs, remaining);
      await new Promise<void>((r) => setTimeout(r, wait));
    }
    throw new BoxApiError(
      `Timeout: 채널 ${channelId} 가 ${timeoutMs}ms 내에 ${targetStatus} 상태에 도달하지 못함`,
      408,
      Date.now(),
    );
  }

  /** ChannelStatus 열거값 (런타임 참조용) */
  static readonly ChannelStatus = ChannelStatusEnum.options;
}

/**
 * `BoxClient` 인스턴스를 생성하는 팩토리.
 *
 * @example
 * ```ts
 * const client = createBoxClient({
 *   baseUrl: 'https://box.example.com:8443/api',
 *   jwt: '...',
 * });
 * const channels = await client.channels.list();
 * ```
 */
export function createBoxClient(config: BoxClientConfig): BoxClient {
  return new BoxClient(config);
}
