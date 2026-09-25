import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import type { ProfileRow } from './db.js';
import { recommendTechniques, scoreTechnique, type TechniqueRow } from './recommend.js';

/**
 * Функциональный прогон выдачи на настоящем каталоге: юнит-тесты проверяют правила на
 * синтетических техниках, здесь — что на 40 реальных записях ничего запрещённого не всплывает.
 */
const DATA_DIR = join(dirname(fileURLToPath(import.meta.url)), '../data');
const DURATION_SEC: Record<string, number> = { short: 90, medium: 180, long: 300 };

type CatalogTechnique = {
  technique_id: number;
  title: string;
  slug?: string;
  description?: string;
  scientific_basis?: string;
  content?: { text?: string; timer_seconds?: number; audio_duration_seconds?: number; audio_url?: string };
  tags: Record<string, unknown>;
};

function loadCatalogRows(): TechniqueRow[] {
  const raw = JSON.parse(
    readFileSync(join(DATA_DIR, 'techniques_catalog.json'), 'utf8'),
  ) as { techniques: CatalogTechnique[] };

  return raw.techniques.map((item) => {
    const tags = item.tags;
    const content = item.content ?? {};
    const levels = (tags.level as string[] | undefined) ?? ['yellow'];
    const contexts = (tags.context as string[] | undefined) ?? ['any'];
    const reactions = (tags.stress_reaction as string[] | undefined) ?? ['any'];

    return {
      id: item.technique_id,
      catalog_id: item.technique_id,
      slug: item.slug ?? null,
      title: item.title,
      text: content.text ?? item.description ?? '',
      duration_sec:
        content.timer_seconds ??
        content.audio_duration_seconds ??
        DURATION_SEC[(tags.duration as string | undefined) ?? 'medium'] ??
        120,
      audio_url: content.audio_url ?? null,
      level: levels[0],
      context: contexts[0],
      psychotypes_json: JSON.stringify(tags.psychotypes ?? []),
      reaction: reactions[0],
      evidence: item.scientific_basis ?? '',
      is_premium: Boolean(tags.is_premium),
      tags_json: JSON.stringify(tags),
      created_at: new Date(),
    } as TechniqueRow;
  });
}

function profile(partial: Partial<ProfileRow>): ProfileRow {
  return {
    vk_user_id: 1,
    trimester: null,
    onboarding_completed: true,
    base_type: null,
    psychotype_code: null,
    secondary_type: null,
    scores_json: null,
    platform: null,
    last_stress: null,
    techniques_completed: 0,
    crisis_level: 'green',
    epds_score: null,
    epds_completed_at: null,
    is_premium: true,
    daily_techniques_date: null,
    daily_techniques_count: 0,
    updated_at: new Date(),
    ...partial,
  } as ProfileRow;
}

const CATALOG = loadCatalogRows();

describe('выдача на реальном каталоге', () => {
  it('каталог загружается целиком', () => {
    expect(CATALOG).toHaveLength(40);
  });

  it('в красной зоне 1-го триместра выдаётся только сенсомоторика', () => {
    const { techniques } = recommendTechniques(CATALOG, {
      stress: 9,
      profile: profile({ trimester: 'trimester_1' }),
    });

    expect(techniques.length).toBeGreaterThan(0);
    for (const row of techniques) {
      const tags = JSON.parse(row.tags_json ?? '{}');
      expect(tags.is_sensorimotor).toBe(true);
      expect(tags.level).toContain('red');
    }
  });

  it('в 1-м триместре и 0–3 мес не всплывают длинные текстовые практики', () => {
    const longText = CATALOG.filter((row) => {
      const tags = JSON.parse(row.tags_json ?? '{}');
      return tags.duration === 'long' && (tags.format as string[] | undefined)?.includes('text');
    });
    expect(longText.map((row) => row.id)).toEqual([17, 26]);

    for (const period of ['trimester_1', 'postpartum_0_3']) {
      for (const stress of [2, 5, 9]) {
        const { techniques } = recommendTechniques(CATALOG, {
          stress,
          profile: profile({ trimester: period }),
        });
        const blocked = techniques.filter((row) => longText.some((item) => item.id === row.id));
        expect(blocked).toEqual([]);
      }
    }

    // В остальных периодах они доступны.
    for (const row of longText) {
      expect(scoreTechnique(row, null, 'trimester_3')).toBeGreaterThan(-1);
    }
  });

  it('каждый психотип получает непустую выдачу в зелёной и жёлтой зоне', () => {
    const types = [
      'Индивидуалист',
      'Инноватор',
      'Лидер Мнений',
      'Эстет',
      'Консерватор',
      'Эмпат',
      'Аналитик',
      'Прагматик',
    ];

    for (const type of types) {
      for (const stress of [3, 6]) {
        const { techniques } = recommendTechniques(CATALOG, {
          stress,
          profile: profile({ base_type: type, trimester: 'trimester_2' }),
        });
        expect(techniques.length, `${type} / стресс ${stress}`).toBeGreaterThan(0);
      }
    }
  });

  it('бонус за формат не вытесняет техники своего психотипа', () => {
    const { techniques } = recommendTechniques(CATALOG, {
      stress: 3,
      profile: profile({ base_type: 'Аналитик', trimester: 'trimester_2' }),
    });

    const own = techniques.filter((row) =>
      (JSON.parse(row.psychotypes_json ?? '[]') as string[]).includes('Аналитик'),
    );
    expect(own.length).toBeGreaterThan(0);
    // Техники своего типа стоят выше универсальных, формат добавляет лишь 1 балл.
    const firstUniversal = techniques.findIndex((row) =>
      (JSON.parse(row.psychotypes_json ?? '[]') as string[]).includes('any'),
    );
    const lastOwn = techniques.reduce(
      (acc, row, index) =>
        (JSON.parse(row.psychotypes_json ?? '[]') as string[]).includes('Аналитик') ? index : acc,
      -1,
    );
    if (firstUniversal !== -1) expect(lastOwn).toBeLessThan(firstUniversal);
  });

  it('без подписки премиум-техники не попадают в выдачу, а подарок их открывает', () => {
    const premiumIds = CATALOG.filter((row) => row.is_premium).map((row) => row.id);
    expect(premiumIds).toHaveLength(15);

    const free = recommendTechniques(CATALOG, {
      stress: 3,
      profile: profile({ is_premium: false, trimester: 'trimester_2' }),
    }).techniques;
    expect(free.some((row) => premiumIds.includes(row.id))).toBe(false);

    // Пул из одной премиум-техники зелёной зоны: без подарка пусто, с подарком она выдаётся.
    const gifted = CATALOG.find((row) => {
      const tags = JSON.parse(row.tags_json ?? '{}');
      return (
        row.is_premium &&
        (tags.level as string[]).includes('green') &&
        scoreTechnique(row, null, 'trimester_2') > -1
      );
    });
    expect(gifted).toBeDefined();
    const soloPool = [gifted as TechniqueRow];
    const freeUser = profile({ is_premium: false, trimester: 'trimester_2' });

    expect(recommendTechniques(soloPool, { stress: 3, profile: freeUser }).techniques).toEqual([]);
    expect(
      recommendTechniques(soloPool, {
        stress: 3,
        profile: freeUser,
        unlockedTechniqueIds: [(gifted as TechniqueRow).id],
      }).techniques.map((row) => row.id),
    ).toEqual([(gifted as TechniqueRow).id]);
  });
});
