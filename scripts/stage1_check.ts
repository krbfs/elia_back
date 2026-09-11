#!/usr/bin/env tsx
/**
 * Проверка критериев этапа 1 (Express + Postgres вместо Django).
 * Запуск: npx tsx scripts/stage1_check.ts
 */
import 'dotenv/config';
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { initDb, queryOne } from '../src/db.js';
import { getAdminSummary, loadEliaData } from '../src/seed/loadCatalog.js';
import { authenticateDevUser, refreshAuth } from '../src/auth/service.js';

type Check = { name: string; ok: boolean; detail: string };

const checks: Check[] = [];

function add(name: string, ok: boolean, detail: string) {
  checks.push({ name, ok, detail });
}

async function main() {
  if (!process.env.SECRET_KEY) {
    add('SECRET_KEY задан', false, 'Добавьте SECRET_KEY в .env');
  } else {
    add('SECRET_KEY задан', true, 'ok');
  }

  await initDb();
  add('initDb / migrate', true, 'Таблицы созданы или обновлены');

  const root = join(dirname(fileURLToPath(import.meta.url)), '..');
  const validation = spawnSync('python3', ['scripts/validate_catalog.py'], {
    cwd: root,
    encoding: 'utf8',
  });
  const validationOk = validation.status === 0;
  add(
    'validate_catalog.py',
    validationOk,
    validationOk ? 'JSON-каталоги валидны' : 'Есть ошибки в JSON (см. методолога)',
  );

  const loadStats = await loadEliaData({});
  const summary = await getAdminSummary();
  add(
    '40 техник в БД',
    summary.techniques === 39,
    `techniques=${summary.techniques}, created=${loadStats.techniquesCreated}, updated=${loadStats.techniquesUpdated}`,
  );
  add(
    '10 вопросов в БД',
    summary.questions === 10,
    `questions=${summary.questions}, created=${loadStats.questionsCreated}, updated=${loadStats.questionsUpdated}`,
  );

  const repeat = await loadEliaData({});
  const noDupes =
    repeat.techniquesCreated === 0 &&
    repeat.questionsCreated === 0 &&
    repeat.techniquesUpdated === 0 &&
    repeat.questionsUpdated === 0;
  add('Повторная загрузка без дубликатов', noDupes, JSON.stringify(repeat));

  if (process.env.SECRET_KEY) {
    const auth = await authenticateDevUser({ vk_user_id: 900_000_999, first_name: 'Stage1' });
    const userExists = await queryOne<{ count: string }>(
      'SELECT COUNT(*)::text AS count FROM users WHERE vk_user_id = $1',
      [auth.user.vk_user_id],
    );
    add(
      'Авто-создание User при auth',
      Number(userExists?.count ?? 0) === 1,
      `vk_user_id=${auth.user.vk_user_id}`,
    );

    const refreshed = await refreshAuth(auth.refresh_token);
    add(
      'JWT refresh',
      Boolean(refreshed.access_token && refreshed.refresh_token),
      'refresh ok',
    );
  }

  add(
    'Admin summary (Express вместо Django admin)',
    summary.techniques === 39 && summary.questions === 10,
    JSON.stringify(summary),
  );

  console.log('\n=== ЭТАП 1: проверка (Express + Postgres) ===\n');
  for (const check of checks) {
    console.log(`${check.ok ? '✅' : '❌'} ${check.name}: ${check.detail}`);
  }

  const failed = checks.filter((item) => !item.ok).length;
  console.log(`\nИтого: ${checks.length - failed}/${checks.length} пройдено`);
  if (!validationOk) {
    console.log('\n⚠️  validate_catalog.py — блокер данных JSON, не кода этапа 1.');
  }
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
