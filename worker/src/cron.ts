import { DORMANT_AFTER_DAYS, INBOUND_REVIEW_RETENTION_DAYS, purgeUser } from './account';
import type { Env } from './types';

/**
 * Daily maintenance sweep:
 * 1. Permanently deletes accounts whose withdrawal grace period has elapsed.
 * 2. Marks long-unused active accounts dormant and forces re-authentication
 *    (bumps token_version so any lingering JWTs stop working).
 * 3. Clears the raw text of received proposal emails the user never reviewed,
 *    bounding how long unreviewed mail content is kept.
 */
export async function runAccountMaintenance(env: Env): Promise<void> {
  const now = new Date().toISOString();

  const due = await env.DB.prepare(
    "SELECT id FROM users WHERE status = 'pending_deletion' AND deletion_scheduled_at IS NOT NULL AND deletion_scheduled_at <= ?"
  ).bind(now).all<{ id: number }>();
  for (const { id } of due.results) {
    try { await purgeUser(env, id); }
    catch (error) { console.error(`예정된 계정 삭제 실패: user=${id}`, error); }
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
