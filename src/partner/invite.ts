import crypto from 'node:crypto';
import { query, queryOne } from '../db.js';
import type { PartnerProfileRow } from '../db.js';

export const PARTNER_INVITE_TTL_DAYS = 30;

export type PartnerInviteRecord = {
  invite_token: string;
  expires_at: string;
  linked_user_vk_id: number;
};

export type PartnerInviteValidation =
  | {
      valid: true;
      expired: false;
      linked_user_vk_id: number;
      expires_at: string;
    }
  | {
      valid: false;
      expired: boolean;
      linked_user_vk_id: number | null;
      reason: 'not_found' | 'expired';
    };

export function generateInviteToken(): string {
  return crypto.randomBytes(16).toString('hex');
}

export function inviteExpiresAt(from = new Date()): Date {
  const expires = new Date(from);
  expires.setUTCDate(expires.getUTCDate() + PARTNER_INVITE_TTL_DAYS);
  return expires;
}

export async function createPartnerInvite(vkUserId: number): Promise<PartnerInviteRecord> {
  const token = generateInviteToken();
  const expires = inviteExpiresAt();

  await query(
    'INSERT INTO users (vk_user_id) VALUES ($1) ON CONFLICT (vk_user_id) DO NOTHING',
    [vkUserId],
  );

  const existing = await queryOne<PartnerProfileRow>(
    'SELECT * FROM partner_profiles WHERE user_vk_id = $1',
    [vkUserId],
  );

  if (existing) {
    await query(
      `UPDATE partner_profiles SET
        invite_token = $1,
        invite_expires_at = $2,
        updated_at = NOW()
       WHERE user_vk_id = $3`,
      [token, expires.toISOString(), vkUserId],
    );
  } else {
    await query(
      `INSERT INTO partner_profiles (user_vk_id, invite_token, invite_expires_at)
       VALUES ($1, $2, $3)`,
      [vkUserId, token, expires.toISOString()],
    );
  }

  return {
    invite_token: token,
    expires_at: expires.toISOString(),
    linked_user_vk_id: vkUserId,
  };
}

export async function validatePartnerInvite(token: string): Promise<PartnerInviteValidation> {
  if (typeof token !== 'string' || token.length !== 32) {
    return { valid: false, expired: false, linked_user_vk_id: null, reason: 'not_found' };
  }

  const row = await queryOne<PartnerProfileRow>(
    'SELECT * FROM partner_profiles WHERE invite_token = $1',
    [token],
  );

  if (!row?.invite_expires_at) {
    return { valid: false, expired: false, linked_user_vk_id: null, reason: 'not_found' };
  }

  const expiresAt = new Date(row.invite_expires_at);
  if (Number.isNaN(expiresAt.getTime()) || expiresAt.getTime() < Date.now()) {
    return {
      valid: false,
      expired: true,
      linked_user_vk_id: row.user_vk_id,
      reason: 'expired',
    };
  }

  return {
    valid: true,
    expired: false,
    linked_user_vk_id: row.user_vk_id,
    expires_at: expiresAt.toISOString(),
  };
}

export async function resolvePartnerInviteUserId(token: string): Promise<number | null> {
  const validation = await validatePartnerInvite(token);
  return validation.valid ? validation.linked_user_vk_id : null;
}
