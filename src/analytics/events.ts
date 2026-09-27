import crypto from 'node:crypto';
import { query, queryAll } from '../db.js';

/**
 * Аналитика (Навигатор §13, ответы 27.09, п. 5).
 * Схема гибридная: бизнес-метрики уедут во внешний счётчик, когда появится его ID,
 * а продуктовые и научные события живут здесь — с хешированным идентификатором,
 * без текстов, заметок и любых персональных данных.
 * Подробные события храним 180 дней, дальше остаются только агрегаты.
 */
export const ANALYTICS_EVENTS = [
  'welcome_shown',
  'onboarding_completed',
  'stress_checked',
  'questionnaire_started',
  'questionnaire_completed',
  'technique_started',
  'technique_completed',
  'emergency_used',
  'crisis_triggered',
  'partner_invited',
  'premium_viewed',
  'premium_purchased',
] as const;

export type AnalyticsEvent = (typeof ANALYTICS_EVENTS)[number];

export const ANALYTICS_RETENTION_DAYS = 180;

/** Числовые и короткие строковые значения — всё, что можно писать в payload. */
const ALLOWED_PAYLOAD_KEYS = new Set([
  'screen',
  'zone',
  'stress_before',
  'stress_after',
  'stress_level',
  'technique_id',
  'psychotype',
  'trimester',
  'reason',
  'mood_score',
]);

export function isAnalyticsEvent(value: unknown): value is AnalyticsEvent {
  return typeof value === 'string' && (ANALYTICS_EVENTS as readonly string[]).includes(value);
}

/**
 * Необратимый идентификатор: sha256(SECRET_KEY + vk_user_id).
 * Без секрета хеш можно было бы подобрать перебором — идентификаторов VK мало.
 */
export function hashUserId(vkUserId: number): string {
  const secret = process.env.SECRET_KEY ?? process.env.JWT_SECRET ?? '';
  return crypto.createHash('sha256').update(`${secret}:${vkUserId}`).digest('hex');
}

/** Оставляем только разрешённые ключи и обезличенные значения. */
export function sanitizePayload(payload: unknown): Record<string, number | string> {
  if (!payload || typeof payload !== 'object') return {};

  const result: Record<string, number | string> = {};
  for (const [key, value] of Object.entries(payload as Record<string, unknown>)) {
    if (!ALLOWED_PAYLOAD_KEYS.has(key)) continue;
    if (typeof value === 'number' && Number.isFinite(value)) {
      result[key] = value;
    } else if (typeof value === 'string' && value.length <= 64) {
      result[key] = value;
    }
  }
  return result;
}

export async function logAnalyticsEvent(params: {
  vkUserId: number;
  event: AnalyticsEvent;
  screen?: string | null;
  payload?: unknown;
}): Promise<void> {
  await query(
    `INSERT INTO analytics_events (user_hash, event, screen, payload_json)
     VALUES ($1, $2, $3, $4)`,
    [
      hashUserId(params.vkUserId),
      params.event,
      typeof params.screen === 'string' ? params.screen.slice(0, 64) : null,
      JSON.stringify(sanitizePayload(params.payload)),
    ],
  );
}

/** Ежедневная уборка: подробные события старше 180 дней удаляем. */
export async function pruneAnalyticsEvents(): Promise<number> {
  const result = await query(
    `DELETE FROM analytics_events
     WHERE created_at < NOW() - ($1 || ' days')::interval`,
    [String(ANALYTICS_RETENTION_DAYS)],
  );
  return result.rowCount ?? 0;
}

export async function analyticsSummary(): Promise<{ event: string; count: number }[]> {
  return queryAll<{ event: string; count: number }>(
    `SELECT event, COUNT(*)::int AS count
     FROM analytics_events
     WHERE created_at >= NOW() - INTERVAL '30 days'
     GROUP BY event
     ORDER BY count DESC`,
  );
}
