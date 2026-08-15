import { logError } from './log';
import type { Env } from './types';

export type RateLimiterName = 'LOGIN_LIMITER' | 'ANALYSIS_LIMITER' | 'MAIL_LIMITER';

/**
 * Cloudflare Rate Limiting 바인딩으로 요청을 제한한다. 바인딩이 없는 환경(로컬 개발 등)이거나
 * 호출 자체가 실패하면 안전하게 허용(fail-open)한다 — 요청 제한 인프라 문제로 서비스 전체가
 * 막히는 것보다는, 드물게 제한이 느슨해지는 쪽이 낫다고 판단했다.
 */
export async function checkRateLimit(env: Env, name: RateLimiterName, key: string): Promise<boolean> {
  const limiter = env[name];
  if (!limiter) return true;
  try {
    const { success } = await limiter.limit({ key });
    return success;
  } catch (error) {
    logError('요청 제한 확인 실패', {}, error, { limiter: name });
    return true;
  }
}

/** Cloudflare 엣지가 검증한 실제 클라이언트 IP. 사용자가 조작할 수 있는 헤더(X-Forwarded-For 등)는 쓰지 않는다. */
export function clientIp(headers: Headers): string {
  return headers.get('CF-Connecting-IP') ?? 'unknown';
}
