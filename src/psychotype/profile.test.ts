import { describe, expect, it } from 'vitest';
import { calculatePsychotype, emptyScores } from './core.js';
import {
  buildStoredPsychotype,
  enrichProfileResponse,
  parseStoredPsychotype,
  savePsychotypeProfile,
  serializePsychotypeResult,
} from './profile.js';
import type { ProfileRow } from '../db.js';

describe('psychotype profile (stage 2.3)', () => {
  it('serializes full psychotype payload', () => {
    const result = calculatePsychotype(emptyScores());
    const payload = serializePsychotypeResult(result);

    expect(payload.base_type).toBeTruthy();
    expect(payload.scores).toBeDefined();
    expect(payload.triad_status).toBeDefined();
  });

  it('roundtrips stored psychotype json', () => {
    const result = calculatePsychotype(emptyScores());
    const stored = buildStoredPsychotype(result);
    const json = JSON.stringify(stored);
    const parsed = parseStoredPsychotype(json);

    expect(parsed?.triad_status).toBe(result.triad_status);
    expect(parsed?.top_traits).toEqual(result.top_traits);
    expect(parsed?.conflict_profile).toBe(result.conflict_profile);
  });

  it('enriches profile response with psychotype metadata', () => {
    const result = calculatePsychotype(emptyScores());
    const row: ProfileRow = {
      vk_user_id: 42,
      trimester: 'trimester_2',
      onboarding_completed: true,
      base_type: result.base_type,
      psychotype_code: result.psychotype_code,
      secondary_type: result.secondary_type,
      scores_json: JSON.stringify(buildStoredPsychotype(result)),
      platform: 'web',
      last_stress: 4,
      techniques_completed: 0,
      crisis_level: 'green',
      epds_score: null,
      epds_completed_at: null,
      is_premium: false,
      daily_techniques_date: null,
      daily_techniques_count: 0,
      updated_at: new Date(),
    };

    const profile = enrichProfileResponse(row, 42);
    expect(profile.base_type).toBe(result.base_type);
    expect(profile.triad_status).toBe(result.triad_status);
    expect(profile.top_traits).toEqual(result.top_traits);
  });

  it.skip('overwrites profile on repeat save (requires DATABASE_URL)', async () => {

    const { initDb, query } = await import('../db.js');
    await initDb();

    const vkUserId = 900_000_888;
    await query(
      `INSERT INTO users (vk_user_id, first_name) VALUES ($1, 'Stage2')
       ON CONFLICT (vk_user_id) DO NOTHING`,
      [vkUserId],
    );

    const first = calculatePsychotype(emptyScores());
    const second = calculatePsychotype({
      ...emptyScores(),
      tr: 16,
      sen: 17,
    });

    await savePsychotypeProfile(vkUserId, first);
    const updated = await savePsychotypeProfile(vkUserId, second);

    expect(updated.base_type).toBe(second.base_type);
    expect(updated.secondary_type).toBe(second.secondary_type);
    expect(parseStoredPsychotype(updated.scores_json)?.triad_status).toBe(second.triad_status);
  });
});
