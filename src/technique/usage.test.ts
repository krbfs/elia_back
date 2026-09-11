import { describe, expect, it } from 'vitest';
import { parseStressLevel } from './usage.js';

describe('parseStressLevel', () => {
  it('accepts stress levels 1–10', () => {
    expect(parseStressLevel(1)).toBe(1);
    expect(parseStressLevel(10)).toBe(10);
    expect(parseStressLevel(6.4)).toBe(6);
  });

  it('rejects out of range and invalid values', () => {
    expect(parseStressLevel(0)).toBeNull();
    expect(parseStressLevel(11)).toBeNull();
    expect(parseStressLevel(null)).toBeNull();
    expect(parseStressLevel('7')).toBeNull();
  });
});
