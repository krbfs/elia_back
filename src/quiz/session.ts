import crypto from 'node:crypto';
import { query, queryOne } from '../db.js';
import { antibotLog } from '../auth/launchParams.js';

const MIN_WAIT_MS = 2000;
const SCRIPT_TOTAL_MS = 8000;
const SESSION_TTL_MS = 30 * 60 * 1000;

export type QuizSessionRow = {
  id: string;
  vk_user_id: number;
  started_at: Date | string;
  preview_at: Date | string | null;
  consumed_at: Date | string | null;
};

export async function createQuizSession(vkUserId: number): Promise<{ session_id: string; min_wait_ms: number }> {
  const id = crypto.randomBytes(16).toString('hex');
  await query(
    `INSERT INTO quiz_sessions (id, vk_user_id) VALUES ($1, $2)`,
    [id, vkUserId],
  );
  return { session_id: id, min_wait_ms: MIN_WAIT_MS };
}

function asTime(value: Date | string): number {
  return new Date(value).getTime();
}

export function isScriptedTiming(answeredAt: unknown): boolean {
  if (!Array.isArray(answeredAt) || answeredAt.length !== 10) return true;
  const times = answeredAt.map((value) => Number(value));
  if (times.some((value) => !Number.isFinite(value))) return false;

  const span = Math.max(...times) - Math.min(...times);
  if (span < SCRIPT_TOTAL_MS) return true;

  const gaps: number[] = [];
  for (let i = 1; i < times.length; i += 1) {
    gaps.push(times[i] - times[i - 1]);
  }
  const allTiny = gaps.every((gap) => gap < 40);
  const allEqual = gaps.every((gap) => gap === gaps[0]);
  return allTiny || allEqual;
}

export async function consumeQuizSession(params: {
  sessionId: unknown;
  vkUserId: number;
  answeredAt: unknown;
  saveProfile: boolean;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  if (typeof params.sessionId !== 'string' || !params.sessionId) {
    return { ok: false, error: 'Нужна сессия опросника' };
  }

  const row = await queryOne<QuizSessionRow>(
    'SELECT * FROM quiz_sessions WHERE id = $1 AND vk_user_id = $2',
    [params.sessionId, params.vkUserId],
  );
  if (!row) {
    antibotLog('bad_session', { vk_user_id: params.vkUserId });
    return { ok: false, error: 'Сессия опросника не найдена' };
  }

  if (row.consumed_at) {
    antibotLog('replay_session', { vk_user_id: params.vkUserId });
    return { ok: false, error: 'Эта сессия уже использована' };
  }

  const started = asTime(row.started_at);
  if (Date.now() - started < MIN_WAIT_MS) {
    antibotLog('timing', { vk_user_id: params.vkUserId, reason: 'too_fast_start' });
    return { ok: false, error: 'Подождите секунду и отправьте ответы ещё раз' };
  }

  if (Date.now() - started > SESSION_TTL_MS) {
    return { ok: false, error: 'Сессия опросника истекла, начните заново' };
  }

  if (isScriptedTiming(params.answeredAt)) {
    antibotLog('timing', { vk_user_id: params.vkUserId, reason: 'scripted' });
    return { ok: false, error: 'Не получилось принять ответы. Пройдите опросник ещё раз' };
  }

  if (params.saveProfile) {
    await query('UPDATE quiz_sessions SET consumed_at = NOW() WHERE id = $1', [row.id]);
  } else if (!row.preview_at) {
    await query('UPDATE quiz_sessions SET preview_at = NOW() WHERE id = $1', [row.id]);
  }

  return { ok: true };
}
