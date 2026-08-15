import { logError } from './log';
import type { Env } from './types';

type MetricEvent =
  | 'api_request'
  | 'webhook_resend'
  | 'llm_analysis'
  | 'notion_export'
  | 'calendar_sync'
  | 'r2_upload'
  | 'd1_error';

// Cloudflare Analytics Engine으로 운영 지표를 비동기로 기록한다. 바인딩이 없거나(로컬 개발)
// 기록이 실패해도 요청 처리에는 영향을 주지 않는다 — fire-and-forget.
export function recordMetric(env: Env, event: MetricEvent, opts: {
  blobs?: Array<string | number | null | undefined>;
  doubles?: Array<number | null | undefined>;
  userId?: number | string | null;
} = {}): void {
  if (!env.METRICS) return;
  try {
    env.METRICS.writeDataPoint({
      blobs: [event, ...(opts.blobs ?? []).map((v) => (v == null ? '' : String(v)))].slice(0, 20),
      doubles: (opts.doubles ?? []).map((v) => v ?? 0).slice(0, 20),
      indexes: [opts.userId != null ? String(opts.userId) : 'system'],
    });
  } catch (error) {
    logError('메트릭 기록 실패', {}, error, { event });
  }
}
