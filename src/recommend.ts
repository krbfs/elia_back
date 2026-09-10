import type { ProfileRow, TechniqueRow as DbTechniqueRow } from './db.js';

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

const RED_MAX_AUDIO_SEC = 180;
const RED_BLOCKED_KEYWORDS = ['mindfulness', 'майндфул', 'meditation', 'медитац', ' act', 'cbt'];

export function stressZone(stress: number): StressZone {
  if (stress >= 8) return 'red';
  if (stress >= 5) return 'yellow';
  return 'green';
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

function trimesterMatches(row: TechniqueRow, trimester: string | null): boolean {
  if (row.context === 'any') return true;
  if (!trimester) return row.context === 'any';

  const tagTrimesters = (parseTags(row).trimester as string[] | undefined) ?? ['any'];
  if (tagTrimesters.includes('any')) return true;
  if (row.context === 'postpartum' || tagTrimesters.includes('postpartum')) {
    return trimester.startsWith('postpartum');
  }
  return tagTrimesters.includes(trimester) || row.context === trimester;
}

function contextMatches(row: TechniqueRow, context: string | null | undefined): boolean {
  if (!context || context === 'any') return true;
  const tagContexts = (parseTags(row).context as string[] | undefined) ?? [row.context];
  return tagContexts.includes('any') || tagContexts.includes(context) || row.context === context;
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

  const blob = `${row.title} ${row.text} ${row.evidence} ${row.tags_json}`.toLowerCase();
  return RED_BLOCKED_KEYWORDS.some((keyword) => blob.includes(keyword));
}

export function scoreTechnique(
  row: TechniqueRow,
  psychotype: string | null,
  trimester: string | null,
  context?: string | null,
): number {
  if (!trimesterMatches(row, trimester)) return -1;
  if (!contextMatches(row, context)) return -1;

  const psychotypes = psychotypesFor(row);
  let score = 0;

  if (psychotype && psychotypes.includes(psychotype)) {
    score += 3;
  } else if (psychotypes.includes('any') || psychotypes.length === 0) {
    score += 1;
  }

  const reactions = (parseTags(row).stress_reaction as string[] | undefined) ?? [row.reaction];
  if (reactions.includes('any')) {
    score += 1;
  } else {
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
  options?: { maxDuration?: number; context?: string | null },
): TechniqueRow[] {
  const psychotype = profile?.[psychotypeField] ?? null;
  const trimester = profile?.trimester ?? null;

  return pool
    .map((technique) => ({
      technique,
      score: scoreTechnique(technique, psychotype, trimester, options?.context),
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
  const pool = allTechniques.filter(
    (row) =>
      techniqueLevels(row).includes(zone) &&
      !isPremiumLocked(row, isPremium) &&
      !isRedZoneBlocked(row, zone),
  );

  const ranked = rankPool(pool, input.profile, 'base_type', { context: input.context });
  const topN = input.topN ?? 5;
  const techniques = ranked.slice(0, topN);
  const technique = techniques[0] ?? null;

  let cascade: TechniqueRow | null = null;
  if (zone === 'yellow' && input.profile?.secondary_type) {
    const cascadeRanked = rankPool(pool, input.profile, 'secondary_type', {
      maxDuration: 120,
      context: input.context,
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
  options?: { maxDuration?: number; context?: string | null },
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
