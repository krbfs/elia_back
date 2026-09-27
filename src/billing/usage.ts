import { queryOne, type ProfileRow } from '../db.js';
import type { StressZone } from '../recommend.js';

/**
 * Модель доступа (ответы 27.09, п. 8):
 *   зелёная зона  — бесплатно без ограничений (формируем привычку к профилактике);
 *   жёлтая зона   — бесплатно 3 техники в неделю;
 *   красная зона  — бесплатно 1 экстренная техника в сутки;
 *   аудио-техники — только Premium.
 * Лимиты считаем по зоне, а не по всем прохождениям: зелёная техника утром
 * не должна отнимать экстренную технику вечером.
 */
export const FREE_DAILY_RED_LIMIT = 1;
export const FREE_WEEKLY_YELLOW_LIMIT = 3;

export type FreeUsage = {
  redToday: number;
  yellowWeek: number;
};

export type AccessReason = 'crisis_red' | 'daily_limit' | 'weekly_limit';

export type AccessDecision =
  | { allowed: true }
  | { allowed: false; reason: AccessReason };

export const EMPTY_USAGE: FreeUsage = { redToday: 0, yellowWeek: 0 };

export function canUseTechnique(
  profile: ProfileRow | undefined,
  zone: StressZone,
  usage: FreeUsage = EMPTY_USAGE,
): AccessDecision {
  if (profile?.crisis_level === 'red') {
    return { allowed: false, reason: 'crisis_red' };
  }

  if (profile?.is_premium) {
    return { allowed: true };
  }

  if (zone === 'green') {
    return { allowed: true };
  }

  if (zone === 'yellow') {
    return usage.yellowWeek >= FREE_WEEKLY_YELLOW_LIMIT
      ? { allowed: false, reason: 'weekly_limit' }
      : { allowed: true };
  }

  return usage.redToday >= FREE_DAILY_RED_LIMIT
    ? { allowed: false, reason: 'daily_limit' }
    : { allowed: true };
}

/** Сколько бесплатных техник осталось в зоне; null — без ограничений. */
export function remainingFor(
  profile: ProfileRow | undefined,
  zone: StressZone,
  usage: FreeUsage = EMPTY_USAGE,
): number | null {
  if (profile?.is_premium || zone === 'green') return null;
  if (zone === 'yellow') {
    return Math.max(0, FREE_WEEKLY_YELLOW_LIMIT - usage.yellowWeek);
  }
  return Math.max(0, FREE_DAILY_RED_LIMIT - usage.redToday);
}

export async function getFreeUsage(vkUserId: number): Promise<FreeUsage> {
  const row = await queryOne<{ red_today: number; yellow_week: number }>(
    `SELECT
       COUNT(*) FILTER (WHERE zone = 'red' AND created_at >= date_trunc('day', NOW())) AS red_today,
       COUNT(*) FILTER (WHERE zone = 'yellow' AND created_at >= NOW() - INTERVAL '7 days') AS yellow_week
     FROM technique_usage
     WHERE vk_user_id = $1`,
    [vkUserId],
  );

  return {
    redToday: Number(row?.red_today ?? 0),
    yellowWeek: Number(row?.yellow_week ?? 0),
  };
}
