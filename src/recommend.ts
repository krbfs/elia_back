import type { ProfileRow, TechniqueRow as DbTechniqueRow } from './db.js';
import { parseStoredPsychotype } from './psychotype/profile.js';
import type { ExpressionLevel } from './psychotype/types.js';

export type StressZone = 'red' | 'yellow' | 'green';

export type TechniqueRow = DbTechniqueRow;

export type RecommendInput = {
  stress: number;
  profile?: ProfileRow;
  context?: string | null;
  /** Ответ на вопрос «Что тебе сейчас больше всего нужно?» (экран #5). */
  feeling?: string | null;
  /** id техник, которые женщина уже проходила. */
  usedTechniqueIds?: number[];
  topN?: number;
  /** Техники, открытые подарком (§9.4): премиум-замок для них не действует. */
  unlockedTechniqueIds?: number[];
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
  /** Одна реакция или несколько — вариант «хочу быть рядом» покрывает две. */
  stressReaction?: string | string[] | null;
  complexProfile?: boolean;
  /** Техники, которые женщина уже проходила: новизна даёт +0.5 (ответы 27.09, п. 2). */
  usedTechniqueIds?: Set<number> | number[];
};

/**
 * Уточняющий вопрос «Что тебе сейчас больше всего нужно?» (экран #5) → теги каталога.
 * Финальный маппинг из ответов 27.09, п. 1: выбор женщины важнее реакции по психотипу.
 */
export const STRESS_REACTION_MAPPING: Record<string, { reactions: string[]; psychotypes: string[] }> =
  {
    active_action: { reactions: ['Бей'], psychotypes: ['Индивидуалист', 'Прагматик'] },
    freeze: { reactions: ['Замри'], psychotypes: ['Эмпат', 'Аналитик'] },
    social_safety: {
      reactions: ['Мимикрия', 'Сливайся с толпой'],
      psychotypes: ['Эстет', 'Консерватор'],
    },
    verbal_switch: {
      reactions: ['Дефлексия', 'Коммуницируй'],
      psychotypes: ['Инноватор', 'Лидер Мнений'],
    },
  };

export function reactionsForFeeling(feeling: string | null | undefined): string[] | null {
  if (!feeling) return null;
  return STRESS_REACTION_MAPPING[feeling]?.reactions ?? null;
}

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
/** Бонусы из ответов 27.09, п. 2. */
export const NOVELTY_BONUS = 0.5;
export const PREMIUM_BONUS = 0.3;
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

export function expressionLevelFor(profile?: ProfileRow): ExpressionLevel | null {
  if (!profile?.scores_json) return null;
  return parseStoredPsychotype(profile.scores_json)?.expression_level ?? null;
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

/**
 * Периоды с ограничением когнитивной нагрузки (Навигатор §3.1, ответы 25.09 п. 3):
 * 1-й триместр и первые 3 месяца после родов.
 */
const LOW_COGNITIVE_LOAD_PERIODS = new Set(['1', '0-3m']);

/** Предпочтительный формат подачи по психотипу (§8.3) — мягкий бонус, не фильтр. */
const PREFERRED_FORMATS: Record<string, string[]> = {
  Индивидуалист: ['video', 'interactive'],
  Инноватор: ['interactive', 'video'],
  'Лидер Мнений': ['audio'],
  Эстет: ['interactive'],
  Консерватор: ['text'],
  Эмпат: ['audio', 'text'],
  Аналитик: ['text'],
  Прагматик: ['text', 'timer'],
};

function periodKey(trimester: string | null | undefined): string | null {
  if (!trimester) return null;
  return mapProfileTrimester(trimester) ?? trimester;
}

function formatsFor(row: TechniqueRow): string[] {
  return (parseTags(row).format as string[] | undefined) ?? [];
}

/** Длинные текстовые практики блокируются в 1-м триместре и 0–3 мес. */
export function isCognitiveLoadBlocked(
  row: TechniqueRow,
  trimester: string | null | undefined,
): boolean {
  const period = periodKey(trimester);
  if (!period || !LOW_COGNITIVE_LOAD_PERIODS.has(period)) return false;
  return parseTags(row).duration === 'long' && formatsFor(row).includes('text');
}

export function isSensorimotorTechnique(row: TechniqueRow): boolean {
  return parseTags(row).is_sensorimotor === true;
}

/** В 1-м триместре в красной зоне выдаём только сенсомоторные техники. */
export function isNonSensorimotorBlocked(
  row: TechniqueRow,
  zone: StressZone,
  trimester: string | null | undefined,
): boolean {
  if (zone !== 'red') return false;
  if (periodKey(trimester) !== '1') return false;
  return !isSensorimotorTechnique(row);
}

export function matchesPreferredFormat(
  row: TechniqueRow,
  psychotype: string | null | undefined,
): boolean {
  if (!psychotype) return false;
  const preferred = PREFERRED_FORMATS[psychotype];
  if (!preferred) return false;
  return formatsFor(row).some((format) => preferred.includes(format));
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

function userReactions(value: string | string[] | null | undefined): string[] {
  if (!value) return [];
  return Array.isArray(value) ? value : [value];
}

function stressReactionMatches(
  row: TechniqueRow,
  userReaction: string | string[] | null | undefined,
): boolean {
  const reactions = techniqueReactions(row);
  if (reactions.includes('any')) return true;
  const mine = userReactions(userReaction);
  if (mine.length === 0) return false;
  return mine.some((value) => reactions.includes(value));
}

function techniqueReactions(row: TechniqueRow): string[] {
  return (
    (parseTags(row).stress_reaction as string[] | undefined) ??
    (row.reaction ? [row.reaction] : ['any'])
  );
}

export function isPremiumLocked(row: TechniqueRow, isPremium: boolean): boolean {
  if (isPremium) return false;
  return row.is_premium || parseTags(row).is_premium === true;
}

/** Аудио-техники — ценность подписки (ответы 27.09, п. 8): без Premium только текст. */
export function isAudioPremiumLocked(row: TechniqueRow, isPremium: boolean): boolean {
  if (isPremium) return false;
  return Boolean(row.audio_url) || formatsFor(row).includes('audio');
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
  if (isCognitiveLoadBlocked(row, trimester)) return -1;
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

  const reactions = techniqueReactions(row);
  if (reactions.includes('any')) {
    score += 1;
  } else if (userReactions(opts.stressReaction).some((value) => reactions.includes(value))) {
    score += 2;
  }

  if (row.duration_sec <= 120) {
    score += 1;
  }

  // §8.3: предпочтительный формат — мягкий бонус, психотип всегда весомее.
  if (!opts.complexProfile && matchesPreferredFormat(row, psychotype)) {
    score += 1;
  }

  // Ответы 27.09, п. 2: новизна +0.5, премиум-техника +0.3 — оба слабее психотипа (+3).
  const used = opts.usedTechniqueIds;
  const alreadyUsed = used instanceof Set ? used.has(row.id) : Boolean(used?.includes(row.id));
  if (!alreadyUsed) {
    score += NOVELTY_BONUS;
  }
  if (row.is_premium || parseTags(row).is_premium === true) {
    score += PREMIUM_BONUS;
  }

  return score;
}

function rankPool(
  pool: TechniqueRow[],
  profile: ProfileRow | undefined,
  psychotypeField: 'base_type' | 'secondary_type',
  options?: {
    maxDuration?: number;
    context?: string | null;
    complexProfile?: boolean;
    feeling?: string | null;
    usedTechniqueIds?: Set<number>;
  },
): TechniqueRow[] {
  const psychotype = profile?.[psychotypeField] ?? null;
  const trimester = profile?.trimester ?? null;
  const complexProfile = options?.complexProfile ?? isComplexProfile(profile);
  // Выбор женщины на экране #5 важнее дефолтной реакции психотипа.
  const stressReaction: string | string[] | null =
    reactionsForFeeling(options?.feeling) ??
    stressReactionForPsychotype(complexProfile ? null : psychotype);

  const ranked = pool
    .map((technique) => ({
      technique,
      score: scoreTechnique(technique, psychotype, trimester, {
        context: options?.context,
        stressReaction,
        complexProfile,
        usedTechniqueIds: options?.usedTechniqueIds,
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

  // TC-206: выраженный уровень → только техники своего психотипа, если они есть.
  if (!complexProfile && psychotype && expressionLevelFor(profile) === 'выраженный') {
    const personalized = ranked.filter((row) => psychotypesFor(row).includes(psychotype));
    if (personalized.length > 0) return personalized;
  }

  return ranked;
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
  const unlocked = new Set(input.unlockedTechniqueIds ?? []);
  const pool = allTechniques.filter(
    (row) =>
      techniqueLevels(row).includes(zone) &&
      (!isPremiumLocked(row, isPremium) || unlocked.has(row.id)) &&
      (!isAudioPremiumLocked(row, isPremium) || unlocked.has(row.id)) &&
      !isRedZoneBlocked(row, zone) &&
      !isNonSensorimotorBlocked(row, zone, input.profile?.trimester) &&
      !isYellowComplexTechniqueBlocked(row, input.profile?.crisis_level) &&
      (!complexProfile || isUniversalTechnique(row)),
  );

  const used = new Set(input.usedTechniqueIds ?? []);
  const ranked = rankPool(pool, input.profile, 'base_type', {
    context: input.context,
    complexProfile,
    feeling: input.feeling,
    usedTechniqueIds: used,
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
      feeling: input.feeling,
      usedTechniqueIds: used,
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
    is_premium: row.is_premium,
  };
}
