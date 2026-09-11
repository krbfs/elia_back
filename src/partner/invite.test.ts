import { describe, expect, it } from 'vitest';
import { generateInviteToken, inviteExpiresAt, PARTNER_INVITE_TTL_DAYS } from './invite.js';

describe('partner invite (TC-501)', () => {
  it('generates 32-char hex token', () => {
    const token = generateInviteToken();
    expect(token).toHaveLength(32);
    expect(token).toMatch(/^[a-f0-9]{32}$/);
  });

  it('expires in 30 days', () => {
    const from = new Date('2026-09-11T12:00:00.000Z');
    const expires = inviteExpiresAt(from);
    expect(expires.toISOString()).toBe('2026-10-11T12:00:00.000Z');
    expect(PARTNER_INVITE_TTL_DAYS).toBe(30);
  });
});

describe('partner invite expiry (TC-503)', () => {
  it('marks invite expired after 31 days', () => {
    const from = new Date('2026-08-01T12:00:00.000Z');
    const expires = inviteExpiresAt(from);
    const day31 = new Date('2026-09-01T12:00:00.000Z');
    expect(day31.getTime()).toBeGreaterThan(expires.getTime());
  });
});
