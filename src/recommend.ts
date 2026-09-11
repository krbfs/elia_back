import type { ProfileRow, TechniqueRow as DbTechniqueRow } from './db.js';
import { parseStoredPsychotype } from './psychotype/profile.js';

export type StressZone = 'red' | 'yellow' | 'green';

export type TechniqueRow = DbTechniqueRow & { level: StressZone };

export type RecommendInput = {
  stress: number;
  profile?: ProfileRow;
  context?: string | null;
  topN?: number;
};

export type RecommendResult = {
  zone: StressZone;
  stress: number;
  techniques: TechniqueRow[];
  technique: TechniqueRow | null;
  cascade: TechniqueRow | null;
};

export type ScoreOptions = {
  context?: string | null;
  stressReaction?: string | null;
  complexProfile?: boolean;
};

/** Стресс-реакция базового психотипа (docs/02, 06). */
export const PSYCHOTYPE_STRESS_REACTIONS: Record<string, string> = {
  Индивидуалист: 'Бей',
  Инноватор: 'Дефлексия',
  'Лидер Мнений': 'Коммуницируй',
  Эстет: 'Мимикрия',
  Консерватор: 'Сливайся с толпой',
  Эмпат: 'Замри',
  Аналитик: 'Замри',
  Прагматик: 'Бей',
};

const RED_MAX_AUDIO_SEC = 180;
const COMPLEX_TECHNIQUE_KEYWORDS = ['mindfulness', 'майндфул', 'meditation', 'медитац', ' act', 'cbt'];

export function stressZone(stress: number): StressZone {
  if (stress >= 8) return 'red';
  if (stress >= 5) return 'yellow';
  return 'green';
}

export function stressReactionForPsychotype(psychotype: string | null | undefined): string | null {
  if (!psychotype) return null;
  return PSYCHOTYPE_STRESS_REACTIONS[psychotype] ?? null;
}

export function isComplexProfile(profile?: ProfileRow): boolean {
  if (!profile?.scores_json) return false;
  const stored = parseStoredPsychotype(profile.scores_json);
  return Boolean(stored?.conflict_profile || stored?.triad_status === 'complex');
}

function parsePsychotypes(raw: string): string[] {
  try {
    const parsed = JSON.parse(raw) as string[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function parseTags(row: TechniqueRow): Record<string, unknown> {
  try {
    return JSON.parse(row.tags_json || '{}') as Record<string, unknown>;
  } catch {
    return {};
  }
}

function techniqueLevels(row: TechniqueRow): StressZone[] {
  const tags = parseTags(row);
  const fromTags = (tags.level as string[] | undefined) ?? [];
  const levels = fromTags.filter(
    (value): value is StressZone => value === 'red' || value === 'yellow' || value === 'green',
  );
  if (levels.length > 0) return levels;
  return [row.level as StressZone];
}

function psychotypesFor(row: TechniqueRow): string[] {
  const fromColumn = parsePsychotypes(row.psychotypes_json);
  const fromTags = (parseTags(row).psychotypes as string[] | undefined) ?? [];
  const merged = [...fromColumn, ...fromTags];
  if (merged.includes('any')) return ['any'];
  return merged.length > 0 ? merged : ['any'];
}

export function isUniversalTechnique(row: TechniqueRow): boolean {
  const psychotypes = psychotypesFor(row);
  return psychotypes.length === 1 && psychotypes[0] === 'any';
}

function mapProfileTrimester(trimester: string): string | null {
  const map: Record<string, string> = {
    trimester_1: '1',
    trimester_2: '2',
    trimester_3: '3',
    postpartum_0_3: '0-3m',
    postpartum_3_6: '3-6m',
    postpartum_6_12: '6-12m',
  };
  return map[trimester] ?? null;
}

function trimesterMatches(row: TechniqueRow, trimester: string | null): boolean {
  const tagTrimesters = (parseTags(row).trimester as string[] | undefined) ?? ['any'];
  if (tagTrimesters.includes('any')) return true;
  if (!trimester) return false;

  const mapped = mapProfileTrimester(trimester);
  if (mapped && tagTrimesters.includes(mapped)) return true;
  if (trimester.startsWith('postpartum') && tagTrimesters.includes('postpartum')) return true;

  return tagTrimesters.includes(trimester);
}

function contextMatches(row: TechniqueRow, context: string | null | undefined): boolean {
  if (!context || context === 'any') return true;
  const tagContexts = (parseTags(row).context as string[] | undefined) ?? [row.context];
  return tagContexts.includes('any') || tagContexts.includes(context) || row.context === context;
}

function stressReactionMatches(row: TechniqueRow, userReaction: string | null | undefined): boolean {
  const reactions =
    (parseTags(row).stress_reaction as string[] | undefined) ??
    (row.reaction ? [row.reaction] : ['any']);
  if (reactions.includes('any')) return true;
  if (!userReaction) return false;
  return reactions.includes(userReaction);
}

export function isPremiumLocked(row: TechniqueRow, isPremium: boolean): boolean {
  if (isPremium) return false;
  return row.is_premium || parseTags(row).is_premium === true;
}

export function isRedZoneBlocked(row: TechniqueRow, zone: StressZone): boolean {
  if (zone !== 'red') return false;

  if (row.audio_url && row.duration_sec > RED_MAX_AUDIO_SEC) {
    return true;
  }

  return isComplexTechniqueContent(row);
}

/** Yellow crisis: block mindfulness / CBT-like «сложные» техники (doc §2). */
export function isYellowComplexTechniqueBlocked(
  row: TechniqueRow,
  crisisLevel: string | null | undefined,
): boolean {
  if (crisisLevel !== 'yellow') return false;
  return isComplexTechniqueContent(row);
}

function isComplexTechniqueContent(row: TechniqueRow): boolean {
  const blob = `${row.title} ${row.text} ${row.evidence} ${row.tags_json}`.toLowerCase();
  return COMPLEX_TECHNIQUE_KEYWORDS.some((keyword) => blob.includes(keyword));
}

export function scoreTechnique(
  row: TechniqueRow,
  psychotype: string | null,
  trimester: string | null,
  options?: ScoreOptions | string | null,
): number {
  const opts: ScoreOptions =
    typeof options === 'string' || options === null || options === undefined
      ? { context: options ?? undefined }
      : options;

  if (opts.complexProfile && !isUniversalTechnique(row)) return -1;
  if (!trimesterMatches(row, trimester)) return -1;
  if (!contextMatches(row, opts.context)) return -1;
  if (!stressReactionMatches(row, opts.stressReaction)) return -1;

  const psychotypes = psychotypesFor(row);
  let score = 0;

  if (opts.complexProfile) {
    score += 2;
  } else if (psychotype && psychotypes.includes(psychotype)) {
    score += 3;
  } else if (psychotypes.includes('any') || psychotypes.length === 0) {
    score += 1;
  }

  const reactions =
    (parseTags(row).stress_reaction as string[] | undefined) ??
    (row.reaction ? [row.reaction] : ['any']);
  if (reactions.includes('any')) {
    score += 1;
  } else if (opts.stressReaction && reactions.includes(opts.stressReaction)) {
    score += 2;
  }

  if (row.duration_sec <= 120) {
    score += 1;
  }

  return score;
}

function rankPool(
  pool: TechniqueRow[],
  profile: ProfileRow | undefined,
  psychotypeField: 'base_type' | 'secondary_type',
  options?: { maxDuration?: number; context?: string | null; complexProfile?: boolean },
): TechniqueRow[] {
  const psychotype = profile?.[psychotypeField] ?? null;
  const trimester = profile?.trimester ?? null;
  const complexProfile = options?.complexProfile ?? isComplexProfile(profile);
  const stressReaction = stressReactionForPsychotype(complexProfile ? null : psychotype);

  return pool
    .map((technique) => ({
      technique,
      score: scoreTechnique(technique, psychotype, trimester, {
        context: options?.context,
        stressReaction,
        complexProfile,
      }),
    }))
    .filter(({ score, technique }) => {
      if (score < 0) return false;
      if (options?.maxDuration && technique.duration_sec > options.maxDuration) return false;
      return true;
    })
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      return a.technique.duration_sec - b.technique.duration_sec;
    })
    .map(({ technique }) => technique);
}

export function recommendTechniques(
  allTechniques: TechniqueRow[],
  input: RecommendInput,
): RecommendResult {
  let zone = stressZone(input.stress);
  if (input.profile?.crisis_level === 'yellow' && zone === 'green') {
    zone = 'yellow';
  }

  const isPremium = Boolean(input.profile?.is_premium);
  const complexProfile = isComplexProfile(input.profile);
  const pool = allTechniques.filter(
    (row) =>
      techniqueLevels(row).includes(zone) &&
      !isPremiumLocked(row, isPremium) &&
      !isRedZoneBlocked(row, zone) &&
      !isYellowComplexTechniqueBlocked(row, input.profile?.crisis_level) &&
      (!complexProfile || isUniversalTechnique(row)),
  );

  const ranked = rankPool(pool, input.profile, 'base_type', {
    context: input.context,
    complexProfile,
  });
  const topN = input.topN ?? 5;
  const techniques = ranked.slice(0, topN);
  const technique = techniques[0] ?? null;

  let cascade: TechniqueRow | null = null;
  if (zone === 'yellow' && input.profile?.secondary_type && !complexProfile) {
    const cascadeRanked = rankPool(pool, input.profile, 'secondary_type', {
      maxDuration: 120,
      context: input.context,
      complexProfile: false,
    });
    cascade = cascadeRanked.find((item) => item.id !== technique?.id) ?? null;
  }

  return {
    zone,
    stress: input.stress,
    techniques,
    technique,
    cascade,
  };
}

/** @deprecated Use recommendTechniques().technique */
export function pickTechnique(
  techniques: TechniqueRow[],
  profile: ProfileRow | undefined,
  psychotypeField: 'base_type' | 'secondary_type',
  options?: { maxDuration?: number; context?: string | null; complexProfile?: boolean },
): TechniqueRow | null {
  return rankPool(techniques, profile, psychotypeField, options)[0] ?? null;
}

export function serializeTechnique(row: TechniqueRow) {
  return {
    id: row.id,
    catalog_id: row.catalog_id,
    title: row.title,
    text: row.text,
    duration_sec: row.duration_sec,
    audio_url: row.audio_url,
    level: row.level,
    context: row.context,
    psychotypes: psychotypesFor(row),
    reaction: row.reaction,
    evidence: row.evidence,
    is_premium: row.is_premium,
  };
}
