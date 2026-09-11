import { queryOne, type ProfileRow } from '../db.js';
import { logCrisisIncident } from './incidents.js';
import { hasSustainedHighStress, logStressEntry } from './stressLog.js';

export async function recordStressLevel(vkUserId: number, stress: number): Promise<void> {
  if (!Number.isFinite(stress) || stress < 1 || stress > 10) return;

  await logStressEntry(vkUserId, stress);

  if (stress >= 9) {
    await logCrisisIncident(vkUserId, 'stress_9', String(stress), [
      'redirect_crisis',
      'block_techniques',
    ]);
    return;
  }

  const profile = await queryOne<ProfileRow>(
    'SELECT crisis_level FROM profiles WHERE vk_user_id = $1',
    [vkUserId],
  );

  if (profile?.crisis_level !== 'green') return;

  if (await hasSustainedHighStress(vkUserId)) {
    const already = await queryOne<{ exists: number }>(
      `SELECT 1 AS exists FROM crisis_incidents
       WHERE vk_user_id = $1
         AND trigger_type = 'sustained_stress_3d'
         AND created_at::date = CURRENT_DATE
       LIMIT 1`,
      [vkUserId],
    );
    if (!already) {
      await logCrisisIncident(vkUserId, 'sustained_stress_3d', null, ['green_nudge']);
    }
  }
}
