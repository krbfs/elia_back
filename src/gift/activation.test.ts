import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import { query, queryAll, queryOne } from '../db.js';
import type { TechniqueGiftRow } from '../db.js';
import { activateGift, createGift, GIFT_MAX_ACTIVE_PER_RECIPIENT } from './gift.js';

vi.mock('../db.js', () => ({
  query: vi.fn(async () => undefined),
  queryAll: vi.fn(async () => []),
  queryOne: vi.fn(async () => undefined),
}));

const queryMock = query as unknown as Mock;
const queryAllMock = queryAll as unknown as Mock;
const queryOneMock = queryOne as unknown as Mock;

const SENDER = 100;
const RECIPIENT = 200;
const TOKEN = 'a'.repeat(32);

function giftRow(partial: Partial<TechniqueGiftRow> = {}): TechniqueGiftRow {
  const tomorrow = new Date(Date.now() + 24 * 60 * 60 * 1000);
  return {
    id: 1,
    token: TOKEN,
    technique_id: 12,
    sender_vk_id: SENDER,
    recipient_vk_id: null,
    token_expires_at: tomorrow.toISOString(),
    activated_at: null,
    access_expires_at: null,
    created_at: new Date(),
    ...partial,
  } as TechniqueGiftRow;
}

/** Сценарии, которые нельзя проверить юнит-тестом: активация читает и пишет несколько таблиц. */
function mockDb(options: { gift?: TechniqueGiftRow | null; active?: number; duplicate?: boolean }) {
  const active = options.active ?? 0;
  queryAllMock.mockImplementation(async () =>
    Array.from({ length: active }, (_, index) => giftRow({ id: index + 10 })),
  );
  queryOneMock.mockImplementation(async (sql: string) => {
    if (sql.includes('SELECT * FROM technique_gifts')) return options.gift ?? undefined;
    if (sql.includes('AND sender_vk_id = $2')) return options.duplicate ? { id: 7 } : undefined;
    if (sql.includes('FROM techniques WHERE id')) return { id: 12 };
    return undefined;
  });
}

describe('активация подарка', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('открывает доступ на 7 дней и помечает подарок использованным', async () => {
    mockDb({ gift: giftRow() });

    const result = await activateGift(TOKEN, RECIPIENT);
    expect(result).toMatchObject({ ok: true, technique_id: 12 });
    if (!result.ok) return;

    const days = Math.round(
      (new Date(result.access_expires_at).getTime() - Date.now()) / (24 * 60 * 60 * 1000),
    );
    expect(days).toBe(7);

    // Повторная активация исключена на уровне SQL: обновляем только неактивированный подарок.
    const update = queryMock.mock.calls.find(([sql]) => String(sql).includes('UPDATE technique_gifts'));
    expect(update?.[0]).toContain('activated_at IS NULL');
  });

  it('не отдаёт доступ при четвёртом активном подарке (п. 12)', async () => {
    mockDb({ gift: giftRow(), active: GIFT_MAX_ACTIVE_PER_RECIPIENT });

    await expect(activateGift(TOKEN, RECIPIENT)).resolves.toEqual({
      ok: false,
      reason: 'limit_reached',
    });
    expect(queryMock.mock.calls.some(([sql]) => String(sql).includes('UPDATE'))).toBe(false);
  });

  it('не даёт подарить ту же технику тому же человеку дважды', async () => {
    mockDb({ gift: giftRow(), duplicate: true });

    await expect(activateGift(TOKEN, RECIPIENT)).resolves.toEqual({
      ok: false,
      reason: 'duplicate',
    });
  });

  it('подарок себе не открывает премиум', async () => {
    mockDb({ gift: giftRow() });

    await expect(activateGift(TOKEN, SENDER)).resolves.toEqual({ ok: false, reason: 'own_gift' });
    expect(queryAllMock).not.toHaveBeenCalled();
  });

  it('истёкшая ссылка и активированный подарок отклоняются', async () => {
    mockDb({ gift: giftRow({ token_expires_at: new Date(Date.now() - 1000).toISOString() }) });
    await expect(activateGift(TOKEN, RECIPIENT)).resolves.toEqual({
      ok: false,
      reason: 'expired',
    });

    mockDb({ gift: giftRow({ activated_at: new Date() }) });
    await expect(activateGift(TOKEN, RECIPIENT)).resolves.toEqual({ ok: false, reason: 'used' });

    mockDb({ gift: null });
    await expect(activateGift(TOKEN, RECIPIENT)).resolves.toEqual({
      ok: false,
      reason: 'not_found',
    });
  });

  it('подарок несуществующей техники не создаётся', async () => {
    queryOneMock.mockImplementation(async () => undefined);
    await expect(createGift(SENDER, 999)).resolves.toBeNull();
    expect(queryMock).not.toHaveBeenCalled();
  });
});
