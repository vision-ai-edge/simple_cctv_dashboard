/**
 * EdgeAI Box API 호출 시 발생하는 에러를 표현하는 커스텀 예외.
 *
 * - `{ success: false }` 응답 봉투
 * - HTTP 4xx / 5xx 응답
 * - 네트워크 수준 실패 (fetch 자체 거부)
 * 모두 본 클래스로 정규화된다.
 */

export class BoxApiError extends Error {
  public override readonly name = 'BoxApiError';
  public override readonly cause?: unknown;
  public readonly statusCode: number;
  public readonly timestamp: number;

  constructor(message: string, statusCode: number, timestamp: number, cause?: unknown) {
    super(message);
    this.statusCode = statusCode;
    this.timestamp = timestamp;
    this.cause = cause;
    // V8 stack trace 보존
    if (typeof Error.captureStackTrace === 'function') {
      Error.captureStackTrace(this, BoxApiError);
    }
  }

  static fromUnknown(value: unknown, fallbackStatus = 0): BoxApiError {
    if (value instanceof BoxApiError) return value;
    const message = value instanceof Error ? value.message : String(value);
    return new BoxApiError(message, fallbackStatus, Date.now(), value);
  }
}
