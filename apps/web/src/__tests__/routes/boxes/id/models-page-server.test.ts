/**
 * /(app)/boxes/[id]/models 모델 관리 페이지 서버 로직 테스트.
 *
 * parseModelsResponse 순수 함수를 로직 복제하여 검증한다.
 * (+page.server.ts는 @sveltejs/kit 의존으로 직접 import 불가)
 */

import { describe, expect, it } from 'bun:test';

// --- 타입 복제 ---

interface ModelInfo {
  modelId: string;
  name: string;
  version?: string;
  createdAt?: number;
}

// --- 순수 함수 복제 ---

function parseModelsResponse(
  body: unknown,
): { ok: true; models: ModelInfo[] } | { ok: false; error: string } {
  // 배열 직접 반환 또는 envelope { models: [...] } 둘 다 허용
  if (Array.isArray(body)) {
    return { ok: true, models: body as ModelInfo[] };
  }
  if (
    typeof body === 'object' &&
    body !== null &&
    'models' in body &&
    Array.isArray((body as { models: unknown }).models)
  ) {
    return { ok: true, models: (body as { models: ModelInfo[] }).models };
  }
  return { ok: false, error: '모델 목록 응답 형식 오류' };
}

// --- 테스트 픽스처 ---

const mockModel: ModelInfo = {
  modelId: 'model-001',
  name: '사람 감지 모델',
  version: '1.0.0',
  createdAt: 1700000000000,
};

const mockModelMinimal: ModelInfo = {
  modelId: 'model-002',
  name: '차량 감지 모델',
};

// --- 테스트 ---

describe('parseModelsResponse', () => {
  it('배열 형식 응답을 파싱한다', () => {
    const result = parseModelsResponse([mockModel, mockModelMinimal]);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.models).toHaveLength(2);
      expect(result.models[0].modelId).toBe('model-001');
    }
  });

  it('envelope 형식 { models: [...] } 응답을 파싱한다', () => {
    const body = { models: [mockModel] };
    const result = parseModelsResponse(body);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.models).toHaveLength(1);
      expect(result.models[0].name).toBe('사람 감지 모델');
    }
  });

  it('빈 배열을 파싱한다', () => {
    const result = parseModelsResponse([]);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.models).toHaveLength(0);
    }
  });

  it('빈 envelope도 파싱한다', () => {
    const result = parseModelsResponse({ models: [] });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.models).toHaveLength(0);
    }
  });

  it('버전 필드 없는 모델도 파싱한다', () => {
    const result = parseModelsResponse([mockModelMinimal]);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.models[0].version).toBeUndefined();
    }
  });

  it('null 바디는 에러를 반환한다', () => {
    const result = parseModelsResponse(null);
    expect(result.ok).toBe(false);
  });

  it('문자열 바디는 에러를 반환한다', () => {
    const result = parseModelsResponse('invalid');
    expect(result.ok).toBe(false);
  });

  it('models 필드가 배열이 아닌 경우 에러를 반환한다', () => {
    const result = parseModelsResponse({ models: 'not-array' });
    expect(result.ok).toBe(false);
  });

  it('배열 형식에서 모든 모델의 modelId가 존재한다', () => {
    const models: ModelInfo[] = [
      { modelId: 'a', name: 'Model A' },
      { modelId: 'b', name: 'Model B', version: '2.0' },
    ];
    const result = parseModelsResponse(models);
    expect(result.ok).toBe(true);
    if (result.ok) {
      for (const m of result.models) {
        expect(m.modelId).toBeTruthy();
        expect(m.name).toBeTruthy();
      }
    }
  });
});
