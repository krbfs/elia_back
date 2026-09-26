import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import { pool } from '../db.js';
import {
  EXPECTED_QUESTION_COUNT,
  EXPECTED_TECHNIQUE_COUNT,
  ensureCatalogSeeded,
  loadTechniquesFromCatalog,
} from './loadCatalog.js';

vi.mock('../db.js', () => ({
  pool: { connect: vi.fn() },
  queryOne: vi.fn(async () => ({ count: '40' })),
}));

type Reply = { rows: { inserted?: boolean; catalog_id?: number; title?: string }[]; rowCount: number };

const orphanRow = { catalog_id: 99, title: 'Снятая техника' };
let queries: string[] = [];

/** Подменяем клиента pg: важно не что вернёт БД, а какие запросы сидер отправляет. */
function mockClient(options: { orphans?: boolean; inserted?: boolean } = {}) {
  queries = [];
  const query = vi.fn(async (sql: string): Promise<Reply> => {
    queries.push(sql);
    if (sql.includes('SELECT catalog_id, title FROM techniques')) {
      return options.orphans
        ? { rows: [orphanRow], rowCount: 1 }
        : { rows: [], rowCount: 0 };
    }
    if (sql.includes('INSERT INTO')) {
      return options.inserted
        ? { rows: [{ inserted: true }], rowCount: 1 }
        : { rows: [], rowCount: 0 };
    }
    return { rows: [], rowCount: 0 };
  });

  (pool.connect as unknown as Mock).mockResolvedValue({ query, release: vi.fn() });
  return query;
}

function upsertCount(table: string): number {
  return queries.filter((sql) => sql.includes(`INSERT INTO ${table}`)).length;
}

describe('синхронизация каталога с БД', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('не очищает таблицы: ни TRUNCATE, ни DELETE без --force', async () => {
    mockClient();
    await loadTechniquesFromCatalog();

    expect(queries.some((sql) => sql.includes('TRUNCATE'))).toBe(false);
    expect(queries.some((sql) => sql.includes('DELETE FROM'))).toBe(false);
    expect(upsertCount('techniques')).toBe(EXPECTED_TECHNIQUE_COUNT);
    expect(queries.some((sql) => sql.includes('ON CONFLICT (catalog_id) DO UPDATE'))).toBe(true);
  });

  it('техники вне каталога удаляются только с --force', async () => {
    mockClient({ orphans: true });
    await loadTechniquesFromCatalog();
    expect(queries.some((sql) => sql.includes('DELETE FROM techniques'))).toBe(false);

    mockClient({ orphans: true });
    await loadTechniquesFromCatalog({ force: true });
    expect(queries.some((sql) => sql.includes('DELETE FROM techniques'))).toBe(true);
    expect(queries.some((sql) => sql.includes('TRUNCATE'))).toBe(false);
  });

  it('неизменившиеся строки не считаются обновлёнными', async () => {
    mockClient();
    await expect(loadTechniquesFromCatalog()).resolves.toEqual({
      techniquesCreated: 0,
      techniquesUpdated: 0,
    });

    mockClient({ inserted: true });
    await expect(loadTechniquesFromCatalog()).resolves.toEqual({
      techniquesCreated: EXPECTED_TECHNIQUE_COUNT,
      techniquesUpdated: 0,
    });
  });

  it('старт сервера сверяет содержимое, а не число строк', async () => {
    mockClient();
    await ensureCatalogSeeded();

    // Раньше при совпадении количества (40 = 40) сидер выходил и правки текстов не доезжали.
    expect(upsertCount('techniques')).toBe(EXPECTED_TECHNIQUE_COUNT);
    expect(upsertCount('questions')).toBe(EXPECTED_QUESTION_COUNT);
    expect(queries.some((sql) => sql.includes('TRUNCATE'))).toBe(false);
  });

  it('ошибка внутри транзакции откатывает изменения', async () => {
    queries = [];
    const query = vi.fn(async (sql: string) => {
      queries.push(sql);
      if (sql.includes('INSERT INTO techniques')) throw new Error('boom');
      return { rows: [], rowCount: 0 };
    });
    (pool.connect as unknown as Mock).mockResolvedValue({ query, release: vi.fn() });

    await expect(loadTechniquesFromCatalog()).rejects.toThrow('boom');
    expect(queries).toContain('ROLLBACK');
    expect(queries).not.toContain('COMMIT');
  });
});
