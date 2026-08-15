import type { Env } from './types';

// 저장된 값에 버전 접두사(vN:)가 없으면 이 코드가 배포되기 전에 저장된 레거시 값으로 보고,
// JWT_SECRET에서 파생한 예전 키로만 복호화한다(그 형식으로는 다시 저장하지 않는다).
// 새로 저장하는 값은 항상 버전을 명시하고, 전용 TOKEN_ENCRYPTION_KEY_V{N} 시크릿을 우선 사용한다 —
// 이렇게 하면 로그인 서명용 JWT_SECRET을 교체해도 기존 Notion·Google 연결이 끊기지 않는다.
// 회전 절차: 새 TOKEN_ENCRYPTION_KEY_V{N+1}을 등록하고 CURRENT_KEY_VERSION을 올려 배포하면,
// 이후 토큰이 갱신될 때마다(재연결·리프레시 시점) 자동으로 새 키로 재암호화된다.
// 옛 버전 시크릿은 모든 데이터가 자연스럽게 재암호화될 때까지 계속 보관해야 한다.
const CURRENT_KEY_VERSION = 2;

const encode = (v: Uint8Array) => btoa(String.fromCharCode(...v)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const decode = (v: string) => Uint8Array.from(atob(v.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0));

let warnedMissingKey = false;

function keySecret(env: Env, version: number): string {
  if (version === 1) return env.JWT_SECRET; // 레거시 파생 키. 복호화 전용, 새 값 저장에는 쓰지 않는다.
  const dedicated = (env as unknown as Record<string, string | undefined>)[`TOKEN_ENCRYPTION_KEY_V${version}`];
  if (dedicated) return dedicated;
  if (!warnedMissingKey) {
    warnedMissingKey = true;
    console.warn(JSON.stringify({ level: 'warn', message: `TOKEN_ENCRYPTION_KEY_V${version}이 설정되지 않아 JWT_SECRET으로 대체합니다. 운영 환경에서는 전용 키를 등록하세요.`, timestamp: new Date().toISOString() }));
  }
  return env.JWT_SECRET;
}

async function deriveKey(env: Env, purpose: string, version: number): Promise<CryptoKey> {
  const secret = keySecret(env, version);
  const material = version === 1 ? `propaid:${purpose}:${secret}` : `propaid:${purpose}:v${version}:${secret}`;
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(material));
  return crypto.subtle.importKey('raw', digest, 'AES-GCM', false, ['encrypt', 'decrypt']);
}

/** 목적별(Notion/Google 등)로 값을 암호화한다. 결과는 항상 버전 접두사(v{N}:)를 포함한다. */
export async function encryptWithPurpose(purpose: string, token: string, env: Env): Promise<string> {
  const version = CURRENT_KEY_VERSION;
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await deriveKey(env, purpose, version);
  const encrypted = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(token));
  return `v${version}:${encode(iv)}.${encode(new Uint8Array(encrypted))}`;
}

/** 버전 접두사가 있으면 해당 버전 키로, 없으면(레거시) v1 키로 복호화한다. */
export async function decryptWithPurpose(purpose: string, value: string, env: Env): Promise<string> {
  const match = value.match(/^v(\d+):(.+)$/);
  const version = match ? Number(match[1]) : 1;
  const body = match ? match[2] : value;
  const [ivPart, encryptedPart] = body.split('.');
  if (!ivPart || !encryptedPart) throw new Error('토큰을 복호화할 수 없습니다.');
  const key = await deriveKey(env, purpose, version);
  const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: decode(ivPart) }, key, decode(encryptedPart));
  return new TextDecoder().decode(plain);
}
