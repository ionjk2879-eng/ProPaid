import { decryptWithPurpose, encryptWithPurpose } from './token-crypto';
import type { Env } from './types';

const encode = (v: Uint8Array) => btoa(String.fromCharCode(...v)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const decode = (v: string) => Uint8Array.from(atob(v.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0));

async function hmac(secret: string, value: string) {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return encode(new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(value))));
}

export async function createGoogleState(userId: number, secret: string) {
  const payload = encode(new TextEncoder().encode(JSON.stringify({ userId, expiresAt: Date.now() + 10 * 60_000, nonce: crypto.randomUUID() })));
  return `${payload}.${await hmac(secret, payload)}`;
}

export async function verifyGoogleState(state: string, secret: string) {
  const [payload, signature] = state.split('.');
  if (!payload || !signature || (await hmac(secret, payload)) !== signature) return null;
  try {
    const parsed = JSON.parse(new TextDecoder().decode(decode(payload))) as { userId?: number; expiresAt?: number };
    return parsed.userId && parsed.expiresAt && parsed.expiresAt > Date.now() ? parsed.userId : null;
  } catch { return null; }
}

export async function createGoogleLoginState(secret: string) {
  const payload = encode(new TextEncoder().encode(JSON.stringify({
    purpose: 'login', expiresAt: Date.now() + 10 * 60_000, nonce: crypto.randomUUID(),
  })));
  return `${payload}.${await hmac(secret, payload)}`;
}

export async function verifyGoogleLoginState(state: string, secret: string) {
  const [payload, signature] = state.split('.');
  if (!payload || !signature || (await hmac(secret, payload)) !== signature) return false;
  try {
    const parsed = JSON.parse(new TextDecoder().decode(decode(payload))) as { purpose?: string; expiresAt?: number };
    return parsed.purpose === 'login' && Boolean(parsed.expiresAt && parsed.expiresAt > Date.now());
  } catch { return false; }
}

// 실제 암호화·복호화와 키 버전 관리는 token-crypto.ts에서 담당한다(Notion 연동과 로직 공유).
export function encryptGoogleToken(token: string, env: Env) { return encryptWithPurpose('google', token, env); }
export function decryptGoogleToken(value: string, env: Env) { return decryptWithPurpose('google', value, env); }

export function googleRedirectUri(env: Env) {
  return env.GOOGLE_REDIRECT_URI || `${env.APP_ORIGIN.split(',')[0].trim()}/api/integrations/google/callback`;
}

export function googleLoginRedirectUri(env: Env) {
  return env.GOOGLE_LOGIN_REDIRECT_URI || `${env.APP_ORIGIN.split(',')[0].trim().replace(/\/$/, '')}/api/auth/google/callback`;
}

export function googleAppOrigin(env: Env) {
  return env.APP_ORIGIN.split(',')[0].trim().replace(/\/$/, '');
}

export interface GoogleConnection {
  access_token_encrypted: string;
  refresh_token_encrypted: string | null;
  token_expiry: string | null;
}

/** 토큰 갱신이 되돌릴 수 없이 실패해 사용자가 다시 연결해야 함을 나타낸다(호출부가 연결 정보를 정리할 수 있도록 구분). */
export class GoogleReauthRequiredError extends Error {}

export async function getGoogleAccessToken(
  connection: GoogleConnection,
  env: Env,
  saveToken: (encrypted: string, expiry: string) => Promise<void>,
): Promise<string> {
  if (connection.token_expiry && new Date(connection.token_expiry) > new Date(Date.now() + 60_000)) {
    return decryptGoogleToken(connection.access_token_encrypted, env);
  }
  if (!connection.refresh_token_encrypted || !env.GOOGLE_CLIENT_ID || !env.GOOGLE_CLIENT_SECRET) {
    throw new GoogleReauthRequiredError('Google 연결이 만료되었습니다. 다시 연결해주세요.');
  }
  const refreshToken = await decryptGoogleToken(connection.refresh_token_encrypted, env);
  const response = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: env.GOOGLE_CLIENT_ID, client_secret: env.GOOGLE_CLIENT_SECRET,
      refresh_token: refreshToken, grant_type: 'refresh_token',
    }),
  });
  const tokens = await response.json<{ access_token?: string; expires_in?: number }>();
  if (!response.ok || !tokens.access_token) throw new GoogleReauthRequiredError('Google 토큰 갱신에 실패했습니다. 다시 연결해주세요.');
  const expiry = new Date(Date.now() + (tokens.expires_in ?? 3600) * 1000).toISOString();
  const encrypted = await encryptGoogleToken(tokens.access_token, env);
  await saveToken(encrypted, expiry);
  return tokens.access_token;
}
