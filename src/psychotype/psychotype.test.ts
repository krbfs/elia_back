import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  calculatePsychotype,
  normalizeScores,
  resolveBaseTraits,
  traitTypeName,
  type TraitKey,
  type TraitScores,
} from './core.js';
import { scoreFromAnswers } from './scoreAnswers.js';
import type { QuestionRow } from './types.js';

const DATA_FILE = join(dirname(fileURLToPath(import.meta.url)), '../../data/questionnaire_full.json');

function loadQuestionnaire(): QuestionRow[] {
  const data = JSON.parse(readFileSync(DATA_FILE, 'utf8')) as {
    questions: Array<{
      number: number;
      context: string;
      text: string;
      options: QuestionRow['options'];
    }>;
  };

  return data.questions.map((item) => ({
    question_number: item.number,
    context: item.context,
    text: item.text,
    options: item.options,
  }));
}

function answersForDominantTraits(
  questions: QuestionRow[],
  dominant: TraitKey[],
): number[] {
  return questions.map((question) => {
    let bestIndex = 0;
    let bestScore = -1;
    question.options.forEach((option, index) => {
      const score = dominant.reduce(
        (sum, trait) => sum + (option.weights[trait] ?? 0),
        0,
      );
      if (score > bestScore) {
        bestScore = score;
        bestIndex = index;
      }
    });
    return bestIndex;
  });
}

describe('psychotype stage 2', () => {
  const questions = loadQuestionnaire();

  it('TC-101: questionnaire has 10 questions with 3 options', () => {
    expect(questions).toHaveLength(10);
    questions.forEach((question) => {
      expect(question.options).toHaveLength(3);
    });
  });

  it('TC-101: full calculation returns base and secondary types', () => {
    const answers = Array(10).fill(1);
    const raw = scoreFromAnswers(answers, questions);
    const baseTraits = resolveBaseTraits(normalizeScores(raw));
    const sliders: Partial<Record<TraitKey, number>> = {
      [baseTraits[0]]: 8,
      [baseTraits[1]]: 7,
    };
    const result = calculatePsychotype(raw, sliders);

    expect(result.base_type).toBeTruthy();
    expect(result.secondary_type).toBeTruthy();
    expect(result.base_traits).toEqual(baseTraits);
    expect(result.scores).toMatchObject(normalizeScores(raw));
  });

  it('TC-102: conservative matrix from questionnaire JSON', () => {
    // Калибровано под MaxPossible NAVIGATOR; tr=13 sen=12 → tr/sen топ-2
    const answers = [2, 2, 2, 0, 0, 1, 1, 1, 0, 0];
    const raw = scoreFromAnswers(answers, questions);
    const result = calculatePsychotype(raw);

    expect(result.base_type).toBe('Консерватор');
    expect(result.base_traits).toEqual(['tr', 'sen']);
  });

  it('TC-103: sliders do not change base traits', () => {
    const answers = [2, 0, 1, 0, 0, 1, 1, 1, 0, 1];
    const raw = scoreFromAnswers(answers, questions);
    const baseFromQuestions = resolveBaseTraits(normalizeScores(raw));
    const sliders: Partial<Record<TraitKey, number>> = {
      tr: 10,
      sen: 10,
      in: 10,
    };
    const result = calculatePsychotype(raw, sliders);

    expect(result.base_traits).toEqual(baseFromQuestions);
    expect(result.base_type).toBe(traitTypeName(baseFromQuestions[0], baseFromQuestions[1]));
  });

  it('TC-104: antagonistic pair sets conflict_profile', () => {
    const raw: TraitScores = {
      agr: 18,
      sp: 0,
      ex: 0,
      lab: 0,
      tr: 0,
      sen: 0,
      in: 10,
      rig: 0,
    };
    const result = calculatePsychotype(raw);
    expect(result.conflict_profile).toBe(true);
    expect(['conflict', 'complex']).toContain(result.triad_status);
  });

  it('TC-105: impossible triad is resolved without crash', () => {
    const raw: TraitScores = {
      agr: 18,
      sp: 0,
      ex: 0,
      lab: 0,
      tr: 16,
      sen: 17,
      in: 0,
      rig: 0,
    };
    const base = resolveBaseTraits(normalizeScores(raw));
    const result = calculatePsychotype(raw);

    expect(base).toHaveLength(2);
    expect(result.base_type).toBeTruthy();
    expect(result.triad_status).toBe('impossible');
  });

  it('traitTypeName maps all 8 psychotypes', () => {
    const pairs: [TraitKey, TraitKey, string][] = [
      ['agr', 'sp', 'Индивидуалист'],
      ['sp', 'ex', 'Инноватор'],
      ['ex', 'lab', 'Лидер Мнений'],
      ['lab', 'tr', 'Эстет'],
      ['tr', 'sen', 'Консерватор'],
      ['sen', 'in', 'Эмпат'],
      ['in', 'rig', 'Аналитик'],
      ['rig', 'agr', 'Прагматик'],
    ];

    pairs.forEach(([first, second, name]) => {
      expect(traitTypeName(first, second)).toBe(name);
    });
  });
});
