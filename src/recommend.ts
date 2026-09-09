import type { ProfileRow, TechniqueRow as DbTechniqueRow } from './db.js';

export type StressZone = 'red' | 'yellow' | 'green';

export type TechniqueRow = DbTechniqueRow & { level: StressZone };

export function stressZone(stress: number): StressZone {
  if (stress >= 8) return 'red';
  if (stress >= 5) return 'yellow';
  return 'green';
}

function parsePsychotypes(raw: string): string[] {
  try {
    const parsed = JSON.parse(raw) as string[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function trimesterMatches(context: string, trimester: string | null): boolean {
  if (context === 'any') return true;
  if (!trimester) return context === 'any';
  if (context === 'postpartum') {
    return trimester.startsWith('postpartum');
  }
  return context === trimester;
}

function scoreTechnique(
  technique: TechniqueRow,
  psychotype: string | null,
  trimester: string | null,
): number {
  if (!trimesterMatches(technique.context, trimester)) return -1;

  const psychotypes = parsePsychotypes(technique.psychotypes_json);
  let score = 0;
  if (psychotype && psychotypes.includes(psychotype)) score += 10;
  if (psychotypes.length === 0) score += 1;
  return score;
}

export function pickTechnique(
  techniques: TechniqueRow[],
  profile: ProfileRow | undefined,
  psychotypeField: 'base_type' | 'secondary_type',
  options?: { maxDuration?: number },
): TechniqueRow | null {
  const psychotype = profile?.[psychotypeField] ?? null;
  const trimester = profile?.trimester ?? null;

  const ranked = techniques
    .map((technique) => ({
      technique,
      score: scoreTechnique(technique, psychotype, trimester),
    }))
    .filter(({ score, technique }) => {
      if (score < 0) return false;
      if (options?.maxDuration && technique.duration_sec > options.maxDuration) {
        return false;
      }
      return true;
    })
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      return a.technique.duration_sec - b.technique.duration_sec;
    });

  return ranked[0]?.technique ?? techniques[0] ?? null;
}

export function serializeTechnique(row: TechniqueRow) {
  return {
    id: row.id,
    title: row.title,
    text: row.text,
    duration_sec: row.duration_sec,
    audio_url: row.audio_url,
    level: row.level,
    context: row.context,
    psychotypes: parsePsychotypes(row.psychotypes_json),
    reaction: row.reaction,
    evidence: row.evidence,
  };
}
