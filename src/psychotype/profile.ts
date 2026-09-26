import { query, queryOne, type ProfileRow } from '../db.js';
import type { PsychotypeResult } from './types.js';

export type StoredPsychotype = {
  normalized: PsychotypeResult['scores'];
  raw: PsychotypeResult['raw_scores'];
  psychotype_code: PsychotypeResult['psychotype_code'];
  top_traits: PsychotypeResult['top_traits'];
  base_traits: PsychotypeResult['base_traits'];
  secondary_traits: PsychotypeResult['secondary_traits'];
  triad: PsychotypeResult['triad'];
  triad_status: PsychotypeResult['triad_status'];
  triad_variant: PsychotypeResult['triad_variant'];
  expression_level: PsychotypeResult['expression_level'];
  conflict_profile: PsychotypeResult['conflict_profile'];
  conflict_reason: PsychotypeResult['conflict_reason'];
  recommendation: PsychotypeResult['recommendation'];
};

export function serializePsychotypeResult(result: PsychotypeResult) {
  return {
    base_type: result.base_type,
    psychotype_code: result.psychotype_code,
    secondary_type: result.secondary_type,
    scores: result.scores,
    raw_scores: result.raw_scores,
    top_traits: result.top_traits,
    base_traits: result.base_traits,
    secondary_traits: result.secondary_traits,
    triad: result.triad,
    triad_status: result.triad_status,
    triad_variant: result.triad_variant,
    expression_level: result.expression_level,
    conflict_profile: result.conflict_profile,
    conflict_reason: result.conflict_reason,
    recommendation: result.recommendation,
  };
}

export function buildStoredPsychotype(result: PsychotypeResult): StoredPsychotype {
  return {
    normalized: result.scores,
    raw: result.raw_scores,
    psychotype_code: result.psychotype_code,
    top_traits: result.top_traits,
    base_traits: result.base_traits,
    secondary_traits: result.secondary_traits,
    triad: result.triad,
    triad_status: result.triad_status,
    triad_variant: result.triad_variant,
    expression_level: result.expression_level,
    conflict_profile: result.conflict_profile,
    conflict_reason: result.conflict_reason,
    recommendation: result.recommendation,
  };
}

export function parseStoredPsychotype(scoresJson: string | null): StoredPsychotype | null {
  if (!scoresJson) return null;

  try {
    const parsed = JSON.parse(scoresJson) as Partial<StoredPsychotype>;
    if (!parsed.normalized || !parsed.raw) return null;
    return {
      normalized: parsed.normalized,
      raw: parsed.raw,
      psychotype_code: parsed.psychotype_code ?? 'complex',
      top_traits: parsed.top_traits ?? [],
      base_traits: parsed.base_traits ?? ['agr', 'sp'],
      secondary_traits: parsed.secondary_traits ?? null,
      triad: parsed.triad ?? null,
      triad_status: parsed.triad_status ?? 'stable',
      triad_variant: parsed.triad_variant ?? null,
      expression_level: parsed.expression_level ?? null,
      conflict_profile: Boolean(parsed.conflict_profile),
      conflict_reason: parsed.conflict_reason ?? null,
      recommendation: parsed.recommendation ?? null,
    };
  } catch {
    return null;
  }
}

export async function savePsychotypeProfile(
  vkUserId: number,
  result: PsychotypeResult,
): Promise<ProfileRow> {
  const scoresJson = JSON.stringify(buildStoredPsychotype(result));

  const existing = await queryOne<ProfileRow>(
    'SELECT * FROM profiles WHERE vk_user_id = $1',
    [vkUserId],
  );

  if (existing) {
    await query(
      `UPDATE profiles SET
        base_type = $1,
        psychotype_code = $2,
        secondary_type = $3,
        scores_json = $4,
        onboarding_completed = TRUE,
        psychotype_updated_at = NOW(),
        updated_at = NOW()
      WHERE vk_user_id = $5`,
      [
        result.base_type,
        result.psychotype_code,
        result.secondary_type,
        scoresJson,
        vkUserId,
      ],
    );
  } else {
    await query(
      `INSERT INTO profiles (
        vk_user_id, base_type, psychotype_code, secondary_type, scores_json,
        onboarding_completed, psychotype_updated_at
      ) VALUES ($1, $2, $3, $4, $5, TRUE, NOW())`,
      [
        vkUserId,
        result.base_type,
        result.psychotype_code,
        result.secondary_type,
        scoresJson,
      ],
    );
  }

  return (await queryOne<ProfileRow>('SELECT * FROM profiles WHERE vk_user_id = $1', [
    vkUserId,
  ]))!;
}

export function enrichProfileResponse(row: ProfileRow | undefined, vkUserId: number) {
  const stored = parseStoredPsychotype(row?.scores_json ?? null);

  return {
    vk_user_id: row?.vk_user_id ?? vkUserId,
    trimester: row?.trimester ?? null,
    onboarding_completed: Boolean(row?.onboarding_completed),
    base_type: row?.base_type ?? null,
    psychotype_code: row?.psychotype_code ?? stored?.psychotype_code ?? null,
    secondary_type: row?.secondary_type ?? null,
    scores_json: row?.scores_json ?? null,
    platform: row?.platform ?? null,
    last_stress: row?.last_stress ?? null,
    techniques_completed: row?.techniques_completed ?? 0,
    crisis_level: row?.crisis_level ?? 'green',
    epds_score: row?.epds_score ?? null,
    epds_completed_at: row?.epds_completed_at ?? null,
    is_premium: Boolean(row?.is_premium),
    updated_at: row?.updated_at ?? null,
    psychotype_updated_at: row?.psychotype_updated_at ?? null,
    top_traits: stored?.top_traits ?? null,
    base_traits: stored?.base_traits ?? null,
    secondary_traits: stored?.secondary_traits ?? null,
    triad: stored?.triad ?? null,
    triad_status: stored?.triad_status ?? null,
    triad_variant: stored?.triad_variant ?? null,
    expression_level: stored?.expression_level ?? null,
    conflict_profile: stored?.conflict_profile ?? null,
    conflict_reason: stored?.conflict_reason ?? null,
    recommendation: stored?.recommendation ?? null,
  };
}
