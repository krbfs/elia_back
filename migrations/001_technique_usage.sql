-- Neon / Postgres: история прохождения техник (stress_before / stress_after)
-- Применяется автоматически через initDb(); файл — для ручного прогона при необходимости.

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
