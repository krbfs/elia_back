export type TraitKey = 'agr' | 'sp' | 'ex' | 'lab' | 'tr' | 'sen' | 'in' | 'rig';

export type TraitScores = Record<TraitKey, number>;

export type TriadStatus = 'stable' | 'conflict' | 'complex';

export type ExpressionLevel = 'выраженный' | 'умеренный' | 'смазанный';

export type PsychotypeCode =
  | 'individualist'
  | 'innovator'
  | 'leader'
  | 'esthete'
  | 'conservator'
  | 'empath'
  | 'analyst'
  | 'pragmatist'
  | 'complex';

export type PsychotypeResult = {
  base_type: string;
  psychotype_code: PsychotypeCode;
  secondary_type: string | null;
  scores: TraitScores;
  raw_scores: TraitScores;
  /** Топ-2 тенденции базового типа (03_Диагностика §6.2). */
  top_traits: TraitKey[];
  base_traits: [TraitKey, TraitKey];
  secondary_traits: [TraitKey, TraitKey] | null;
  /** Топ-3 тенденции, если 3-я прошла порог; иначе null. */
  triad: TraitKey[] | null;
  triad_status: TriadStatus;
  triad_variant: string | null;
  expression_level: ExpressionLevel | null;
  conflict_profile: boolean;
  conflict_reason: string | null;
  recommendation: string | null;
};

export type QuestionOption = {
  id?: number;
  text: string;
  weights: Partial<TraitScores>;
};

export type QuestionRow = {
  question_number: number;
  context: string;
  text: string;
  options: QuestionOption[];
};
