import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { queryAll } from '../db.js';
import type { QuestionRow, TraitKey, TraitScores } from './types.js';
import { emptyScores } from './core.js';

const DATA_FILE = join(dirname(fileURLToPath(import.meta.url)), '../../data/questionnaire_full.json');

type DbQuestion = {
  question_number: number;
  context: string;
  text: string;
  options_json: string;
};

let cachedQuestions: QuestionRow[] | null = null;

function parseQuestionRow(row: DbQuestion): QuestionRow {
  return {
    question_number: row.question_number,
    context: row.context,
    text: row.text,
    options: JSON.parse(row.options_json),
  };
}

export async function loadQuestions(): Promise<QuestionRow[]> {
  const rows = await queryAll<DbQuestion>(
    'SELECT question_number, context, text, options_json FROM questions ORDER BY question_number',
  );
  if (rows.length > 0) {
    return rows.map(parseQuestionRow);
  }

  const fallback = JSON.parse(readFileSync(DATA_FILE, 'utf8')) as {
    questions: Array<{
      number: number;
      context: string;
      text: string;
      options: QuestionRow['options'];
    }>;
  };

  return fallback.questions.map((item) => ({
    question_number: item.number,
    context: item.context,
    text: item.text,
    options: item.options,
  }));
}

export async function getCachedQuestions(): Promise<QuestionRow[]> {
  if (!cachedQuestions) {
    cachedQuestions = await loadQuestions();
  }
  return cachedQuestions;
}

export function scoreFromAnswers(
  answers: number[],
  questions: QuestionRow[],
): TraitScores {
  if (answers.length !== 10) {
    throw new Error('answers must contain exactly 10 option indexes');
  }

  const scores = emptyScores();
  answers.forEach((optionIndex, questionIndex) => {
    const question = questions[questionIndex];
    const option = question?.options[optionIndex];
    if (!option) {
      throw new Error(`Invalid answer at question ${questionIndex + 1}`);
    }

    for (const [trait, weight] of Object.entries(option.weights)) {
      scores[trait as TraitKey] += weight ?? 0;
    }
  });

  return scores;
}
