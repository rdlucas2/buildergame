import { z } from 'zod';
import { emptyLifetime, type PlayerProfile } from '../profile';
import { FileFormatError } from './errors';

export const PROFILE_FORMAT = 'buildergame.profile';
export const PROFILE_FORMAT_VERSION = 1;

const int = z.number().int();
const count = z.number().min(0).max(1e12);
const counts = z.record(z.string().max(64), count);

const ProfileSchema = z.object({
  clover: count,
  cloverEarned: count,
  upgrades: z.record(z.string().max(64), int.min(0).max(1000)),
  achievements: z.record(z.string().max(64), z.string().max(64)),
  stats: z
    .object({
      rounds: count,
      time: count,
      bestTime: count,
      bestScore: count,
      bestWave: count,
      score: count,
      waves: count,
      kills: count,
      killsWith: counts,
      killsOf: counts,
    })
    .partial()
    .default({}),
});

const ProfileFileSchema = ProfileSchema.extend({
  format: z.literal(PROFILE_FORMAT),
  version: z.literal(PROFILE_FORMAT_VERSION),
});

/** Checks a stored or imported profile and fills in anything missing. Throws FileFormatError. */
export function parseProfile(raw: unknown): PlayerProfile {
  const r = ProfileSchema.safeParse(raw);
  if (!r.success) throw new FileFormatError(`Invalid player profile: ${r.error.issues[0]?.message ?? 'unreadable'}`);
  const p = r.data;
  return { clover: p.clover, cloverEarned: p.cloverEarned, upgrades: { ...p.upgrades }, achievements: { ...p.achievements }, stats: { ...emptyLifetime(), ...p.stats } };
}

/** A profile as a `.profile.json` file. */
export function encodeProfileFile(p: PlayerProfile): Record<string, unknown> {
  return { format: PROFILE_FORMAT, version: PROFILE_FORMAT_VERSION, ...structuredClone(p) };
}

/** Reads a `.profile.json` file. Throws FileFormatError when it isn't one. */
export function decodeProfileFile(json: unknown): PlayerProfile {
  const r = ProfileFileSchema.safeParse(json);
  if (!r.success) {
    const fmt = (json as { format?: unknown } | null)?.format;
    if (fmt !== PROFILE_FORMAT) throw new FileFormatError('This is not a Buildergame player profile file.');
    throw new FileFormatError(`Invalid player profile: ${r.error.issues[0]?.message ?? 'unreadable'}`);
  }
  return parseProfile(r.data);
}
