import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it, vi } from 'vitest';
import {
  areAdjacentTraits,
  areAntagonisticTraits,
  calculatePsychotype,
  calculateSubjectivePsychotype,
  hasAntagonisticPair,
  normalizeScores,
  psychotypeCodeFor,
  resolveBaseTraits,
  traitTypeName,
  CONFLICT_BASE_TYPE,
  CONFLICT_RECOMMENDATION,
  LAB_IN_MULTIPLIER,
  TRIAD_THRESHOLD,
  type PsychotypeCode,
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

  it('TC-101: Консерватор + Эмпат из целевых сырых баллов (03_Диагностика §8.1–8.2)', () => {
    const raw: TraitScores = { agr: 2, sp: 1, ex: 1, lab: 2, tr: 14, sen: 13, in: 5, rig: 6 };
    const result = calculatePsychotype(raw, { tr: 6, sen: 8 });

    expect(result.base_type).toBe('Консерватор');
    expect(result.psychotype_code).toBe('conservator');
    expect(result.base_traits).toEqual(['tr', 'sen']);
    expect(result.expression_level).toBe('выраженный');
    expect(result.secondary_type).toBe('Эмпат');
    expect(result.conflict_profile).toBe(false);
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

  it('TC-104: non-adjacent pair gives complex profile', () => {
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
    expect(result.base_type).toBe('complex');
    expect(result.psychotype_code).toBe('complex');
    expect(result.expression_level).toBeNull();
  });

  it('TC-105: conflict triad is saved with conflict flag', () => {
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
    expect(result.conflict_profile).toBe(true);
    expect(result.triad_status).toBe('conflict');
    expect(result.triad).toEqual(['agr', 'sen', 'tr']);
    expect(result.recommendation).toBe('Пройдите опросник повторно в спокойном состоянии');
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

describe('psychotype v4.3', () => {
  const zero: TraitScores = { agr: 0, sp: 0, ex: 0, lab: 0, tr: 0, sen: 0, in: 0, rig: 0 };
  // Фикстура TC-101: Консерватор + Эмпат, третья тенденция — Интроверсия.
  const conservator: TraitScores = { agr: 2, sp: 1, ex: 1, lab: 2, tr: 14, sen: 13, in: 5, rig: 6 };
  const ring: TraitKey[] = ['agr', 'sp', 'ex', 'lab', 'tr', 'sen', 'in', 'rig'];

  it('множитель 1.33 применяется только к lab и in', () => {
    const normalized = normalizeScores({ ...zero, lab: 3, in: 3, tr: 8 });

    expect(normalized.lab).toBeCloseTo(((3 * LAB_IN_MULTIPLIER) / 9) * 10, 5);
    expect(normalized.in).toBeCloseTo(((3 * LAB_IN_MULTIPLIER) / 10) * 10, 5);
    expect(normalized.tr).toBe(5);
  });

  it('антагонистических пар ровно четыре: 1-5, 2-6, 3-7, 4-8', () => {
    const found: string[] = [];
    ring.forEach((first, index) => {
      ring.slice(index + 1).forEach((second) => {
        if (areAntagonisticTraits(first, second)) found.push(`${first}-${second}`);
      });
    });

    expect(found).toEqual(['agr-tr', 'sp-sen', 'ex-in', 'lab-rig']);
    expect(hasAntagonisticPair(['tr', 'sen', 'in'])).toBe(false);
    expect(hasAntagonisticPair(['tr', 'sen', 'agr'])).toBe(true);
  });

  it('смежность замкнута в круг: rig соседствует с agr', () => {
    expect(areAdjacentTraits('rig', 'agr')).toBe(true);
    expect(areAdjacentTraits('agr', 'sp')).toBe(true);
    expect(areAdjacentTraits('agr', 'ex')).toBe(false);
  });

  it('psychotypeCodeFor покрывает 8 типов, остальное — complex', () => {
    const codes: [string, PsychotypeCode][] = [
      ['Индивидуалист', 'individualist'],
      ['Инноватор', 'innovator'],
      ['Лидер Мнений', 'leader'],
      ['Эстет', 'esthete'],
      ['Консерватор', 'conservator'],
      ['Эмпат', 'empath'],
      ['Аналитик', 'analyst'],
      ['Прагматик', 'pragmatist'],
    ];

    codes.forEach(([name, code]) => {
      expect(psychotypeCodeFor(name)).toBe(code);
    });
    expect(psychotypeCodeFor('complex')).toBe('complex');
    expect(psychotypeCodeFor(CONFLICT_BASE_TYPE)).toBe('complex');
  });

  it('триада формируется только выше порога третьей тенденции', () => {
    expect(normalizeScores(conservator).in).toBeGreaterThanOrEqual(TRIAD_THRESHOLD);
    const above = calculatePsychotype(conservator);
    expect(above.triad).toEqual(['tr', 'sen', 'in']);
    expect(above.triad_variant).toBe('in-sen-tr');

    const weakThird = { ...conservator, in: 4 };
    expect(normalizeScores(weakThird).in).toBeLessThan(TRIAD_THRESHOLD);
    const below = calculatePsychotype(weakThird);
    expect(below.triad).toBeNull();
    expect(below.triad_variant).toBeNull();
    expect(below.triad_status).toBe('stable');
  });

  it('уровень выраженности считается по топ-2 и разрыву с топ-3', () => {
    expect(calculatePsychotype(conservator).expression_level).toBe('выраженный');
    expect(calculatePsychotype({ ...zero, tr: 10, sen: 10 }).expression_level).toBe('умеренный');
    expect(calculatePsychotype({ ...zero, tr: 6, sen: 6, in: 2 }).expression_level).toBe(
      'смазанный',
    );
  });

  it('антагонистическая пара в топ-2 даёт конфликт без сопутствующего типа', () => {
    // Слайдеры переданы намеренно: для конфликтного профиля они не должны создавать сопутствующий тип.
    const result = calculatePsychotype({ ...zero, agr: 18, tr: 16 }, { agr: 9, tr: 4 });

    expect(result.base_traits).toEqual(['agr', 'tr']);
    expect(result.base_type).toBe(CONFLICT_BASE_TYPE);
    expect(result.psychotype_code).toBe('complex');
    expect(result.triad_status).toBe('conflict');
    expect(result.conflict_profile).toBe(true);
    expect(result.conflict_reason).toBe(
      'Обнаружена антагонистическая пара в топ-2: Агрессивность (1) + Тревожность (5)',
    );
    expect(result.recommendation).toBe(CONFLICT_RECOMMENDATION);
    expect(result.secondary_type).toBeNull();
    expect(result.secondary_traits).toBeNull();
    expect(result.expression_level).toBeNull();
  });

  it('сопутствующий тип: основной опросник требует слайдеров, опросник партнёра берёт 3-4 тенденции', () => {
    expect(calculatePsychotype(conservator).secondary_type).toBeNull();
    expect(calculatePsychotype(conservator, { tr: 6, sen: 8 }).secondary_type).toBe('Эмпат');

    const partner = calculateSubjectivePsychotype(conservator);
    expect(partner.base_type).toBe('Консерватор');
    expect(partner.secondary_type).toBe('Аналитик');
    expect(partner.secondary_traits).toEqual(['in', 'rig']);
  });

  it('равные нормализованные баллы разрешаются сырыми баллами, затем порядком круга', () => {
    const byRaw: TraitScores = { ...zero, agr: 18, tr: 16 };
    const normalized = normalizeScores(byRaw);
    expect(normalized.agr).toBe(normalized.tr);
    expect(calculatePsychotype(byRaw).base_traits).toEqual(['agr', 'tr']);

    const info = vi.spyOn(console, 'info').mockImplementation(() => {});
    const byRing = calculatePsychotype({ ...zero, tr: 16, rig: 16 });
    expect(byRing.base_traits).toEqual(['tr', 'rig']);
    expect(info).toHaveBeenCalledWith(
      expect.stringContaining('неоднозначность между Тревожность и Ригидность'),
    );
    info.mockRestore();
  });
});
