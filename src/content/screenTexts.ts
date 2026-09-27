import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Единственный источник копирайта (ответы 27.09, п. 7): фронт тянет тексты отсюда
 * и кэширует их у себя на сутки. Кризисные экраны читают свою захардкоженную копию —
 * они должны работать без сети (TC-304, TC-604).
 */
export type ScreenText = {
  screen_id: string;
  screen_number: number | string;
  title?: string;
  texts?: Record<string, unknown>;
  buttons?: unknown[];
  metadata?: Record<string, unknown>;
};

/** Экраны, которым нельзя зависеть от сети. */
export const OFFLINE_SCREENS = new Set(['screen_emergency', 'screen_crisis']);

const DATA_DIR = join(dirname(fileURLToPath(import.meta.url)), '../../data');

let cache: Map<string, ScreenText> | null = null;

function load(): Map<string, ScreenText> {
  if (cache) return cache;

  const raw = JSON.parse(
    readFileSync(join(DATA_DIR, 'screen_texts.json'), 'utf8'),
  ) as { screens: ScreenText[] };

  cache = new Map(raw.screens.map((screen) => [screen.screen_id, screen]));
  return cache;
}

export function getScreenText(screenId: string): ScreenText | null {
  return load().get(screenId) ?? null;
}

export function listScreenIds(): { screen_id: string; screen_number: number | string; offline: boolean }[] {
  return [...load().values()].map((screen) => ({
    screen_id: screen.screen_id,
    screen_number: screen.screen_number,
    offline: OFFLINE_SCREENS.has(screen.screen_id),
  }));
}

/** Сбросить кэш — нужен тестам и после правки файла без перезапуска. */
export function resetScreenTextsCache(): void {
  cache = null;
}
