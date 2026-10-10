import { z } from 'zod';

/** An example replay the game ships in `public/replays/`: one bot play style, recorded. */
export const ReplayExampleSchema = z.object({
  style: z.string().min(1).max(40),
  name: z.string().min(1).max(40),
  brief: z.string().max(1000),
  file: z.string().regex(/^[\w-]+\.replay\.json$/),
  seed: z.number().int(),
  seconds: z.number().nonnegative(),
  wave: z.number().int().nonnegative(),
  score: z.number().nonnegative(),
  kills: z.number().int().nonnegative(),
  /** Notable decisions: [round seconds, what the bot did]. */
  moments: z.array(z.tuple([z.number().nonnegative(), z.string().max(200)])).max(16),
});
export type ReplayExample = z.infer<typeof ReplayExampleSchema>;

export const ReplayIndexSchema = z.object({ examples: z.array(ReplayExampleSchema).max(50) });

/** Where the examples live, next to the game's page (the site is static and may be served from a sub-path). */
function replayUrl(name: string): string {
  return new URL(`replays/${name}`, document.baseURI).href;
}

/** The example replays the game ships with; empty when the index can't be read (offline, or none built). */
export async function loadReplayExamples(): Promise<ReplayExample[]> {
  try {
    const res = await fetch(replayUrl('index.json'));
    if (!res.ok) return [];
    return ReplayIndexSchema.parse(await res.json()).examples;
  } catch {
    return [];
  }
}

/** The text of one example replay file, or null when it can't be fetched. */
export async function loadReplayExample(file: string): Promise<string | null> {
  try {
    const res = await fetch(replayUrl(file));
    return res.ok ? await res.text() : null;
  } catch {
    return null;
  }
}
