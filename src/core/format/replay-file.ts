import { z } from 'zod';
import type { DefenseModifiers } from '../defense-state';
import type { DefenseAction } from '../../sim/defense/defense';
import { FileFormatError, formatZodError, parseJsonText } from './errors';
import { ModifiersSchema } from './world-file';

export const REPLAY_FORMAT = 'buildergame.replay';
export const REPLAY_FORMAT_VERSION = 1;
export const REPLAY_FILE_EXTENSION = '.replay.json';

/** More actions than a 30-minute round could hold at one per tick. */
export const MAX_REPLAY_ACTIONS = 20_000;

/** Who played a recorded round. */
export interface ReplayPlayer {
  /** A bot persona (turtle, sharpshooter...) or 'player'. */
  style: string;
  /** What made the decisions: 'heuristic', 'typesafe' or 'human'. */
  brain: string;
}

/** How a recorded round ended. */
export interface ReplayResult {
  clock: number;
  wave: number;
  score: number;
  kills: number;
  rabbitsLost: number;
  blocksBroken: number;
  outcome: 'playing' | 'lost';
  /** `stateHash` of the simulation at the end, to check a replay came out the same. */
  hash: string;
}

/** A recorded Warren Defense round: everything needed to play it again, identically. */
export interface Replay {
  seed: number;
  size: number;
  modifiers: DefenseModifiers;
  player: ReplayPlayer;
  actions: Array<{ tick: number; action: DefenseAction }>;
  /** The tick the recording ended at. */
  ticks: number;
  result: ReplayResult;
}

const int = z.number().int();
const coord = int.min(-1_000_000).max(1_000_000);
const id = z.string().min(1).max(64);
const block = z.object({ x: coord, y: coord, z: coord, material: id }).strict();

const ActionSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('allocate'), defenders: int.min(0).max(100_000) }).strict(),
  z.object({ type: z.literal('callWave') }).strict(),
  z.object({ type: z.literal('buyBudget') }).strict(),
  z.object({ type: z.literal('place'), x: coord, y: coord, z: coord, material: id }).strict(),
  z.object({ type: z.literal('placeMany'), blocks: z.array(block).min(1).max(10_000) }).strict(),
  z.object({ type: z.literal('remove'), x: coord, y: coord, z: coord }).strict(),
  z.object({ type: z.literal('pickPerk'), index: int.min(0).max(16) }).strict(),
  z.object({ type: z.literal('reroll') }).strict(),
  z.object({ type: z.literal('equip'), weapon: id }).strict(),
  z.object({ type: z.literal('loadout'), weapon: id, count: int.min(0).max(100_000) }).strict(),
  z.object({ type: z.literal('strengthen'), tier: int.min(0).max(16) }).strict(),
  z.object({ type: z.literal('repair') }).strict(),
]);

const ReplayFileSchema = z.object({
  format: z.literal(REPLAY_FORMAT),
  version: z.literal(REPLAY_FORMAT_VERSION),
  seed: int.min(0).max(0xffffffff),
  size: int.min(64).max(2048),
  modifiers: ModifiersSchema,
  player: z.object({ style: id, brain: id }),
  actions: z.array(z.object({ tick: int.min(0).max(1e9), action: ActionSchema })).max(MAX_REPLAY_ACTIONS),
  ticks: int.min(0).max(1e9),
  result: z.object({
    clock: z.number().min(0).max(1e9),
    wave: int.min(0).max(1e6),
    score: z.number().min(0).max(1e15),
    kills: int.min(0).max(1e9),
    rabbitsLost: int.min(0).max(1e9),
    blocksBroken: int.min(0).max(1e9),
    outcome: z.enum(['playing', 'lost']),
    hash: z.string().max(64),
  }),
});

/** A replay as a `.replay.json` file. */
export function encodeReplay(r: Replay): Record<string, unknown> {
  return { format: REPLAY_FORMAT, version: REPLAY_FORMAT_VERSION, ...structuredClone(r) };
}

/** Reads a replay file (parsed JSON or its text). Throws FileFormatError when it isn't a valid one. */
export function decodeReplay(input: unknown): Replay {
  const json = typeof input === 'string' ? parseJsonText(input, 'replay') : input;
  const fmt = (json as { format?: unknown } | null)?.format;
  if (fmt !== REPLAY_FORMAT) throw new FileFormatError('This is not a Buildergame replay file.');
  const r = ReplayFileSchema.safeParse(json);
  if (!r.success) throw new FileFormatError(formatZodError('replay', r.error));
  const { format: _f, version: _v, ...replay } = r.data;
  // Ticks must not go backwards: a replay applies its actions in order.
  for (let i = 1; i < replay.actions.length; i++)
    if (replay.actions[i].tick < replay.actions[i - 1].tick) throw new FileFormatError('Invalid replay file: actions are out of order.');
  return replay as Replay;
}
