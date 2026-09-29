import type { NextFunction, Request, Response } from 'express';
import { antibotLog } from './launchParams.js';
import type { AuthedRequest } from './middleware.js';

type Bucket = { count: number; resetAt: number };

const buckets = new Map<string, Bucket>();
const WINDOW_MS = 60 * 60 * 1000;

const LIMITS: Record<string, number> = {
  quiz_start: 20,
  calculate: 20,
  recommend: 60,
  gift_activate: 30,
  default: 180,
};

function clientKey(req: AuthedRequest, kind: string): string {
  const user = req.vkUserId ? `u:${req.vkUserId}` : `ip:${req.ip ?? 'unknown'}`;
  return `${kind}:${user}`;
}

function take(key: string, limit: number): boolean {
  const now = Date.now();
  const current = buckets.get(key);
  if (!current || current.resetAt <= now) {
    buckets.set(key, { count: 1, resetAt: now + WINDOW_MS });
    return true;
  }
  if (current.count >= limit) return false;
  current.count += 1;
  return true;
}

export function rateLimit(kind: keyof typeof LIMITS | 'default' = 'default') {
  const limit = LIMITS[kind] ?? LIMITS.default;
  return (req: Request, res: Response, next: NextFunction) => {
    const key = clientKey(req as AuthedRequest, kind);
    if (take(key, limit)) {
      next();
      return;
    }
    antibotLog('rate_limit', { kind });
    res.status(429).json({ error: 'Слишком много запросов, подождите' });
  };
}

/** Кризисные ручки не режем в ноль — только грубый потолок от скрипта. */
export function rateLimitCrisis(req: Request, res: Response, next: NextFunction) {
  const key = clientKey(req as AuthedRequest, 'crisis');
  if (take(key, 600)) {
    next();
    return;
  }
  antibotLog('rate_limit', { kind: 'crisis' });
  res.status(429).json({ error: 'Слишком много запросов, подождите' });
}
