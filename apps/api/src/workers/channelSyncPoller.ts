// TAG: BOX-CHANNELS-001
/**
 * SPEC-BOX-CHANNELS-001 — 채널 동기화 주기 폴러.
 *
 * 책임:
 *   - REQ-CHAN-002: status='active' Box만 주기적으로 채널 동기화
 *   - CHANNEL_SYNC_INTERVAL_MS 환경변수로 주기 조정 (기본 5분, 최소 30초)
 *   - CHANNEL_SYNC_CONCURRENCY 환경변수로 동시 처리 Box 수 제한 (기본 3)
 *   - Box 단위 뮤텍스(channelSyncService.isSyncInProgress) 활용
 *   - 개별 Box 실패 격리 (다른 Box 처리 중단 없음)
 *
 * 보안 원칙:
 *   - 자격증명(비밀번호, 암호화 blob) 로그 미포함
 *   - BOX_VAULT_KEY DI deps 주입
 *
 * 패턴:
 *   - boxStatusPoller.ts와 동일한 싱글톤 + start/stop 패턴
 *   - setInterval 기반, 종료 시 clearInterval
 */

import type { BoxServiceDeps } from '../services/boxService';
import {
  acquireSyncLock,
  isSyncInProgress,
  releaseSyncLock,
  syncChannelsForBox,
} from '../services/channelSyncService';

// ---------------------------------------------------------------------------
// 상수
// ---------------------------------------------------------------------------

/** 기본 동기화 주기 (ms) */
const DEFAULT_INTERVAL_MS = 300_000; // 5분

/** 최소 동기화 주기 (ms) — 더 짧게 설정 시 클램핑 */
const MIN_INTERVAL_MS = 30_000; // 30초

/** 기본 동시 처리 Box 수 */
const DEFAULT_CONCURRENCY = 3;

/** 최소 동시 처리 Box 수 */
const MIN_CONCURRENCY = 1;

/** 로그 prefix */
const LOG_PREFIX = '[channelSyncPoller]';

// ---------------------------------------------------------------------------
// 내부 타입
// ---------------------------------------------------------------------------

/** DB에서 조회하는 active Box 행 */
type ActiveBoxRow = {
  id: string;
};

// ---------------------------------------------------------------------------
// 싱글톤 상태
// ---------------------------------------------------------------------------

/** 현재 실행 중인 폴러 인스턴스 */
let activeInstance: { stop: () => void } | null = null;

// ---------------------------------------------------------------------------
// 내부 헬퍼
// ---------------------------------------------------------------------------

/**
 * status='active' Box ID 목록 조회.
 * inactive / error Box는 폴링 제외.
 */
function listActiveBoxIds(deps: BoxServiceDeps): string[] {
  const rows = deps.db.$client
    .query("SELECT id FROM boxes WHERE status = 'active'")
    .all() as ActiveBoxRow[];
  return rows.map((r) => r.id);
}

/**
 * 환경변수 CHANNEL_SYNC_INTERVAL_MS를 읽어 클램핑된 인터벌(ms)을 반환한다.
 */
export function resolveIntervalMs(envValue?: string): number {
  const raw = envValue !== undefined ? Number.parseInt(envValue, 10) : DEFAULT_INTERVAL_MS;
  const value = Number.isNaN(raw) ? DEFAULT_INTERVAL_MS : raw;
  return Math.max(value, MIN_INTERVAL_MS);
}

/**
 * 환경변수 CHANNEL_SYNC_CONCURRENCY를 읽어 클램핑된 동시성 값을 반환한다.
 */
export function resolveConcurrency(envValue?: string): number {
  const raw = envValue !== undefined ? Number.parseInt(envValue, 10) : DEFAULT_CONCURRENCY;
  const value = Number.isNaN(raw) ? DEFAULT_CONCURRENCY : raw;
  return Math.max(value, MIN_CONCURRENCY);
}

/**
 * 배열을 concurrency 단위로 나누어 순차 처리하는 제한된 병렬 실행기.
 * 동시에 최대 concurrency 개의 작업을 실행한다.
 */
async function runWithConcurrency<T>(
  items: T[],
  concurrency: number,
  fn: (item: T) => Promise<void>,
): Promise<void> {
  for (let i = 0; i < items.length; i += concurrency) {
    const batch = items.slice(i, i + concurrency);
    await Promise.all(batch.map(fn));
  }
}

// ---------------------------------------------------------------------------
// 공개 API
// ---------------------------------------------------------------------------

/** channelSyncPoller 옵션 */
export interface ChannelSyncPollerOptions {
  /** 폴링 주기 (ms). 기본값: CHANNEL_SYNC_INTERVAL_MS 환경변수 또는 300000 */
  intervalMs?: number;
  /** 동시 처리 Box 수. 기본값: CHANNEL_SYNC_CONCURRENCY 환경변수 또는 3 */
  concurrency?: number;
}

/**
 * 채널 동기화 폴러를 시작한다.
 *
 * 처리 순서 (매 tick):
 *  1. status='active' Box 목록 조회
 *  2. 각 Box에 대해 isSyncInProgress 확인 — 진행 중이면 스킵
 *  3. acquireSyncLock → syncChannelsForBox → releaseSyncLock
 *  4. 동시성 제한 (concurrency 단위 배치 처리)
 *  5. 개별 Box 실패 try-catch 격리
 *
 * 싱글톤:
 *  - 이미 실행 중인 인스턴스가 있으면 경고 후 기존 stop 반환
 *  - stop() 호출 후 재시작 가능
 *
 * @param deps 의존성 주입
 * @param options 폴러 옵션
 * @returns stop 함수 — clearInterval 및 싱글톤 상태 초기화
 */
export function startChannelSyncPoller(
  deps: BoxServiceDeps,
  options: ChannelSyncPollerOptions = {},
): () => void {
  // 싱글톤: 이미 실행 중이면 경고 후 기존 stop 반환
  if (activeInstance) {
    console.warn(`${LOG_PREFIX} 이미 실행 중인 인스턴스가 있습니다. 기존 인스턴스를 유지합니다.`);
    return activeInstance.stop;
  }

  const intervalMs = options.intervalMs ?? resolveIntervalMs(process.env.CHANNEL_SYNC_INTERVAL_MS);
  const concurrency =
    options.concurrency ?? resolveConcurrency(process.env.CHANNEL_SYNC_CONCURRENCY);

  console.info(`${LOG_PREFIX} 시작 — 주기: ${intervalMs}ms, 동시성: ${concurrency}`);

  /** 매 tick 실행 로직 */
  const tick = async (): Promise<void> => {
    const boxIds = listActiveBoxIds(deps);

    if (boxIds.length === 0) {
      return;
    }

    await runWithConcurrency(boxIds, concurrency, async (boxId) => {
      // 뮤텍스: 이미 진행 중인 Box는 스킵
      if (isSyncInProgress(boxId)) {
        console.info(`${LOG_PREFIX} Box ${boxId} 동기화 진행 중, 건너뜀`);
        return;
      }

      const acquired = acquireSyncLock(boxId);
      if (!acquired) {
        console.info(`${LOG_PREFIX} Box ${boxId} 락 획득 실패, 건너뜀`);
        return;
      }

      try {
        const result = await syncChannelsForBox(boxId, deps);
        if (result.success) {
          console.info(`${LOG_PREFIX} Box ${boxId} 동기화 완료`, {
            synced: result.synced,
            timestamp: result.timestamp,
          });
        } else {
          console.warn(`${LOG_PREFIX} Box ${boxId} 동기화 실패`, {
            failed: result.failed,
          });
        }
      } catch (err) {
        // 개별 Box 실패 격리 — 다른 Box 처리에 영향 없음
        console.error(`${LOG_PREFIX} Box ${boxId} 동기화 오류 (격리됨)`, {
          error: err instanceof Error ? err.message : String(err),
        });
      } finally {
        releaseSyncLock(boxId);
      }
    });
  };

  const handle = setInterval(() => {
    tick().catch((err) => {
      // tick 전체 실패 격리 — 서버 프로세스 종료 방지
      console.error(`${LOG_PREFIX} tick 오류 (서버 영향 없음)`, {
        error: err instanceof Error ? err.message : String(err),
      });
    });
  }, intervalMs);

  const stop = (): void => {
    clearInterval(handle);
    activeInstance = null;
    console.info(`${LOG_PREFIX} 중지됨`);
  };

  activeInstance = { stop };
  return stop;
}
