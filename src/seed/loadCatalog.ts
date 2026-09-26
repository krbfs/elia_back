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

const TECHNIQUE_COLUMNS = [
  'slug',
  'title',
  'text',
  'duration_sec',
  'audio_url',
  'level',
  'context',
  'psychotypes_json',
  'reaction',
  'evidence',
  'is_premium',
  'tags_json',
] as const;

/**
 * Синхронизация без удаления данных: upsert по стабильному catalog_id, и строка трогается
 * только если содержимое действительно изменилось. Избранное, история прохождений и
 * подарки ссылаются на techniques(id) с ON DELETE CASCADE, поэтому TRUNCATE здесь запрещён.
 */
const UPSERT_TECHNIQUE = `
  INSERT INTO techniques (catalog_id, ${TECHNIQUE_COLUMNS.join(', ')})
  VALUES (${Array.from({ length: TECHNIQUE_COLUMNS.length + 1 }, (_, i) => `$${i + 1}`).join(', ')})
  ON CONFLICT (catalog_id) DO UPDATE SET
    ${TECHNIQUE_COLUMNS.map((column) => `${column} = EXCLUDED.${column}`).join(',\n    ')}
  WHERE (${TECHNIQUE_COLUMNS.map((column) => `techniques.${column}`).join(', ')})
    IS DISTINCT FROM (${TECHNIQUE_COLUMNS.map((column) => `EXCLUDED.${column}`).join(', ')})
  RETURNING (xmax = 0) AS inserted`;

export async function loadTechniquesFromCatalog(
  options: { force?: boolean } = {},
): Promise<Pick<LoadStats, 'techniquesCreated' | 'techniquesUpdated'>> {
  const data = loadJson(TECHNIQUES_FILE);
  const items = (data.techniques as Record<string, unknown>[] | undefined) ?? [];

  let techniquesCreated = 0;
  let techniquesUpdated = 0;
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    for (const raw of items) {
      const item = mapTechnique(raw);
      const result = await client.query<{ inserted: boolean }>(UPSERT_TECHNIQUE, [
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
      ]);

      if (result.rows[0]?.inserted) techniquesCreated += 1;
      else if (result.rowCount) techniquesUpdated += 1;
    }

    // Техники, которых больше нет в каталоге. Удаляем только по явной просьбе (--force):
    // вместе со строкой каскадом уходят избранное, история прохождений и подарки.
    const catalogIds = items.map((raw) => Number(raw.technique_id));
    const orphans = await client.query<{ catalog_id: number; title: string }>(
      'SELECT catalog_id, title FROM techniques WHERE catalog_id IS NULL OR NOT (catalog_id = ANY($1::int[]))',
      [catalogIds],
    );

    if (orphans.rowCount) {
      const titles = orphans.rows.map((row) => `#${row.catalog_id} ${row.title}`).join(', ');
      if (options.force) {
        await client.query(
          'DELETE FROM techniques WHERE catalog_id IS NULL OR NOT (catalog_id = ANY($1::int[]))',
          [catalogIds],
        );
        console.warn(`Catalog sync: удалены техники вне каталога (${titles})`);
      } else {
        console.warn(
          `Catalog sync: в БД есть техники вне каталога (${titles}). Запустите load-data --force, чтобы удалить их вместе с избранным и историей.`,
        );
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

  let questionsCreated = 0;
  let questionsUpdated = 0;
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    for (const raw of items) {
      const result = await client.query<{ inserted: boolean }>(
        `INSERT INTO questions (question_number, context, text, options_json)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (question_number) DO UPDATE SET
           context = EXCLUDED.context, text = EXCLUDED.text,
           options_json = EXCLUDED.options_json, updated_at = NOW()
         WHERE (questions.context, questions.text, questions.options_json)
           IS DISTINCT FROM (EXCLUDED.context, EXCLUDED.text, EXCLUDED.options_json)
         RETURNING (xmax = 0) AS inserted`,
        [
          Number(raw.number),
          String(raw.context ?? 'any'),
          String(raw.text),
          JSON.stringify(raw.options ?? []),
        ],
      );

      if (result.rows[0]?.inserted) questionsCreated += 1;
      else if (result.rowCount) questionsUpdated += 1;
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
  // Сверять число строк недостаточно: правки текстов и тегов количество не меняют.
  const stats = await loadEliaData();

  if (stats.techniquesCreated || stats.techniquesUpdated) {
    console.log(
      `Catalog techniques: created=${stats.techniquesCreated}, updated=${stats.techniquesUpdated}`,
    );
  }
  if (stats.questionsCreated || stats.questionsUpdated) {
    console.log(
      `Catalog questions: created=${stats.questionsCreated}, updated=${stats.questionsUpdated}`,
    );
  }

  const [techniques, questions] = await Promise.all([
    queryOne<{ count: string }>('SELECT COUNT(*)::text AS count FROM techniques'),
    queryOne<{ count: string }>('SELECT COUNT(*)::text AS count FROM questions'),
  ]);

  if (Number(techniques?.count ?? 0) !== EXPECTED_TECHNIQUE_COUNT) {
    console.warn(`Catalog sync: техник в БД ${techniques?.count}, ожидается ${EXPECTED_TECHNIQUE_COUNT}`);
  }
  if (Number(questions?.count ?? 0) !== EXPECTED_QUESTION_COUNT) {
    console.warn(`Catalog sync: вопросов в БД ${questions?.count}, ожидается ${EXPECTED_QUESTION_COUNT}`);
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
