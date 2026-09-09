export type CrisisLevel = 'green' | 'yellow' | 'red';

/** Option scores for EPDS Q1–Q10 (0–3 each). Server-side mirror of frontend config. */
const EPDS_OPTION_SCORES: number[][] = [
  [0, 1, 2, 3],
  [0, 1, 2, 3],
  [0, 1, 2, 3],
  [0, 1, 2, 3],
  [0, 1, 2, 3],
  [0, 1, 2, 3],
  [0, 1, 2, 3],
  [0, 1, 2, 3],
  [0, 1, 2, 3],
  [0, 1, 2, 3],
];

export function scoreEpdsAnswers(answers: number[]): {
  total: number;
  crisisLevel: CrisisLevel;
  q10Score: number;
} {
  if (!Array.isArray(answers) || answers.length !== 10) {
    throw new Error('answers must be an array of 10 option indexes');
  }

  let total = 0;
  let q10Score = 0;

  answers.forEach((optionIndex, questionIndex) => {
    const scores = EPDS_OPTION_SCORES[questionIndex];
    const score = scores[optionIndex];
    if (score === undefined) throw new Error('invalid option index');
    total += score;
    if (questionIndex === 9) q10Score = score;
  });

  let crisisLevel: CrisisLevel = 'green';
  if (q10Score > 0) crisisLevel = 'red';
  else if (total >= 10) crisisLevel = 'yellow';

  return { total, crisisLevel, q10Score };
}
