import type { NextFunction, Request, Response } from 'express';
import { verifyAccessToken } from './jwt.js';

export type AuthedRequest = Request & {
  vkUserId?: number;
};

/** Гостевой id из JSON только локально. На проде — только JWT от подписи запуска. */
export function allowUnsignedUserId(): boolean {
  return process.env.ALLOW_DEV_AUTH === 'true' || process.env.NODE_ENV !== 'production';
}

export function attachAuth(req: AuthedRequest, _res: Response, next: NextFunction) {
  const header = req.headers.authorization;
  if (header?.startsWith('Bearer ')) {
    try {
      req.vkUserId = verifyAccessToken(header.slice('Bearer '.length)).sub;
    } catch {
      /* конечные ручки решат сами */
    }
  }
  next();
}

export function requireAuth(req: AuthedRequest, res: Response, next: NextFunction) {
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) {
    res.status(401).json({ error: 'Нужна авторизация' });
    return;
  }

  try {
    const payload = verifyAccessToken(header.slice('Bearer '.length));
    req.vkUserId = payload.sub;
    next();
  } catch {
    res.status(401).json({ error: 'Нужна авторизация' });
  }
}

export function resolveUserId(
  req: AuthedRequest,
  source: Record<string, unknown> | undefined,
): number | null {
  if (typeof req.vkUserId === 'number') {
    return req.vkUserId;
  }

  if (!allowUnsignedUserId()) return null;

  const raw = source?.vk_user_id;
  if (typeof raw === 'number' && Number.isFinite(raw)) return raw;
  if (typeof raw === 'string' && raw.trim()) {
    const parsed = Number(raw);
    if (Number.isFinite(parsed)) return parsed;
  }

  return null;
}

export function requireUser(
  req: AuthedRequest,
  res: Response,
  source?: Record<string, unknown>,
): number | null {
  const id = resolveUserId(req, source ?? {
    ...(typeof req.body === 'object' && req.body ? (req.body as Record<string, unknown>) : {}),
    ...(req.query as Record<string, unknown>),
  });
  if (id == null) {
    res.status(401).json({ error: 'Нужна авторизация' });
    return null;
  }
  return id;
}
