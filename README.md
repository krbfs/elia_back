# Elia Back

REST API для Elia: Express + TypeScript + Neon Postgres.

## Запуск

```bash
npm install
cp .env.example .env
npm run dev
```

API: http://localhost:3001  
Health: http://localhost:3001/health

## Переменные окружения

| Переменная | Описание |
|------------|----------|
| `PORT` | Порт API (по умолчанию 3001) |
| `FRONTEND_URL` | Origin фронта для CORS |
| `DATABASE_URL` | Neon Postgres (pooled connection string) |
| `DATABASE_SSL` | `true` — принудительный SSL |

## Основные эндпоинты

- `GET /health`
- `POST /auth/verify-vk-token` — VK access_token → JWT
- `POST /auth/refresh` — обновление JWT
- `POST /auth/dev-login` — локальный вход (ALLOW_DEV_AUTH=true)
- `GET /admin/summary` — счётчики таблиц (ENABLE_ADMIN=true)
- `POST /users/sync`
- `GET/POST/DELETE /profile`
- `GET /techniques/recommend`
- `POST /techniques/complete`
- `GET/POST/DELETE /favorites`
- `GET/POST /partner/*`
- `POST /epds`
- `POST /premium/activate`

## Данные (этап 1)

```bash
npm run load-data          # 39 техник + 10 вопросов из data/*.json
npm run load-data -- --force
npx tsx scripts/stage1_check.ts
python3 scripts/validate_catalog.py
```
