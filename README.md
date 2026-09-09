# Elia Back

REST API для Elia: Express + TypeScript + SQLite.

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
| `DATABASE_PATH` | Путь к SQLite (по умолчанию `data/elia.sqlite`) |

## Основные эндпоинты

- `GET /health`
- `POST /users/sync`
- `GET/POST/DELETE /profile`
- `GET /techniques/recommend`
- `POST /techniques/complete`
- `GET/POST/DELETE /favorites`
- `GET/POST /partner/*`
- `POST /epds`
- `POST /premium/activate`
