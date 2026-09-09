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
import { pickTechnique, serializeTechnique, stressZone } from './recommend.js';
import { seedTechniques } from './seed/run.js';
import { partnerTipsForType } from './partner/tips.js';
import { scoreEpdsAnswers } from './epds/score.js';
import {
  FREE_DAILY_EMERGENCY_LIMIT,
  canUseTechnique,
  getDailyUsage,
  incrementDailyUsage,
} from './billing/usage.js';

const app = express();
const port = Number(process.env.PORT ?? 3001);

const frontendOrigin = process.env.FRONTEND_URL ?? 'http://localhost:5173';
app.use(
  cors({
    origin: [frontendOrigin, 'http://localhost:5173', 'http://127.0.0.1:5173'],
  }),
);
app.use(express.json());

function serializeProfile(row: ProfileRow | undefined, vkUserId: number) {
  return {
    vk_user_id: row?.vk_user_id ?? vkUserId,
    trimester: row?.trimester ?? null,
    onboarding_completed: Boolean(row?.onboarding_completed),
    base_type: row?.base_type ?? null,
    secondary_type: row?.secondary_type ?? null,
    scores_json: row?.scores_json ?? null,
    platform: row?.platform ?? null,
    last_stress: row?.last_stress ?? null,
    techniques_completed: row?.techniques_completed ?? 0,
    crisis_level: row?.crisis_level ?? 'green',
    epds_score: row?.epds_score ?? null,
    epds_completed_at: row?.epds_completed_at ?? null,
    is_premium: Boolean(row?.is_premium),
    daily_techniques_used: getDailyUsage(row).count,
    daily_techniques_remaining: getDailyUsage(row).remaining,
    daily_techniques_limit: FREE_DAILY_EMERGENCY_LIMIT,
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

  res.json({ profile: serializeProfile(row, vkUserId) });
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

  res.json({ profile: serializeProfile(row, vk_user_id) });
});

app.get('/techniques/recommend', async (req, res) => {
  const vkUserId = Number(req.query.vk_user_id);
  const stress = Number(req.query.stress);

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

  let zone = stressZone(stress);
  const access = canUseTechnique(profile, zone);
  if (!access.allowed) {
    res.status(402).json({
      error: access.reason ?? 'premium_required',
      is_premium: Boolean(profile?.is_premium),
      daily_remaining: getDailyUsage(profile).remaining,
    });
    return;
  }

  if (profile?.crisis_level === 'yellow' && zone === 'green') {
    zone = 'yellow';
  }

  const pool = await queryAll<TechniqueRow>(
    'SELECT * FROM techniques WHERE level = $1',
    [zone],
  );

  const technique = pickTechnique(pool, profile, 'base_type');
  if (!technique) {
    res.status(404).json({ error: 'No technique found for zone' });
    return;
  }

  let cascade = null;
  if (zone === 'yellow' && profile?.secondary_type) {
    const cascadePick = pickTechnique(pool, profile, 'secondary_type', {
      maxDuration: 120,
    });
    if (cascadePick && cascadePick.id !== technique.id) {
      cascade = serializeTechnique(cascadePick);
    }
  }

  res.json({
    zone,
    stress,
    technique: serializeTechnique(technique),
    cascade,
  });
});

app.post('/techniques/complete', async (req, res) => {
  const { vk_user_id, stress } = req.body ?? {};

  if (typeof vk_user_id !== 'number' || !Number.isFinite(vk_user_id)) {
    res.status(400).json({ error: 'vk_user_id must be a number' });
    return;
  }

  const existing = await queryOne<ProfileRow>(
    'SELECT * FROM profiles WHERE vk_user_id = $1',
    [vk_user_id],
  );

  const nextStress =
    typeof stress === 'number' && stress >= 1 && stress <= 10
      ? stress
      : (existing?.last_stress ?? null);
  const nextCompleted = (existing?.techniques_completed ?? 0) + 1;

  if (existing) {
    await query(
      `UPDATE profiles SET last_stress = $1, techniques_completed = $2, updated_at = NOW()
       WHERE vk_user_id = $3`,
      [nextStress, nextCompleted, vk_user_id],
    );
  } else {
    await query(
      `INSERT INTO profiles (vk_user_id, last_stress, techniques_completed) VALUES ($1, $2, $3)`,
      [vk_user_id, nextStress, nextCompleted],
    );
  }

  await incrementDailyUsage(vk_user_id, existing);

  const updated = await queryOne<ProfileRow>(
    'SELECT * FROM profiles WHERE vk_user_id = $1',
    [vk_user_id],
  );

  res.json({ profile: serializeProfile(updated, vk_user_id) });
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
  };
}

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
    partner_self_base_type,
    partner_self_secondary_type,
    partner_self_scores_json,
  } = req.body ?? {};

  if (
    typeof partner_vk_id !== 'number' ||
    typeof linked_user_vk_id !== 'number' ||
    !Number.isFinite(partner_vk_id) ||
    !Number.isFinite(linked_user_vk_id)
  ) {
    res.status(400).json({ error: 'partner_vk_id and linked_user_vk_id required' });
    return;
  }

  await query(
    'INSERT INTO users (vk_user_id) VALUES ($1) ON CONFLICT DO NOTHING',
    [partner_vk_id],
  );
  await query(
    'INSERT INTO users (vk_user_id) VALUES ($1) ON CONFLICT DO NOTHING',
    [linked_user_vk_id],
  );

  const existing = await queryOne<PartnerProfileRow>(
    'SELECT * FROM partner_profiles WHERE user_vk_id = $1',
    [linked_user_vk_id],
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
        linked_user_vk_id,
      ],
    );
  } else {
    await query(
      `INSERT INTO partner_profiles (
        user_vk_id, partner_vk_id, partner_self_base_type,
        partner_self_secondary_type, partner_self_scores_json
      ) VALUES ($1, $2, $3, $4, $5)`,
      [
        linked_user_vk_id,
        partner_vk_id,
        partner_self_base_type ?? null,
        partner_self_secondary_type ?? null,
        partner_self_scores_json ?? null,
      ],
    );
  }

  const row = await queryOne<PartnerProfileRow>(
    'SELECT * FROM partner_profiles WHERE user_vk_id = $1',
    [linked_user_vk_id],
  );

  res.json({ partner: serializePartner(row, linked_user_vk_id) });
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

  const tips = partnerTipsForType(profile?.base_type ?? null);
  res.json({ base_type: profile?.base_type ?? null, tips });
});

app.post('/epds', async (req, res) => {
  const { vk_user_id, answers } = req.body ?? {};

  if (typeof vk_user_id !== 'number' || !Number.isFinite(vk_user_id)) {
    res.status(400).json({ error: 'vk_user_id must be a number' });
    return;
  }

  try {
    const { total, crisisLevel } = scoreEpdsAnswers(answers);
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

    res.json({
      epds_score: total,
      crisis_level: crisisLevel,
      profile: serializeProfile(row, vk_user_id),
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

  res.json({ profile: serializeProfile(row, vk_user_id) });
});

async function main() {
  await initDb();
  await seedTechniques();

  app.listen(port, () => {
    console.log(`Elia API http://localhost:${port}`);
  });
}

main().catch((error) => {
  console.error('Failed to start API:', error);
  process.exit(1);
});
