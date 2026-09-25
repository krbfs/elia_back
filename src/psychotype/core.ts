import type {
  ExpressionLevel,
  PsychotypeCode,
  PsychotypeResult,
  TraitKey,
  TraitScores,
  TriadStatus,
} from './types.js';

export type { PsychotypeCode, TraitKey, TraitScores } from './types.js';

export const TRAIT_LABELS: Record<TraitKey, string> = {
  agr: 'Агрессивность',
  sp: 'Спонтанность',
  ex: 'Экстраверсия',
  lab: 'Лабильность',
  tr: 'Тревожность',
  sen: 'Чувствительность',
  in: 'Интроверсия',
  rig: 'Ригидность',
};

export const MAX_POSSIBLE: Record<TraitKey, number> = {
  agr: 18,
  sp: 9,
  ex: 8,
  lab: 9,
  tr: 16,
  sen: 17,
  in: 10,
  rig: 16,
};

export const LAB_IN_MULTIPLIER = 1.33;

const TYPE_PAIRS: { traits: [TraitKey, TraitKey]; name: string; code: PsychotypeCode }[] = [
  { traits: ['agr', 'sp'], name: 'Индивидуалист', code: 'individualist' },
  { traits: ['sp', 'ex'], name: 'Инноватор', code: 'innovator' },
  { traits: ['ex', 'lab'], name: 'Лидер Мнений', code: 'leader' },
  { traits: ['lab', 'tr'], name: 'Эстет', code: 'esthete' },
  { traits: ['tr', 'sen'], name: 'Консерватор', code: 'conservator' },
  { traits: ['sen', 'in'], name: 'Эмпат', code: 'empath' },
  { traits: ['in', 'rig'], name: 'Аналитик', code: 'analyst' },
  { traits: ['rig', 'agr'], name: 'Прагматик', code: 'pragmatist' },
];

/** Порядок тенденций на круге Собчик: позиция = индекс + 1 (03_Диагностика §3.1). */
const TRAIT_RING: TraitKey[] = ['agr', 'sp', 'ex', 'lab', 'tr', 'sen', 'in', 'rig'];

/**
 * Пороги из 03_Диагностика v2.0 §3.1 и §5.1.
 * В документе нормализация 0..1, внутри проекта 0..10 — значения умножены на 10.
 */
export const TRIAD_THRESHOLD = 5.5;
const EXPRESSED_MIN = 7;
const MODERATE_MIN = 5;
const BLURRED_MAX_GAP = 1;
const TIE_EPSILON = 0.1;

export const CONFLICT_BASE_TYPE = 'Не определен (конфликт)';
export const COMPLEX_BASE_TYPE = 'complex';
export const CONFLICT_RECOMMENDATION = 'Пройдите опросник повторно в спокойном состоянии';

function position(trait: TraitKey): number {
  return TRAIT_RING.indexOf(trait) + 1;
}

function traitKey(traits: TraitKey[]): string {
  return [...traits].sort().join('-');
}

function positionsKey(traits: TraitKey[]): string {
  return [...traits]
    .map(position)
    .sort((a, b) => a - b)
    .join('-');
}

function traitsText(traits: TraitKey[]): string {
  return [...traits]
    .sort((a, b) => position(a) - position(b))
    .map((trait) => `${TRAIT_LABELS[trait]} (${position(trait)})`)
    .join(' + ');
}

export function emptyScores(): TraitScores {
  return { agr: 0, sp: 0, ex: 0, lab: 0, tr: 0, sen: 0, in: 0, rig: 0 };
}

export function traitTypeName(a: TraitKey, b: TraitKey): string {
  const found = TYPE_PAIRS.find(
    ({ traits: [t1, t2] }) => (t1 === a && t2 === b) || (t1 === b && t2 === a),
  );
  return found?.name ?? COMPLEX_BASE_TYPE;
}

export function psychotypeCodeFor(name: string): PsychotypeCode {
  return TYPE_PAIRS.find((pair) => pair.name === name)?.code ?? 'complex';
}

export function normalizeScores(raw: TraitScores): TraitScores {
  const adjusted = { ...raw };
  adjusted.lab *= LAB_IN_MULTIPLIER;
  adjusted.in *= LAB_IN_MULTIPLIER;

  const normalized = emptyScores();
  for (const key of TRAIT_RING) {
    normalized[key] = (adjusted[key] / MAX_POSSIBLE[key]) * 10;
  }
  return normalized;
}

/**
 * Сортировка по убыванию нормализованных баллов.
 * Краевой случай (§5.1): разница меньше порога → сырые баллы → порядок круга.
 */
function sortTraits(normalized: TraitScores, raw?: TraitScores): TraitKey[] {
  return [...TRAIT_RING].sort((a, b) => {
    const diff = normalized[b] - normalized[a];
    if (Math.abs(diff) >= TIE_EPSILON) return diff;
    if (raw) {
      const rawDiff = raw[b] - raw[a];
      if (rawDiff !== 0) return rawDiff;
    }
    return position(a) - position(b);
  });
}

function logAmbiguity(sorted: TraitKey[], normalized: TraitScores, raw: TraitScores): void {
  for (let i = 0; i < 3 && i + 1 < sorted.length; i += 1) {
    const first = sorted[i];
    const second = sorted[i + 1];
    if (Math.abs(normalized[first] - normalized[second]) >= TIE_EPSILON) continue;
    if (raw[first] !== raw[second]) continue;
    console.info(
      `INFO: Обнаружена неоднозначность между ${TRAIT_LABELS[first]} и ${TRAIT_LABELS[second]}. Выбрана ${TRAIT_LABELS[first]} по приоритету`,
    );
  }
}

export function topTraits(scores: TraitScores, count: number): TraitKey[] {
  return sortTraits(scores).slice(0, count);
}

export function areAdjacentTraits(a: TraitKey, b: TraitKey): boolean {
  const diff = Math.abs(position(a) - position(b));
  return diff === 1 || diff === 7;
}

/** Антагонистические пары 1-5, 2-6, 3-7, 4-8 (Навигатор v4.3 §2.3). */
export function areAntagonisticTraits(a: TraitKey, b: TraitKey): boolean {
  return Math.abs(position(a) - position(b)) === 4;
}

export function hasAntagonisticPair(traits: TraitKey[]): boolean {
  for (let i = 0; i < traits.length; i += 1) {
    for (let j = i + 1; j < traits.length; j += 1) {
      if (areAntagonisticTraits(traits[i], traits[j])) return true;
    }
  }
  return false;
}

export function resolveBaseTraits(
  normalized: TraitScores,
  raw?: TraitScores,
): [TraitKey, TraitKey] {
  const sorted = sortTraits(normalized, raw);
  return [sorted[0], sorted[1]];
}

/** Триада формируется только если 3-я тенденция прошла порог (§3.1, шаг 6). */
function resolveTriad(sorted: TraitKey[], normalized: TraitScores): TraitKey[] | null {
  if (sorted.length < 3) return null;
  if (normalized[sorted[2]] < TRIAD_THRESHOLD) return null;
  return sorted.slice(0, 3);
}

function expressionLevel(sorted: TraitKey[], normalized: TraitScores): ExpressionLevel {
  const top1 = normalized[sorted[0]];
  const top2 = normalized[sorted[1]];
  const top3 = sorted[2] ? normalized[sorted[2]] : 0;

  if (top1 >= EXPRESSED_MIN && top2 >= EXPRESSED_MIN) return 'выраженный';
  if (top1 >= MODERATE_MIN && top2 >= MODERATE_MIN) return 'умеренный';
  if (Math.abs(top2 - top3) < BLURRED_MAX_GAP) return 'смазанный';
  return 'умеренный';
}

/**
 * Сопутствующий тип: слайдеры (1–10) подменяют баллы топ-2, затем пересортировка (§3.1, шаг 7).
 * Без слайдеров (опросник партнёра) берём следующую пару по убыванию.
 */
function resolveSecondary(
  normalized: TraitScores,
  baseTraits: [TraitKey, TraitKey],
  sliderValues: Partial<Record<TraitKey, number>> | null,
  allowFallback: boolean,
): { type: string; traits: [TraitKey, TraitKey] } | null {
  const hasSliders = Boolean(
    sliderValues && baseTraits.some((trait) => sliderValues[trait] !== undefined),
  );

  let traits: [TraitKey, TraitKey];
  if (hasSliders) {
    const withSliders = { ...normalized };
    for (const trait of baseTraits) {
      const value = sliderValues![trait];
      if (value !== undefined) withSliders[trait] = value;
    }
    const sorted = sortTraits(withSliders);
    traits = [sorted[0], sorted[1]];
  } else if (allowFallback) {
    const sorted = sortTraits(normalized);
    traits = [sorted[2], sorted[3]];
  } else {
    return null;
  }

  if (!areAdjacentTraits(traits[0], traits[1])) {
    return { type: COMPLEX_BASE_TYPE, traits };
  }
  return { type: traitTypeName(traits[0], traits[1]), traits };
}

function buildResult(
  rawScores: TraitScores,
  sliderValues: Partial<Record<TraitKey, number>> | null,
  allowSecondaryFallback: boolean,
): PsychotypeResult {
  const normalized = normalizeScores(rawScores);
  const sorted = sortTraits(normalized, rawScores);
  logAmbiguity(sorted, normalized, rawScores);

  const baseTraits: [TraitKey, TraitKey] = [sorted[0], sorted[1]];
  const adjacent = areAdjacentTraits(baseTraits[0], baseTraits[1]);
  const antagonistic = areAntagonisticTraits(baseTraits[0], baseTraits[1]);
  const triad = resolveTriad(sorted, normalized);
  const conflictTriad = triad !== null && hasAntagonisticPair(triad);
  const conflictProfile = antagonistic || conflictTriad;

  let baseType: string;
  let code: PsychotypeCode;
  if (antagonistic) {
    baseType = CONFLICT_BASE_TYPE;
    code = 'complex';
  } else if (!adjacent) {
    baseType = COMPLEX_BASE_TYPE;
    code = 'complex';
  } else {
    baseType = traitTypeName(baseTraits[0], baseTraits[1]);
    code = psychotypeCodeFor(baseType);
  }

  let conflictReason: string | null = null;
  if (antagonistic) {
    conflictReason = `Обнаружена антагонистическая пара в топ-2: ${traitsText(baseTraits)}`;
  } else if (conflictTriad) {
    conflictReason = `Обнаружена конфликтная триада: ${traitsText(triad!)}`;
  }

  if (conflictTriad) {
    console.info(
      `INFO: Conflict triad detected (${positionsKey(triad!)}), profile saved with conflict flag`,
    );
  }

  const triadStatus: TriadStatus = conflictProfile
    ? 'conflict'
    : adjacent
      ? 'stable'
      : 'complex';

  const secondary =
    code === 'complex'
      ? null
      : resolveSecondary(normalized, baseTraits, sliderValues, allowSecondaryFallback);

  return {
    base_type: baseType,
    psychotype_code: code,
    secondary_type: secondary?.type ?? null,
    scores: normalized,
    raw_scores: rawScores,
    top_traits: [...baseTraits],
    base_traits: baseTraits,
    secondary_traits: secondary?.traits ?? null,
    triad,
    triad_status: triadStatus,
    triad_variant: triad ? traitKey(triad) : null,
    expression_level: code === 'complex' ? null : expressionLevel(sorted, normalized),
    conflict_profile: conflictProfile,
    conflict_reason: conflictReason,
    recommendation: conflictProfile ? CONFLICT_RECOMMENDATION : null,
  };
}

/** Опросник партнёра: те же 10 вопросов, слайдеры не используются (§1.3). */
export function calculateSubjectivePsychotype(rawScores: TraitScores): PsychotypeResult {
  return buildResult(rawScores, null, true);
}

export function calculatePsychotype(
  rawScores: TraitScores,
  sliderValues: Partial<Record<TraitKey, number>> = {},
): PsychotypeResult {
  return buildResult(rawScores, sliderValues, false);
}
