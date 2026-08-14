const encoder = new TextEncoder();

function base64Url(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function decodeBase64Url(value: string): Uint8Array<ArrayBuffer> {
  const normalized = value.replace(/-/g, '+').replace(/_/g, '/');
  const binary = atob(normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '='));
  const bytes = new Uint8Array(new ArrayBuffer(binary.length));
  for (let index = 0; index < binary.length; index++) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

export async function hashPassword(password: string): Promise<string> {
  const salt = new Uint8Array(new ArrayBuffer(16));
  crypto.getRandomValues(salt);
  const key = await crypto.subtle.importKey('raw', encoder.encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations: 100_000 }, key, 256);
  return `pbkdf2_sha256$100000$${base64Url(salt)}$${base64Url(new Uint8Array(bits))}`;
}

async function jwtKey(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']);
}

export async function createToken(userId: number, secret: string): Promise<string> {
  const header = base64Url(encoder.encode(JSON.stringify({ alg: 'HS256', typ: 'JWT' })));
  const payload = base64Url(encoder.encode(JSON.stringify({ sub: String(userId), exp: Math.floor(Date.now() / 1000) + 60 * 60 * 24 * 7 })));
  const signature = await crypto.subtle.sign('HMAC', await jwtKey(secret), encoder.encode(`${header}.${payload}`));
  return `${header}.${payload}.${base64Url(new Uint8Array(signature))}`;
}

export async function verifyToken(token: string, secret: string): Promise<number | null> {
  const [header, payload, signature] = token.split('.');
  if (!header || !payload || !signature) return null;
  const valid = await crypto.subtle.verify('HMAC', await jwtKey(secret), decodeBase64Url(signature), encoder.encode(`${header}.${payload}`));
  if (!valid) return null;
  try {
    const data = JSON.parse(new TextDecoder().decode(decodeBase64Url(payload))) as { sub: string; exp: number };
    return data.exp > Date.now() / 1000 ? Number(data.sub) : null;
  } catch { return null; }
}

export function randomToken(bytes = 18): string {
  return base64Url(crypto.getRandomValues(new Uint8Array(bytes))).toLowerCase();
}
