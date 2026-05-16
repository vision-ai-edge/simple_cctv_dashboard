/**
 * alertStream.ts 순수 함수 테스트.
 *
 * - getBackoffDelay: 지수 백오프 스케줄 검증
 * - parseAlertMessage: SSE 메시지 파싱 검증
 */

import { describe, expect, it } from 'bun:test';
import {
  BACKOFF_SCHEDULE_MS,
  getBackoffDelay,
  parseAlertMessage,
} from '../../lib/alertStream';

// --- getBackoffDelay 테스트 ---

describe('getBackoffDelay', () => {
  it('첫 번째 재시도는 1초(1000ms)이다', () => {
    expect(getBackoffDelay(0)).toBe(1000);
  });

  it('두 번째 재시도는 2초(2000ms)이다', () => {
    expect(getBackoffDelay(1)).toBe(2000);
  });

  it('세 번째 재시도는 5초(5000ms)이다', () => {
    expect(getBackoffDelay(2)).toBe(5000);
  });

  it('네 번째 재시도는 10초(10000ms)이다', () => {
    expect(getBackoffDelay(3)).toBe(10000);
  });

  it('다섯 번째 이상은 30초(30000ms)로 상한이 적용된다', () => {
    expect(getBackoffDelay(4)).toBe(30000);
    expect(getBackoffDelay(5)).toBe(30000);
    expect(getBackoffDelay(100)).toBe(30000);
  });

  it('백오프 스케줄은 오름차순이다', () => {
    for (let i = 0; i < BACKOFF_SCHEDULE_MS.length - 1; i++) {
      expect(BACKOFF_SCHEDULE_MS[i]).toBeLessThan(BACKOFF_SCHEDULE_MS[i + 1]);
    }
  });

  it('백오프 스케줄의 상한은 30초이다', () => {
    const max = Math.max(...BACKOFF_SCHEDULE_MS);
    expect(max).toBe(30000);
  });
});

// --- parseAlertMessage 테스트 ---

const validAlert = {
  id: 'alert-001',
  type: 'person_detected',
  channelId: 'ch-001',
  boxId: 'box-001',
  firedAt: 1700000000000,
};

describe('parseAlertMessage', () => {
  it('유효한 AlertEvent JSON을 파싱한다', () => {
    const data = JSON.stringify(validAlert);
    const result = parseAlertMessage(data);
    expect(result).not.toBeNull();
    expect(result?.id).toBe('alert-001');
    expect(result?.type).toBe('person_detected');
    expect(result?.channelId).toBe('ch-001');
    expect(result?.boxId).toBe('box-001');
    expect(result?.firedAt).toBe(1700000000000);
  });

  it('선택 필드 payload가 있는 경우도 파싱한다', () => {
    const withPayload = { ...validAlert, payload: { confidence: 0.95 } };
    const result = parseAlertMessage(JSON.stringify(withPayload));
    expect(result).not.toBeNull();
    expect(result?.payload).toEqual({ confidence: 0.95 });
  });

  it('유효하지 않은 JSON은 null을 반환한다', () => {
    expect(parseAlertMessage('not-json')).toBeNull();
    expect(parseAlertMessage('{')).toBeNull();
    expect(parseAlertMessage('')).toBeNull();
  });

  it('필수 필드 id가 없으면 null을 반환한다', () => {
    const { id: _id, ...withoutId } = validAlert;
    expect(parseAlertMessage(JSON.stringify(withoutId))).toBeNull();
  });

  it('필수 필드 type이 없으면 null을 반환한다', () => {
    const { type: _type, ...withoutType } = validAlert;
    expect(parseAlertMessage(JSON.stringify(withoutType))).toBeNull();
  });

  it('필수 필드 channelId가 없으면 null을 반환한다', () => {
    const { channelId: _channelId, ...withoutChannel } = validAlert;
    expect(parseAlertMessage(JSON.stringify(withoutChannel))).toBeNull();
  });

  it('필수 필드 boxId가 없으면 null을 반환한다', () => {
    const { boxId: _boxId, ...withoutBox } = validAlert;
    expect(parseAlertMessage(JSON.stringify(withoutBox))).toBeNull();
  });

  it('firedAt이 숫자가 아니면 null을 반환한다', () => {
    const wrongType = { ...validAlert, firedAt: '2024-01-01' };
    expect(parseAlertMessage(JSON.stringify(wrongType))).toBeNull();
  });

  it('id가 문자열이 아니면 null을 반환한다', () => {
    const wrongIdType = { ...validAlert, id: 123 };
    expect(parseAlertMessage(JSON.stringify(wrongIdType))).toBeNull();
  });

  it('null 데이터는 null을 반환한다', () => {
    expect(parseAlertMessage('null')).toBeNull();
  });

  it('배열 데이터는 null을 반환한다', () => {
    expect(parseAlertMessage('[]')).toBeNull();
  });
});
