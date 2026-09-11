import { query } from '../db.js';

export type CrisisTriggerType =
  | 'stress_9'
  | 'epds_red'
  | 'epds_yellow'
  | 'sustained_stress_3d'
  | 'client_action';

export async function logCrisisIncident(
  vkUserId: number,
  triggerType: CrisisTriggerType | string,
  triggerValue: string | null | undefined,
  actionsTaken: string[],
): Promise<void> {
  await query(
    `INSERT INTO crisis_incidents (vk_user_id, trigger_type, trigger_value, actions_taken)
     VALUES ($1, $2, $3, $4)`,
    [vkUserId, triggerType, triggerValue ?? null, JSON.stringify(actionsTaken)],
  );
}
