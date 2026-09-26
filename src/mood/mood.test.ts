import { describe, expect, it } from 'vitest';
import {
  LOW_MOOD_DAYS,
  LOW_MOOD_MAX_SCORE,
  MOOD_OPTIONS,
  hasConsecutiveLowMoodDays,
  isValidMoodScore,
  type MoodEntry,
} from './mood.js';

function entry(date: string, mood_score: number): MoodEntry {
  return { date, mood_score, note: null };
}

describe('дневник настроения', () => {
  it('шкала — ровно 5 вариантов из screen_texts, два нижних считаются снижением', () => {
    expect(MOOD_OPTIONS.map((option) => option.label)).toEqual([
      'Отлично',
      'Хорошо',
      'Нормально',
      'Грустно',
      'Плохо',
    ]);
    expect(MOOD_OPTIONS.filter((option) => option.score <= LOW_MOOD_MAX_SCORE)).toHaveLength(2);
    expect(MOOD_OPTIONS.map((option) => option.emoji)).toContain('😔');
    expect(MOOD_OPTIONS.map((option) => option.emoji)).toContain('😡');
  });

  it('оценка принимается только как целое 1–5', () => {
    expect(isValidMoodScore(1)).toBe(true);
    expect(isValidMoodScore(5)).toBe(true);
    expect(isValidMoodScore(0)).toBe(false);
    expect(isValidMoodScore(6)).toBe(false);
    expect(isValidMoodScore(3.5)).toBe(false);
    expect(isValidMoodScore('3')).toBe(false);
  });

  it('три дня подряд с «Грустно» или «Плохо» дают зелёный триггер (§10.2)', () => {
    expect(
      hasConsecutiveLowMoodDays([
        entry('2026-09-20', 2),
        entry('2026-09-21', 1),
        entry('2026-09-22', 2),
      ]),
    ).toBe(true);

    // Пропущенный день разрывает серию, как и в правиле по стрессу.
    expect(
      hasConsecutiveLowMoodDays([
        entry('2026-09-20', 2),
        entry('2026-09-21', 1),
        entry('2026-09-23', 2),
      ]),
    ).toBe(false);

    // «Нормально» в середине тоже разрывает.
    expect(
      hasConsecutiveLowMoodDays([
        entry('2026-09-20', 2),
        entry('2026-09-21', 3),
        entry('2026-09-22', 1),
        entry('2026-09-23', 2),
      ]),
    ).toBe(false);

    expect(hasConsecutiveLowMoodDays([entry('2026-09-20', 1), entry('2026-09-21', 1)])).toBe(false);
    expect(LOW_MOOD_DAYS).toBe(3);
  });

  it('серия ищется в любом месте окна, а не только в конце', () => {
    expect(
      hasConsecutiveLowMoodDays([
        entry('2026-09-18', 2),
        entry('2026-09-19', 2),
        entry('2026-09-20', 1),
        entry('2026-09-21', 5),
        entry('2026-09-22', 4),
      ]),
    ).toBe(true);
  });
});
