import { describe, expect, it } from 'vitest';
import {
  ANALYTICS_EVENTS,
  ANALYTICS_RETENTION_DAYS,
  hashUserId,
  isAnalyticsEvent,
  sanitizePayload,
} from './events.js';

describe('аналитика (§13, ответы 27.09 п. 5)', () => {
  it('принимает только согласованные 12 событий', () => {
    expect(ANALYTICS_EVENTS).toHaveLength(12);
    expect(isAnalyticsEvent('technique_completed')).toBe(true);
    expect(isAnalyticsEvent('mood_logged')).toBe(false);
    expect(isAnalyticsEvent('')).toBe(false);
  });

  it('идентификатор необратим и стабилен', () => {
    const hash = hashUserId(12345);
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    expect(hash).toBe(hashUserId(12345));
    expect(hash).not.toContain('12345');
    expect(hashUserId(12346)).not.toBe(hash);
  });

  it('из payload выбрасывает всё, кроме разрешённых обезличенных полей', () => {
    expect(
      sanitizePayload({
        stress_before: 7,
        stress_after: 4,
        technique_id: 12,
        note: 'мне очень тяжело',
        first_name: 'Аня',
        vk_user_id: 777,
        epds_score: 14,
      }),
    ).toEqual({ stress_before: 7, stress_after: 4, technique_id: 12 });

    expect(sanitizePayload(null)).toEqual({});
    expect(sanitizePayload('строка')).toEqual({});
    // Длинные строки не проходят: в них может уехать свободный текст.
    expect(sanitizePayload({ reason: 'x'.repeat(65) })).toEqual({});
  });

  it('срок хранения подробных событий — 6 месяцев', () => {
    expect(ANALYTICS_RETENTION_DAYS).toBe(180);
  });
});
