/**
 * Сквозной прогон требований 23.09 против живого API (веб-режим, без VK).
 * Запуск: npm run dev в одном терминале, затем npx tsx scripts/smoke_sep23.ts
 */
import { readFileSync } from 'node:fs';

const BASE = process.env.SMOKE_API ?? 'http://localhost:3001';
const USER = Number(process.env.SMOKE_USER ?? 990001);
const PARTNER = USER + 1;

let failures = 0;

function check(name: string, ok: boolean, detail = '') {
  if (!ok) failures += 1;
  console.log(`${ok ? '  ok  ' : ' FAIL '} ${name}${detail ? ` — ${detail}` : ''}`);
}

async function api(method: string, path: string, body?: unknown) {
  const response = await fetch(`${BASE}${path}`, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await response.text();
  return { status: response.status, data: text ? JSON.parse(text) : null };
}

/** API не отдаёт tags, поэтому признаки техник берём из каталога. */
const CATALOG: any[] = JSON.parse(
  readFileSync(new URL('../data/techniques_catalog.json', import.meta.url), 'utf-8'),
).techniques;
const SENSORIMOTOR = new Set(
  CATALOG.filter((t) => t.tags?.is_sensorimotor).map((t) => t.technique_id),
);
const LONG_TEXT = new Set(
  CATALOG.filter((t) => t.tags?.duration === 'long' && t.tags?.format?.includes('text'))
    .map((t) => t.technique_id),
);

async function main() {
  console.log(`\n=== Опросник и психотип ===`);
  const questions = await api('GET', '/questions');
  check('10 вопросов по 3 варианта', questions.data.questions.length === 10 &&
    questions.data.questions.every((q: any) => q.options.length === 3),
    `${questions.data.questions.length} вопросов`);

  await api('DELETE', '/profile', { vk_user_id: USER });
  await api('POST', '/users/sync', { vk_user_id: USER, first_name: 'Смоук' });
  await api('POST', '/profile', { vk_user_id: USER, trimester: 'trimester_1' });

  // Первый вариант в каждом вопросе — доминирование одной пары черт.
  const answers = questions.data.questions.map(() => 0);
  const psycho = await api('POST', '/calculate-psychotype', { vk_user_id: USER, answers, save_profile: true });
  const profile = psycho.data.profile;
  const TYPES = ['Индивидуалист', 'Инноватор', 'Лидер Мнений', 'Эстет',
    'Консерватор', 'Эмпат', 'Аналитик', 'Прагматик'];
  check('базовый тип из 8 разрешённых', TYPES.includes(profile.base_type), profile.base_type);
  check('нормализация 0–10', Object.values(profile.scores ?? {}).every((v: any) => v >= 0 && v <= 10));
  check('сопутствующий тип отдельно от базового', profile.secondary_type !== profile.base_type,
    `${profile.base_type} / ${profile.secondary_type ?? '—'}`);

  console.log(`\n=== Выдача техник (1 триместр) ===`);
  const red = await api('GET', `/techniques/recommend?vk_user_id=${USER}&stress=9`);
  const redItems = red.data.techniques ?? [];
  check('красная зона не пустая', redItems.length > 0, `${redItems.length} техник`);
  check('красная зона + 1 триместр → только сенсомоторные',
    redItems.length > 0 && redItems.every((t: any) => SENSORIMOTOR.has(t.catalog_id)),
    redItems.map((t: any) => `#${t.catalog_id}`).join(' '));

  const calm = await api('GET', `/techniques/recommend?vk_user_id=${USER}&stress=3`);
  check('вне красной зоны бесплатный доступ закрыт (§9.1)',
    calm.status === 402 && calm.data.error === 'premium_required',
    `${calm.status} ${calm.data.error ?? ''}`);

  const freeTips = await api('GET', `/partner/tips?vk_user_id=${USER}`);
  check('без премиума таблица подсказок закрыта превью',
    freeTips.data.premium_required === true && !!freeTips.data.premium_preview && !freeTips.data.tips);

  await api('POST', '/premium/activate', { vk_user_id: USER });
  const premiumCalm = await api('GET', `/techniques/recommend?vk_user_id=${USER}&stress=3`);
  const calmItems = premiumCalm.data.techniques ?? [];
  check('с премиумом зелёная зона наполняется', calmItems.length > 0, `${calmItems.length} техник`);
  const longText = calmItems.filter((t: any) => LONG_TEXT.has(t.catalog_id));
  check('длинные текстовые техники не выдаются в 1 триместре', longText.length === 0,
    longText.map((t: any) => `#${t.catalog_id}`).join(' '));
  const freeRed = red.data.techniques ?? [];
  check('премиум не протекает в бесплатную выдачу',
    freeRed.every((t: any) => t.is_premium !== true),
    freeRed.filter((t: any) => t.is_premium).map((t: any) => `#${t.catalog_id}`).join(' '));

  console.log(`\n=== Стресс и зелёный триггер ===`);
  const stress = await api('POST', '/stress/report', { vk_user_id: USER, stress: 9 });
  check('стресс 9 → редирект в кризис', stress.data.crisis_redirect === 'red',
    String(stress.data.crisis_redirect));
  const mid = await api('POST', '/stress/report', { vk_user_id: USER, stress: 5 });
  check('стресс 5 → без редиректа', mid.data.crisis_redirect === null);
  check('замер пишется в профиль', mid.data.profile?.last_stress === 5);
  check('оценка вне 1–10 отклоняется',
    (await api('POST', '/stress/report', { vk_user_id: USER, stress: 11 })).status === 400);

  console.log(`\n=== Дневник настроения ===`);
  const mood = await api('GET', `/mood?vk_user_id=${USER}`);
  check('5 вариантов настроения', mood.data.options.length === 5);
  const saved = await api('POST', '/mood', { vk_user_id: USER, mood_score: 2, note: 'смоук' });
  check('запись настроения сохраняется', saved.data.entry?.mood_score === 2);
  check('повторная запись за день не дублируется',
    (await api('POST', '/mood', { vk_user_id: USER, mood_score: 4 })).data.entry?.mood_score === 4 &&
    (await api('GET', `/mood?vk_user_id=${USER}`)).data.entries.length === 1);
  check('оценка вне 1–5 отклоняется',
    (await api('POST', '/mood', { vk_user_id: USER, mood_score: 7 })).status === 400);

  console.log(`\n=== EPDS и кризис ===`);
  const epdsRed = await api('POST', '/epds', {
    vk_user_id: USER,
    answers: [0, 0, 0, 0, 0, 0, 0, 0, 0, 1],
  });
  check('мысли о самоповреждении → красный уровень', epdsRed.data.crisis_level === 'red',
    `${epdsRed.data.crisis_level}, балл ${epdsRed.data.epds_score}`);
  check('красный уровень блокирует обычную выдачу',
    (await api('GET', `/techniques/recommend?vk_user_id=${USER}&stress=5`)).status === 403);
  const epdsGreen = await api('POST', '/epds', {
    vk_user_id: USER,
    answers: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
  });
  check('нулевые ответы → зелёный уровень', epdsGreen.data.crisis_level === 'green');

  console.log(`\n=== Подарок техники ===`);
  const gift = await api('POST', '/gift', { vk_user_id: USER, technique_id: 1 });
  const token = gift.data.gift?.token;
  check('подарок создаётся с токеном', /^[0-9a-f]{32}$/.test(token ?? ''), token);
  const own = await api('POST', `/gift/${token}/activate`, { vk_user_id: USER });
  check('свой же подарок активировать нельзя', own.data.error === 'own_gift', own.data.error);
  const activated = await api('POST', `/gift/${token}/activate`, { vk_user_id: PARTNER });
  check('получатель активирует подарок', activated.status === 200 && !!activated.data.technique,
    activated.data.error ?? 'ok');
  check('доступ по подарку на 7 дней',
    typeof activated.data.access_expires_at === 'string' || activated.data.access_days === 7,
    JSON.stringify(activated.data.access_expires_at ?? activated.data.access_days));
  const repeat = await api('POST', `/gift/${token}/activate`, { vk_user_id: PARTNER });
  check('повторная активация отклоняется', repeat.status !== 200, repeat.data.error ?? 'прошла');

  console.log(`\n=== Партнёр ===`);
  const invite = await api('POST', '/partner/invite', { vk_user_id: USER });
  const inviteToken = invite.data.invite_token;
  check('инвайт партнёра создаётся', /^[0-9a-f]{32}$/.test(inviteToken ?? ''), inviteToken);
  check('инвайт валидируется',
    (await api('GET', `/partner/invite/validate?token=${inviteToken}`)).data.valid === true);
  const tips = await api('GET', `/partner/tips?vk_user_id=${USER}`);
  check('принципы поддержки приходят', (tips.data.principles?.length ?? 0) > 0,
    `${tips.data.principles?.length} принципов`);
  check('фразы поддержки и запретные фразы приходят',
    (tips.data.support_phrases?.length ?? 0) > 0 && (tips.data.avoid_phrases?.length ?? 0) > 0);
  check('с премиумом приходит таблица подсказок по типу',
    tips.data.premium_required === false && !!tips.data.tips,
    tips.data.tips ? 'таблица есть' : 'таблицы нет');

  console.log(`\n=== Право на забвение ===`);
  const removed = await api('DELETE', '/profile', { vk_user_id: USER });
  check('профиль удаляется', removed.status === 200);
  const after = await api('GET', `/mood?vk_user_id=${USER}`);
  check('дневник удаляется вместе с профилем', after.data.entries.length === 0);
  const afterProfile = await api('GET', `/profile?vk_user_id=${USER}`);
  check('психотип стёрт', !afterProfile.data.profile?.base_type);

  console.log(`\n${failures === 0 ? 'ВСЁ ЗЕЛЁНОЕ' : `ПРОВАЛОВ: ${failures}`}\n`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
