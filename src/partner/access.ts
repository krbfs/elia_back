import { queryOne } from '../db.js';

export type PartnerTipsAccess = {
  has_premium: boolean;
  /** Кто оплатил подписку: сама женщина или партнёр (Архитектура подсказок §4.3). */
  paid_by: 'user' | 'partner' | null;
};

/**
 * Premium-доступ к подсказкам открыт, если подписка есть у женщины ИЛИ у связанного партнёра.
 * Данные женщины при этом партнёру не отдаются — только подсказки по её психотипу.
 */
export async function partnerTipsAccess(userVkId: number): Promise<PartnerTipsAccess> {
  const own = await queryOne<{ is_premium: boolean }>(
    'SELECT is_premium FROM profiles WHERE vk_user_id = $1',
    [userVkId],
  );
  if (own?.is_premium) return { has_premium: true, paid_by: 'user' };

  const link = await queryOne<{ partner_vk_id: number | null }>(
    'SELECT partner_vk_id FROM partner_profiles WHERE user_vk_id = $1',
    [userVkId],
  );
  if (!link?.partner_vk_id) return { has_premium: false, paid_by: null };

  const partner = await queryOne<{ is_premium: boolean }>(
    'SELECT is_premium FROM profiles WHERE vk_user_id = $1',
    [link.partner_vk_id],
  );
  if (partner?.is_premium) return { has_premium: true, paid_by: 'partner' };

  return { has_premium: false, paid_by: null };
}
