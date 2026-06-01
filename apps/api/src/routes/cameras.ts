// TAG: DASHBOARD-001
/**
 * SPEC-DASHBOARD-001 — 카메라 집계 Hono 서브라우터.
 *
 * 엔드포인트:
 *   GET /   — 전체 카메라 목록 (cameras JOIN boxes) 반환
 *             마운트 위치: /api/cameras
 *
 * 보안 원칙 (REQ-DASH-013):
 *   - 응답에 password_enc, jwt_cached_enc, api_key_cached_enc,
 *     jwt_cached, api_key_cached 컬럼 절대 미포함
 *   - Box 메타데이터(이름, 상태)만 포함
 *   - requireAuth 미들웨어 필수
 */

import type { Db } from '@cctv/db';
import { Hono } from 'hono';
import { createRequireAuth } from '../middleware/requireAuth';

// ---------------------------------------------------------------------------
// 응답 타입
// ---------------------------------------------------------------------------

/**
 * cameras JOIN boxes 집계 응답 항목.
 *
 * REQ-DASH-002 응답 스키마:
 *   id, channelId, name, status, latitude, longitude,
 *   bleBeaconCount, boxId, boxName, boxStatus, lastSyncedAt
 *
 * 절대 포함하지 않는 컬럼 (REQ-DASH-013):
 *   password_enc, jwt_cached_enc, api_key_cached_enc,
 *   jwt_cached, api_key_cached
 */
export type CameraWithBox = {
  id: string;
  channelId: string;
  name: string;
  status: 'online' | 'offline' | 'error';
  latitude: number | null;
  longitude: number | null;
  bleBeaconCount: number;
  lastSyncedAt: number | null;
  boxId: string;
  boxName: string;
  boxStatus: 'active' | 'inactive' | 'error';
};

// ---------------------------------------------------------------------------
// DB 행 타입 (sqlite raw 결과)
// ---------------------------------------------------------------------------

type CameraWithBoxRow = {
  id: string;
  channelId: string;
  name: string;
  status: string;
  latitude: number | null;
  longitude: number | null;
  bleBeaconCount: number | null;
  lastSyncedAt: number | null;
  boxId: string;
  boxName: string;
  boxStatus: string;
};

// ---------------------------------------------------------------------------
// 에러 응답 헬퍼
// ---------------------------------------------------------------------------

function errorEnvelope(message: string) {
  return { success: false, message, timestamp: Date.now() } as const;
}

// ---------------------------------------------------------------------------
// 라우트 팩토리 옵션
// ---------------------------------------------------------------------------

export interface CreateCameraRoutesOptions {
  /** DB 인스턴스 */
  db: Db;
  /** JWT 시크릿 (requireAuth 생성에 사용) */
  jwtSecret?: string;
}

// ---------------------------------------------------------------------------
// 라우트 팩토리
// ---------------------------------------------------------------------------

/**
 * 카메라 집계 라우트 팩토리.
 *
 * 사용법 (app.ts 또는 boxes.ts에서 마운트):
 * ```ts
 * import { createCameraRoutes } from './cameras';
 * app.route('/api/cameras', createCameraRoutes({ db, jwtSecret }));
 * ```
 */
export function createCameraRoutes(opts: CreateCameraRoutesOptions): Hono {
  const { db } = opts;
  const jwtSecret = opts.jwtSecret ?? process.env.JWT_SECRET ?? '';
  const requireAuth = createRequireAuth({ db, jwtSecret });

  const router = new Hono();

  // 모든 카메라 라우트에 requireAuth 적용 (REQ-DASH-002 [Unwanted])
  router.use('*', requireAuth);

  // -------------------------------------------------------------------------
  // GET / — 전체 카메라 목록 조회 (REQ-DASH-002)
  //
  // cameras LEFT JOIN boxes on cameras.box_id = boxes.id
  // 반환 필드: id, channelId, name, status, latitude, longitude,
  //            bleBeaconCount, lastSyncedAt, boxId, boxName, boxStatus
  //
  // 보안: password_enc, jwt_cached_enc, api_key_cached_enc 미포함 (REQ-DASH-013)
  // -------------------------------------------------------------------------
  router.get('/', async (c) => {
    const rows = db.$client
      .query(
        `SELECT
           c.id          AS id,
           c.channel_id  AS channelId,
           c.name        AS name,
           c.status      AS status,
           c.latitude    AS latitude,
           c.longitude   AS longitude,
           c.ble_beacon_count AS bleBeaconCount,
           c.last_synced_at AS lastSyncedAt,
           b.id          AS boxId,
           b.name        AS boxName,
           b.status      AS boxStatus
         FROM cameras c
         INNER JOIN boxes b ON c.box_id = b.id
         ORDER BY c.created_at ASC`,
      )
      .all() as CameraWithBoxRow[];

    const cameras: CameraWithBox[] = rows.map((row) => ({
      id: row.id,
      channelId: row.channelId,
      name: row.name,
      status: row.status as CameraWithBox['status'],
      latitude: row.latitude,
      longitude: row.longitude,
      bleBeaconCount: row.bleBeaconCount ?? 0,
      lastSyncedAt: row.lastSyncedAt,
      boxId: row.boxId,
      boxName: row.boxName,
      boxStatus: row.boxStatus as CameraWithBox['boxStatus'],
    }));

    return c.json({ cameras }, 200);
  });

  return router;
}
