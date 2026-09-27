import 'dotenv/config';
import pg from 'pg';

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  throw new Error('DATABASE_URL is required (Neon Postgres connection string)');
}

// BIGINT (oid 20) по умолчанию приходит строкой, а vk_user_id во всех типах — number.
// Из-за этого сравнения вида gift.sender_vk_id === recipientVkId молча давали false.
pg.types.setTypeParser(20, (value) => Number(value));

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
      psychotype_code TEXT,
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
      actions_taken TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS stress_log (
      id SERIAL PRIMARY KEY,
      vk_user_id BIGINT NOT NULL REFERENCES users(vk_user_id) ON DELETE CASCADE,
      stress_level INTEGER NOT NULL,
      logged_date DATE NOT NULL DEFAULT CURRENT_DATE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE (vk_user_id, logged_date)
    );

    CREATE TABLE IF NOT EXISTS mood_entries (
      id SERIAL PRIMARY KEY,
      vk_user_id BIGINT NOT NULL REFERENCES users(vk_user_id) ON DELETE CASCADE,
      mood_score INTEGER NOT NULL CHECK (mood_score BETWEEN 1 AND 5),
      note TEXT,
      logged_date DATE NOT NULL DEFAULT CURRENT_DATE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE (vk_user_id, logged_date)
    );

    -- §13: продуктовые и научные события без персональных данных.
    CREATE TABLE IF NOT EXISTS analytics_events (
      id SERIAL PRIMARY KEY,
      user_hash TEXT NOT NULL,
      event TEXT NOT NULL,
      screen TEXT,
      payload_json TEXT NOT NULL DEFAULT '{}',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE INDEX IF NOT EXISTS idx_analytics_events_event_created
      ON analytics_events (event, created_at DESC);

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
      invite_token TEXT UNIQUE,
      invite_expires_at TIMESTAMPTZ,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS technique_usage (
      id SERIAL PRIMARY KEY,
      vk_user_id BIGINT NOT NULL REFERENCES users(vk_user_id) ON DELETE CASCADE,
      technique_id INTEGER NOT NULL REFERENCES techniques(id) ON DELETE CASCADE,
      stress_before INTEGER NOT NULL CHECK (stress_before BETWEEN 1 AND 10),
      stress_after INTEGER NOT NULL CHECK (stress_after BETWEEN 1 AND 10),
      zone TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE INDEX IF NOT EXISTS idx_technique_usage_user_created
      ON technique_usage (vk_user_id, created_at DESC);

    CREATE TABLE IF NOT EXISTS technique_gifts (
      id SERIAL PRIMARY KEY,
      token TEXT UNIQUE NOT NULL,
      technique_id INTEGER NOT NULL REFERENCES techniques(id) ON DELETE CASCADE,
      sender_vk_id BIGINT NOT NULL REFERENCES users(vk_user_id) ON DELETE CASCADE,
      recipient_vk_id BIGINT,
      token_expires_at TIMESTAMPTZ NOT NULL,
      activated_at TIMESTAMPTZ,
      access_expires_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE INDEX IF NOT EXISTS idx_technique_gifts_recipient
      ON technique_gifts (recipient_vk_id, access_expires_at DESC);

    ALTER TABLE profiles ADD COLUMN IF NOT EXISTS psychotype_code TEXT;
    ALTER TABLE profiles ADD COLUMN IF NOT EXISTS psychotype_updated_at TIMESTAMPTZ;
    -- Ответы 27.09: триггер заботы показываем один раз, стресс-замер — не чаще раза в день.
    ALTER TABLE profiles ADD COLUMN IF NOT EXISTS care_trigger_shown BOOLEAN NOT NULL DEFAULT FALSE;
    ALTER TABLE profiles ADD COLUMN IF NOT EXISTS stress_checked_date TEXT;
    ALTER TABLE techniques ADD COLUMN IF NOT EXISTS catalog_id INTEGER UNIQUE;
    ALTER TABLE techniques ADD COLUMN IF NOT EXISTS slug TEXT;
    ALTER TABLE techniques ADD COLUMN IF NOT EXISTS is_premium BOOLEAN NOT NULL DEFAULT FALSE;
    ALTER TABLE techniques ADD COLUMN IF NOT EXISTS tags_json TEXT NOT NULL DEFAULT '{}';
    ALTER TABLE crisis_incidents ADD COLUMN IF NOT EXISTS actions_taken TEXT;
    ALTER TABLE partner_profiles ADD COLUMN IF NOT EXISTS invite_token TEXT UNIQUE;
    ALTER TABLE partner_profiles ADD COLUMN IF NOT EXISTS invite_expires_at TIMESTAMPTZ;
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
  /** Зона стресса техники — совпадает с StressZone в recommend.ts. */
  level: 'red' | 'yellow' | 'green';
  context: string;
  psychotypes_json: string;
  reaction: string;
  evidence: string;
  is_premium: boolean;
  tags_json: string;
  created_at: Date | string;
};

export type TechniqueGiftRow = {
  id: number;
  token: string;
  technique_id: number;
  sender_vk_id: number;
  recipient_vk_id: number | null;
  token_expires_at: Date | string;
  activated_at: Date | string | null;
  access_expires_at: Date | string | null;
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
  invite_token: string | null;
  invite_expires_at: Date | string | null;
  updated_at: Date | string;
};

export type ProfileRow = {
  vk_user_id: number;
  trimester: string | null;
  onboarding_completed: boolean;
  base_type: string | null;
  psychotype_code: string | null;
  psychotype_updated_at?: Date | string | null;
  care_trigger_shown?: boolean;
  stress_checked_date?: string | null;
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

export type TechniqueUsageRow = {
  id: number;
  vk_user_id: number;
  technique_id: number;
  stress_before: number;
  stress_after: number;
  zone: string | null;
  created_at: Date | string;
};
