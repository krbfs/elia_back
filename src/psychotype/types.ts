export type TraitKey = 'agr' | 'sp' | 'ex' | 'lab' | 'tr' | 'sen' | 'in' | 'rig';

export type TraitScores = Record<TraitKey, number>;

export type TriadStatus = 'stable' | 'impossible' | 'conflict' | 'complex';

export type ExpressionLevel = 'low' | 'medium' | 'high';

export type PsychotypeResult = {
  base_type: string;
  secondary_type: string;
  scores: TraitScores;
  raw_scores: TraitScores;
  top_traits: TraitKey[];
  base_traits: [TraitKey, TraitKey];
  secondary_traits: [TraitKey, TraitKey];
  triad_status: TriadStatus;
  triad_variant: string | null;
  expression_level: ExpressionLevel;
  conflict_profile: boolean;
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
