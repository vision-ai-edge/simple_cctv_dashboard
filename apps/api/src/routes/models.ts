// TAG: ALERTS-001
/**
 * SPEC-ALERTS-001 M4-1 — 전역 모델 관리 Hono 서브라우터 (per-box).
 *
 * 엔드포인트 (모두 requireAuth 보호):
 *   GET    /                — 모델 목록 조회
 *   POST   /                — 모델 업로드 (multipart/form-data)
 *   DELETE /:modelId        — 모델 삭제
 *
 * 마운트 위치 (boxes.ts):
 *   router.route('/:id/models', createModelRoutes({ deps, jwtSecret }));
 *
 * 보안 원칙:
 *   - 자격증명(JWT, API Key) 원문 클라이언트 노출 금지
 *   - 모든 요청 Zod 스키마 검증
 *   - 업로드 파일 크기 ENV MODEL_UPLOAD_MAX_MB (기본 100MB) 상한
 *   - BoxNotFoundError → 404
 */

import type { BoxClient } from '@cctv/shared';
import { decryptWithVault } from '@cctv/shared/crypto/vault';
import { Hono } from 'hono';
import { z } from 'zod';
import { createRequireAuth } from '../middleware/requireAuth';
import type { BoxServiceDeps } from '../services/boxService';
import { BoxNotFoundError, queryCredentialRow } from '../services/boxService';

// ---------------------------------------------------------------------------
// 상수
// ---------------------------------------------------------------------------

/** 업로드 파일 크기 기본 상한 (100 MB) */
const DEFAULT_MAX_MB = 100;

// ---------------------------------------------------------------------------
// 입력 스키마
// ---------------------------------------------------------------------------

const ModelIdParamSchema = z.object({
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

export interface CreateModelRoutesOptions {
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
): Promise<{ client: BoxClient; baseUrl: string }> {
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

  const client = createBoxClient(credRow.baseUrl, jwt);
  return { client, baseUrl: credRow.baseUrl };
}

// ---------------------------------------------------------------------------
// 내부 헬퍼: 부모 라우터 파라미터 추출
// ---------------------------------------------------------------------------

function getBoxId(c: { req: { param: (key: string) => string | undefined } }): string | null {
  const id = c.req.param('id');
  return id ?? null;
}

// ---------------------------------------------------------------------------
// 업로드 크기 상한 계산
// ---------------------------------------------------------------------------

function getMaxUploadBytes(): number {
  const envMb = Number(process.env.MODEL_UPLOAD_MAX_MB);
  const maxMb = Number.isFinite(envMb) && envMb > 0 ? envMb : DEFAULT_MAX_MB;
  return maxMb * 1024 * 1024;
}

// ---------------------------------------------------------------------------
// 라우트 팩토리
// ---------------------------------------------------------------------------

/**
 * 전역 모델 라우트 팩토리 (per-box).
 *
 * 사용법 (boxes.ts에서 마운트):
 * ```ts
 * import { createModelRoutes } from './models';
 * router.route('/:id/models', createModelRoutes({ deps, jwtSecret }));
 * ```
 *
 * 주의: 이 라우터는 /:id 파라미터 컨텍스트 외부에서 마운트된다.
 * boxId는 req.param('id')로 접근한다.
 */
export function createModelRoutes(opts: CreateModelRoutesOptions): Hono {
  const { deps } = opts;

  const jwtSecret = opts.jwtSecret ?? process.env.JWT_SECRET ?? '';
  const requireAuth = createRequireAuth({ db: deps.db, jwtSecret });

  const router = new Hono();

  // 모든 모델 라우트에 requireAuth 적용
  router.use('*', requireAuth);

  // -------------------------------------------------------------------------
  // GET / — 모델 목록 조회 (REQ-MODEL-001)
  // -------------------------------------------------------------------------
  router.get('/', async (c) => {
    const boxId = getBoxId(c);
    if (!boxId) {
      return c.json(errorEnvelope('Box ID가 없습니다'), 400);
    }

    try {
      const { client } = await resolveClientForBox(boxId, deps);
      const models = await client.models.list();
      return c.json({ models }, 200);
    } catch (err) {
      if (err instanceof BoxNotFoundError) {
        return c.json(errorEnvelope(`Box 를 찾을 수 없습니다: ${boxId}`), 404);
      }
      return c.json(errorEnvelope('모델 목록 조회에 실패했습니다'), 502);
    }
  });

  // -------------------------------------------------------------------------
  // POST / — 모델 업로드 (REQ-MODEL-002)
  // multipart/form-data: modelFile (File) + metadataFile (File)
  // -------------------------------------------------------------------------
  router.post('/', async (c) => {
    const boxId = getBoxId(c);
    if (!boxId) {
      return c.json(errorEnvelope('Box ID가 없습니다'), 400);
    }

    // multipart 파싱
    let formData: FormData;
    try {
      formData = await c.req.formData();
    } catch {
      return c.json(errorEnvelope('multipart 파싱에 실패했습니다'), 400);
    }

    const modelFileEntry = formData.get('modelFile');
    const metadataFileEntry = formData.get('metadataFile');

    if (!(modelFileEntry instanceof File)) {
      return c.json(errorEnvelope('modelFile 이 없거나 파일이 아닙니다'), 400);
    }
    if (!(metadataFileEntry instanceof File)) {
      return c.json(errorEnvelope('metadataFile 이 없거나 파일이 아닙니다'), 400);
    }

    // 파일 크기 검증
    const maxBytes = getMaxUploadBytes();
    const totalBytes = modelFileEntry.size + metadataFileEntry.size;
    if (totalBytes > maxBytes) {
      const maxMb = maxBytes / (1024 * 1024);
      return c.json(errorEnvelope(`업로드 파일 크기가 상한(${maxMb}MB)을 초과했습니다`), 413);
    }

    try {
      const { client } = await resolveClientForBox(boxId, deps);
      const uploaded = await client.models.upload(modelFileEntry, metadataFileEntry);
      return c.json(uploaded, 200);
    } catch (err) {
      if (err instanceof BoxNotFoundError) {
        return c.json(errorEnvelope(`Box 를 찾을 수 없습니다: ${boxId}`), 404);
      }
      return c.json(errorEnvelope('모델 업로드에 실패했습니다'), 502);
    }
  });

  // -------------------------------------------------------------------------
  // DELETE /:modelId — 모델 삭제 (REQ-MODEL-003)
  // -------------------------------------------------------------------------
  router.delete('/:modelId', async (c) => {
    const boxId = getBoxId(c);
    if (!boxId) {
      return c.json(errorEnvelope('Box ID가 없습니다'), 400);
    }

    const rawParams = c.req.param();
    const parsed = ModelIdParamSchema.safeParse(rawParams);
    if (!parsed.success) {
      return c.json(errorEnvelope('modelId가 유효하지 않습니다'), 400);
    }
    const { modelId } = parsed.data;

    try {
      const { client } = await resolveClientForBox(boxId, deps);
      await client.models.delete(modelId);
      return c.json({ success: true }, 200);
    } catch (err) {
      if (err instanceof BoxNotFoundError) {
        return c.json(errorEnvelope(`Box 를 찾을 수 없습니다: ${boxId}`), 404);
      }
      return c.json(errorEnvelope('모델 삭제에 실패했습니다'), 502);
    }
  });

  return router;
}
