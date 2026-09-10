#!/usr/bin/env tsx
import 'dotenv/config';
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { initDb } from '../src/db.js';
import {
  calculatePsychotype,
  getCachedQuestions,
  scoreFromAnswers,
} from '../src/psychotype/index.js';
import { readFileSync } from 'node:fs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

async function main() {
  const tests = spawnSync(
    'npm',
    ['test', '--', 'src/psychotype/psychotype.test.ts', 'src/psychotype/profile.test.ts'],
    { cwd: root, encoding: 'utf8' },
  );

  console.log('\n=== ЭТАП 2: проверка ===\n');
  console.log(tests.stdout || tests.stderr);

  await initDb();
  const questions = await getCachedQuestions();
  const answersOk = questions.length === 10;

  const result = calculatePsychotype(scoreFromAnswers(Array(10).fill(0), questions));
  const calcOk = Boolean(result.base_type && result.secondary_type);

  const indexSource = readFileSync(join(root, 'src/index.ts'), 'utf8');
  const apiOk =
    indexSource.includes("app.get('/questions'") &&
    indexSource.includes("app.post('/calculate-psychotype'") &&
    indexSource.includes("app.get('/profile/:vk_user_id'") &&
    indexSource.includes('savePsychotypeProfile');

  console.log(`${answersOk ? '✅' : '❌'} 2.1 GET /questions: ${questions.length} вопросов`);
  console.log(`${calcOk ? '✅' : '❌'} 2.1 POST /calculate-psychotype: ok`);
  console.log(`${apiOk ? '✅' : '❌'} 2.3 profile API wired`);
  console.log(`${tests.status === 0 ? '✅' : '❌'} 2.2 unit tests TC-100`);

  process.exit(tests.status === 0 && answersOk && calcOk && apiOk ? 0 : 1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
