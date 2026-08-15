import { decryptWithPurpose, encryptWithPurpose } from './token-crypto';
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

// 실제 암호화·복호화와 키 버전 관리는 token-crypto.ts에서 담당한다(Google 연동과 로직 공유).
export function encryptNotionToken(token: string, env: Env) { return encryptWithPurpose('notion', token, env); }
export function decryptNotionToken(value: string, env: Env) { return decryptWithPurpose('notion', value, env); }

export function notionHeaders(accessToken: string) {
  return { Authorization: `Bearer ${accessToken}`, 'Notion-Version': NOTION_VERSION, 'Content-Type': 'application/json' };
}

export function notionRedirectUri(env: Env) {
  return env.NOTION_REDIRECT_URI || `${env.APP_ORIGIN.split(',')[0].trim()}/api/integrations/notion/callback`;
}

export function notionAppOrigin(env: Env) {
  return env.APP_ORIGIN.split(',')[0].trim().replace(/\/$/, '');
}
