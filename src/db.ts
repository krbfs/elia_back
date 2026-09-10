import 'dotenv/config';
import pg from 'pg';

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  throw new Error('DATABASE_URL is required (Neon Postgres connection string)');
}

export const pool = new pg.Pool({
  connectionString,
  ssl: connectionString.includes('neon.tech') || process.env.DATABASE_SSL === 'true'
    ? { rejectUnauthorized: false }
    : undefined,
  max: Number(process.env.DATABASE_POOL_MAX ?? 10),
});

export async function query(text: string, params: unknown[] = []) {
  return pool.query(text, params);
}

export async function queryOne<T>(text: string, params: unknown[] = []): Promise<T | undefined> {
  const result = await pool.query(text, params);
  return (result.rows[0] as T) ?? undefined;
}

export async function queryAll<T>(text: string, params: unknown[] = []): Promise<T[]> {
  const result = await pool.query(text, params);
  return result.rows as T[];
}

export async function initDb() {
  await query(`
    CREATE TABLE IF NOT EXISTS users (
      vk_user_id BIGINT PRIMARY KEY,
      first_name TEXT,
      last_name TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS profiles (
      vk_user_id BIGINT PRIMARY KEY REFERENCES users(vk_user_id) ON DELETE CASCADE,
      trimester TEXT,
      onboarding_completed BOOLEAN NOT NULL DEFAULT FALSE,
      base_type TEXT,
      secondary_type TEXT,
      scores_json TEXT,
      platform TEXT,
      last_stress INTEGER,
      techniques_completed INTEGER NOT NULL DEFAULT 0,
      crisis_level TEXT NOT NULL DEFAULT 'green',
      epds_score INTEGER,
      epds_completed_at TIMESTAMPTZ,
      is_premium BOOLEAN NOT NULL DEFAULT FALSE,
      daily_techniques_date TEXT,
      daily_techniques_count INTEGER NOT NULL DEFAULT 0,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS techniques (
      id SERIAL PRIMARY KEY,
      catalog_id INTEGER UNIQUE,
      slug TEXT,
      title TEXT NOT NULL,
      text TEXT NOT NULL,
      duration_sec INTEGER NOT NULL,
      audio_url TEXT,
      level TEXT NOT NULL,
      context TEXT NOT NULL DEFAULT 'any',
      psychotypes_json TEXT NOT NULL DEFAULT '[]',
      reaction TEXT,
      evidence TEXT,
      is_premium BOOLEAN NOT NULL DEFAULT FALSE,
      tags_json TEXT NOT NULL DEFAULT '{}',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS questions (
      question_number INTEGER PRIMARY KEY,
      context TEXT NOT NULL,
      text TEXT NOT NULL,
      options_json TEXT NOT NULL,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS subscriptions (
      id SERIAL PRIMARY KEY,
      vk_user_id BIGINT NOT NULL REFERENCES users(vk_user_id) ON DELETE CASCADE,
      status TEXT NOT NULL DEFAULT 'active',
      started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      expires_at TIMESTAMPTZ,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS payments (
      id SERIAL PRIMARY KEY,
      vk_user_id BIGINT NOT NULL REFERENCES users(vk_user_id) ON DELETE CASCADE,
      amount INTEGER NOT NULL,
      currency TEXT NOT NULL DEFAULT 'RUB',
      status TEXT NOT NULL DEFAULT 'pending',
      vk_payment_id TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      completed_at TIMESTAMPTZ
    );

    CREATE TABLE IF NOT EXISTS crisis_incidents (
      id SERIAL PRIMARY KEY,
      vk_user_id BIGINT NOT NULL REFERENCES users(vk_user_id) ON DELETE CASCADE,
      trigger_type TEXT NOT NULL,
      trigger_value TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS auth_refresh_tokens (
      token_hash TEXT PRIMARY KEY,
      vk_user_id BIGINT NOT NULL REFERENCES users(vk_user_id) ON DELETE CASCADE,
      expires_at TIMESTAMPTZ NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS favorites (
      vk_user_id BIGINT NOT NULL,
      technique_id INTEGER NOT NULL REFERENCES techniques(id) ON DELETE CASCADE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (vk_user_id, technique_id)
    );

    CREATE TABLE IF NOT EXISTS partner_profiles (
      user_vk_id BIGINT PRIMARY KEY REFERENCES users(vk_user_id) ON DELETE CASCADE,
      subjective_base_type TEXT,
      subjective_secondary_type TEXT,
      subjective_scores_json TEXT,
      partner_vk_id BIGINT,
      partner_self_base_type TEXT,
      partner_self_secondary_type TEXT,
      partner_self_scores_json TEXT,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    ALTER TABLE techniques ADD COLUMN IF NOT EXISTS catalog_id INTEGER UNIQUE;
    ALTER TABLE techniques ADD COLUMN IF NOT EXISTS slug TEXT;
    ALTER TABLE techniques ADD COLUMN IF NOT EXISTS is_premium BOOLEAN NOT NULL DEFAULT FALSE;
    ALTER TABLE techniques ADD COLUMN IF NOT EXISTS tags_json TEXT NOT NULL DEFAULT '{}';
  `);
}

export type TechniqueRow = {
  id: number;
  catalog_id: number | null;
  slug: string | null;
  title: string;
  text: string;
  duration_sec: number;
  audio_url: string | null;
  level: string;
  context: string;
  psychotypes_json: string;
  reaction: string;
  evidence: string;
  is_premium: boolean;
  tags_json: string;
  created_at: Date | string;
};

export type PartnerProfileRow = {
  user_vk_id: number;
  subjective_base_type: string | null;
  subjective_secondary_type: string | null;
  subjective_scores_json: string | null;
  partner_vk_id: number | null;
  partner_self_base_type: string | null;
  partner_self_secondary_type: string | null;
  partner_self_scores_json: string | null;
  updated_at: Date | string;
};

export type ProfileRow = {
  vk_user_id: number;
  trimester: string | null;
  onboarding_completed: boolean;
  base_type: string | null;
  secondary_type: string | null;
  scores_json: string | null;
  platform: string | null;
  last_stress: number | null;
  techniques_completed: number;
  crisis_level: string;
  epds_score: number | null;
  epds_completed_at: Date | string | null;
  is_premium: boolean;
  daily_techniques_date: string | null;
  daily_techniques_count: number;
  updated_at: Date | string;
};

export type UserRow = {
  vk_user_id: number;
  first_name: string | null;
  last_name: string | null;
  created_at: Date | string;
  updated_at: Date | string;
};
