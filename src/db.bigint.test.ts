import pg from 'pg';
import { describe, expect, it } from 'vitest';
import './db.js';

describe('типы pg', () => {
  it('BIGINT приходит числом, иначе сравнения vk_user_id молча ложны', () => {
    expect(pg.types.getTypeParser(20)('990001')).toBe(990001);
  });
});
