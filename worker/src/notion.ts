import type { Env } from './types';

const NOTION_VERSION = '2026-03-11';
const encode = (value: Uint8Array) => btoa(String.fromCharCode(...value)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const decode = (value: string) => Uint8Array.from(atob(value.replace(/-/g, '+').replace(/_/g, '/')), (char) => char.charCodeAt(0));

async function hmac(secret: string, value: string) {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return encode(new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(value))));
}

export async function createNotionState(userId: number, secret: string) {
  const payload = encode(new TextEncoder().encode(JSON.stringify({ userId, expiresAt: Date.now() + 10 * 60_000, nonce: crypto.randomUUID() })));
  return `${payload}.${await hmac(secret, payload)}`;
}

export async function verifyNotionState(state: string, secret: string) {
  const [payload, signature] = state.split('.');
  if (!payload || !signature || await hmac(secret, payload) !== signature) return null;
  try {
    const parsed = JSON.parse(new TextDecoder().decode(decode(payload))) as { userId?: number; expiresAt?: number };
    return parsed.userId && parsed.expiresAt && parsed.expiresAt > Date.now() ? parsed.userId : null;
  } catch { return null; }
}

async function encryptionKey(secret: string) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`propaid:notion:${secret}`));
  return crypto.subtle.importKey('raw', digest, 'AES-GCM', false, ['encrypt', 'decrypt']);
}

export async function encryptNotionToken(token: string, secret: string) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encrypted = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, await encryptionKey(secret), new TextEncoder().encode(token));
  return `${encode(iv)}.${encode(new Uint8Array(encrypted))}`;
}

export async function decryptNotionToken(value: string, secret: string) {
  const [iv, encrypted] = value.split('.');
  if (!iv || !encrypted) throw new Error('Notion 토큰을 복호화할 수 없습니다.');
  const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: decode(iv) }, await encryptionKey(secret), decode(encrypted));
  return new TextDecoder().decode(plain);
}

export function notionHeaders(accessToken: string) {
  return { Authorization: `Bearer ${accessToken}`, 'Notion-Version': NOTION_VERSION, 'Content-Type': 'application/json' };
}

export function notionRedirectUri(env: Env) {
  return env.NOTION_REDIRECT_URI || `${env.APP_ORIGIN.split(',')[0].trim()}/api/integrations/notion/callback`;
}

export function notionAppOrigin(env: Env) {
  return env.APP_ORIGIN.split(',')[0].trim().replace(/\/$/, '');
}
