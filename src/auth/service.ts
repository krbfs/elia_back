import { query, queryOne, type UserRow } from '../db.js';
import {
  hashRefreshToken,
  issueAccessToken,
  issueRefreshToken,
  refreshTokenExpiresAt,
} from './jwt.js';
import { verifyVkAccessToken } from './vk.js';

export type AuthTokens = {
  access_token: string;
  refresh_token: string;
  token_type: 'Bearer';
  expires_in: number;
  user: UserRow;
};

const TOKEN_TTL_SEC = 30 * 24 * 60 * 60;

async function upsertUser(
  vkUserId: number,
  firstName?: string,
  lastName?: string,
): Promise<UserRow> {
  const existing = await queryOne<UserRow>(
    'SELECT * FROM users WHERE vk_user_id = $1',
    [vkUserId],
  );

  if (existing) {
    await query(
      `UPDATE users SET first_name = $1, last_name = $2, updated_at = NOW() WHERE vk_user_id = $3`,
      [firstName ?? existing.first_name, lastName ?? existing.last_name, vkUserId],
    );
  } else {
    await query(
      `INSERT INTO users (vk_user_id, first_name, last_name) VALUES ($1, $2, $3)`,
      [vkUserId, firstName ?? null, lastName ?? null],
    );
  }

  return (await queryOne<UserRow>('SELECT * FROM users WHERE vk_user_id = $1', [vkUserId]))!;
}

async function storeRefreshToken(vkUserId: number, refreshToken: string) {
  await query(
    `INSERT INTO auth_refresh_tokens (token_hash, vk_user_id, expires_at)
     VALUES ($1, $2, $3)
     ON CONFLICT (token_hash) DO UPDATE SET expires_at = EXCLUDED.expires_at`,
    [hashRefreshToken(refreshToken), vkUserId, refreshTokenExpiresAt()],
  );
}

export async function authenticateWithVkToken(accessToken: string): Promise<AuthTokens> {
  const vkUser = await verifyVkAccessToken(accessToken);
  const user = await upsertUser(vkUser.id, vkUser.first_name, vkUser.last_name);
  const refreshToken = issueRefreshToken();
  await storeRefreshToken(user.vk_user_id, refreshToken);

  return {
    access_token: issueAccessToken(user.vk_user_id),
    refresh_token: refreshToken,
    token_type: 'Bearer',
    expires_in: TOKEN_TTL_SEC,
    user,
  };
}

export async function authenticateDevUser(payload: {
  vk_user_id: number;
  first_name?: string;
  last_name?: string;
}): Promise<AuthTokens> {
  const user = await upsertUser(payload.vk_user_id, payload.first_name, payload.last_name);
  const refreshToken = issueRefreshToken();
  await storeRefreshToken(user.vk_user_id, refreshToken);

  return {
    access_token: issueAccessToken(user.vk_user_id),
    refresh_token: refreshToken,
    token_type: 'Bearer',
    expires_in: TOKEN_TTL_SEC,
    user,
  };
}

export async function refreshAuth(refreshToken: string): Promise<AuthTokens> {
  const row = await queryOne<{ vk_user_id: number; expires_at: Date | string }>(
    `SELECT vk_user_id, expires_at FROM auth_refresh_tokens WHERE token_hash = $1`,
    [hashRefreshToken(refreshToken)],
  );

  if (!row) {
    throw new Error('Refresh token not found');
  }

  if (new Date(row.expires_at).getTime() <= Date.now()) {
    await query('DELETE FROM auth_refresh_tokens WHERE token_hash = $1', [
      hashRefreshToken(refreshToken),
    ]);
    throw new Error('Refresh token expired');
  }

  const user = await queryOne<UserRow>('SELECT * FROM users WHERE vk_user_id = $1', [
    row.vk_user_id,
  ]);
  if (!user) {
    throw new Error('User not found');
  }

  const nextRefreshToken = issueRefreshToken();
  await query('DELETE FROM auth_refresh_tokens WHERE token_hash = $1', [
    hashRefreshToken(refreshToken),
  ]);
  await storeRefreshToken(user.vk_user_id, nextRefreshToken);

  return {
    access_token: issueAccessToken(user.vk_user_id),
    refresh_token: nextRefreshToken,
    token_type: 'Bearer',
    expires_in: TOKEN_TTL_SEC,
    user,
  };
}
