import crypto from 'node:crypto';

export type VerifiedLaunch = {
  vkUserId: number;
  platform: string | null;
};

function timingSafeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  if (left.length !== right.length) return false;
  return crypto.timingSafeEqual(left, right);
}

/**
 * Подпись параметров запуска Mini Apps:
 * HMAC-SHA256 по отсортированным vk_* , ключ — защищённый ключ приложения.
 * https://dev.vk.com/mini-apps/development/launch-params
 */
export function verifyLaunchParams(search: string, secret: string): VerifiedLaunch | null {
  if (!secret || !search) return null;

  const raw = search.startsWith('?') ? search.slice(1) : search;
  const params = new URLSearchParams(raw.includes('#') ? raw.slice(0, raw.indexOf('#')) : raw);
  const sign = params.get('sign');
  if (!sign) return null;

  const query = [...params.entries()]
    .filter(([key]) => key.startsWith('vk_'))
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, value]) => `${key}=${value}`)
    .join('&');

  const computed = crypto
    .createHmac('sha256', secret)
    .update(query)
    .digest('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');

  if (!timingSafeEqual(computed, sign)) return null;

  const vkUserId = Number(params.get('vk_user_id'));
  if (!Number.isFinite(vkUserId) || vkUserId <= 0) return null;

  return {
    vkUserId,
    platform: params.get('vk_platform'),
  };
}

export function antibotLog(kind: string, extra: Record<string, string | number | boolean | null> = {}) {
  console.log(
    JSON.stringify({
      event: 'elia_antibot',
      kind,
      ...extra,
      t: new Date().toISOString(),
    }),
  );
}
