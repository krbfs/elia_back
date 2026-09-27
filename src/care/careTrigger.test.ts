import { describe, expect, it } from 'vitest';
import type { ProfileRow } from '../db.js';
import {
  CARE_TRIGGER_DAYS,
  isStressCheckDue,
  shouldShowCareTrigger,
  todayKey,
} from './careTrigger.js';

function profile(partial: Partial<ProfileRow> = {}): ProfileRow {
  return {
    vk_user_id: 1,
    crisis_level: 'green',
    last_stress: 3,
    care_trigger_shown: false,
    ...partial,
  } as ProfileRow;
}

const NOW = new Date('2026-09-27T12:00:00Z');
const daysAgo = (days: number) =>
  new Date(NOW.getTime() - days * 86_400_000).toISOString();

describe('триггер заботы (ответы 27.09, п. 3)', () => {
  it('показывается на седьмой день с регистрации', () => {
    expect(CARE_TRIGGER_DAYS).toBe(7);
    expect(shouldShowCareTrigger(profile(), daysAgo(7), NOW)).toBe(true);
    expect(shouldShowCareTrigger(profile(), daysAgo(6), NOW)).toBe(false);
    expect(shouldShowCareTrigger(profile(), daysAgo(30), NOW)).toBe(true);
  });

  it('не повторяется после закрытия', () => {
    expect(
      shouldShowCareTrigger(profile({ care_trigger_shown: true }), daysAgo(9), NOW),
    ).toBe(false);
  });

  it('молчит в красной зоне и при кризисе', () => {
    expect(shouldShowCareTrigger(profile({ last_stress: 8 }), daysAgo(9), NOW)).toBe(false);
    expect(shouldShowCareTrigger(profile({ crisis_level: 'red' }), daysAgo(9), NOW)).toBe(false);
    // Жёлтый уровень заботу не блокирует: предложения оплаты в карточке нет.
    expect(shouldShowCareTrigger(profile({ crisis_level: 'yellow' }), daysAgo(9), NOW)).toBe(true);
  });

  it('без даты регистрации не показывается', () => {
    expect(shouldShowCareTrigger(profile(), null, NOW)).toBe(false);
  });
});

describe('стресс-замер на входе (ответы 27.09, п. 4)', () => {
  it('нужен один раз в день', () => {
    expect(isStressCheckDue(profile({ stress_checked_date: null }), NOW)).toBe(true);
    expect(isStressCheckDue(profile({ stress_checked_date: todayKey(NOW) }), NOW)).toBe(false);
    expect(isStressCheckDue(profile({ stress_checked_date: '2026-09-26' }), NOW)).toBe(true);
  });
});
