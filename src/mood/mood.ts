import { query, queryAll, queryOne } from '../db.js';

/**
 * Дневник настроения (screen_texts.json #24, ответы методолога 25.09 п. 8):
 * шкала из 5 эмодзи + необязательная заметка, отображение — только календарь с отметками.
 * Графиков и недельных сводок в MVP нет: принцип энергосбережения §8.1.
 */
export const MOOD_OPTIONS = [
  { score: 5, emoji: '😊', label: 'Отлично' },
  { score: 4, emoji: '🙂', label: 'Хорошо' },
  { score: 3, emoji: '😐', label: 'Нормально' },
  { score: 2, emoji: '😔', label: 'Грустно' },
  { score: 1, emoji: '😡', label: 'Плохо' },
] as const;

/** Два самых низких варианта («😔 Грустно» и «😡 Плохо») — сигнал для зелёного триггера. */
export const LOW_MOOD_MAX_SCORE = 2;
export const LOW_MOOD_DAYS = 3;
export const MOOD_NOTE_MAX_LENGTH = 500;

export type MoodEntry = {
  date: string;
  mood_score: number;
  note: string | null;
};

export function isValidMoodScore(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 1 && value <= 5;
}

/**
 * §10.2: снижение настроения три дня подряд — мягкое предложение пройти EPDS.
 * Пропущенный день разрывает серию, как и в правиле по стрессу.
 */
export function hasConsecutiveLowMoodDays(
  entries: MoodEntry[],
  days = LOW_MOOD_DAYS,
  maxScore = LOW_MOOD_MAX_SCORE,
): boolean {
  const lowDays = [
    ...new Set(
      entries.filter((entry) => entry.mood_score <= maxScore).map((entry) => entry.date.slice(0, 10)),
    ),
  ].sort();

  if (lowDays.length < days) return false;

  for (let i = 0; i <= lowDays.length - days; i += 1) {
    let consecutive = true;
    for (let j = 1; j < days; j += 1) {
      const prev = new Date(`${lowDays[i + j - 1]}T12:00:00Z`);
      const next = new Date(`${lowDays[i + j]}T12:00:00Z`);
      if (Math.round((next.getTime() - prev.getTime()) / 86_400_000) !== 1) {
        consecutive = false;
        break;
      }
    }
    if (consecutive) return true;
  }

  return false;
}

export async function saveMoodEntry(
  vkUserId: number,
  moodScore: number,
  note?: string | null,
): Promise<MoodEntry | null> {
  if (!isValidMoodScore(moodScore)) return null;

  const trimmed = typeof note === 'string' ? note.trim().slice(0, MOOD_NOTE_MAX_LENGTH) : null;
  const saved = await queryOne<{ logged_date: string; mood_score: number; note: string | null }>(
    `INSERT INTO mood_entries (vk_user_id, mood_score, note, logged_date)
     VALUES ($1, $2, $3, CURRENT_DATE)
     ON CONFLICT (vk_user_id, logged_date) DO UPDATE
       SET mood_score = EXCLUDED.mood_score, note = EXCLUDED.note, updated_at = NOW()
     RETURNING logged_date::text AS logged_date, mood_score, note`,
    [vkUserId, moodScore, trimmed && trimmed.length > 0 ? trimmed : null],
  );

  if (!saved) return null;
  return { date: saved.logged_date.slice(0, 10), mood_score: saved.mood_score, note: saved.note };
}

export async function getMoodEntries(vkUserId: number, lookbackDays = 60): Promise<MoodEntry[]> {
  const rows = await queryAll<{ logged_date: string; mood_score: number; note: string | null }>(
    `SELECT logged_date::text AS logged_date, mood_score, note
     FROM mood_entries
     WHERE vk_user_id = $1 AND logged_date >= CURRENT_DATE - $2::int
     ORDER BY logged_date ASC`,
    [vkUserId, lookbackDays],
  );

  return rows.map((row) => ({
    date: row.logged_date.slice(0, 10),
    mood_score: row.mood_score,
    note: row.note,
  }));
}

export async function hasSustainedLowMood(vkUserId: number): Promise<boolean> {
  const entries = await getMoodEntries(vkUserId, 7);
  return hasConsecutiveLowMoodDays(entries);
}

export async function deleteMoodEntries(vkUserId: number): Promise<void> {
  await query('DELETE FROM mood_entries WHERE vk_user_id = $1', [vkUserId]);
}
