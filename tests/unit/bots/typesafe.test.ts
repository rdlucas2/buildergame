import { describe, expect, it } from 'vitest';
import { NO_MODIFIERS } from '../../../src/core/defense-state';
import { DefenseSession } from '../../../src/sim/defense/session';
import { buildOptions } from '../../../src/sim/defense/advisor';
import type { View } from '../../../bots/brain';
import { MockBrain } from '../../../bots/brains/mock';
import { MissingKeyError, TypeSafeBrain } from '../../../bots/brains/typesafe';
import { councilOffers, loadProfile } from '../../../bots/campaign';
import { SimTable } from '../../../bots/drivers/sim';
import { PERSONAS } from '../../../bots/personas';
import { playRound } from '../../../bots/play';

interface Sent {
  url: string;
  headers: Record<string, string>;
  body: { state: Record<string, unknown>; questions: Record<string, { type: string; instructions: string; criteria: Record<string, string> }>; model: string };
}

/** A stand-in for the API: records each request and answers with `answer(questions)` (or a status). */
function fakeApi(answer: (q: Sent['body']['questions']) => Record<string, string> | number) {
  const sent: Sent[] = [];
  const fetch = async (url: string, init?: RequestInit): Promise<Response> => {
    const body = JSON.parse(String(init?.body)) as Sent['body'];
    sent.push({ url, headers: init?.headers as Record<string, string>, body });
    const a = answer(body.questions);
    if (typeof a === 'number') return new Response(JSON.stringify({ error: { message: 'boom' } }), { status: a, headers: { 'content-type': 'application/json' } });
    const answers: Record<string, unknown> = {};
    for (const [name, label] of Object.entries(a)) {
      const labels = Object.keys(body.questions[name]?.criteria ?? { [label]: null });
      const probabilities = Object.fromEntries(labels.map((l) => [l, l === label ? 0.7 : 0.3 / Math.max(1, labels.length - 1)]));
      answers[name] = { type: 'choice', choice: label, confidence: 0.7, probabilities };
    }
    return new Response(JSON.stringify({ model: 'test-model', answers, usage: { input_tokens: 321, output_tokens: 9 } }), { status: 200, headers: { 'content-type': 'application/json' } });
  };
  return { sent, fetch };
}

/** A round two waves in, with a perk offer waiting and the bow unlocked. */
function viewWithOffer(): View {
  const s = DefenseSession.create({ seed: 4, modifiers: { ...NO_MODIFIERS, startWeapon: 1 } });
  while (s.observe().offer.length === 0) s.advance(5);
  return { obs: s.observe(), options: buildOptions(s.defense).map(({ actions: _a, ...o }) => o) };
}

describe('the TypeSafe brain', () => {
  it('needs an API key, and says how to get one', () => {
    const saved = process.env.TYPESAFE_API_KEY;
    delete process.env.TYPESAFE_API_KEY;
    try {
      expect(() => new TypeSafeBrain(PERSONAS.balanced)).toThrow(MissingKeyError);
      expect(() => new TypeSafeBrain(PERSONAS.balanced)).toThrow(/TYPESAFE_API_KEY.*--brain heuristic/s);
    } finally {
      if (saved !== undefined) process.env.TYPESAFE_API_KEY = saved;
    }
  });

  it('asks one systemOne request per decision, with a choice for each judgment', async () => {
    const api = fakeApi(() => ({ defenders: 'most', build: 'more-lookouts', perk: 'card_2', weapon: 'slingshot' }));
    const brain = new TypeSafeBrain(PERSONAS.sharpshooter, { apiKey: 'test-key', fetch: api.fetch, retry: { maxRetries: 0 } });
    const view = viewWithOffer();
    const d = await brain.decide(view);
    expect(api.sent).toHaveLength(1);
    const req = api.sent[0];
    expect(req.url).toBe('https://api.typesafe.ai/v1/systemone');
    expect(req.headers.Authorization).toBe('Bearer test-key');
    expect(Object.keys(req.body.questions).sort()).toEqual(['build', 'defenders', 'perk', 'weapon']);
    for (const q of Object.values(req.body.questions)) expect(q.type).toBe('choice');
    // Code lists the options; the model only picks one of them.
    expect(Object.keys(req.body.questions.build.criteria)).toEqual(view.options.map((o) => o.id));
    expect(Object.keys(req.body.questions.perk.criteria)).toEqual(view.obs.offer.map((_, i) => `card_${i + 1}`));
    expect(Object.keys(req.body.questions.weapon.criteria)).toEqual(view.obs.unlocked);
    expect(req.body.state).toMatchObject({ persona: { style: 'Sharpshooter' }, rabbits: { total: view.obs.rabbits } });
    // Each question names the state it judges.
    expect(req.body.questions.build.instructions).toMatch(/`warren`/);

    const grown = view.obs.rabbits - view.obs.young;
    expect(d.actions).toContainEqual({ type: 'allocate', defenders: Math.min(view.obs.rabbits, Math.max(PERSONAS.sharpshooter.minDefenders, Math.round(grown * 0.7))) });
    expect(d.actions).toContainEqual({ type: 'pickPerk', index: 1 });
    // The bow is already carried (it's better); the model asked for the slingshot instead.
    expect(view.obs.mainWeapon).toBe('bow');
    expect(d.actions).toContainEqual({ type: 'equip', weapon: 'slingshot' });
    expect(d.actions).toContainEqual({ option: 'more-lookouts' });
    expect(d.usage).toEqual({ input: 321, output: 9 });
    expect(d.probs?.build[0]).toEqual({ label: 'more-lookouts', p: 0.7 });
    expect(d.fallback).toBeUndefined();
  });

  it('skips the perk and weapon questions when there is nothing to choose', async () => {
    const api = fakeApi(() => ({ defenders: 'half', build: 'wait' }));
    const brain = new TypeSafeBrain(PERSONAS.balanced, { apiKey: 'k', fetch: api.fetch, retry: { maxRetries: 0 } });
    const s = DefenseSession.create({ seed: 4 });
    const d = await brain.decide({ obs: s.observe(), options: buildOptions(s.defense).map(({ actions: _a, ...o }) => o) });
    expect(Object.keys(api.sent[0].body.questions).sort()).toEqual(['build', 'defenders']);
    expect(d.actions.some((a) => 'option' in a)).toBe(false);
  });

  it('ignores an answer that was not offered, and uses the rules for that judgment', async () => {
    const api = fakeApi(() => ({ defenders: 'all of them', build: 'nuke-the-foxes', perk: 'card_9' }));
    const brain = new TypeSafeBrain(PERSONAS.balanced, { apiKey: 'k', fetch: api.fetch, retry: { maxRetries: 0 } });
    const view = viewWithOffer();
    const d = await brain.decide(view);
    expect(d.fallback).toMatch(/defenders: "all of them" was not offered/);
    expect(d.fallback).toMatch(/build: "nuke-the-foxes"/);
    expect(d.actions.find((a) => 'type' in a && a.type === 'pickPerk')).toBeTruthy();
    expect(d.actions.every((a) => !('option' in a) || view.options.some((o) => o.id === a.option))).toBe(true);
  });

  it('falls back to the heuristic brain when the API fails, and keeps playing', async () => {
    const api = fakeApi(() => 500);
    const brain = new TypeSafeBrain(PERSONAS.turtle, { apiKey: 'k', fetch: api.fetch, retry: { maxRetries: 0 } });
    const d = await brain.decide(viewWithOffer());
    expect(d.fallback).toMatch(/TypeSafe API error 500/);
    expect(d.actions.length).toBeGreaterThan(0);
    // A whole (short) round still plays through, every decision on rules.
    const modifiers = { ...NO_MODIFIERS };
    const run = await playRound(new SimTable(4, modifiers), brain, { seed: 4, size: 512, modifiers, every: 10, maxSeconds: 60 });
    expect(run.decisions.length).toBeGreaterThan(3);
    expect(run.decisions.every((x) => x.fallback)).toBe(true);
  });

  it('chooses Warren Council upgrades among those it can afford, or saves', async () => {
    const profile = { ...loadProfile('fresh'), clover: 300 };
    const offers = councilOffers(profile);
    const pick = fakeApi((q) => {
      expect(Object.keys(q.upgrade.criteria)).toEqual(['save', ...offers.map((o) => o.id)]);
      return { upgrade: offers[1].id };
    });
    const brain = new TypeSafeBrain(PERSONAS.breeder, { apiKey: 'k', fetch: pick.fetch, retry: { maxRetries: 0 } });
    expect((await brain.council(profile, offers)).buy).toBe(offers[1].id);
    const save = new TypeSafeBrain(PERSONAS.breeder, { apiKey: 'k', fetch: fakeApi(() => ({ upgrade: 'save' })).fetch, retry: { maxRetries: 0 } });
    expect((await save.council(profile, offers)).buy).toBeNull();
  });
});

describe('the offline mock of the TypeSafe API', () => {
  it('runs the whole TypeSafe pipeline with no key and no network, answering like the persona', async () => {
    const seen: string[] = [];
    const brain = new MockBrain(PERSONAS.breeder, { onExchange: (e) => seen.push(`${e.what}:${Object.keys(e.questions).sort().join(',')}`) });
    expect(brain.kind).toBe('mock');
    const modifiers = { ...NO_MODIFIERS };
    const run = await playRound(new SimTable(4, modifiers), brain, { seed: 4, size: 512, modifiers, every: 10, maxSeconds: 120 });
    expect(brain.api.requests).toBe(run.decisions.length);
    expect(run.decisions.every((d) => !d.fallback && d.usage && d.probs?.defenders)).toBe(true);
    expect(seen[0]).toBe('decision:build,defenders');
    // The breeder's rules want few rabbits defending.
    expect(run.decisions[0].why).toMatch(/\(few\)/);
    expect(run.replay.player).toEqual({ style: 'breeder', brain: 'mock' });
  });

  it('with chaos, answers some requests badly, and the brain falls back each time', async () => {
    const brain = new MockBrain(PERSONAS.turtle, { chaos: 1, seed: 3 });
    const modifiers = { ...NO_MODIFIERS };
    const run = await playRound(new SimTable(4, modifiers), brain, { seed: 4, size: 512, modifiers, every: 10, maxSeconds: 60 });
    expect(run.decisions.every((d) => d.fallback)).toBe(true);
    expect(run.decisions.some((d) => /not offered/.test(d.fallback!))).toBe(true);
    expect(run.decisions.some((d) => /500/.test(d.fallback!))).toBe(true);
  });
});
