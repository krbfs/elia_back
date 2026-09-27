import { describe, expect, it } from 'vitest';
import { getScreenText, listScreenIds, OFFLINE_SCREENS } from './screenTexts.js';

describe('screen_texts как источник копирайта (ответы 27.09, п. 7)', () => {
  it('отдаёт экран по id', () => {
    const screen = getScreenText('screen_first_recommendation');
    expect(screen?.screen_number).toBe(19);
    expect(screen?.texts?.headline).toBe('Твоя первая техника');
    expect(getScreenText('нет такого')).toBeNull();
  });

  it('кризисные экраны помечены как оффлайновые', () => {
    expect(OFFLINE_SCREENS.has('screen_crisis')).toBe(true);
    expect(OFFLINE_SCREENS.has('screen_emergency')).toBe(true);

    const list = listScreenIds();
    expect(list.length).toBeGreaterThanOrEqual(18);
    expect(list.find((item) => item.screen_id === 'screen_crisis')?.offline).toBe(true);
    expect(list.find((item) => item.screen_id === 'screen_home')?.offline).toBe(false);
  });
});
