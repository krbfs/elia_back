#!/usr/bin/env python3
"""
Наполнение БД проекта «Элия» (Express + Postgres).

Адаптация seed_data.py под текущую схему elia_back:
- techniques ← data/techniques_catalog.json
- users + profiles ← тестовые dev-аккаунты

Опросник (questionnaire_full.json) в БД не хранится — только во фронте.

Использование:
    python scripts/seed_data.py --techniques          # загрузить техники (если таблица пуста)
    python scripts/seed_data.py --techniques --force  # перезалить техники
    python scripts/seed_data.py --users 10            # 10 тестовых пользователей
    python scripts/seed_data.py --all                 # техники + 10 пользователей
    python scripts/seed_data.py --clear-test-users  # удалить тестовых (vk_user_id 900000xxx)

Требуется: DATABASE_URL в .env, pip install psycopg2-binary
"""

from __future__ import annotations

import argparse
import json
import os
import sys
from pathlib import Path

try:
    import psycopg2
    import psycopg2.extras
except ImportError:
    print("❌ Нужен psycopg2: pip install psycopg2-binary")
    sys.exit(1)


PROJECT_ROOT = Path(__file__).resolve().parent.parent
DATA_DIR = PROJECT_ROOT / "data"
TECHNIQUES_FILE = DATA_DIR / "techniques_catalog.json"

TEST_USER_ID_BASE = 900_000_001
DURATION_SEC = {"short": 90, "medium": 180, "long": 300}

PSYCHOTYPES = [
    "Индивидуалист",
    "Инноватор",
    "Лидер Мнений",
    "Эстет",
    "Консерватор",
    "Эмпат",
    "Аналитик",
    "Прагматик",
]
SECONDARY_TYPES = [
    "Эмпат",
    "Консерватор",
    "Эмпат",
    "Аналитик",
    "Консерватор",
    "Инноватор",
    "Лидер Мнений",
    "Эстет",
]


def load_env() -> None:
    env_path = PROJECT_ROOT / ".env"
    if not env_path.exists():
        return
    for line in env_path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        key = key.strip()
        value = value.strip().strip('"').strip("'")
        os.environ.setdefault(key, value)


def get_connection():
    url = os.environ.get("DATABASE_URL")
    if not url:
        print("❌ DATABASE_URL не задан (см. .env)")
        sys.exit(1)
    return psycopg2.connect(url)


def load_json(path: Path) -> dict:
    if not path.exists():
        raise FileNotFoundError(f"Файл не найден: {path}")
    with open(path, encoding="utf-8") as handle:
        return json.load(handle)


def map_technique(raw: dict) -> dict:
    tags = raw.get("tags") or {}
    content = raw.get("content") or {}
    duration = content.get("timer_seconds") or content.get("audio_duration_seconds")
    if not duration:
        duration = DURATION_SEC.get(tags.get("duration"), 120)

    levels = tags.get("level") or ["yellow"]
    contexts = tags.get("context") or ["any"]
    psychotypes = tags.get("psychotypes") or []
    reactions = tags.get("stress_reaction") or ["any"]

    return {
        "title": raw["title"],
        "text": content.get("text") or raw.get("description", ""),
        "duration_sec": int(duration),
        "audio_url": content.get("audio_url"),
        "level": levels[0],
        "context": contexts[0],
        "psychotypes_json": json.dumps(psychotypes, ensure_ascii=False),
        "reaction": reactions[0],
        "evidence": raw.get("scientific_basis", ""),
    }


def seed_techniques(force: bool = False) -> int:
    print("\n📚 Загрузка техник из каталога...")
    data = load_json(TECHNIQUES_FILE)
    items = data.get("techniques") or []
    if not items:
        print("⚠️  Каталог техник пуст")
        return 0

    mapped = [map_technique(item) for item in items]

    with get_connection() as conn:
        with conn.cursor() as cur:
            cur.execute("SELECT COUNT(*) FROM techniques")
            count = cur.fetchone()[0]
            if count > 0 and not force:
                print(f"⚠️  В БД уже {count} техник. Используйте --force для перезаливки.")
                return 0

            if force and count > 0:
                # Очистка удалила бы избранное, историю прохождений и подарки (ON DELETE CASCADE).
                print("⚠️  Перезаливка через этот скрипт отключена.")
                print("   Используйте npm run load-data — он обновляет техники по catalog_id без удаления.")
                return 0

            psycopg2.extras.execute_batch(
                cur,
                """
                INSERT INTO techniques (
                  title, text, duration_sec, audio_url, level, context,
                  psychotypes_json, reaction, evidence
                ) VALUES (
                  %(title)s, %(text)s, %(duration_sec)s, %(audio_url)s,
                  %(level)s, %(context)s, %(psychotypes_json)s, %(reaction)s, %(evidence)s
                )
                """,
                mapped,
            )
        conn.commit()

    print(f"✅ Загружено техник: {len(mapped)}")
    return len(mapped)


def seed_test_users(count: int = 10) -> int:
    print(f"\n👥 Создание {count} тестовых пользователей (vk_user_id {TEST_USER_ID_BASE}+)...")
    created = 0

    with get_connection() as conn:
        with conn.cursor() as cur:
            for i in range(count):
                vk_id = TEST_USER_ID_BASE + i
                base_type = PSYCHOTYPES[i % len(PSYCHOTYPES)]
                secondary = SECONDARY_TYPES[i % len(SECONDARY_TYPES)]
                scores = {
                    "agr": round(0.1 + i * 0.1, 2),
                    "sp": round(0.2 + i * 0.05, 2),
                    "ex": round(0.3 + i * 0.05, 2),
                    "lab": round(0.4 + i * 0.05, 2),
                    "tr": round(0.5 + i * 0.05, 2),
                    "sen": round(0.6 + i * 0.05, 2),
                    "in": round(0.7 + i * 0.05, 2),
                    "rig": round(0.8 + i * 0.05, 2),
                }

                cur.execute(
                    """
                    INSERT INTO users (vk_user_id, first_name, last_name)
                    VALUES (%s, %s, %s)
                    ON CONFLICT (vk_user_id) DO UPDATE SET
                      first_name = EXCLUDED.first_name,
                      last_name = EXCLUDED.last_name,
                      updated_at = NOW()
                    """,
                    (vk_id, f"Тест{i + 1}", "Пользователь"),
                )
                cur.execute(
                    """
                    INSERT INTO profiles (
                      vk_user_id, trimester, onboarding_completed,
                      base_type, secondary_type, scores_json, platform
                    ) VALUES (%s, %s, TRUE, %s, %s, %s, %s)
                    ON CONFLICT (vk_user_id) DO UPDATE SET
                      trimester = EXCLUDED.trimester,
                      onboarding_completed = EXCLUDED.onboarding_completed,
                      base_type = EXCLUDED.base_type,
                      secondary_type = EXCLUDED.secondary_type,
                      scores_json = EXCLUDED.scores_json,
                      platform = EXCLUDED.platform,
                      updated_at = NOW()
                    """,
                    (
                        vk_id,
                        str((i % 3) + 1),
                        base_type,
                        secondary,
                        json.dumps(scores, ensure_ascii=False),
                        "dev_seed",
                    ),
                )
                created += 1
                print(f"  ✓ vk_user_id={vk_id} ({base_type})")
        conn.commit()

    print(f"✅ Пользователей: {created}")
    return created


def clear_test_users() -> int:
    print("\n🗑️  Удаление тестовых пользователей (900000001–900000999)...")
    with get_connection() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                DELETE FROM users
                WHERE vk_user_id >= %s AND vk_user_id <= %s
                """,
                (TEST_USER_ID_BASE, TEST_USER_ID_BASE + 999),
            )
            deleted = cur.rowcount
        conn.commit()
    print(f"✅ Удалено: {deleted}")
    return deleted


def main() -> None:
    load_env()
    parser = argparse.ArgumentParser(description="Seed data для elia_back (Postgres)")
    parser.add_argument("--techniques", action="store_true", help="Загрузить техники из JSON")
    parser.add_argument("--force", action="store_true", help="Перезалить техники")
    parser.add_argument("--users", type=int, metavar="N", help="Создать N тестовых пользователей")
    parser.add_argument("--all", action="store_true", help="Техники + 10 пользователей")
    parser.add_argument("--clear-test-users", action="store_true", help="Удалить тестовых пользователей")
    args = parser.parse_args()

    if not any([args.techniques, args.users, args.all, args.clear_test_users]):
        parser.print_help()
        sys.exit(0)

    print("=" * 60)
    print("🌸 SEED DATA — «ЭЛИЯ»")
    print("=" * 60)

    try:
        if args.clear_test_users:
            clear_test_users()
        if args.all or args.techniques:
            seed_techniques(force=args.force)
        if args.all:
            seed_test_users(10)
        elif args.users is not None:
            seed_test_users(args.users)
    except Exception as error:
        print(f"\n❌ Ошибка: {error}")
        sys.exit(1)


if __name__ == "__main__":
    main()
