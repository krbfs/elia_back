import crypto from 'node:crypto';
import { query, queryAll, queryOne } from '../db.js';
import type { TechniqueGiftRow } from '../db.js';

/**
 * Механика «Подари технику» (Навигатор v4.3 §9.4): пользователь отправляет технику подруге,
 * получатель активирует её на 7 дней бесплатно. Без лидербордов, счётчиков и личных данных.
 */
export const GIFT_TOKEN_TTL_DAYS = 7;
export const GIFT_ACCESS_DAYS = 7;

export type GiftValidation =
  | { valid: true; gift: TechniqueGiftRow }
  | { valid: false; reason: 'not_found' | 'expired' | 'used' };

export type GiftActivation =
  | { ok: true; technique_id: number; access_expires_at: string }
  | { ok: false; reason: 'not_found' | 'expired' | 'used' | 'own_gift' };

export function generateGiftToken(): string {
  return crypto.randomBytes(16).toString('hex');
}

function plusDays(days: number, from = new Date()): Date {
  const date = new Date(from);
  date.setUTCDate(date.getUTCDate() + days);
  return date;
}

export function giftTokenExpiresAt(from = new Date()): Date {
  return plusDays(GIFT_TOKEN_TTL_DAYS, from);
}

export function giftAccessExpiresAt(from = new Date()): Date {
  return plusDays(GIFT_ACCESS_DAYS, from);
}

export function isGiftAccessActive(
  gift: Pick<TechniqueGiftRow, 'access_expires_at'>,
  now = new Date(),
): boolean {
  if (!gift.access_expires_at) return false;
  const expires = new Date(gift.access_expires_at);
  return !Number.isNaN(expires.getTime()) && expires.getTime() > now.getTime();
}

export async function createGift(
  senderVkId: number,
  techniqueId: number,
): Promise<TechniqueGiftRow | null> {
  const technique = await queryOne<{ id: number }>(
    'SELECT id FROM techniques WHERE id = $1',
    [techniqueId],
  );
  if (!technique) return null;

  await query(
    'INSERT INTO users (vk_user_id) VALUES ($1) ON CONFLICT (vk_user_id) DO NOTHING',
    [senderVkId],
  );

  const created = await queryOne<TechniqueGiftRow>(
    `INSERT INTO technique_gifts (token, technique_id, sender_vk_id, token_expires_at)
     VALUES ($1, $2, $3, $4)
     RETURNING *`,
    [generateGiftToken(), techniqueId, senderVkId, giftTokenExpiresAt().toISOString()],
  );
  return created ?? null;
}

export async function validateGift(token: string): Promise<GiftValidation> {
  if (typeof token !== 'string' || token.length !== 32) {
    return { valid: false, reason: 'not_found' };
  }

  const gift = await queryOne<TechniqueGiftRow>(
    'SELECT * FROM technique_gifts WHERE token = $1',
    [token],
  );
  if (!gift) return { valid: false, reason: 'not_found' };
  if (gift.activated_at) return { valid: false, reason: 'used' };

  const expires = new Date(gift.token_expires_at);
  if (Number.isNaN(expires.getTime()) || expires.getTime() < Date.now()) {
    return { valid: false, reason: 'expired' };
  }

  return { valid: true, gift };
}

export async function activateGift(
  token: string,
  recipientVkId: number,
): Promise<GiftActivation> {
  const validation = await validateGift(token);
  if (!validation.valid) return { ok: false, reason: validation.reason };

  const { gift } = validation;
  // Подарок себе не даёт доступа: иначе премиум открывается в один клик.
  if (gift.sender_vk_id === recipientVkId) return { ok: false, reason: 'own_gift' };

  await query(
    'INSERT INTO users (vk_user_id) VALUES ($1) ON CONFLICT (vk_user_id) DO NOTHING',
    [recipientVkId],
  );

  const accessExpires = giftAccessExpiresAt();
  await query(
    `UPDATE technique_gifts
     SET recipient_vk_id = $1, activated_at = NOW(), access_expires_at = $2
     WHERE token = $3 AND activated_at IS NULL`,
    [recipientVkId, accessExpires.toISOString(), token],
  );

  return {
    ok: true,
    technique_id: gift.technique_id,
    access_expires_at: accessExpires.toISOString(),
  };
}

/** Техники, открытые получателю прямо сейчас: используются как обход премиум-замка. */
export async function giftedTechniqueIds(recipientVkId: number): Promise<number[]> {
  const rows = await queryAll<{ technique_id: number }>(
    `SELECT technique_id FROM technique_gifts
     WHERE recipient_vk_id = $1 AND access_expires_at > NOW()`,
    [recipientVkId],
  );
  return rows.map((row) => row.technique_id);
}

export async function activeGiftsFor(recipientVkId: number): Promise<TechniqueGiftRow[]> {
  return queryAll<TechniqueGiftRow>(
    `SELECT * FROM technique_gifts
     WHERE recipient_vk_id = $1 AND access_expires_at > NOW()
     ORDER BY access_expires_at DESC`,
    [recipientVkId],
  );
}
