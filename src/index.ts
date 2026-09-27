import { fileURLToPath } from 'node:url';
import express from 'express';
import cors from 'cors';
import {
  initDb,
  query,
  queryAll,
  queryOne,
  type PartnerProfileRow,
  type ProfileRow,
  type TechniqueRow,
  type UserRow,
} from './db.js';
import { recommendTechniques, serializeTechnique, stressZone } from './recommend.js';
import { ensureCatalogSeeded, getAdminSummary } from './seed/loadCatalog.js';
import {
  authenticateDevUser,
  authenticateWithVkToken,
  refreshAuth,
} from './auth/service.js';
import { requireAuth, type AuthedRequest } from './auth/middleware.js';
import {
  calculatePsychotype,
  calculateSubjectivePsychotype,
  getCachedQuestions,
  scoreFromAnswers,
} from './psychotype/index.js';
import { enrichProfileResponse, savePsychotypeProfile, serializePsychotypeResult } from './psychotype/profile.js';
import {
  PARTNER_ARTICLE,
  PARTNER_AVOID_PHRASES,
  PARTNER_HELP_SIGNALS,
  PARTNER_PREMIUM_NOTICE,
  PARTNER_PREMIUM_PREVIEW,
  PARTNER_PRINCIPLES,
  PARTNER_SUPPORT_PHRASES,
  partnerTipsForType,
  situationalTipsForType,
} from './partner/tips.js';
import { partnerTipsAccess } from './partner/access.js';
import {
  createPartnerInvite,
  validatePartnerInvite,
} from './partner/invite.js';
import {
  GIFT_ACCESS_DAYS,
  activateGift,
  activeGiftsFor,
  createGift,
  giftedTechniqueIds,
  validateGift,
} from './gift/gift.js';
import { scoreEpdsAnswers } from './epds/score.js';
import {
  canUseTechnique,
  getFreeUsage,
  remainingFor,
  FREE_DAILY_RED_LIMIT,
  FREE_WEEKLY_YELLOW_LIMIT,
} from './billing/usage.js';
import { logCrisisIncident } from './crisis/incidents.js';
import { recordStressLevel } from './crisis/recordStress.js';
import { hasSustainedHighStress } from './crisis/stressLog.js';
import {
  MOOD_OPTIONS,
  deleteMoodEntries,
  getMoodEntries,
  hasSustainedLowMood,
  isValidMoodScore,
  saveMoodEntry,
} from './mood/mood.js';
import { logTechniqueUsage, parseStressLevel, usedTechniqueIds } from './technique/usage.js';
import {
  ANALYTICS_EVENTS,
  analyticsSummary,
  isAnalyticsEvent,
  logAnalyticsEvent,
  pruneAnalyticsEvents,
} from './analytics/events.js';
import {
  CARE_TRIGGER_TEXT,
  careTriggerDue,
  isStressCheckDue,
  markCareTriggerShown,
  markStressChecked,
} from './care/careTrigger.js';

const app = express();
const port = Number(process.env.PORT ?? 3001);

const frontendOrigin = process.env.FRONTEND_URL ?? 'http://localhost:5173';
const corsOrigins = new Set([
  frontendOrigin,
  'http://localhost:5173',
  'http://127.0.0.1:5173',
]);
app.use(
  cors({
    origin(origin, callback) {
      if (!origin || corsOrigins.has(origin) || /\.run\.app$/i.test(origin)) {
        callback(null, true);
        return;
      }
      callback(null, false);
    },
  }),
);
app.use(express.json());

// Аудио техник: /media/techniques/{id}_audio.mp3 из audio_scripts.json.
const mediaDir = process.env.MEDIA_DIR ?? fileURLToPath(new URL('../media', import.meta.url));
app.use('/media', express.static(mediaDir, { maxAge: '7d' }));

async function buildProfileResponse(row: ProfileRow | undefined, vkUserId: number) {
  // §10.2: зелёный уровень ловит и устойчивый стресс, и снижение настроения 3 дня подряд.
  const freeUsage = await getFreeUsage(vkUserId);
  const careTrigger = await careTriggerDue(vkUserId, row);
  const [sustainedStress, sustainedLowMood] =
    row?.crisis_level === 'green'
      ? await Promise.all([hasSustainedHighStress(vkUserId), hasSustainedLowMood(vkUserId)])
      : [false, false];
  const greenNudge = sustainedStress || sustainedLowMood;

  return {
    ...enrichProfileResponse(row, vkUserId),
    free_red_today: freeUsage.redToday,
    free_red_limit: FREE_DAILY_RED_LIMIT,
    free_yellow_week: freeUsage.yellowWeek,
    free_yellow_limit: FREE_WEEKLY_YELLOW_LIMIT,
    care_trigger: careTrigger,
    stress_check_due: isStressCheckDue(row),
    green_nudge: greenNudge,
    green_nudge_reason: sustainedStress
      ? ('sustained_stress_3d' as const)
      : sustainedLowMood
        ? ('sustained_low_mood_3d' as const)
        : null,
  };
}

app.get('/health', async (_req, res) => {
  try {
    await query('SELECT 1');
    res.json({ ok: true, service: 'elia-api', database: 'postgres' });
  } catch {
    res.status(503).json({ ok: false, service: 'elia-api', database: 'unavailable' });
  }
});

app.post('/auth/verify-vk-token', async (req, res) => {
  const { access_token } = req.body ?? {};
  if (typeof access_token !== 'string' || !access_token.trim()) {
    res.status(400).json({ error: 'access_token required' });
    return;
  }

  try {
    const tokens = await authenticateWithVkToken(access_token);
    res.json(tokens);
  } catch (error) {
    res.status(401).json({
      error: error instanceof Error ? error.message : 'Invalid VK token',
    });
  }
});

app.post('/auth/refresh', async (req, res) => {
  const { refresh_token } = req.body ?? {};
  if (typeof refresh_token !== 'string' || !refresh_token.trim()) {
    res.status(400).json({ error: 'refresh_token required' });
    return;
  }

  try {
    const tokens = await refreshAuth(refresh_token);
    res.json(tokens);
  } catch (error) {
    res.status(401).json({
      error: error instanceof Error ? error.message : 'Invalid refresh token',
    });
  }
});

app.post('/auth/dev-login', async (req, res) => {
  if (process.env.ALLOW_DEV_AUTH !== 'true') {
    res.status(404).json({ error: 'Not found' });
    return;
  }

  const { vk_user_id, first_name, last_name } = req.body ?? {};
  if (typeof vk_user_id !== 'number' || !Number.isFinite(vk_user_id)) {
    res.status(400).json({ error: 'vk_user_id must be a number' });
    return;
  }

  const tokens = await authenticateDevUser({ vk_user_id, first_name, last_name });
  res.json(tokens);
});

app.get('/admin/summary', requireAuth, async (_req, res) => {
  if (process.env.ENABLE_ADMIN !== 'true') {
    res.status(404).json({ error: 'Not found' });
    return;
  }

  res.json({ summary: await getAdminSummary() });
});

app.post('/users/sync', async (req, res) => {
  const { vk_user_id, first_name, last_name } = req.body ?? {};

  if (typeof vk_user_id !== 'number' || !Number.isFinite(vk_user_id)) {
    res.status(400).json({ error: 'vk_user_id must be a number' });
    return;
  }

  const existing = await queryOne<UserRow>(
    'SELECT * FROM users WHERE vk_user_id = $1',
    [vk_user_id],
  );

  if (existing) {
    await query(
      `UPDATE users SET first_name = $1, last_name = $2, updated_at = NOW() WHERE vk_user_id = $3`,
      [first_name ?? null, last_name ?? null, vk_user_id],
    );
  } else {
    await query(
      `INSERT INTO users (vk_user_id, first_name, last_name) VALUES ($1, $2, $3)`,
      [vk_user_id, first_name ?? null, last_name ?? null],
    );
  }

  const user = await queryOne<UserRow>(
    'SELECT * FROM users WHERE vk_user_id = $1',
    [vk_user_id],
  );

  res.json({ user });
});

app.get('/questions', async (_req, res) => {
  try {
    const questions = await getCachedQuestions();
    res.json({
      questions: questions.map((question) => ({
        number: question.question_number,
        context: question.context,
        text: question.text,
        options: question.options.map((option) => ({
          id: option.id,
          text: option.text,
        })),
      })),
    });
  } catch (error) {
    res.status(500).json({
      error: error instanceof Error ? error.message : 'Failed to load questions',
    });
  }
});

app.post('/calculate-psychotype', async (req, res) => {
  const { vk_user_id, answers, sliders, save_profile, mode } = req.body ?? {};

  if (!Array.isArray(answers) || answers.length !== 10) {
    res.status(400).json({ error: 'answers must be an array of 10 option indexes' });
    return;
  }

  if (
    answers.some(
      (value) => typeof value !== 'number' || !Number.isInteger(value) || value < 0 || value > 2,
    )
  ) {
    res.status(400).json({ error: 'each answer must be 0, 1, or 2' });
    return;
  }

  try {
    const questions = await getCachedQuestions();
    const raw = scoreFromAnswers(answers, questions);
    const result =
      mode === 'subjective'
        ? calculateSubjectivePsychotype(raw)
        : calculatePsychotype(raw, sliders ?? {});
    const payload = serializePsychotypeResult(result);

    if (save_profile) {
      if (typeof vk_user_id !== 'number' || !Number.isFinite(vk_user_id)) {
        res.status(400).json({ error: 'vk_user_id required when save_profile=true' });
        return;
      }

      await query(
        `INSERT INTO users (vk_user_id) VALUES ($1)
         ON CONFLICT (vk_user_id) DO UPDATE SET updated_at = NOW()`,
        [vk_user_id],
      );
      await savePsychotypeProfile(vk_user_id, result);
      const saved = await queryOne<ProfileRow>(
        'SELECT * FROM profiles WHERE vk_user_id = $1',
        [vk_user_id],
      );
      res.json({
        profile: payload,
        saved: await buildProfileResponse(saved, vk_user_id),
      });
      return;
    }

    res.json({ profile: payload });
  } catch (error) {
    res.status(400).json({
      error: error instanceof Error ? error.message : 'Failed to calculate psychotype',
    });
  }
});

app.get('/profile', async (req, res) => {
  const vkUserId = Number(req.query.vk_user_id);
  if (!Number.isFinite(vkUserId)) {
    res.status(400).json({ error: 'vk_user_id required' });
    return;
  }

  const row = await queryOne<ProfileRow>(
    'SELECT * FROM profiles WHERE vk_user_id = $1',
    [vkUserId],
  );

  res.json({ profile: await buildProfileResponse(row, vkUserId) });
});

app.get('/profile/:vk_user_id', async (req, res) => {
  const vkUserId = Number(req.params.vk_user_id);
  if (!Number.isFinite(vkUserId)) {
    res.status(400).json({ error: 'vk_user_id must be a number' });
    return;
  }

  const row = await queryOne<ProfileRow>(
    'SELECT * FROM profiles WHERE vk_user_id = $1',
    [vkUserId],
  );

  if (!row) {
    res.status(404).json({ error: 'Profile not found' });
    return;
  }

  res.json({ profile: await buildProfileResponse(row, vkUserId) });
});

app.post('/profile', async (req, res) => {
  const {
    vk_user_id,
    trimester,
    onboarding_completed,
    base_type,
    secondary_type,
    scores_json,
    platform,
    last_stress,
    techniques_completed,
  } = req.body ?? {};

  if (typeof vk_user_id !== 'number' || !Number.isFinite(vk_user_id)) {
    res.status(400).json({ error: 'vk_user_id must be a number' });
    return;
  }

  const existing = await queryOne<ProfileRow>(
    'SELECT * FROM profiles WHERE vk_user_id = $1',
    [vk_user_id],
  );

  const nextTrimester = trimester !== undefined ? trimester : (existing?.trimester ?? null);
  const nextOnboarding =
    onboarding_completed !== undefined
      ? onboarding_completed
      : Boolean(existing?.onboarding_completed);
  const nextBaseType = base_type !== undefined ? base_type : (existing?.base_type ?? null);
  const nextSecondaryType =
    secondary_type !== undefined ? secondary_type : (existing?.secondary_type ?? null);
  const nextScoresJson =
    scores_json !== undefined ? scores_json : (existing?.scores_json ?? null);
  const nextPlatform = platform !== undefined ? platform : (existing?.platform ?? null);
  const nextLastStress =
    last_stress !== undefined ? last_stress : (existing?.last_stress ?? null);
  const nextTechniquesCompleted =
    techniques_completed !== undefined
      ? techniques_completed
      : (existing?.techniques_completed ?? 0);

  if (existing) {
    await query(
      `UPDATE profiles SET
        trimester = $1, onboarding_completed = $2, base_type = $3, secondary_type = $4,
        scores_json = $5, platform = $6, last_stress = $7, techniques_completed = $8,
        updated_at = NOW()
       WHERE vk_user_id = $9`,
      [
        nextTrimester,
        nextOnboarding,
        nextBaseType,
        nextSecondaryType,
        nextScoresJson,
        nextPlatform,
        nextLastStress,
        nextTechniquesCompleted,
        vk_user_id,
      ],
    );
  } else {
    await query(
      `INSERT INTO profiles (
        vk_user_id, trimester, onboarding_completed, base_type, secondary_type,
        scores_json, platform, last_stress, techniques_completed
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [
        vk_user_id,
        nextTrimester,
        nextOnboarding,
        nextBaseType,
        nextSecondaryType,
        nextScoresJson,
        nextPlatform,
        nextLastStress,
        nextTechniquesCompleted,
      ],
    );
  }

  const row = await queryOne<ProfileRow>(
    'SELECT * FROM profiles WHERE vk_user_id = $1',
    [vk_user_id],
  );

  if (typeof nextLastStress === 'number') {
    await recordStressLevel(vk_user_id, nextLastStress);
  }

  res.json({ profile: await buildProfileResponse(row, vk_user_id) });
});

app.get('/techniques/recommend', handleRecommend);
app.get('/recommendations', handleRecommend);

async function handleRecommend(req: express.Request, res: express.Response) {
  const vkUserId = Number(req.query.vk_user_id);
  const stress = Number(req.query.stress ?? req.query.stress_level);
  const context = typeof req.query.context === 'string' ? req.query.context : null;
  const feeling = typeof req.query.feeling === 'string' ? req.query.feeling : null;

  if (!Number.isFinite(vkUserId)) {
    res.status(400).json({ error: 'vk_user_id required' });
    return;
  }
  if (!Number.isFinite(stress) || stress < 1 || stress > 10) {
    res.status(400).json({ error: 'stress must be 1–10' });
    return;
  }

  const profile = await queryOne<ProfileRow>(
    'SELECT * FROM profiles WHERE vk_user_id = $1',
    [vkUserId],
  );

  if (profile?.crisis_level === 'red') {
    res.status(403).json({ error: 'crisis_red', crisis_level: 'red' });
    return;
  }

  const zone = stressZone(stress);
  const unlockedTechniqueIds = await giftedTechniqueIds(vkUserId);
  const freeUsage = await getFreeUsage(vkUserId);
  const access = canUseTechnique(profile, zone, freeUsage);
  // §9.4: активный подарок открывает доступ даже без подписки.
  if (!access.allowed && unlockedTechniqueIds.length === 0) {
    res.status(402).json({
      error: access.reason,
      is_premium: Boolean(profile?.is_premium),
      zone,
      free_remaining: remainingFor(profile, zone, freeUsage),
    });
    return;
  }

  const allTechniques = await queryAll<TechniqueRow>('SELECT * FROM techniques');
  const recommendation = recommendTechniques(allTechniques, {
    stress,
    profile,
    context,
    feeling,
    usedTechniqueIds: await usedTechniqueIds(vkUserId),
    unlockedTechniqueIds,
  });

  if (!recommendation.technique) {
    res.status(404).json({ error: 'No technique found for zone' });
    return;
  }

  res.json({
    zone: recommendation.zone,
    stress,
    technique: serializeTechnique(recommendation.technique),
    cascade: recommendation.cascade ? serializeTechnique(recommendation.cascade) : null,
    techniques: recommendation.techniques.map(serializeTechnique),
  });
}

app.post('/techniques/complete', async (req, res) => {
  const { vk_user_id, technique_id, stress_before, stress_after, stress } = req.body ?? {};

  if (typeof vk_user_id !== 'number' || !Number.isFinite(vk_user_id)) {
    res.status(400).json({ error: 'vk_user_id must be a number' });
    return;
  }

  if (typeof technique_id !== 'number' || !Number.isFinite(technique_id)) {
    res.status(400).json({ error: 'technique_id must be a number' });
    return;
  }

  const stressAfter = parseStressLevel(stress_after ?? stress);
  if (stressAfter === null) {
    res.status(400).json({ error: 'stress_after must be a number between 1 and 10' });
    return;
  }

  const existing = await queryOne<ProfileRow>(
    'SELECT * FROM profiles WHERE vk_user_id = $1',
    [vk_user_id],
  );

  const stressBefore =
    parseStressLevel(stress_before) ??
    parseStressLevel(existing?.last_stress) ??
    null;

  if (stressBefore === null) {
    res.status(400).json({ error: 'stress_before must be a number between 1 and 10' });
    return;
  }

  const technique = await queryOne<TechniqueRow>(
    'SELECT id FROM techniques WHERE id = $1',
    [technique_id],
  );
  if (!technique) {
    res.status(404).json({ error: 'Technique not found' });
    return;
  }

  const usage = await logTechniqueUsage({
    vkUserId: vk_user_id,
    techniqueId: technique_id,
    stressBefore,
    stressAfter,
  });

  const nextCompleted = (existing?.techniques_completed ?? 0) + 1;

  if (existing) {
    await query(
      `UPDATE profiles SET last_stress = $1, techniques_completed = $2, updated_at = NOW()
       WHERE vk_user_id = $3`,
      [stressAfter, nextCompleted, vk_user_id],
    );
  } else {
    await query(
      `INSERT INTO profiles (vk_user_id, last_stress, techniques_completed) VALUES ($1, $2, $3)`,
      [vk_user_id, stressAfter, nextCompleted],
    );
  }

  await recordStressLevel(vk_user_id, stressAfter);

  const updated = await queryOne<ProfileRow>(
    'SELECT * FROM profiles WHERE vk_user_id = $1',
    [vk_user_id],
  );

  res.json({
    profile: await buildProfileResponse(updated, vk_user_id),
    usage: {
      id: usage.id,
      technique_id: usage.technique_id,
      stress_before: usage.stress_before,
      stress_after: usage.stress_after,
      zone: usage.zone,
    },
  });
});

app.get('/techniques/:id', async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) {
    res.status(400).json({ error: 'Invalid technique id' });
    return;
  }

  const row = await queryOne<TechniqueRow>(
    'SELECT * FROM techniques WHERE id = $1',
    [id],
  );

  if (!row) {
    res.status(404).json({ error: 'Technique not found' });
    return;
  }

  res.json({ technique: serializeTechnique(row) });
});

// «Подари технику» (§9.4): ссылка живёт 7 дней, доступ получателю — тоже 7 дней.
app.post('/gift', async (req, res) => {
  const { vk_user_id, technique_id } = req.body ?? {};

  if (typeof vk_user_id !== 'number' || !Number.isFinite(vk_user_id)) {
    res.status(400).json({ error: 'vk_user_id must be a number' });
    return;
  }
  if (typeof technique_id !== 'number' || !Number.isFinite(technique_id)) {
    res.status(400).json({ error: 'technique_id must be a number' });
    return;
  }

  const gift = await createGift(vk_user_id, technique_id);
  if (!gift) {
    res.status(404).json({ error: 'Technique not found' });
    return;
  }

  const technique = await queryOne<TechniqueRow>(
    'SELECT * FROM techniques WHERE id = $1',
    [technique_id],
  );

  res.json({
    gift: {
      token: gift.token,
      technique_id: gift.technique_id,
      token_expires_at: gift.token_expires_at,
      access_days: GIFT_ACCESS_DAYS,
    },
    technique: technique ? serializeTechnique(technique) : null,
  });
});

// Превью по ссылке: только техника, без имени отправителя (анонимный шеринг, §9.4).
app.get('/gift/:token', async (req, res) => {
  const validation = await validateGift(req.params.token);
  if (!validation.valid) {
    const status = validation.reason === 'expired' ? 410 : validation.reason === 'used' ? 409 : 404;
    res.status(status).json({ error: validation.reason });
    return;
  }

  const technique = await queryOne<TechniqueRow>(
    'SELECT * FROM techniques WHERE id = $1',
    [validation.gift.technique_id],
  );

  res.json({
    technique: technique ? serializeTechnique(technique) : null,
    access_days: GIFT_ACCESS_DAYS,
    token_expires_at: validation.gift.token_expires_at,
  });
});

app.post('/gift/:token/activate', async (req, res) => {
  const { vk_user_id } = req.body ?? {};
  if (typeof vk_user_id !== 'number' || !Number.isFinite(vk_user_id)) {
    res.status(400).json({ error: 'vk_user_id must be a number' });
    return;
  }

  const activation = await activateGift(req.params.token, vk_user_id);
  if (!activation.ok) {
    const status =
      activation.reason === 'expired'
        ? 410
        : activation.reason === 'used' || activation.reason === 'duplicate'
          ? 409
          : activation.reason === 'limit_reached'
            ? 429
            : activation.reason === 'own_gift'
              ? 400
              : 404;
    res.status(status).json({ error: activation.reason });
    return;
  }

  const technique = await queryOne<TechniqueRow>(
    'SELECT * FROM techniques WHERE id = $1',
    [activation.technique_id],
  );

  res.json({
    technique: technique ? serializeTechnique(technique) : null,
    access_expires_at: activation.access_expires_at,
  });
});

app.get('/gifts', async (req, res) => {
  const vkUserId = Number(req.query.vk_user_id);
  if (!Number.isFinite(vkUserId)) {
    res.status(400).json({ error: 'vk_user_id required' });
    return;
  }

  const gifts = await activeGiftsFor(vkUserId);
  const techniques = await Promise.all(
    gifts.map((gift) =>
      queryOne<TechniqueRow>('SELECT * FROM techniques WHERE id = $1', [gift.technique_id]),
    ),
  );

  res.json({
    gifts: gifts.map((gift, index) => ({
      technique_id: gift.technique_id,
      access_expires_at: gift.access_expires_at,
      technique: techniques[index] ? serializeTechnique(techniques[index]!) : null,
    })),
  });
});

app.get('/favorites', async (req, res) => {
  const vkUserId = Number(req.query.vk_user_id);
  if (!Number.isFinite(vkUserId)) {
    res.status(400).json({ error: 'vk_user_id required' });
    return;
  }

  const rows = await queryAll<TechniqueRow>(
    `SELECT t.* FROM favorites f
     JOIN techniques t ON t.id = f.technique_id
     WHERE f.vk_user_id = $1
     ORDER BY f.created_at DESC`,
    [vkUserId],
  );

  res.json({ favorites: rows.map(serializeTechnique) });
});

app.post('/favorites', async (req, res) => {
  const { vk_user_id, technique_id } = req.body ?? {};
  if (
    typeof vk_user_id !== 'number' ||
    typeof technique_id !== 'number' ||
    !Number.isFinite(vk_user_id) ||
    !Number.isFinite(technique_id)
  ) {
    res.status(400).json({ error: 'vk_user_id and technique_id required' });
    return;
  }

  await query(
    `INSERT INTO favorites (vk_user_id, technique_id) VALUES ($1, $2)
     ON CONFLICT DO NOTHING`,
    [vk_user_id, technique_id],
  );

  res.json({ ok: true });
});

app.delete('/favorites', async (req, res) => {
  const { vk_user_id, technique_id } = req.body ?? {};
  if (typeof vk_user_id !== 'number' || typeof technique_id !== 'number') {
    res.status(400).json({ error: 'vk_user_id and technique_id required' });
    return;
  }

  await query(
    'DELETE FROM favorites WHERE vk_user_id = $1 AND technique_id = $2',
    [vk_user_id, technique_id],
  );

  res.json({ ok: true });
});

function serializePartner(row: PartnerProfileRow | undefined, userVkId: number) {
  return {
    user_vk_id: row?.user_vk_id ?? userVkId,
    subjective_base_type: row?.subjective_base_type ?? null,
    subjective_secondary_type: row?.subjective_secondary_type ?? null,
    subjective_scores_json: row?.subjective_scores_json ?? null,
    partner_vk_id: row?.partner_vk_id ?? null,
    partner_self_base_type: row?.partner_self_base_type ?? null,
    partner_self_secondary_type: row?.partner_self_secondary_type ?? null,
    partner_self_scores_json: row?.partner_self_scores_json ?? null,
    invite_token: row?.invite_token ?? null,
    invite_expires_at: row?.invite_expires_at ?? null,
  };
}

app.post('/partner/invite', async (req, res) => {
  const { vk_user_id } = req.body ?? {};

  if (typeof vk_user_id !== 'number' || !Number.isFinite(vk_user_id)) {
    res.status(400).json({ error: 'vk_user_id must be a number' });
    return;
  }

  const invite = await createPartnerInvite(vk_user_id);
  res.json(invite);
});

app.get('/partner/invite/validate', async (req, res) => {
  const token = typeof req.query.token === 'string' ? req.query.token : '';

  if (!token) {
    res.status(400).json({ error: 'token required' });
    return;
  }

  const validation = await validatePartnerInvite(token);
  res.json(validation);
});

app.get('/partner', async (req, res) => {
  const userVkId = Number(req.query.vk_user_id);
  if (!Number.isFinite(userVkId)) {
    res.status(400).json({ error: 'vk_user_id required' });
    return;
  }

  const row = await queryOne<PartnerProfileRow>(
    'SELECT * FROM partner_profiles WHERE user_vk_id = $1',
    [userVkId],
  );

  res.json({ partner: serializePartner(row, userVkId) });
});

app.post('/partner/subjective', async (req, res) => {
  const {
    vk_user_id,
    subjective_base_type,
    subjective_secondary_type,
    subjective_scores_json,
  } = req.body ?? {};

  if (typeof vk_user_id !== 'number' || !Number.isFinite(vk_user_id)) {
    res.status(400).json({ error: 'vk_user_id must be a number' });
    return;
  }

  const existing = await queryOne<PartnerProfileRow>(
    'SELECT * FROM partner_profiles WHERE user_vk_id = $1',
    [vk_user_id],
  );

  if (existing) {
    await query(
      `UPDATE partner_profiles SET
        subjective_base_type = $1, subjective_secondary_type = $2,
        subjective_scores_json = $3, updated_at = NOW()
       WHERE user_vk_id = $4`,
      [
        subjective_base_type ?? null,
        subjective_secondary_type ?? null,
        subjective_scores_json ?? null,
        vk_user_id,
      ],
    );
  } else {
    await query(
      `INSERT INTO partner_profiles (
        user_vk_id, subjective_base_type, subjective_secondary_type, subjective_scores_json
      ) VALUES ($1, $2, $3, $4)`,
      [
        vk_user_id,
        subjective_base_type ?? null,
        subjective_secondary_type ?? null,
        subjective_scores_json ?? null,
      ],
    );
  }

  const row = await queryOne<PartnerProfileRow>(
    'SELECT * FROM partner_profiles WHERE user_vk_id = $1',
    [vk_user_id],
  );

  res.json({ partner: serializePartner(row, vk_user_id) });
});

app.post('/partner/self', async (req, res) => {
  const {
    partner_vk_id,
    linked_user_vk_id,
    invite_token,
    partner_self_base_type,
    partner_self_secondary_type,
    partner_self_scores_json,
  } = req.body ?? {};

  if (typeof partner_vk_id !== 'number' || !Number.isFinite(partner_vk_id)) {
    res.status(400).json({ error: 'partner_vk_id required' });
    return;
  }

  let resolvedLinkedUserId = linked_user_vk_id;

  if (typeof invite_token === 'string' && invite_token.trim()) {
    const validation = await validatePartnerInvite(invite_token.trim());
    if (!validation.valid) {
      res.status(validation.expired ? 410 : 404).json({
        error: validation.reason,
        expired: validation.expired,
      });
      return;
    }
    resolvedLinkedUserId = validation.linked_user_vk_id;
  }

  if (typeof resolvedLinkedUserId !== 'number' || !Number.isFinite(resolvedLinkedUserId)) {
    res.status(400).json({ error: 'invite_token or linked_user_vk_id required' });
    return;
  }

  await query(
    'INSERT INTO users (vk_user_id) VALUES ($1) ON CONFLICT DO NOTHING',
    [partner_vk_id],
  );
  await query(
    'INSERT INTO users (vk_user_id) VALUES ($1) ON CONFLICT DO NOTHING',
    [resolvedLinkedUserId],
  );

  const existing = await queryOne<PartnerProfileRow>(
    'SELECT * FROM partner_profiles WHERE user_vk_id = $1',
    [resolvedLinkedUserId],
  );

  if (existing) {
    await query(
      `UPDATE partner_profiles SET
        partner_vk_id = $1, partner_self_base_type = $2, partner_self_secondary_type = $3,
        partner_self_scores_json = $4, updated_at = NOW()
       WHERE user_vk_id = $5`,
      [
        partner_vk_id,
        partner_self_base_type ?? null,
        partner_self_secondary_type ?? null,
        partner_self_scores_json ?? null,
        resolvedLinkedUserId,
      ],
    );
  } else {
    await query(
      `INSERT INTO partner_profiles (
        user_vk_id, partner_vk_id, partner_self_base_type,
        partner_self_secondary_type, partner_self_scores_json
      ) VALUES ($1, $2, $3, $4, $5)`,
      [
        resolvedLinkedUserId,
        partner_vk_id,
        partner_self_base_type ?? null,
        partner_self_secondary_type ?? null,
        partner_self_scores_json ?? null,
      ],
    );
  }

  const row = await queryOne<PartnerProfileRow>(
    'SELECT * FROM partner_profiles WHERE user_vk_id = $1',
    [resolvedLinkedUserId],
  );

  res.json({ partner: serializePartner(row, resolvedLinkedUserId) });
});

app.get('/partner/tips', async (req, res) => {
  const userVkId = Number(req.query.vk_user_id);
  if (!Number.isFinite(userVkId)) {
    res.status(400).json({ error: 'vk_user_id required' });
    return;
  }

  const profile = await queryOne<{ base_type: string | null }>(
    'SELECT base_type FROM profiles WHERE vk_user_id = $1',
    [userVkId],
  );
  const baseType = profile?.base_type ?? null;
  const access = await partnerTipsAccess(userVkId);

  // Архитектура подсказок §2–3: Free — принципы и фразы, Premium — таблица типа и ситуации.
  res.json({
    base_type: baseType,
    principles: PARTNER_PRINCIPLES,
    support_phrases: PARTNER_SUPPORT_PHRASES,
    avoid_phrases: PARTNER_AVOID_PHRASES,
    article: PARTNER_ARTICLE,
    help_signals: PARTNER_HELP_SIGNALS,
    has_premium: access.has_premium,
    premium_paid_by: access.paid_by,
    premium_notice: access.paid_by === 'partner' ? PARTNER_PREMIUM_NOTICE : null,
    tips: access.has_premium ? partnerTipsForType(baseType) : null,
    situational_tips: access.has_premium ? situationalTipsForType(baseType) : [],
    premium_required: !access.has_premium,
    premium_preview: access.has_premium ? null : PARTNER_PREMIUM_PREVIEW,
  });
});

app.post('/crisis/incidents', async (req, res) => {
  const { vk_user_id, trigger_type, trigger_value, actions_taken } = req.body ?? {};

  if (typeof vk_user_id !== 'number' || !Number.isFinite(vk_user_id)) {
    res.status(400).json({ error: 'vk_user_id must be a number' });
    return;
  }
  if (typeof trigger_type !== 'string' || !trigger_type.trim()) {
    res.status(400).json({ error: 'trigger_type required' });
    return;
  }

  const actions = Array.isArray(actions_taken)
    ? actions_taken.filter((item): item is string => typeof item === 'string')
    : [];

  await logCrisisIncident(
    vk_user_id,
    trigger_type,
    typeof trigger_value === 'string' ? trigger_value : null,
    actions,
  );

  res.json({ ok: true });
});

app.get('/mood', async (req, res) => {
  const vkUserId = Number(req.query.vk_user_id);
  if (!Number.isFinite(vkUserId)) {
    res.status(400).json({ error: 'vk_user_id must be a number' });
    return;
  }

  const entries = await getMoodEntries(vkUserId);
  res.json({ options: MOOD_OPTIONS, entries });
});

app.post('/mood', async (req, res) => {
  const { vk_user_id, mood_score, note } = req.body ?? {};
  if (typeof vk_user_id !== 'number' || !Number.isFinite(vk_user_id)) {
    res.status(400).json({ error: 'vk_user_id must be a number' });
    return;
  }
  if (!isValidMoodScore(mood_score)) {
    res.status(400).json({ error: 'mood_score must be 1–5' });
    return;
  }
  if (note !== undefined && note !== null && typeof note !== 'string') {
    res.status(400).json({ error: 'note must be a string' });
    return;
  }

  await query('INSERT INTO users (vk_user_id) VALUES ($1) ON CONFLICT (vk_user_id) DO NOTHING', [
    vk_user_id,
  ]);

  const entry = await saveMoodEntry(vk_user_id, mood_score, note ?? null);
  if (!entry) {
    res.status(400).json({ error: 'mood_score must be 1–5' });
    return;
  }

  const profile = await queryOne<ProfileRow>('SELECT * FROM profiles WHERE vk_user_id = $1', [
    vk_user_id,
  ]);

  res.json({ entry, profile: await buildProfileResponse(profile ?? undefined, vk_user_id) });
});

app.post('/stress/report', async (req, res) => {
  const { vk_user_id, stress } = req.body ?? {};

  if (typeof vk_user_id !== 'number' || !Number.isFinite(vk_user_id)) {
    res.status(400).json({ error: 'vk_user_id must be a number' });
    return;
  }
  if (typeof stress !== 'number' || stress < 1 || stress > 10) {
    res.status(400).json({ error: 'stress must be 1–10' });
    return;
  }

  await recordStressLevel(vk_user_id, stress);

  const existing = await queryOne<ProfileRow>(
    'SELECT * FROM profiles WHERE vk_user_id = $1',
    [vk_user_id],
  );

  if (existing) {
    await query(
      'UPDATE profiles SET last_stress = $1, updated_at = NOW() WHERE vk_user_id = $2',
      [stress, vk_user_id],
    );
  } else {
    await query(
      'INSERT INTO profiles (vk_user_id, last_stress) VALUES ($1, $2)',
      [vk_user_id, stress],
    );
  }

  // Ответы 27.09, п. 4: замер на входе показываем не чаще раза в день.
  await markStressChecked(vk_user_id);

  const row = await queryOne<ProfileRow>(
    'SELECT * FROM profiles WHERE vk_user_id = $1',
    [vk_user_id],
  );

  res.json({
    profile: await buildProfileResponse(row, vk_user_id),
    crisis_redirect: stress >= 9 ? 'red' : null,
  });
});

app.post('/care-trigger/dismiss', async (req, res) => {
  const { vk_user_id } = req.body ?? {};
  if (typeof vk_user_id !== 'number' || !Number.isFinite(vk_user_id)) {
    res.status(400).json({ error: 'vk_user_id must be a number' });
    return;
  }

  await markCareTriggerShown(vk_user_id);
  const row = await queryOne<ProfileRow>(
    'SELECT * FROM profiles WHERE vk_user_id = $1',
    [vk_user_id],
  );
  res.json({ profile: await buildProfileResponse(row, vk_user_id) });
});

app.get('/care-trigger', async (_req, res) => {
  res.json({ text: CARE_TRIGGER_TEXT });
});

/**
 * §13: приём продуктовых событий. Идентификатор хешируется на сервере,
 * payload фильтруется по белому списку — тексты и заметки сюда не попадают.
 */
app.post('/analytics/event', async (req, res) => {
  const { vk_user_id, event, screen, payload } = req.body ?? {};
  if (typeof vk_user_id !== 'number' || !Number.isFinite(vk_user_id)) {
    res.status(400).json({ error: 'vk_user_id must be a number' });
    return;
  }
  if (!isAnalyticsEvent(event)) {
    res.status(400).json({ error: 'unknown event', allowed: ANALYTICS_EVENTS });
    return;
  }

  await logAnalyticsEvent({ vkUserId: vk_user_id, event, screen, payload });
  res.status(204).end();
});

app.get('/analytics/summary', requireAuth, async (_req, res) => {
  if (process.env.ENABLE_ADMIN !== 'true') {
    res.status(404).json({ error: 'Not found' });
    return;
  }

  res.json({ events: await analyticsSummary(), retention_days: 180 });
});

app.post('/epds', async (req, res) => {
  const { vk_user_id, answers } = req.body ?? {};

  if (typeof vk_user_id !== 'number' || !Number.isFinite(vk_user_id)) {
    res.status(400).json({ error: 'vk_user_id must be a number' });
    return;
  }

  try {
    const { total, crisisLevel, q10Score } = scoreEpdsAnswers(answers);
    const existing = await queryOne<ProfileRow>(
      'SELECT * FROM profiles WHERE vk_user_id = $1',
      [vk_user_id],
    );

    if (existing) {
      await query(
        `UPDATE profiles SET epds_score = $1, crisis_level = $2,
         epds_completed_at = NOW(), updated_at = NOW()
         WHERE vk_user_id = $3`,
        [total, crisisLevel, vk_user_id],
      );
    } else {
      await query(
        `INSERT INTO profiles (vk_user_id, epds_score, crisis_level, epds_completed_at)
         VALUES ($1, $2, $3, NOW())`,
        [vk_user_id, total, crisisLevel],
      );
    }

    const row = await queryOne<ProfileRow>(
      'SELECT * FROM profiles WHERE vk_user_id = $1',
      [vk_user_id],
    );

    if (crisisLevel === 'red') {
      await logCrisisIncident(vk_user_id, 'epds_red', String(total), [
        'set_crisis_red',
        'redirect_crisis',
        `q10=${q10Score}`,
      ]);
    } else if (crisisLevel === 'yellow') {
      await logCrisisIncident(vk_user_id, 'epds_yellow', String(total), [
        'set_crisis_yellow',
        'block_complex_techniques',
      ]);
    }

    res.json({
      epds_score: total,
      crisis_level: crisisLevel,
      profile: await buildProfileResponse(row, vk_user_id),
    });
  } catch (error) {
    res.status(400).json({
      error: error instanceof Error ? error.message : 'invalid answers',
    });
  }
});

app.delete('/profile', async (req, res) => {
  const { vk_user_id } = req.body ?? {};
  if (typeof vk_user_id !== 'number' || !Number.isFinite(vk_user_id)) {
    res.status(400).json({ error: 'vk_user_id must be a number' });
    return;
  }

  await query('DELETE FROM favorites WHERE vk_user_id = $1', [vk_user_id]);
  await query('DELETE FROM technique_usage WHERE vk_user_id = $1', [vk_user_id]);
  await query('DELETE FROM stress_log WHERE vk_user_id = $1', [vk_user_id]);
  await deleteMoodEntries(vk_user_id);
  await query('DELETE FROM crisis_incidents WHERE vk_user_id = $1', [vk_user_id]);
  await query('DELETE FROM partner_profiles WHERE user_vk_id = $1', [vk_user_id]);
  await query('DELETE FROM profiles WHERE vk_user_id = $1', [vk_user_id]);
  await query('DELETE FROM users WHERE vk_user_id = $1', [vk_user_id]);

  res.json({ ok: true });
});

app.post('/premium/activate', async (req, res) => {
  const { vk_user_id } = req.body ?? {};
  if (typeof vk_user_id !== 'number' || !Number.isFinite(vk_user_id)) {
    res.status(400).json({ error: 'vk_user_id must be a number' });
    return;
  }

  const existing = await queryOne<ProfileRow>(
    'SELECT * FROM profiles WHERE vk_user_id = $1',
    [vk_user_id],
  );

  if (existing) {
    await query(
      'UPDATE profiles SET is_premium = TRUE, updated_at = NOW() WHERE vk_user_id = $1',
      [vk_user_id],
    );
  } else {
    await query(
      'INSERT INTO profiles (vk_user_id, is_premium) VALUES ($1, TRUE)',
      [vk_user_id],
    );
  }

  const row = await queryOne<ProfileRow>(
    'SELECT * FROM profiles WHERE vk_user_id = $1',
    [vk_user_id],
  );

  res.json({ profile: await buildProfileResponse(row, vk_user_id) });
});

async function main() {
  await initDb();

  app.listen(port, () => {
    console.log(`Elia API http://localhost:${port}`);
  });

  ensureCatalogSeeded().catch((error) => {
    console.error('Catalog seed failed:', error);
  });

  // §13: подробные события живут 180 дней. Чистим при старте и раз в сутки.
  const pruneAnalytics = () =>
    pruneAnalyticsEvents()
      .then((removed) => {
        if (removed > 0) console.log(`analytics: удалено старых событий — ${removed}`);
      })
      .catch((error) => console.error('analytics prune failed:', error));

  void pruneAnalytics();
  setInterval(pruneAnalytics, 24 * 60 * 60 * 1000).unref();
}

main().catch((error) => {
  console.error('Failed to start API:', error);
  process.exit(1);
});
