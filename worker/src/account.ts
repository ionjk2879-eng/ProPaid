import { logError, type LogContext } from './log';
import type { Env } from './types';

export const DELETION_GRACE_DAYS = 14;
export const DORMANT_AFTER_DAYS = 365;
/** How long an unreviewed received proposal email keeps its raw text before it's auto-cleared. */
export const INBOUND_REVIEW_RETENTION_DAYS = 30;

export function scheduledDeletionAt(from = new Date()): string {
  return new Date(from.getTime() + DELETION_GRACE_DAYS * 24 * 60 * 60 * 1000).toISOString();
}

/** Deletes every R2 evidence object owned by the user. Best-effort: logs and continues on individual failures. */
export async function purgeUserEvidence(env: Env, userId: number, context: LogContext = {}): Promise<void> {
  if (!env.EVIDENCE_BUCKET) return;
  const { results } = await env.DB.prepare('SELECT evidence_object_key FROM expenses WHERE user_id = ? AND evidence_object_key IS NOT NULL')
    .bind(userId).all<{ evidence_object_key: string }>();
  for (const row of results) {
    try { await env.EVIDENCE_BUCKET.delete(row.evidence_object_key); }
    catch (error) { logError('계정 삭제 중 R2 증빙 정리 실패', { ...context, userId }, error); }
  }
}

/** Permanently deletes a user and every row that references it (D1 FKs cascade). Call purgeUserEvidence first. */
export async function purgeUser(env: Env, userId: number, context: LogContext = {}): Promise<void> {
  await purgeUserEvidence(env, userId, context);
  await env.DB.prepare('DELETE FROM users WHERE id = ?').bind(userId).run();
}
