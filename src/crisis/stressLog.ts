import { query, queryAll } from '../db.js';

export type StressDayEntry = {
  date: string;
  stress: number;
};

/** Pure helper for TC-303: 3 consecutive calendar days with stress >= threshold. */
export function hasConsecutiveHighStressDays(
  entries: StressDayEntry[],
  days = 3,
  threshold = 7,
): boolean {
  if (entries.length < days) return false;

  const byDate = new Map<string, number>();
  for (const entry of entries) {
    const prev = byDate.get(entry.date);
    if (prev === undefined || entry.stress > prev) {
      byDate.set(entry.date, entry.stress);
    }
  }

  const highDays = [...byDate.entries()]
    .filter(([, stress]) => stress >= threshold)
    .map(([date]) => date)
    .sort();

  if (highDays.length < days) return false;

  for (let i = 0; i <= highDays.length - days; i += 1) {
    let consecutive = true;
    for (let j = 1; j < days; j += 1) {
      const prev = new Date(`${highDays[i + j - 1]}T12:00:00Z`);
      const next = new Date(`${highDays[i + j]}T12:00:00Z`);
      const diffDays = Math.round((next.getTime() - prev.getTime()) / 86_400_000);
      if (diffDays !== 1) {
        consecutive = false;
        break;
      }
    }
    if (consecutive) return true;
  }

  return false;
}

export async function logStressEntry(vkUserId: number, stressLevel: number): Promise<void> {
  if (!Number.isFinite(stressLevel) || stressLevel < 1 || stressLevel > 10) return;

  await query(
    `INSERT INTO stress_log (vk_user_id, stress_level, logged_date)
     VALUES ($1, $2, CURRENT_DATE)
     ON CONFLICT (vk_user_id, logged_date)
     DO UPDATE SET stress_level = GREATEST(stress_log.stress_level, EXCLUDED.stress_level)`,
    [vkUserId, stressLevel],
  );
}

export async function getRecentStressEntries(vkUserId: number, lookbackDays = 7): Promise<StressDayEntry[]> {
  const rows = await queryAll<{ logged_date: string; stress_level: number }>(
    `SELECT logged_date::text AS logged_date, stress_level
     FROM stress_log
     WHERE vk_user_id = $1
       AND logged_date >= CURRENT_DATE - $2::int
     ORDER BY logged_date ASC`,
    [vkUserId, lookbackDays],
  );

  return rows.map((row) => ({ date: row.logged_date.slice(0, 10), stress: row.stress_level }));
}

export async function hasSustainedHighStress(vkUserId: number): Promise<boolean> {
  const entries = await getRecentStressEntries(vkUserId, 7);
  return hasConsecutiveHighStressDays(entries, 3, 7);
}
