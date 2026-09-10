import { describe, expect, it } from 'vitest';
import { canUseTechnique } from './billing/usage.js';
import type { ProfileRow } from './db.js';
import {
  isPremiumLocked,
  isRedZoneBlocked,
  recommendTechniques,
  scoreTechnique,
  stressZone,
  type TechniqueRow,
} from './recommend.js';

function technique(
  partial: Partial<TechniqueRow> & Pick<TechniqueRow, 'id' | 'title' | 'level'>,
): TechniqueRow {
  return {
    catalog_id: partial.catalog_id ?? partial.id,
    slug: partial.slug ?? null,
    text: partial.text ?? 'text',
    duration_sec: partial.duration_sec ?? 90,
    audio_url: partial.audio_url ?? null,
    context: partial.context ?? 'any',
    psychotypes_json: partial.psychotypes_json ?? '[]',
    reaction: partial.reaction ?? 'any',
    evidence: partial.evidence ?? '',
    is_premium: partial.is_premium ?? false,
    tags_json: partial.tags_json ?? '{}',
    created_at: partial.created_at ?? new Date(),
    ...partial,
  };
}

function profile(partial: Partial<ProfileRow> & Pick<ProfileRow, 'vk_user_id'>): ProfileRow {
  return {
    trimester: null,
    onboarding_completed: true,
    base_type: null,
    secondary_type: null,
    scores_json: null,
    platform: null,
    last_stress: null,
    techniques_completed: 0,
    crisis_level: 'green',
    epds_score: null,
    epds_completed_at: null,
    is_premium: false,
    daily_techniques_date: null,
    daily_techniques_count: 0,
    updated_at: new Date(),
    ...partial,
  };
}

describe('recommend stage 3', () => {
  it('TC-201: stress 9 maps to red zone', () => {
    expect(stressZone(9)).toBe('red');
  });

  it('TC-201: red pool excludes long audio and mindfulness-like techniques', () => {
    const pool = [
      technique({
        id: 1,
        title: 'Grounding',
        level: 'red',
        duration_sec: 120,
        psychotypes_json: '["any"]',
      }),
      technique({
        id: 2,
        title: 'Long audio',
        level: 'red',
        duration_sec: 240,
        audio_url: '/a.mp3',
        psychotypes_json: '["any"]',
      }),
      technique({
        id: 3,
        title: 'Mindfulness pause',
        level: 'red',
        duration_sec: 90,
        evidence: 'Mindfulness based stress reduction',
        psychotypes_json: '["any"]',
      }),
    ];

    const result = recommendTechniques(pool, {
      stress: 9,
      profile: profile({ vk_user_id: 1, base_type: 'Инноватор' }),
    });

    expect(result.zone).toBe('red');
    expect(result.technique?.id).toBe(1);
    expect(result.techniques.every((item) => !isRedZoneBlocked(item, 'red'))).toBe(true);
  });

  it('TC-202: yellow zone returns cascade for secondary type', () => {
    const pool = [
      technique({
        id: 1,
        title: 'Base Innovator',
        level: 'yellow',
        psychotypes_json: '["Инноватор"]',
        duration_sec: 90,
      }),
      technique({
        id: 2,
        title: 'Secondary Empath',
        level: 'yellow',
        psychotypes_json: '["Эмпат"]',
        duration_sec: 100,
      }),
      technique({
        id: 3,
        title: 'Long secondary',
        level: 'yellow',
        psychotypes_json: '["Эмпат"]',
        duration_sec: 200,
      }),
    ];

    const result = recommendTechniques(pool, {
      stress: 6,
      profile: profile({
        vk_user_id: 1,
        base_type: 'Инноватор',
        secondary_type: 'Эмпат',
        is_premium: true,
      }),
    });

    expect(result.zone).toBe('yellow');
    expect(result.technique?.title).toBe('Base Innovator');
    expect(result.cascade?.title).toBe('Secondary Empath');
  });

  it('TC-203: premium techniques filtered for free users', () => {
    const row = technique({
      id: 1,
      title: 'Premium only',
      level: 'red',
      is_premium: true,
    });

    expect(isPremiumLocked(row, false)).toBe(true);
    expect(
      recommendTechniques([row], {
        stress: 9,
        profile: profile({ vk_user_id: 1, base_type: 'Эмпат' }),
      }).technique,
    ).toBeNull();
  });

  it('TC-203: free user cannot use yellow zone', () => {
    const freeProfile = profile({ vk_user_id: 1, is_premium: false });
    expect(canUseTechnique(freeProfile, 'yellow')).toEqual({
      allowed: false,
      reason: 'premium_required',
    });
  });

  it('TC-204: psychotype-specific technique outranks universal', () => {
    const pool = [
      technique({
        id: 1,
        title: 'Universal',
        level: 'yellow',
        psychotypes_json: '["any"]',
        duration_sec: 60,
      }),
      technique({
        id: 2,
        title: 'Empath',
        level: 'yellow',
        psychotypes_json: '["Эмпат"]',
        duration_sec: 90,
      }),
    ];

    const result = recommendTechniques(pool, {
      stress: 6,
      profile: profile({ vk_user_id: 1, base_type: 'Эмпат', is_premium: true }),
    });

    expect(result.technique?.title).toBe('Empath');
    expect(scoreTechnique(pool[1], 'Эмпат', null)).toBeGreaterThan(
      scoreTechnique(pool[0], 'Эмпат', null),
    );
  });

  it('returns top-5 techniques', () => {
    const pool = Array.from({ length: 7 }, (_, index) =>
      technique({
        id: index + 1,
        title: `Technique ${index + 1}`,
        level: 'green',
        psychotypes_json: '["any"]',
        duration_sec: 60 + index,
      }),
    );

    const result = recommendTechniques(pool, {
      stress: 2,
      profile: profile({ vk_user_id: 1, base_type: 'Эмпат', is_premium: true }),
      topN: 5,
    });

    expect(result.techniques).toHaveLength(5);
  });
});
