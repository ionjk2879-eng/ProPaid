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

async function encryptionKey(secret: string) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`propaid:google:${secret}`));
  return crypto.subtle.importKey('raw', digest, 'AES-GCM', false, ['encrypt', 'decrypt']);
}

export async function encryptGoogleToken(token: string, secret: string) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encrypted = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, await encryptionKey(secret), new TextEncoder().encode(token));
  return `${encode(iv)}.${encode(new Uint8Array(encrypted))}`;
}

export async function decryptGoogleToken(value: string, secret: string) {
  const [iv, encrypted] = value.split('.');
  if (!iv || !encrypted) throw new Error('Google 토큰을 복호화할 수 없습니다.');
  const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: decode(iv) }, await encryptionKey(secret), decode(encrypted));
  return new TextDecoder().decode(plain);
}

export function googleRedirectUri(env: Env) {
  return env.GOOGLE_REDIRECT_URI || `${env.APP_ORIGIN.split(',')[0].trim()}/api/integrations/google/callback`;
}

export function googleAppOrigin(env: Env) {
  return env.APP_ORIGIN.split(',')[0].trim().replace(/\/$/, '');
}

export interface GoogleConnection {
  access_token_encrypted: string;
  refresh_token_encrypted: string | null;
  token_expiry: string | null;
}

export async function getGoogleAccessToken(
  connection: GoogleConnection,
  env: Env,
  saveToken: (encrypted: string, expiry: string) => Promise<void>,
): Promise<string> {
  if (connection.token_expiry && new Date(connection.token_expiry) > new Date(Date.now() + 60_000)) {
    return decryptGoogleToken(connection.access_token_encrypted, env.JWT_SECRET);
  }
  if (!connection.refresh_token_encrypted || !env.GOOGLE_CLIENT_ID || !env.GOOGLE_CLIENT_SECRET) {
    throw new Error('Google 연결이 만료되었습니다. 다시 연결해주세요.');
  }
  const refreshToken = await decryptGoogleToken(connection.refresh_token_encrypted, env.JWT_SECRET);
  const response = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: env.GOOGLE_CLIENT_ID, client_secret: env.GOOGLE_CLIENT_SECRET,
      refresh_token: refreshToken, grant_type: 'refresh_token',
    }),
  });
  const tokens = await response.json<{ access_token?: string; expires_in?: number }>();
  if (!response.ok || !tokens.access_token) throw new Error('Google 토큰 갱신에 실패했습니다. 다시 연결해주세요.');
  const expiry = new Date(Date.now() + (tokens.expires_in ?? 3600) * 1000).toISOString();
  const encrypted = await encryptGoogleToken(tokens.access_token, env.JWT_SECRET);
  await saveToken(encrypted, expiry);
  return tokens.access_token;
}
