import { describe, expect, it } from 'vitest';
import {
  GIFT_ACCESS_DAYS,
  GIFT_MAX_ACTIVE_PER_RECIPIENT,
  GIFT_TOKEN_TTL_DAYS,
  generateGiftToken,
  giftAccessExpiresAt,
  giftTokenExpiresAt,
  isGiftAccessActive,
} from './gift.js';

const DAY_MS = 24 * 60 * 60 * 1000;

describe('«Подари технику» (§9.4)', () => {
  it('токен — 32 hex-символа и не повторяется', () => {
    const token = generateGiftToken();
    expect(token).toMatch(/^[0-9a-f]{32}$/);
    expect(token).not.toBe(generateGiftToken());
  });

  it('ссылка живёт 7 дней, доступ получателю — тоже 7 дней', () => {
    const from = new Date('2026-09-25T10:00:00.000Z');

    expect(GIFT_TOKEN_TTL_DAYS).toBe(7);
    expect(GIFT_ACCESS_DAYS).toBe(7);
    expect(giftTokenExpiresAt(from).getTime() - from.getTime()).toBe(7 * DAY_MS);
    expect(giftAccessExpiresAt(from).getTime() - from.getTime()).toBe(7 * DAY_MS);
  });

  it('доступ считается активным только до конца срока', () => {
    const now = new Date('2026-09-25T10:00:00.000Z');

    expect(isGiftAccessActive({ access_expires_at: null }, now)).toBe(false);
    expect(
      isGiftAccessActive({ access_expires_at: '2026-09-25T09:59:59.000Z' }, now),
    ).toBe(false);
    expect(isGiftAccessActive({ access_expires_at: giftAccessExpiresAt(now) }, now)).toBe(true);
  });

  it('лимит активных подарков у получателя — 3 (ответы 25.09, п. 12)', () => {
    expect(GIFT_MAX_ACTIVE_PER_RECIPIENT).toBe(3);
  });
});
