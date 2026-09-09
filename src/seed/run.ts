import { TECHNIQUE_SEEDS } from './techniques.js';
import { db } from '../db.js';

export function seedTechniques() {
  const count = db
    .prepare('SELECT COUNT(*) as count FROM techniques')
    .get() as { count: number };

  if (count.count > 0) return;

  const insert = db.prepare(`
    INSERT INTO techniques (
      title, text, duration_sec, audio_url, level, context,
      psychotypes_json, reaction, evidence
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const insertMany = db.transaction((items: typeof TECHNIQUE_SEEDS) => {
    for (const item of items) {
      insert.run(
        item.title,
        item.text,
        item.duration_sec,
        item.audio_url,
        item.level,
        item.context,
        JSON.stringify(item.psychotypes),
        item.reaction,
        item.evidence,
      );
    }
  });

  insertMany(TECHNIQUE_SEEDS);
  console.log(`Seeded ${TECHNIQUE_SEEDS.length} techniques`);
}
