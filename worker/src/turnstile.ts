import { logError, type LogContext } from './log';
import type { Env } from './types';

/**
 * Cloudflare Turnstile 토큰을 서버 측에서 검증한다(siteverify). 브라우저 위젯 통과만으로는
 * 부족하고, 반드시 이 서버 측 호출까지 거쳐야 실제로 사람이 통과했다고 신뢰할 수 있다.
 * TURNSTILE_SECRET_KEY가 설정되지 않은 환경(로컬 개발, 아직 Turnstile 사이트를 만들지 않은 경우)에서는
 * 검증을 건너뛰고 통과시킨다 — 프런트엔드도 사이트 키가 없으면 위젯을 렌더링하지 않으므로 짝이 맞는다.
 */
export async function verifyTurnstile(env: Env, token: string | undefined | null, remoteIp: string, context: LogContext = {}): Promise<boolean> {
  if (!env.TURNSTILE_SECRET_KEY) return true;
  if (!token) return false;
  try {
    const response = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ secret: env.TURNSTILE_SECRET_KEY, response: token, remoteip: remoteIp }),
    });
    const result = await response.json<{ success?: boolean }>();
    return result.success === true;
  } catch (error) {
    logError('Turnstile 검증 실패', context, error);
    return false; // 검증 서비스 오류 시 안전하게 차단한다(자동화 남용 방지가 목적이므로 fail-closed).
  }
}
