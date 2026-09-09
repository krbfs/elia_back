import Database from 'better-sqlite3';
import path from 'node:path';
import fs from 'node:fs';

const dataDir = path.join(process.cwd(), 'data');
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

const dbPath = process.env.DATABASE_PATH ?? path.join(dataDir, 'elia.sqlite');
export const db = new Database(dbPath);

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    vk_user_id INTEGER PRIMARY KEY,
    first_name TEXT,
    last_name TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS profiles (
    vk_user_id INTEGER PRIMARY KEY,
    trimester TEXT,
    onboarding_completed INTEGER NOT NULL DEFAULT 0,
    base_type TEXT,
    secondary_type TEXT,
    scores_json TEXT,
    platform TEXT,
    last_stress INTEGER,
    techniques_completed INTEGER NOT NULL DEFAULT 0,
    crisis_level TEXT NOT NULL DEFAULT 'green',
    epds_score INTEGER,
    epds_completed_at TEXT,
    is_premium INTEGER NOT NULL DEFAULT 0,
    daily_techniques_date TEXT,
    daily_techniques_count INTEGER NOT NULL DEFAULT 0,
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (vk_user_id) REFERENCES users(vk_user_id)
  );
`);

const profileColumns = db
  .prepare('PRAGMA table_info(profiles)')
  .all() as { name: string }[];

function ensureProfileColumn(name: string, ddl: string) {
  if (!profileColumns.some((column) => column.name === name)) {
    db.exec(ddl);
  }
}

ensureProfileColumn('base_type', 'ALTER TABLE profiles ADD COLUMN base_type TEXT');
ensureProfileColumn('secondary_type', 'ALTER TABLE profiles ADD COLUMN secondary_type TEXT');
ensureProfileColumn('scores_json', 'ALTER TABLE profiles ADD COLUMN scores_json TEXT');
ensureProfileColumn('platform', 'ALTER TABLE profiles ADD COLUMN platform TEXT');
ensureProfileColumn('last_stress', 'ALTER TABLE profiles ADD COLUMN last_stress INTEGER');
ensureProfileColumn(
  'techniques_completed',
  'ALTER TABLE profiles ADD COLUMN techniques_completed INTEGER NOT NULL DEFAULT 0',
);
ensureProfileColumn(
  'crisis_level',
  "ALTER TABLE profiles ADD COLUMN crisis_level TEXT NOT NULL DEFAULT 'green'",
);
ensureProfileColumn('epds_score', 'ALTER TABLE profiles ADD COLUMN epds_score INTEGER');
ensureProfileColumn('epds_completed_at', 'ALTER TABLE profiles ADD COLUMN epds_completed_at TEXT');
ensureProfileColumn(
  'is_premium',
  'ALTER TABLE profiles ADD COLUMN is_premium INTEGER NOT NULL DEFAULT 0',
);
ensureProfileColumn(
  'daily_techniques_date',
  'ALTER TABLE profiles ADD COLUMN daily_techniques_date TEXT',
);
ensureProfileColumn(
  'daily_techniques_count',
  'ALTER TABLE profiles ADD COLUMN daily_techniques_count INTEGER NOT NULL DEFAULT 0',
);

db.exec(`
  CREATE TABLE IF NOT EXISTS techniques (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    text TEXT NOT NULL,
    duration_sec INTEGER NOT NULL,
    audio_url TEXT,
    level TEXT NOT NULL,
    context TEXT NOT NULL DEFAULT 'any',
    psychotypes_json TEXT NOT NULL DEFAULT '[]',
    reaction TEXT,
    evidence TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS favorites (
    vk_user_id INTEGER NOT NULL,
    technique_id INTEGER NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    PRIMARY KEY (vk_user_id, technique_id),
    FOREIGN KEY (technique_id) REFERENCES techniques(id)
  );

  CREATE TABLE IF NOT EXISTS partner_profiles (
    user_vk_id INTEGER PRIMARY KEY,
    subjective_base_type TEXT,
    subjective_secondary_type TEXT,
    subjective_scores_json TEXT,
    partner_vk_id INTEGER,
    partner_self_base_type TEXT,
    partner_self_secondary_type TEXT,
    partner_self_scores_json TEXT,
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (user_vk_id) REFERENCES users(vk_user_id)
  );
`);

export type TechniqueRow = {
  id: number;
  title: string;
  text: string;
  duration_sec: number;
  audio_url: string | null;
  level: string;
  context: string;
  psychotypes_json: string;
  reaction: string;
  evidence: string;
  created_at: string;
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
  updated_at: string;
};

export type ProfileRow = {
  vk_user_id: number;
  trimester: string | null;
  onboarding_completed: number;
  base_type: string | null;
  secondary_type: string | null;
  scores_json: string | null;
  platform: string | null;
  last_stress: number | null;
  techniques_completed: number;
  crisis_level: string;
  epds_score: number | null;
  epds_completed_at: string | null;
  is_premium: number;
  daily_techniques_date: string | null;
  daily_techniques_count: number;
  updated_at: string;
};

export type UserRow = {
  vk_user_id: number;
  first_name: string | null;
  last_name: string | null;
  created_at: string;
  updated_at: string;
};
