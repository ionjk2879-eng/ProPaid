import { logError, type LogContext } from './log';
import type { Env } from './types';

export const BACKUP_RETENTION_DAYS = 90;
const BACKUP_PREFIX = 'd1/';

async function listUserTables(env: Env): Promise<string[]> {
  const { results } = await env.DB.prepare(
    "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%' AND name != 'd1_migrations' ORDER BY name"
  ).all<{ name: string }>();
  return results.map((row) => row.name);
}

/**
 * Daily D1 -> R2 export, independent of Cloudflare Time Travel (which only covers the last
 * 7/30 days and lives inside Cloudflare's own systems). Writes one JSON object per table under
 * both a dated key and a fixed `latest` key, then prunes exports older than the retention window.
 * This is deliberately plain JSON (no compression) so a human can restore it without extra tooling.
 */
export async function runDailyBackup(env: Env, context: LogContext = {}): Promise<void> {
  if (!env.BACKUP_BUCKET) return; // 백업 버킷이 없는 환경(로컬 개발 등)에서는 건너뛴다.
  const tables = await listUserTables(env);
  const exportedAt = new Date().toISOString();
  const dateKey = exportedAt.slice(0, 10);
  const put = (key: string, body: string) => env.BACKUP_BUCKET!.put(key, body, { httpMetadata: { contentType: 'application/json' } });

  for (const table of tables) {
    const { results } = await env.DB.prepare(`SELECT * FROM "${table}"`).all();
    const body = JSON.stringify(results);
    await put(`${BACKUP_PREFIX}${dateKey}/${table}.json`, body);
    await put(`${BACKUP_PREFIX}latest/${table}.json`, body);
  }
  const manifest = JSON.stringify({ exportedAt, tables });
  await put(`${BACKUP_PREFIX}${dateKey}/manifest.json`, manifest);
  await put(`${BACKUP_PREFIX}latest/manifest.json`, manifest);

  // 보관 기간이 지난 날짜별 백업을 정리한다(latest/는 항상 유지). 목록은 첫 페이지만 확인한다 —
  // 하루 (테이블 수 + 1)개 객체만 쌓이므로 보관 기간 안에서는 충분하다.
  const cutoff = new Date(Date.now() - BACKUP_RETENTION_DAYS * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const listed = await env.BACKUP_BUCKET.list({ prefix: BACKUP_PREFIX });
  for (const object of listed.objects) {
    const match = object.key.match(/^d1\/(\d{4}-\d{2}-\d{2})\//);
    if (match && match[1] < cutoff) {
      try { await env.BACKUP_BUCKET.delete(object.key); }
      catch (error) { logError('오래된 백업 삭제 실패', context, error, { key: object.key }); }
    }
  }
}
