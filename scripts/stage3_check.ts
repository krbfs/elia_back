#!/usr/bin/env tsx
import 'dotenv/config';
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { initDb, queryAll, queryOne, type ProfileRow, type TechniqueRow } from '../src/db.js';
import { recommendTechniques, stressZone } from '../src/recommend.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

async function main() {
  const tests = spawnSync('npm', ['test', '--', 'src/recommend.test.ts'], {
    cwd: root,
    encoding: 'utf8',
  });
  console.log(tests.stdout || tests.stderr);

  await initDb();
  const techniques = await queryAll<TechniqueRow>('SELECT * FROM techniques');
  const profile = await queryOne<ProfileRow>(
    'SELECT * FROM profiles WHERE base_type IS NOT NULL LIMIT 1',
  );

  const red = recommendTechniques(techniques, {
    stress: 9,
    profile: profile ?? undefined,
  });
  const yellow = recommendTechniques(techniques, {
    stress: 6,
    profile: profile
      ? { ...profile, is_premium: true }
      : ({ vk_user_id: 1, base_type: 'Консерватор', secondary_type: 'Эмпат', is_premium: true } as ProfileRow),
  });

  console.log('\n=== ЭТАП 3: проверка ===\n');
  console.log(`${techniques.length >= 39 ? '✅' : '❌'} techniques in DB: ${techniques.length}`);
  console.log(`${red.zone === 'red' ? '✅' : '❌'} stress 9 → red (${red.technique?.title ?? 'none'})`);
  console.log(`${yellow.cascade ? '✅' : '⚠️ '} yellow cascade: ${yellow.cascade?.title ?? 'none'}`);
  console.log(`${(yellow.techniques.length ?? 0) >= 1 ? '✅' : '❌'} top list size: ${yellow.techniques.length}`);

  process.exit(tests.status === 0 ? 0 : 1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
