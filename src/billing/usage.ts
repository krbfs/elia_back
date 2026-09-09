import { db, type ProfileRow } from '../db.js';

export const FREE_DAILY_EMERGENCY_LIMIT = 1;

function todayKey(): string {
  return new Date().toISOString().slice(0, 10);
}

export function getDailyUsage(row: ProfileRow | undefined) {
  const today = todayKey();
  const date = row?.daily_techniques_date ?? null;
  const count = date === today ? (row?.daily_techniques_count ?? 0) : 0;
  return {
    date: today,
    count,
    remaining: Math.max(0, FREE_DAILY_EMERGENCY_LIMIT - count),
  };
}

export function canUseTechnique(
  profile: ProfileRow | undefined,
  stressZone: 'red' | 'yellow' | 'green',
): { allowed: boolean; reason?: 'premium_required' | 'daily_limit' | 'crisis_red' } {
  if (profile?.crisis_level === 'red') {
    return { allowed: false, reason: 'crisis_red' };
  }

  if (profile?.is_premium) {
    return { allowed: true };
  }

  if (stressZone !== 'red') {
    return { allowed: false, reason: 'premium_required' };
  }

  const usage = getDailyUsage(profile);
  if (usage.count >= FREE_DAILY_EMERGENCY_LIMIT) {
    return { allowed: false, reason: 'daily_limit' };
  }

  return { allowed: true };
}

export function incrementDailyUsage(vkUserId: number, profile: ProfileRow | undefined) {
  if (profile?.is_premium) return;

  const today = todayKey();
  const existing =
    profile?.daily_techniques_date === today
      ? (profile?.daily_techniques_count ?? 0)
      : 0;

  db.prepare(`
    UPDATE profiles
    SET daily_techniques_date = ?,
        daily_techniques_count = ?,
        updated_at = datetime('now')
    WHERE vk_user_id = ?
  `).run(today, existing + 1, vkUserId);
}
