import crypto from 'node:crypto';

const JWT_TTL_SEC = 30 * 24 * 60 * 60;

function secret(): string {
  const value = process.env.SECRET_KEY ?? process.env.JWT_SECRET;
  if (!value) {
    throw new Error('SECRET_KEY is required for JWT');
  }
  return value;
}

function b64url(input: string | Buffer): string {
  return Buffer.from(input)
    .toString('base64')
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');
}

function sign(data: string): string {
  return b64url(crypto.createHmac('sha256', secret()).update(data).digest());
}

export type AccessTokenPayload = {
  sub: number;
  type: 'access';
  iat: number;
  exp: number;
};

export function issueAccessToken(vkUserId: number): string {
  const header = b64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const now = Math.floor(Date.now() / 1000);
  const payload = b64url(
    JSON.stringify({
      sub: vkUserId,
      type: 'access',
      iat: now,
      exp: now + JWT_TTL_SEC,
    } satisfies AccessTokenPayload),
  );
  const body = `${header}.${payload}`;
  return `${body}.${sign(body)}`;
}

export function verifyAccessToken(token: string): AccessTokenPayload {
  const parts = token.split('.');
  if (parts.length !== 3) {
    throw new Error('Invalid token format');
  }

  const [header, payload, signature] = parts;
  const body = `${header}.${payload}`;
  const expected = sign(body);
  const a = Buffer.from(signature);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    throw new Error('Invalid token signature');
  }

  const decoded = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as AccessTokenPayload;
  if (decoded.type !== 'access' || !Number.isFinite(decoded.sub)) {
    throw new Error('Invalid token payload');
  }
  if (decoded.exp <= Math.floor(Date.now() / 1000)) {
    throw new Error('Token expired');
  }

  return decoded;
}

export function issueRefreshToken(): string {
  return crypto.randomBytes(32).toString('hex');
}

export function hashRefreshToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex');
}

export function refreshTokenExpiresAt(): Date {
  return new Date(Date.now() + JWT_TTL_SEC * 1000);
}
