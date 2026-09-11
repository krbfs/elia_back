import { queryOne, type TechniqueUsageRow } from '../db.js';
import { stressZone } from '../recommend.js';

export type { TechniqueUsageRow };

export function parseStressLevel(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null;
  const rounded = Math.round(value);
  if (rounded < 1 || rounded > 10) return null;
  return rounded;
}

export async function logTechniqueUsage(params: {
  vkUserId: number;
  techniqueId: number;
  stressBefore: number;
  stressAfter: number;
}): Promise<TechniqueUsageRow> {
  const zone = stressZone(params.stressBefore);
  const row = await queryOne<TechniqueUsageRow>(
    `INSERT INTO technique_usage (vk_user_id, technique_id, stress_before, stress_after, zone)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING *`,
    [
      params.vkUserId,
      params.techniqueId,
      params.stressBefore,
      params.stressAfter,
      zone,
    ],
  );

  if (!row) {
    throw new Error('Failed to log technique usage');
  }

  return row;
}
