#!/usr/bin/env tsx
import 'dotenv/config';
import { initDb } from '../src/db.js';
import { loadEliaData } from '../src/seed/loadCatalog.js';

// --force больше не очищает таблицы: он лишь разрешает удалить техники, которых нет в каталоге.
const force = process.argv.includes('--force');

async function main() {
  await initDb();
  const stats = await loadEliaData({ force });

  console.log('load_elia_data finished');
  console.log(`  techniques: created=${stats.techniquesCreated}, updated=${stats.techniquesUpdated}`);
  console.log(`  questions: created=${stats.questionsCreated}, updated=${stats.questionsUpdated}`);

  const secondRun = await loadEliaData({});
  const duplicates =
    secondRun.techniquesCreated +
    secondRun.questionsCreated +
    secondRun.techniquesUpdated +
    secondRun.questionsUpdated;

  if (duplicates === 0) {
    console.log('  repeat run: no changes (ok)');
  } else {
    console.log('  repeat run: changes detected (check upsert logic)');
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
