import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test';
import { BoxApiError, BoxClient, createBoxClient } from '../edgeai-box-client';

// ---------------------------------------------------------------------------
// fetch mock 헬퍼 — globalThis.fetch 를 임의의 응답으로 대체한다.
// ---------------------------------------------------------------------------
type MockResponse = {
  status?: number;
  body?: unknown;
  contentType?: string;
};

function installFetchMock(handler: (url: string, init?: RequestInit) => MockResponse) {
  const original = globalThis.fetch;
  globalThis.fetch = mock(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input.toString();
    const resp = handler(url, init);
    const status = resp.status ?? 200;
    const headers = new Headers({
      'content-type': resp.contentType ?? 'application/json',
    });
    const body =
      resp.body === undefined
        ? ''
        : typeof resp.body === 'string'
          ? resp.body
          : JSON.stringify(resp.body);
    return new Response(body, { status, headers });
  }) as unknown as typeof fetch;
  return () => {
    globalThis.fetch = original;
  };
}

let restoreFetch: (() => void) | null = null;
afterEach(() => {
  if (restoreFetch) {
    restoreFetch();
    restoreFetch = null;
  }
});

// ---------------------------------------------------------------------------
// AC-2: 팩토리 호출
// ---------------------------------------------------------------------------
describe('createBoxClient — 팩토리', () => {
  test('BoxClient 인스턴스를 반환하며 모든 그룹이 존재한다', () => {
    const client = createBoxClient({ baseUrl: 'http://localhost', jwt: 'test-token' });
    expect(client).toBeInstanceOf(BoxClient);
    expect(client.auth).toBeDefined();
    expect(client.system).toBeDefined();
    expect(client.channels).toBeDefined();
    expect(client.models).toBeDefined();
    expect(client.visionAi).toBeDefined();
    expect(client.media).toBeDefined();
    expect(client.hls).toBeDefined();
    expect(client.webrtc).toBeDefined();
  });

  test('baseUrl 누락 시 TypeError 를 던진다', () => {
    expect(() => createBoxClient({ baseUrl: '' })).toThrow(TypeError);
  });

  test('baseUrl 의 trailing slash 는 제거된다', () => {
    const client = createBoxClient({ baseUrl: 'https://box.example.com:8443/api/' });
    expect(client.baseUrl).toBe('https://box.example.com:8443/api');
  });
});

// ---------------------------------------------------------------------------
// AC-2: auth.login 성공
// ---------------------------------------------------------------------------
describe('auth.login', () => {
  test('성공 응답을 파싱하여 token/expiresAt 을 반환한다', async () => {
    restoreFetch = installFetchMock(() => ({
      status: 200,
      body: { token: 'jwt-abc', expiresAt: null },
    }));
    const client = createBoxClient({ baseUrl: 'http://box.local/api' });
    const result = await client.auth.login('admin', 'password');
    expect(result.token).toBe('jwt-abc');
    expect(result.expiresAt).toBeNull();
  });

  test('인증 헤더 — jwt 가 있으면 Authorization 헤더가 첨부된다', async () => {
    let capturedHeaders: Headers | null = null;
    restoreFetch = installFetchMock((_url, init) => {
      capturedHeaders = new Headers(init?.headers);
      return { body: { username: 'admin', hasApiKey: false } };
    });
    const client = createBoxClient({ baseUrl: 'http://box.local/api', jwt: 'my-jwt' });
    await client.auth.me();
    expect(capturedHeaders).not.toBeNull();
    expect(capturedHeaders?.get('authorization')).toBe('Bearer my-jwt');
    expect(capturedHeaders?.get('x-api-key')).toBeNull();
  });

  test('인증 헤더 — apiKey 만 있으면 X-API-Key 헤더가 첨부된다', async () => {
    let capturedHeaders: Headers | null = null;
    restoreFetch = installFetchMock((_url, init) => {
      capturedHeaders = new Headers(init?.headers);
      return { body: { username: 'admin', hasApiKey: true } };
    });
    const client = createBoxClient({ baseUrl: 'http://box.local/api', apiKey: 'my-key' });
    await client.auth.me();
    expect(capturedHeaders?.get('x-api-key')).toBe('my-key');
    expect(capturedHeaders?.get('authorization')).toBeNull();
  });

  test('인증 헤더 — jwt 와 apiKey 가 모두 있으면 jwt 가 우선한다', async () => {
    let capturedHeaders: Headers | null = null;
    restoreFetch = installFetchMock((_url, init) => {
      capturedHeaders = new Headers(init?.headers);
      return { body: { username: 'admin', hasApiKey: true } };
    });
    const client = createBoxClient({
      baseUrl: 'http://box.local/api',
      jwt: 'my-jwt',
      apiKey: 'my-key',
    });
    await client.auth.me();
    expect(capturedHeaders?.get('authorization')).toBe('Bearer my-jwt');
    expect(capturedHeaders?.get('x-api-key')).toBeNull();
  });

  test('setCredentials 로 자격증명을 교체할 수 있다', async () => {
    let captured: Headers | null = null;
    restoreFetch = installFetchMock((_u, init) => {
      captured = new Headers(init?.headers);
      return { body: { username: 'admin', hasApiKey: false } };
    });
    const client = createBoxClient({ baseUrl: 'http://box.local/api' });
    client.setCredentials({ jwt: 'new-jwt' });
    await client.auth.me();
    expect(captured?.get('authorization')).toBe('Bearer new-jwt');
  });
});

// ---------------------------------------------------------------------------
// AC-2: BoxApiError 던짐
// ---------------------------------------------------------------------------
describe('BoxApiError', () => {
  test('HTTP 401 + success:false 응답에서 BoxApiError 가 던져진다', async () => {
    restoreFetch = installFetchMock(() => ({
      status: 401,
      body: { success: false, message: 'Unauthorized', timestamp: 1000 },
    }));
    const client = createBoxClient({ baseUrl: 'http://box.local/api', jwt: 'invalid' });

    try {
      await client.auth.me();
      throw new Error('did not throw');
    } catch (err) {
      expect(err).toBeInstanceOf(BoxApiError);
      const e = err as BoxApiError;
      expect(e.message).toBe('Unauthorized');
      expect(e.statusCode).toBe(401);
      expect(e.timestamp).toBe(1000);
    }
  });

  test('HTTP 500 + 빈 본문에서 statusText 가 메시지로 사용된다', async () => {
    restoreFetch = installFetchMock(() => ({ status: 500, body: { foo: 'bar' } }));
    const client = createBoxClient({ baseUrl: 'http://box.local/api' });
    try {
      await client.system.health();
      throw new Error('did not throw');
    } catch (err) {
      expect(err).toBeInstanceOf(BoxApiError);
      expect((err as BoxApiError).statusCode).toBe(500);
    }
  });

  test('네트워크 실패 시 BoxApiError 로 정규화된다', async () => {
    globalThis.fetch = mock(async () => {
      throw new TypeError('network down');
    }) as unknown as typeof fetch;
    restoreFetch = () => {
      // installFetchMock 헬퍼를 거치지 않은 케이스 — 별도 복원 처리
    };
    const client = createBoxClient({ baseUrl: 'http://box.local/api' });
    try {
      await client.system.health();
      throw new Error('did not throw');
    } catch (err) {
      expect(err).toBeInstanceOf(BoxApiError);
      expect((err as BoxApiError).statusCode).toBe(0);
      expect((err as BoxApiError).message).toContain('network down');
    }
  });

  test('BoxApiError.fromUnknown 은 BoxApiError 인스턴스를 보존한다', () => {
    const original = new BoxApiError('original', 418, 1234);
    const wrapped = BoxApiError.fromUnknown(original);
    expect(wrapped).toBe(original);
  });
});

// ---------------------------------------------------------------------------
// AC-2: hls.buildPlaylistUrl
// ---------------------------------------------------------------------------
describe('hls.buildPlaylistUrl', () => {
  test('jwt 가 있으면 ?token=... 형식을 반환한다', () => {
    const client = createBoxClient({ baseUrl: 'https://box.example.com:8443/api' });
    const url = client.hls.buildPlaylistUrl('ch1', { jwt: 'my-jwt' });
    expect(url).toBe('https://box.example.com:8443/api/hls/ch1/playlist.m3u8?token=my-jwt');
  });

  test('apiKey 만 있으면 ?apikey=... 형식을 반환한다', () => {
    const client = createBoxClient({ baseUrl: 'https://box.example.com:8443/api' });
    const url = client.hls.buildPlaylistUrl('ch1', { apiKey: 'my-key' });
    expect(url).toBe('https://box.example.com:8443/api/hls/ch1/playlist.m3u8?apikey=my-key');
  });

  test('인증 정보가 없으면 인증 파라미터 없이 반환한다', () => {
    const client = createBoxClient({ baseUrl: 'https://box.example.com:8443/api' });
    const url = client.hls.buildPlaylistUrl('ch1');
    expect(url).toBe('https://box.example.com:8443/api/hls/ch1/playlist.m3u8');
  });

  test('클라이언트 생성자 jwt 를 fallback 으로 사용한다', () => {
    const client = createBoxClient({
      baseUrl: 'https://box.example.com:8443/api',
      jwt: 'ctor-jwt',
    });
    const url = client.hls.buildPlaylistUrl('ch1');
    expect(url).toBe('https://box.example.com:8443/api/hls/ch1/playlist.m3u8?token=ctor-jwt');
  });

  test('특수문자가 포함된 채널 ID는 URL 인코딩된다', () => {
    const client = createBoxClient({ baseUrl: 'https://box.example.com:8443/api' });
    const url = client.hls.buildPlaylistUrl('ch a/b', { jwt: 'j' });
    expect(url).toBe('https://box.example.com:8443/api/hls/ch%20a%2Fb/playlist.m3u8?token=j');
  });
});

// ---------------------------------------------------------------------------
// AC-2: webrtc.buildPlayerUrl + buildSignalingWsUrl
// ---------------------------------------------------------------------------
describe('webrtc URL 헬퍼', () => {
  test('buildPlayerUrl 은 ?channel=&apikey= 형식을 반환한다', () => {
    const client = createBoxClient({ baseUrl: 'https://box.example.com:8443/api' });
    const url = client.webrtc.buildPlayerUrl('ch1', 'my-apikey');
    expect(url).toBe('https://box.example.com:8443/api/webrtc/player?channel=ch1&apikey=my-apikey');
  });

  test('buildPlayerUrl 은 생성자 apiKey 를 fallback 으로 사용한다', () => {
    const client = createBoxClient({
      baseUrl: 'https://box.example.com:8443/api',
      apiKey: 'ctor-key',
    });
    const url = client.webrtc.buildPlayerUrl('ch1');
    expect(url).toBe('https://box.example.com:8443/api/webrtc/player?channel=ch1&apikey=ctor-key');
  });

  test('buildSignalingWsUrl — https → wss:// 변환', () => {
    const client = createBoxClient({ baseUrl: 'https://box.example.com:8443/api' });
    const url = client.webrtc.buildSignalingWsUrl('ch1');
    expect(url).toBe('wss://box.example.com:8443/ws/channels/ch1/webrtc');
  });

  test('buildSignalingWsUrl — http → ws:// 변환', () => {
    const client = createBoxClient({ baseUrl: 'http://box.local/api' });
    const url = client.webrtc.buildSignalingWsUrl('ch1');
    expect(url).toBe('ws://box.local/ws/channels/ch1/webrtc');
  });
});

// ---------------------------------------------------------------------------
// AC-2: waitForChannelStatus 타임아웃
// ---------------------------------------------------------------------------
describe('waitForChannelStatus', () => {
  test('목표 상태에 도달하지 않으면 BoxApiError(408)을 던진다', async () => {
    restoreFetch = installFetchMock(() => ({
      body: { channelId: 'ch1', status: 'CONNECTING', isActive: false },
    }));
    const client = createBoxClient({ baseUrl: 'http://box.local/api' });
    try {
      await client.waitForChannelStatus('ch1', 'RUNNING', { timeoutMs: 50, intervalMs: 10 });
      throw new Error('did not throw');
    } catch (err) {
      expect(err).toBeInstanceOf(BoxApiError);
      expect((err as BoxApiError).statusCode).toBe(408);
      expect((err as BoxApiError).message).toContain('RUNNING');
    }
  });

  test('이미 목표 상태이면 즉시 반환한다', async () => {
    let callCount = 0;
    restoreFetch = installFetchMock(() => {
      callCount++;
      return { body: { channelId: 'ch1', status: 'RUNNING', isActive: true } };
    });
    const client = createBoxClient({ baseUrl: 'http://box.local/api' });
    await client.waitForChannelStatus('ch1', 'RUNNING', { timeoutMs: 1000, intervalMs: 10 });
    expect(callCount).toBe(1);
  });

  test('중간에 목표 상태로 전이하면 반환한다', async () => {
    let calls = 0;
    restoreFetch = installFetchMock(() => {
      calls++;
      return {
        body: {
          channelId: 'ch1',
          status: calls < 3 ? 'CONNECTING' : 'RUNNING',
          isActive: false,
        },
      };
    });
    const client = createBoxClient({ baseUrl: 'http://box.local/api' });
    await client.waitForChannelStatus('ch1', 'RUNNING', { timeoutMs: 1000, intervalMs: 5 });
    expect(calls).toBeGreaterThanOrEqual(3);
  });
});

// ---------------------------------------------------------------------------
// channels CRUD 동작 (스모크)
// ---------------------------------------------------------------------------
describe('channels CRUD', () => {
  test('list 는 query 파라미터를 전달한다', async () => {
    let capturedUrl = '';
    restoreFetch = installFetchMock((url) => {
      capturedUrl = url;
      return { body: [] };
    });
    const client = createBoxClient({ baseUrl: 'http://box.local/api' });
    await client.channels.list({ status: 'RUNNING' });
    expect(capturedUrl).toBe('http://box.local/api/channels?status=RUNNING');
  });

  test('list 는 EdgeAI Box envelope 응답을 array 로 unwrap 한다', async () => {
    // 실제 박스 (OpenAPI v1.3.6) 응답 모양:
    //   { success: true, timestamp: 0, summary: {...}, channels: [...] }
    restoreFetch = installFetchMock(() => ({
      body: {
        success: true,
        timestamp: 1778782560000,
        summary: { total: 2, running: 1 },
        channels: [
          { id: 'cam-a', name: 'Front Gate', status: 'RUNNING' },
          { id: 'cam-b', name: 'Lobby', status: 'STOPPED' },
        ],
      },
    }));
    const client = createBoxClient({ baseUrl: 'http://box.local/api' });
    const list = await client.channels.list();
    expect(Array.isArray(list)).toBe(true);
    expect(list).toHaveLength(2);
    expect(list[0]?.id).toBe('cam-a');
    expect(list[1]?.name).toBe('Lobby');
  });

  test('get 은 path 의 채널 ID 를 인코딩한다', async () => {
    let capturedUrl = '';
    restoreFetch = installFetchMock((url) => {
      capturedUrl = url;
      return { body: { id: 'ch 1', name: 'test' } };
    });
    const client = createBoxClient({ baseUrl: 'http://box.local/api' });
    await client.channels.get('ch 1');
    expect(capturedUrl).toBe('http://box.local/api/channels/ch%201');
  });

  test('create 는 POST + JSON body 를 전송한다', async () => {
    let captured: { method?: string; body?: string } = {};
    restoreFetch = installFetchMock((_url, init) => {
      captured = {
        method: init?.method,
        body: typeof init?.body === 'string' ? init.body : undefined,
      };
      return { body: { id: 'new-ch', name: 'cam-1' } };
    });
    const client = createBoxClient({ baseUrl: 'http://box.local/api' });
    await client.channels.create({ name: 'cam-1', inputType: 'rtsp' });
    expect(captured.method).toBe('POST');
    expect(captured.body).toContain('cam-1');
    expect(captured.body).toContain('rtsp');
  });

  test('delete 는 DELETE 메서드를 사용한다', async () => {
    let captured = '';
    restoreFetch = installFetchMock((_u, init) => {
      captured = init?.method ?? '';
      return { body: { success: true } };
    });
    const client = createBoxClient({ baseUrl: 'http://box.local/api' });
    await client.channels.delete('ch1');
    expect(captured).toBe('DELETE');
  });
});

// ---------------------------------------------------------------------------
// system.health
// ---------------------------------------------------------------------------
describe('system.health', () => {
  test('정상 응답에서 status 를 반환한다', async () => {
    restoreFetch = installFetchMock(() => ({ body: { status: 'ok' } }));
    const client = createBoxClient({ baseUrl: 'http://box.local/api' });
    const health = await client.system.health();
    expect(health.status).toBe('ok');
  });
});

// ---------------------------------------------------------------------------
// M1-1/M1-2: ModelListResponseSchema characterization 테스트 (DDD PRESERVE)
// ---------------------------------------------------------------------------
describe('ModelListResponseSchema — characterization', () => {
  test('[PRESERVE] bare-array 응답은 그대로 통과한다', async () => {
    // 기존 mock/테스트가 기대하는 동작: body가 배열 그 자체일 때 정상 파싱
    restoreFetch = installFetchMock(() => ({
      body: [],
    }));
    const client = createBoxClient({ baseUrl: 'http://box.local/api', jwt: 'tok' });
    const result = await client.models.list();
    expect(Array.isArray(result)).toBe(true);
    expect(result).toHaveLength(0);
  });

  test('[PRESERVE] bare-array 에 항목이 있으면 항목 배열을 반환한다', async () => {
    restoreFetch = installFetchMock(() => ({
      body: [
        { id: 'model-1', name: 'YOLOv8n', type: 'detection' },
        { id: 'model-2', name: 'YOLOv8s', type: 'detection', isBuiltIn: true },
      ],
    }));
    const client = createBoxClient({ baseUrl: 'http://box.local/api', jwt: 'tok' });
    const result = await client.models.list();
    expect(Array.isArray(result)).toBe(true);
    expect(result).toHaveLength(2);
    expect(result[0]?.id).toBe('model-1');
    expect(result[1]?.name).toBe('YOLOv8s');
  });

  test('[IMPROVE] envelope `{ success, timestamp, models: [...] }` 응답을 unwrap 한다', async () => {
    // 실제 박스 (OpenAPI v1.3.6) 응답 모양:
    //   { success: true, timestamp: ..., models: [...] }
    // M1-2 수정 전: 이 테스트는 FAIL (ModelListResponseSchema가 배열만 허용)
    // M1-2 수정 후: PASS (z.preprocess로 models 필드 unwrap)
    restoreFetch = installFetchMock(() => ({
      body: {
        success: true,
        timestamp: 1748000000000,
        models: [
          { id: 'm-001', name: 'Intrusion Detection v2', type: 'detection', isBuiltIn: false },
          { id: 'm-002', name: 'Fall Detection v1', type: 'detection', isBuiltIn: true },
        ],
      },
    }));
    const client = createBoxClient({ baseUrl: 'http://box.local/api', jwt: 'tok' });
    const result = await client.models.list();
    expect(Array.isArray(result)).toBe(true);
    expect(result).toHaveLength(2);
    expect(result[0]?.id).toBe('m-001');
    expect(result[1]?.name).toBe('Fall Detection v1');
  });
});

// ---------------------------------------------------------------------------
// 정적 상수
// ---------------------------------------------------------------------------
describe('BoxClient.ChannelStatus', () => {
  test('6개 상태 enum 값을 노출한다', () => {
    expect(BoxClient.ChannelStatus).toEqual([
      'STOPPED',
      'CONNECTING',
      'RUNNING',
      'PAUSED',
      'ERROR',
      'RETRYING',
    ]);
  });
});
