import { TECHNIQUE_SEEDS } from './techniques.js';
import { pool, queryOne } from '../db.js';

export async function seedTechniques() {
  const count = await queryOne<{ count: string }>(
    'SELECT COUNT(*)::text AS count FROM techniques',
  );
  if (Number(count?.count ?? 0) > 0) return;

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    for (const item of TECHNIQUE_SEEDS) {
      await client.query(
        `INSERT INTO techniques (
          title, text, duration_sec, audio_url, level, context,
          psychotypes_json, reaction, evidence
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
        [
          item.title,
          item.text,
          item.duration_sec,
          item.audio_url,
          item.level,
          item.context,
          JSON.stringify(item.psychotypes),
          item.reaction,
          item.evidence,
        ],
      );
    }
    await client.query('COMMIT');
    console.log(`Seeded ${TECHNIQUE_SEEDS.length} techniques`);
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}
