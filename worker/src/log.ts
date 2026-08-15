export type LogContext = { requestId?: string; jobId?: string; userId?: number | string | null };

type LogLevel = 'info' | 'warn' | 'error';

// 메일 본문, 토큰 등 민감한 값이 실수로 로그 필드에 섞여 들어가는 것을 막기 위한 방어선.
// 구조화 로그는 항상 이 모듈을 통해서만 남기고, 원문 텍스트나 토큰 값 자체를 필드로 넘기지 않는다.
const SENSITIVE_KEY_PATTERN = /token|secret|password|authorization|jwt|api[_-]?key|raw[_-]?text|text[_-]?body|html|cookie/i;
const MAX_FIELD_LENGTH = 300;

function sanitize(fields: Record<string, unknown>): Record<string, unknown> {
  const safe: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(fields)) {
    if (SENSITIVE_KEY_PATTERN.test(key)) { safe[key] = '[redacted]'; continue; }
    if (typeof value === 'string' && value.length > MAX_FIELD_LENGTH) { safe[key] = `${value.slice(0, MAX_FIELD_LENGTH)}…`; continue; }
    safe[key] = value;
  }
  return safe;
}

/**
 * Workers Logs(관찰 기능)에서 request_id/job_id/user_id로 검색할 수 있도록 JSON 한 줄로 기록한다.
 * fields에는 절대 메일 원문·토큰 값을 직접 넘기지 않는다(SENSITIVE_KEY_PATTERN이 필드명 기준으로 한 번 더 걸러낸다).
 */
export function log(level: LogLevel, message: string, context: LogContext = {}, fields: Record<string, unknown> = {}): void {
  const entry = {
    level,
    message,
    timestamp: new Date().toISOString(),
    request_id: context.requestId ?? null,
    job_id: context.jobId ?? null,
    user_id: context.userId ?? null,
    ...sanitize(fields),
  };
  const writer = level === 'error' ? console.error : level === 'warn' ? console.warn : console.log;
  writer(JSON.stringify(entry));
}

export function logError(message: string, context: LogContext = {}, error?: unknown, fields: Record<string, unknown> = {}): void {
  const errorMessage = error instanceof Error ? error.message : error != null ? String(error) : undefined;
  log('error', message, context, { ...fields, error: errorMessage });
}
