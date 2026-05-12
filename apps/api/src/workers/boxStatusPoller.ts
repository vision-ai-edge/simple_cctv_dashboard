/**
 * SPEC-BOX-001 — Box 상태 폴링 워커.
 *
 * 책임:
 *   - REQ-MOD-4: status='active' 인 Box 를 60초 주기로 /system/health 폴링
 *   - 3회 연속 실패 시 status='error' 전이 및 폴링 제외
 *   - 성공 시 last_sync_at 갱신 및 연속 실패 카운터 초기화
 *
 * 보안 원칙:
 *   - BOX_VAULT_KEY 를 process.env 에서 직접 읽지 않음 (DI deps 로 수신)
 *   - 자격증명(비밀번호, 암호화 blob) 을 로그에 절대 미포함
 *
 * 싱글톤 패턴:
 *   - 모듈 스코프 activeInstance 변수로 중복 실행 방지
 *   - stop() 호출 후 재시작 가능
 */

import type { BoxStatus, Db } from '@cctv/db';
import type { BoxClient } from '@cctv/shared';

// ---------------------------------------------------------------------------
// 공개 타입
// ---------------------------------------------------------------------------

/** boxStatusPoller 의존성 주입 컨테이너 */
export type PollerDeps = {
  /** Drizzle DB 인스턴스 */
  db: Db;
  /** BOX_VAULT_KEY — 64자 hex 볼트 키 (로그 미포함) */
  vaultKey: string;
  /** BoxClient 팩토리 (테스트 mock 용이) */
  createBoxClient: (baseUrl: string, token?: string) => BoxClient;
};

/** boxStatusPoller 옵션 */
export type PollerOptions = {
  /** 폴링 주기 (ms). 기본값: 60000 (60초) */
  intervalMs?: number;
  /** 연속 실패 허용 횟수. 이 횟수 이상 실패 시 status='error'. 기본값: 3 */
  maxConsecutiveFailures?: number;
};

// ---------------------------------------------------------------------------
// 내부 타입
// ---------------------------------------------------------------------------

/** DB 에서 조회하는 active Box 행 */
type ActiveBoxRow = {
  id: string;
  baseUrl: string;
};

// ---------------------------------------------------------------------------
// 상수
// ---------------------------------------------------------------------------

/** 로그 prefix — 자격증명 노출 방지를 위해 단일 지점에서 관리 */
const LOG_PREFIX = '[boxStatusPoller]';

// ---------------------------------------------------------------------------
// 싱글톤 상태
// ---------------------------------------------------------------------------

/** 현재 실행 중인 폴러 인스턴스 (null 이면 미실행) */
let activeInstance: { stop: () => void } | null = null;

// ---------------------------------------------------------------------------
// 내부 헬퍼
// ---------------------------------------------------------------------------

/**
 * status='active' 인 Box 목록을 조회한다.
 * inactive/error Box 는 폴링 제외.
 */
function listActiveBoxes(db: Db): ActiveBoxRow[] {
  return db.$client
    .query(`SELECT id, base_url as baseUrl FROM boxes WHERE status = 'active'`)
    .all() as ActiveBoxRow[];
}

/**
 * Box 의 last_sync_at 을 현재 시각으로 갱신한다.
 * status 는 변경하지 않는다.
 */
function updateLastSyncAt(db: Db, boxId: string, syncAt: Date): void {
  db.$client
    .prepare('UPDATE boxes SET last_sync_at = ?, updated_at = ? WHERE id = ?')
    .run(syncAt.getTime(), Date.now(), boxId);
}

/**
 * Box 의 status 를 갱신한다.
 * error 전이 시 호출.
 */
function updateStatus(db: Db, boxId: string, status: BoxStatus): void {
  db.$client
    .prepare('UPDATE boxes SET status = ?, updated_at = ? WHERE id = ?')
    .run(status, Date.now(), boxId);
}

// ---------------------------------------------------------------------------
// 공개 API
// ---------------------------------------------------------------------------

/**
 * Box 상태 폴링 워커를 시작한다.
 *
 * 처리 순서 (매 tick):
 *  1. status='active' 인 Box 목록 조회
 *  2. 각 Box 에 대해 BoxClient.system.health() 호출
 *  3. 성공 시: failCount 를 0 으로 리셋, last_sync_at 갱신
 *  4. 실패 시: failCount 를 1 증가,
 *     maxConsecutiveFailures 이상이면 status='error' 갱신 (이후 폴링 제외)
 *
 * 싱글톤:
 *  - 이미 실행 중인 인스턴스가 있으면 경고 로그 후 기존 stop 함수 반환
 *  - stop() 호출 후 재시작 가능
 *
 * @param deps 의존성 주입 (db, vaultKey, createBoxClient)
 * @param options 폴러 옵션 (intervalMs, maxConsecutiveFailures)
 * @returns stop 함수 — 호출 시 setInterval 해제 및 싱글톤 상태 초기화
 */
export function startBoxStatusPoller(deps: PollerDeps, options: PollerOptions = {}): () => void {
  // 싱글톤: 이미 실행 중이면 경고 후 기존 stop 반환
  if (activeInstance) {
    console.warn(`${LOG_PREFIX} 이미 실행 중인 인스턴스가 있습니다. 기존 인스턴스를 유지합니다.`);
    return activeInstance.stop;
  }

  const intervalMs = options.intervalMs ?? 60_000;
  const maxFails = options.maxConsecutiveFailures ?? 3;

  /** 연속 실패 카운터: Map<boxId, failCount> */
  const failCount = new Map<string, number>();

  /** 매 tick 실행 로직 */
  const tick = async (): Promise<void> => {
    const activeBoxes = listActiveBoxes(deps.db);

    for (const box of activeBoxes) {
      const client = deps.createBoxClient(box.baseUrl);
      try {
        await client.system.health();
        // 성공: 카운터 초기화, last_sync_at 갱신
        failCount.set(box.id, 0);
        updateLastSyncAt(deps.db, box.id, new Date());
      } catch (err) {
        // 실패: 카운터 증가
        const prev = failCount.get(box.id) ?? 0;
        const cur = prev + 1;
        failCount.set(box.id, cur);

        console.warn(`${LOG_PREFIX} Box ${box.id} 폴링 실패`, {
          count: cur,
          maxFails,
          error: err instanceof Error ? err.message : String(err),
        });

        // maxFails 이상이면 status='error' 전이
        if (cur >= maxFails) {
          updateStatus(deps.db, box.id, 'error');
          // 카운터에서 제거: 이후 listActiveBoxes 에서 제외되므로 불필요하지만 명시적 정리
          failCount.delete(box.id);
        }
      }
    }
  };

  const handle = setInterval(tick, intervalMs);

  const stop = (): void => {
    clearInterval(handle);
    failCount.clear();
    activeInstance = null;
  };

  activeInstance = { stop };
  return stop;
}
