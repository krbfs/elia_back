import { describe, expect, it } from 'vitest';
import { hasConsecutiveHighStressDays } from './stressLog.js';

describe('hasConsecutiveHighStressDays (TC-303)', () => {
  it('returns true for 3 consecutive days with stress >= 7', () => {
    expect(
      hasConsecutiveHighStressDays([
        { date: '2026-09-08', stress: 7 },
        { date: '2026-09-09', stress: 8 },
        { date: '2026-09-10', stress: 7 },
      ]),
    ).toBe(true);
  });

  it('returns false when high-stress days are not consecutive', () => {
    expect(
      hasConsecutiveHighStressDays([
        { date: '2026-09-08', stress: 8 },
        { date: '2026-09-10', stress: 8 },
        { date: '2026-09-11', stress: 7 },
      ]),
    ).toBe(false);
  });

  it('returns false when stress below threshold', () => {
    expect(
      hasConsecutiveHighStressDays([
        { date: '2026-09-08', stress: 6 },
        { date: '2026-09-09', stress: 7 },
        { date: '2026-09-10', stress: 7 },
      ]),
    ).toBe(false);
  });
});
