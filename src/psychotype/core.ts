import type {
  ExpressionLevel,
  PsychotypeResult,
  TraitKey,
  TraitScores,
  TriadStatus,
} from './types.js';

export const TRAIT_LABELS: Record<TraitKey, string> = {
  agr: 'Агрессивность',
  sp: 'Спонтанность',
  ex: 'Экстраверсия',
  lab: 'Лабильность',
  tr: 'Тревожность',
  sen: 'Сензитивность',
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

const TYPE_PAIRS: { traits: [TraitKey, TraitKey]; name: string }[] = [
  { traits: ['agr', 'sp'], name: 'Индивидуалист' },
  { traits: ['sp', 'ex'], name: 'Инноватор' },
  { traits: ['ex', 'lab'], name: 'Лидер Мнений' },
  { traits: ['lab', 'tr'], name: 'Эстет' },
  { traits: ['tr', 'sen'], name: 'Консерватор' },
  { traits: ['sen', 'in'], name: 'Эмпат' },
  { traits: ['in', 'rig'], name: 'Аналитик' },
  { traits: ['rig', 'agr'], name: 'Прагматик' },
];

const TRAIT_RING: TraitKey[] = ['agr', 'sp', 'ex', 'lab', 'tr', 'sen', 'in', 'rig'];

const TRAIT_ORDER: TraitKey[] = ['agr', 'sp', 'ex', 'lab', 'tr', 'sen', 'in', 'rig'];

function triadKey(traits: TraitKey[]): string {
  return [...traits].sort().join('-');
}

const IMPOSSIBLE_TRIADS = new Set([
  triadKey(['agr', 'tr', 'sen']),
  triadKey(['sp', 'lab', 'rig']),
]);

const ANTAGONISTIC_PAIRS: [TraitKey, TraitKey][] = [
  ['agr', 'in'],
  ['sp', 'rig'],
  ['ex', 'in'],
];

function pairKey(a: TraitKey, b: TraitKey): string {
  return [a, b].sort().join('-');
}

export function emptyScores(): TraitScores {
  return { agr: 0, sp: 0, ex: 0, lab: 0, tr: 0, sen: 0, in: 0, rig: 0 };
}

export function traitTypeName(a: TraitKey, b: TraitKey): string {
  const found = TYPE_PAIRS.find(
    ({ traits: [t1, t2] }) => (t1 === a && t2 === b) || (t1 === b && t2 === a),
  );
  return found?.name ?? 'Смешанный профиль';
}

export function normalizeScores(raw: TraitScores): TraitScores {
  const adjusted = { ...raw };
  adjusted.lab *= LAB_IN_MULTIPLIER;
  adjusted.in *= LAB_IN_MULTIPLIER;

  const normalized = emptyScores();
  for (const key of TRAIT_ORDER) {
    normalized[key] = (adjusted[key] / MAX_POSSIBLE[key]) * 10;
  }
  return normalized;
}

export function topTraits(scores: TraitScores, count: number): TraitKey[] {
  return [...TRAIT_ORDER]
    .sort((a, b) => {
      const diff = scores[b] - scores[a];
      if (diff !== 0) return diff;
      return TRAIT_ORDER.indexOf(a) - TRAIT_ORDER.indexOf(b);
    })
    .slice(0, count);
}

export function areAdjacentTraits(a: TraitKey, b: TraitKey): boolean {
  const left = TRAIT_RING.indexOf(a);
  const right = TRAIT_RING.indexOf(b);
  if (left < 0 || right < 0) return false;
  return Math.abs(left - right) === 1 || (left === 0 && right === TRAIT_RING.length - 1);
}

export function hasAntagonisticPair(traits: TraitKey[]): boolean {
  for (let i = 0; i < traits.length; i += 1) {
    for (let j = i + 1; j < traits.length; j += 1) {
      const key = pairKey(traits[i], traits[j]);
      if (ANTAGONISTIC_PAIRS.some(([x, y]) => pairKey(x, y) === key)) {
        return true;
      }
    }
  }
  return false;
}

export function resolveBaseTraits(normalized: TraitScores): [TraitKey, TraitKey] {
  let top = topTraits(normalized, 3);
  if (IMPOSSIBLE_TRIADS.has(triadKey(top))) {
    top = topTraits(normalized, 4);
  }
  return [top[0], top[1]];
}

function expressionLevel(
  normalized: TraitScores,
  baseTraits: [TraitKey, TraitKey],
  sliderValues: Partial<Record<TraitKey, number>>,
): ExpressionLevel {
  const values = baseTraits.map((trait) => sliderValues[trait] ?? normalized[trait]);
  const avg = values.reduce((sum, value) => sum + value, 0) / values.length;
  if (avg >= 7) return 'high';
  if (avg >= 4) return 'medium';
  return 'low';
}

function resolveTriadStatus(
  normalized: TraitScores,
  baseTraits: [TraitKey, TraitKey],
): { status: TriadStatus; variant: string | null } {
  const top3 = topTraits(normalized, 3);
  if (IMPOSSIBLE_TRIADS.has(triadKey(top3))) {
    return { status: 'impossible', variant: triadKey(top3) };
  }
  if (!areAdjacentTraits(baseTraits[0], baseTraits[1])) {
    return { status: 'complex', variant: pairKey(baseTraits[0], baseTraits[1]) };
  }
  if (hasAntagonisticPair(top3)) {
    return { status: 'conflict', variant: triadKey(top3) };
  }
  return { status: 'stable', variant: null };
}

export function calculateSubjectivePsychotype(rawScores: TraitScores): PsychotypeResult {
  const normalized = normalizeScores(rawScores);
  const baseTraits = resolveBaseTraits(normalized);
  const baseType = traitTypeName(baseTraits[0], baseTraits[1]);
  const top4 = topTraits(normalized, 4);
  const secondaryTraits = [top4[2], top4[3]] as [TraitKey, TraitKey];
  const secondaryType = traitTypeName(secondaryTraits[0], secondaryTraits[1]);
  const triad = resolveTriadStatus(normalized, baseTraits);
  const top = topTraits(normalized, 3);
  const conflictProfile = hasAntagonisticPair(top) || triad.status === 'complex';

  return {
    base_type: baseType,
    secondary_type: secondaryType,
    scores: normalized,
    raw_scores: rawScores,
    top_traits: top,
    base_traits: baseTraits,
    secondary_traits: secondaryTraits,
    triad_status: triad.status,
    triad_variant: triad.variant,
    expression_level: expressionLevel(normalized, baseTraits, {}),
    conflict_profile: conflictProfile,
  };
}

export function calculatePsychotype(
  rawScores: TraitScores,
  sliderValues: Partial<Record<TraitKey, number>> = {},
): PsychotypeResult {
  const normalized = normalizeScores(rawScores);
  const baseTraits = resolveBaseTraits(normalized);
  const baseType = traitTypeName(baseTraits[0], baseTraits[1]);

  const withSliders = { ...normalized };
  for (const trait of baseTraits) {
    if (sliderValues[trait] !== undefined) {
      withSliders[trait] = sliderValues[trait]!;
    }
  }

  const secondaryTraits = topTraits(withSliders, 2) as [TraitKey, TraitKey];
  const secondaryType = traitTypeName(secondaryTraits[0], secondaryTraits[1]);
  const triad = resolveTriadStatus(normalized, baseTraits);
  const top = topTraits(normalized, 3);
  const conflictProfile = hasAntagonisticPair(top) || triad.status === 'complex';

  return {
    base_type: baseType,
    secondary_type: secondaryType,
    scores: normalized,
    raw_scores: rawScores,
    top_traits: top,
    base_traits: baseTraits,
    secondary_traits: secondaryTraits,
    triad_status: triad.status,
    triad_variant: triad.variant,
    expression_level: expressionLevel(normalized, baseTraits, sliderValues),
    conflict_profile: conflictProfile,
  };
}
