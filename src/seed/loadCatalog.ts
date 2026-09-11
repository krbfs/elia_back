import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { pool, queryOne } from '../db.js';

const DATA_DIR = join(dirname(fileURLToPath(import.meta.url)), '../../data');
const TECHNIQUES_FILE = join(DATA_DIR, 'techniques_catalog.json');
const QUESTIONNAIRE_FILE = join(DATA_DIR, 'questionnaire_full.json');

export const EXPECTED_TECHNIQUE_COUNT = 40;
export const EXPECTED_QUESTION_COUNT = 10;

const DURATION_SEC: Record<string, number> = {
  short: 90,
  medium: 180,
  long: 300,
};

type LoadStats = {
  techniquesCreated: number;
  techniquesUpdated: number;
  questionsCreated: number;
  questionsUpdated: number;
};

function loadJson(path: string): Record<string, unknown> {
  return JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>;
}

function mapTechnique(raw: Record<string, unknown>) {
  const tags = (raw.tags ?? {}) as Record<string, unknown>;
  const content = (raw.content ?? {}) as Record<string, unknown>;
  const duration =
    (content.timer_seconds as number | undefined) ??
    (content.audio_duration_seconds as number | undefined) ??
    DURATION_SEC[(tags.duration as string | undefined) ?? 'medium'] ??
    120;

  const levels = (tags.level as string[] | undefined) ?? ['yellow'];
  const contexts = (tags.context as string[] | undefined) ?? ['any'];
  const psychotypes = (tags.psychotypes as string[] | undefined) ?? [];
  const reactions = (tags.stress_reaction as string[] | undefined) ?? ['any'];

  return {
    catalog_id: Number(raw.technique_id),
    slug: (raw.slug as string | undefined) ?? null,
    title: String(raw.title),
    text: String(content.text ?? raw.description ?? ''),
    duration_sec: Number(duration),
    audio_url: (content.audio_url as string | undefined) ?? null,
    level: levels[0],
    context: contexts[0],
    psychotypes_json: JSON.stringify(psychotypes),
    reaction: reactions[0],
    evidence: String(raw.scientific_basis ?? ''),
    is_premium: Boolean(tags.is_premium),
    tags_json: JSON.stringify(tags),
  };
}

export async function loadTechniquesFromCatalog(
  options: { force?: boolean } = {},
): Promise<Pick<LoadStats, 'techniquesCreated' | 'techniquesUpdated'>> {
  const data = loadJson(TECHNIQUES_FILE);
  const items = (data.techniques as Record<string, unknown>[] | undefined) ?? [];

  const count = await queryOne<{ count: string }>('SELECT COUNT(*)::text AS count FROM techniques');
  const existingCount = Number(count?.count ?? 0);
  if (existingCount > 0 && existingCount !== items.length && !options.force) {
    return loadTechniquesFromCatalog({ force: true });
  }
  if (existingCount === items.length && !options.force) {
    return { techniquesCreated: 0, techniquesUpdated: 0 };
  }

  let techniquesCreated = 0;
  let techniquesUpdated = 0;
  const client = await pool.connect();

  try {
    await client.query('BEGIN');
    if (options.force && existingCount > 0) {
      await client.query('TRUNCATE TABLE favorites');
      await client.query('TRUNCATE TABLE techniques RESTART IDENTITY CASCADE');
    }

    for (const raw of items) {
      const item = mapTechnique(raw);
      const existing = await client.query(
        'SELECT id FROM techniques WHERE catalog_id = $1',
        [item.catalog_id],
      );

      if (existing.rowCount) {
        await client.query(
          `UPDATE techniques SET
            slug = $2, title = $3, text = $4, duration_sec = $5, audio_url = $6,
            level = $7, context = $8, psychotypes_json = $9, reaction = $10,
            evidence = $11, is_premium = $12, tags_json = $13
          WHERE catalog_id = $1`,
          [
            item.catalog_id,
            item.slug,
            item.title,
            item.text,
            item.duration_sec,
            item.audio_url,
            item.level,
            item.context,
            item.psychotypes_json,
            item.reaction,
            item.evidence,
            item.is_premium,
            item.tags_json,
          ],
        );
        techniquesUpdated += 1;
      } else {
        await client.query(
          `INSERT INTO techniques (
            catalog_id, slug, title, text, duration_sec, audio_url, level, context,
            psychotypes_json, reaction, evidence, is_premium, tags_json
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)`,
          [
            item.catalog_id,
            item.slug,
            item.title,
            item.text,
            item.duration_sec,
            item.audio_url,
            item.level,
            item.context,
            item.psychotypes_json,
            item.reaction,
            item.evidence,
            item.is_premium,
            item.tags_json,
          ],
        );
        techniquesCreated += 1;
      }
    }

    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }

  return { techniquesCreated, techniquesUpdated };
}

export async function loadQuestionsFromCatalog(
  options: { force?: boolean } = {},
): Promise<Pick<LoadStats, 'questionsCreated' | 'questionsUpdated'>> {
  const data = loadJson(QUESTIONNAIRE_FILE);
  const items = (data.questions as Record<string, unknown>[] | undefined) ?? [];

  const count = await queryOne<{ count: string }>('SELECT COUNT(*)::text AS count FROM questions');
  const existingCount = Number(count?.count ?? 0);
  if (existingCount > 0 && existingCount !== items.length && !options.force) {
    return loadQuestionsFromCatalog({ force: true });
  }
  if (existingCount === items.length && !options.force) {
    return { questionsCreated: 0, questionsUpdated: 0 };
  }

  let questionsCreated = 0;
  let questionsUpdated = 0;
  const client = await pool.connect();

  try {
    await client.query('BEGIN');
    if (options.force && existingCount > 0) {
      await client.query('TRUNCATE TABLE questions RESTART IDENTITY');
    }

    for (const raw of items) {
      const questionNumber = Number(raw.number);
      const existing = await client.query(
        'SELECT question_number FROM questions WHERE question_number = $1',
        [questionNumber],
      );

      const payload = [
        questionNumber,
        String(raw.context ?? 'any'),
        String(raw.text),
        JSON.stringify(raw.options ?? []),
      ];

      if (existing.rowCount) {
        await client.query(
          `UPDATE questions SET context = $2, text = $3, options_json = $4, updated_at = NOW()
           WHERE question_number = $1`,
          payload,
        );
        questionsUpdated += 1;
      } else {
        await client.query(
          `INSERT INTO questions (question_number, context, text, options_json)
           VALUES ($1, $2, $3, $4)`,
          payload,
        );
        questionsCreated += 1;
      }
    }

    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }

  return { questionsCreated, questionsUpdated };
}

export async function loadEliaData(options: { force?: boolean } = {}): Promise<LoadStats> {
  const techniques = await loadTechniquesFromCatalog(options);
  const questions = await loadQuestionsFromCatalog(options);
  return { ...techniques, ...questions };
}

export async function ensureCatalogSeeded() {
  const [techniquesCount, questionsCount] = await Promise.all([
    queryOne<{ count: string }>('SELECT COUNT(*)::text AS count FROM techniques'),
    queryOne<{ count: string }>('SELECT COUNT(*)::text AS count FROM questions'),
  ]);

  const techniques = Number(techniquesCount?.count ?? 0);
  const questions = Number(questionsCount?.count ?? 0);

  if (techniques !== EXPECTED_TECHNIQUE_COUNT) {
    const stats = await loadTechniquesFromCatalog({ force: techniques > 0 });
    console.log(
      `Catalog techniques: created=${stats.techniquesCreated}, updated=${stats.techniquesUpdated}`,
    );
  }

  if (questions !== EXPECTED_QUESTION_COUNT) {
    const stats = await loadQuestionsFromCatalog({ force: questions > 0 });
    console.log(
      `Catalog questions: created=${stats.questionsCreated}, updated=${stats.questionsUpdated}`,
    );
  }
}

export async function getAdminSummary() {
  const [users, profiles, techniques, questions, subscriptions, payments, crisis, usage] =
    await Promise.all([
      queryOne<{ count: string }>('SELECT COUNT(*)::text AS count FROM users'),
      queryOne<{ count: string }>('SELECT COUNT(*)::text AS count FROM profiles'),
      queryOne<{ count: string }>('SELECT COUNT(*)::text AS count FROM techniques'),
      queryOne<{ count: string }>('SELECT COUNT(*)::text AS count FROM questions'),
      queryOne<{ count: string }>('SELECT COUNT(*)::text AS count FROM subscriptions'),
      queryOne<{ count: string }>('SELECT COUNT(*)::text AS count FROM payments'),
      queryOne<{ count: string }>('SELECT COUNT(*)::text AS count FROM crisis_incidents'),
      queryOne<{ count: string }>('SELECT COUNT(*)::text AS count FROM technique_usage'),
    ]);

  return {
    users: Number(users?.count ?? 0),
    profiles: Number(profiles?.count ?? 0),
    techniques: Number(techniques?.count ?? 0),
    questions: Number(questions?.count ?? 0),
    subscriptions: Number(subscriptions?.count ?? 0),
    payments: Number(payments?.count ?? 0),
    crisis_incidents: Number(crisis?.count ?? 0),
    technique_usage: Number(usage?.count ?? 0),
  };
}
