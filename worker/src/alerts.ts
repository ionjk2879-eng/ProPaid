import { logError, type LogContext } from './log';
import type { Env } from './types';

// 같은 항목에 대한 반복 알림을 막기 위해, 실패 횟수가 정확히 이 값에 도달한 시점에만 알림을 보낸다
// (그 이후 계속 실패해도 attempts는 계속 증가하므로 다시 이 값과 같아지지 않는다).
export const QUARANTINE_ALERT_THRESHOLD = 3;

// 최근 1시간 내 신규 실패가 이 값 이상이면 급증으로 간주한다.
export const RESEND_FAILURE_ALERT_THRESHOLD = 3;

// Slack과 Discord Incoming Webhook 모두 알림이 보이도록 두 필드를 함께 보낸다(둘 다 상대방 필드는 무시함).
export async function sendAlert(env: Env, title: string, detail: string, context: LogContext = {}): Promise<void> {
  if (!env.ALERT_WEBHOOK_URL) return;
  const message = `🚨 ProPaid 운영 알림: ${title}\n${detail}`;
  try {
    await fetch(env.ALERT_WEBHOOK_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: message, content: message }),
    });
  } catch (error) {
    logError('알림 웹훅 전송 실패', context, error, { title });
  }
}
