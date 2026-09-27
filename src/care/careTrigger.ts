import { query, queryOne, type ProfileRow, type UserRow } from '../db.js';

/**
 * Триггер заботы (Навигатор §9.2, финальная спецификация из ответов 27.09, п. 3):
 * на 7-й день с регистрации один раз предлагаем подарить технику близкому.
 * Без упоминания оплаты — VK Pay ещё нет — и никогда в красной зоне.
 */
export const CARE_TRIGGER_DAYS = 7;
export const CARE_TRIGGER_TEXT = {
  title: '💜 Подарите технику тому, кто вас поддерживает',
  body: 'Вы используете Элию уже неделю. Поделитесь заботой с тем, кто рядом.',
  accept: 'Подарить технику',
  dismiss: 'Не сейчас',
};

export function daysSince(date: Date | string | null | undefined, now = new Date()): number | null {
  if (!date) return null;
  const started = typeof date === 'string' ? new Date(date) : date;
  if (Number.isNaN(started.getTime())) return null;
  return Math.floor((now.getTime() - started.getTime()) / 86_400_000);
}

export function shouldShowCareTrigger(
  profile: ProfileRow | undefined,
  registeredAt: Date | string | null | undefined,
  now = new Date(),
): boolean {
  if (profile?.care_trigger_shown) return false;

  const days = daysSince(registeredAt, now);
  if (days === null || days < CARE_TRIGGER_DAYS) return false;

  // Красная зона: никаких предложений, даже без оплаты.
  if (profile?.crisis_level === 'red') return false;
  if ((profile?.last_stress ?? 0) >= 8) return false;

  return true;
}

export async function careTriggerDue(vkUserId: number, profile: ProfileRow | undefined) {
  const user = await queryOne<UserRow>('SELECT * FROM users WHERE vk_user_id = $1', [vkUserId]);
  return shouldShowCareTrigger(profile, user?.created_at ?? null);
}

export async function markCareTriggerShown(vkUserId: number): Promise<void> {
  await query(
    `INSERT INTO profiles (vk_user_id, care_trigger_shown) VALUES ($1, TRUE)
     ON CONFLICT (vk_user_id) DO UPDATE SET care_trigger_shown = TRUE, updated_at = NOW()`,
    [vkUserId],
  );
}

/** Стресс-замер на входе — не чаще раза в день (§8.1, ответы 27.09, п. 4). */
export function todayKey(now = new Date()): string {
  return now.toISOString().slice(0, 10);
}

export function isStressCheckDue(profile: ProfileRow | undefined, now = new Date()): boolean {
  return (profile?.stress_checked_date ?? null) !== todayKey(now);
}

export async function markStressChecked(vkUserId: number): Promise<void> {
  await query('UPDATE profiles SET stress_checked_date = $1 WHERE vk_user_id = $2', [
    todayKey(),
    vkUserId,
  ]);
}
