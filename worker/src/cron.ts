import { DORMANT_AFTER_DAYS, INBOUND_REVIEW_RETENTION_DAYS, purgeUser } from './account';
import { RESEND_FAILURE_ALERT_THRESHOLD, sendAlert } from './alerts';
import { runDailyBackup } from './backup';
import { logError, type LogContext } from './log';
import type { Env } from './types';

/**
 * Daily maintenance sweep:
 * 0. Exports every table to R2 (see backup.ts) before anything else runs, so accounts
 *    that get purged below are still captured in that day's backup.
 * 1. Permanently deletes accounts whose withdrawal grace period has elapsed.
 * 2. Marks long-unused active accounts dormant and forces re-authentication
 *    (bumps token_version so any lingering JWTs stop working).
 * 3. Clears the raw text of received proposal emails the user never reviewed,
 *    bounding how long unreviewed mail content is kept.
 */
export async function runAccountMaintenance(env: Env, jobId?: string): Promise<void> {
  const context: LogContext = { jobId };
  try { await runDailyBackup(env, context); }
  catch (error) { logError('일일 D1 백업 실패', context, error); }

  const now = new Date().toISOString();

  const due = await env.DB.prepare(
    "SELECT id FROM users WHERE status = 'pending_deletion' AND deletion_scheduled_at IS NOT NULL AND deletion_scheduled_at <= ?"
  ).bind(now).all<{ id: number }>();
  for (const { id } of due.results) {
    try { await purgeUser(env, id, context); }
    catch (error) { logError('예정된 계정 삭제 실패', { ...context, userId: id }, error); }
  }

  const dormantCutoff = new Date(Date.now() - DORMANT_AFTER_DAYS * 24 * 60 * 60 * 1000).toISOString();
  await env.DB.prepare(
    `UPDATE users SET status = 'dormant', token_version = token_version + 1
     WHERE status = 'active' AND last_active_at IS NOT NULL AND last_active_at <= ?`
  ).bind(dormantCutoff).run();

  const reviewCutoff = new Date(Date.now() - INBOUND_REVIEW_RETENTION_DAYS * 24 * 60 * 60 * 1000).toISOString();
  await env.DB.prepare(
    "UPDATE inbound_emails SET text_body = '' WHERE status = 'REVIEW' AND text_body != '' AND created_at <= ?"
  ).bind(reviewCutoff).run();
}

// 매시간 실행: wrangler tail을 계속 지켜보지 않아도 급증한 실패를 알림으로 받을 수 있도록,
// 최근 1시간 내 새로 발생한 수신 메일 처리 실패(Resend 조회·Claude 분석 포함) 건수를 확인한다.
// Notion·Calendar 연동 실패는 실패 시점에 바로 알림을 보내므로(index.ts) 여기서는 다루지 않는다.
export async function runFailureAlertCheck(env: Env, jobId?: string): Promise<void> {
  const context: LogContext = { jobId };
  const since = new Date(Date.now() - 60 * 60 * 1000).toISOString();
  const failed = await env.DB.prepare(
    "SELECT COUNT(*) as n FROM inbound_emails WHERE status = 'FAILED' AND last_attempt_at >= ?"
  ).bind(since).first<{ n: number }>();
  const count = failed?.n ?? 0;
  if (count >= RESEND_FAILURE_ALERT_THRESHOLD) {
    await sendAlert(env, '수신 메일 처리 실패 급증',
      `최근 1시간 동안 ${count}건의 수신 메일 처리가 실패했습니다(Resend 조회 실패 또는 분석 오류). wrangler tail 또는 /api/inbox/messages에서 원인을 확인하세요.`,
      context);
  }
}
