import type { NextFunction, Request, Response } from 'express';
import { verifyAccessToken } from './jwt.js';

export type AuthedRequest = Request & {
  vkUserId?: number;
};

export function requireAuth(req: AuthedRequest, res: Response, next: NextFunction) {
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) {
    res.status(401).json({ error: 'Authorization required' });
    return;
  }

  try {
    const payload = verifyAccessToken(header.slice('Bearer '.length));
    req.vkUserId = payload.sub;
    next();
  } catch {
    res.status(401).json({ error: 'Invalid or expired token' });
  }
}

/** Web/dev fallback: JWT or explicit vk_user_id in body/query. */
export function resolveUserId(
  req: AuthedRequest,
  source: Record<string, unknown> | undefined,
): number | null {
  if (typeof req.vkUserId === 'number') {
    return req.vkUserId;
  }

  const raw = source?.vk_user_id;
  if (typeof raw === 'number' && Number.isFinite(raw)) {
    return raw;
  }

  return null;
}
