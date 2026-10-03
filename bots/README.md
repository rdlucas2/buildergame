# Warren Defense test bots

Bots that play Warren Defense in different styles, so you can watch how the game plays, compare
strategies, and catch balance problems. Each bot round writes a replay that plays back exactly in
the game.

```sh
npm run bots:test -- --quick                                # rules and balance checks, offline (~1½ min)
npm run bots -- --style balanced --seed 42                  # one headless round
npm run bots -- --style all --mode browser --headed         # watch each style play in a browser
npm run bots -- --style turtle --rounds 5 --profile fresh   # a campaign with Council purchases
npm run bots -- --style sharpshooter --brain typesafe       # decisions by TypeSafe (needs a key)
npm run bots -- --style gambler --brain mock --show-requests  # TypeSafe's pipeline offline: no key, no tokens
npm run bots:compare -- --seeds 5 --profile mid             # every style side by side
npm run bots:verify -- bot-runs/<run>/round-1.replay.json   # replay headless, check the end state
npm run bots -- --help
```

## Styles

| Style | Plays |
| --- | --- |
| `turtle` | Walls first: rebuilds breaches, mends, raises and strengthens; a small guard of defenders. |
| `sharpshooter` | Firepower first: many defenders, more lookout posts, weapon perks. |
| `breeder` | Economy first: most rabbits breed, a roofed nursery, fertility and toughness perks. |
| `balanced` | A bit of everything; walls raised before tigers and a roof before hawks. |
| `gambler` | Calls waves early for bonus points, redeals plain perk offers, likes rare cards. |
| `expander` | Grows the warren: saves budget for new rings of walls lined with lookout posts, for room for more rabbits and posts for more defenders. Plays for the long game past 20:00. |

The personas are defined in `personas.ts`: a brief for the model, and weights for the rules.

## Testing without a browser or tokens

All of this runs headless in Node, offline, in seconds to minutes: iterate on the game with it, and
save the browser and live TypeSafe for confirming.

- **`npm run bots:test`** is the scenario suite. It plays rounds with every style on a fresh
  profile, and balanced and expander on a maxed one, and checks:

  | Scenario | Checks |
  | --- | --- |
  | `fresh-balance` | Each style lasts between 5:00 and 15:00 |
  | `upgrades-help` | Upgrades make the warren last longer, to at least 12:00 |
  | `core-after-breeders` | Predators only hurt the core once no breeders are left |
  | `rounds-end-at-the-core` | Every lost round ended with the core down |
  | `one-core` | Every round has exactly one core, and no move adds to it |
  | `warren-grows` | Expanding makes room: the expander's room, colony and defenders on posts all grow |
  | `late-game` | With every upgrade, the expander gets past 18:00 (median), and no round reaches 30:00 |
  | `no-water` | No rabbit dies of thirst or goes to drink |
  | `budget-grows` | Every wave adds budget |
  | `legal-moves` | No move the bots make is refused |
  | `replays-repeat` | Every replay comes out the same |
  | `typesafe-pipeline` | The TypeSafe brain plays a round against the mock with no fallbacks, and keeps playing when half its answers are broken |

  Use `--quick` for one seed and rounds cut at 15:00 (`late-game` then only checks that the round
  reaches the cut), and `--only a,b` to pick scenarios. It exits
  non-zero on a failure. The scenarios are in `scenarios.ts`; add one when you add a rule.
- **`--brain mock`** runs the TypeSafe brain end to end against an offline stand-in for the API
  (`brains/mock.ts`). The stand-in answers each question the way the persona's rules would, with
  made-up probabilities and a token count estimated from the request's size.
  - Everything real runs: the state and questions sent, checking and mapping the answers, and the
    fallbacks.
  - `--chaos 0.2` breaks a share of the answers (a label that wasn't offered, or a server error) to
    exercise the fallbacks.
  - **`--show-requests`** prints every request and its answers, so you can work on the questions
    without spending tokens.
  - Every TypeSafe or mock run also saves the requests to `requests.jsonl`.
- `npm run bots:compare` and `npm run balance` give the numbers. `npm run bots:verify` replays saved
  rounds.

## Brains

A bot decides every 10 seconds of round time (`--every`), and sooner when a perk offer is waiting.
Code works out what is possible. `buildOptions` in `src/sim/defense/advisor.ts` lists ready-made
build moves such as rebuilding breaches, raising the walls, roofing a nursery, adding lookouts,
expanding the warren with a new ring of walls, repairing, reinforcing, buying budget or calling a
wave. They are the moves a player has in the Shop and in Fortify. The brain only chooses among them and
never invents coordinates.

- **`heuristic`** (the default) plays each style by plain rules. It is deterministic, free and runs
  offline. CI uses it, and it is the fallback for the TypeSafe brain.
- **`mock`** is the TypeSafe brain talking to the offline stand-in (see above).
- **`typesafe`** asks [TypeSafe](https://typesafe.ai) once per decision. A single `systemOne`
  request sends the round as named JSON state:
  - the persona;
  - the clock, the threats now and in the next 4 minutes, the predators on the field, and the rules
    (breeders first, then the core);
  - the core's health, and the warren's budget (with what the next wave adds), points and damage;
  - the rabbits;
  - weapons and unlocks;
  - the recent decisions.

  It asks independent `choice` questions over that state:

  | Question | Choices |
  | --- | --- |
  | `defenders` | Share of grown rabbits who defend: few, some, half or most |
  | `build` | The advisor's options, including `wait` |
  | `perk` | The offered cards, or a redeal; only when an offer is waiting |

  Defenders always carry the best weapon unlocked, as in the game, so there is no weapon question.

  Between rounds, an `upgrade` question chooses a Warren Council purchase, or saving.
  - Code checks every answer against what was offered and applies the matching action.
  - An answer that wasn't offered is ignored, and that judgment falls back to the rules.
  - API errors fall back to the rules for the whole decision.
  - The report logs every fallback, the top three probabilities for each question, and the tokens
    used.

## Where they play

- **`--mode sim`** (the default) runs the pure simulation in Node, as fast as the CPU allows.
  Without a browser, a round of about 10 minutes takes a few seconds.
- **`--mode browser`** plays the real game:
  - It starts Vite on a free port, or uses `--url` to point at a running game, such as the
    published site.
  - It opens Chromium, plays at `--speed` (up to 16; the game's own buttons offer 1×–3×), and
    records a video.
  - **`--headed`** shows the window so you can watch live. That needs a display; in a headless
    container, watch the video instead.
  - A panel in the corner shows the bot's style, the round, its last decision and, for TypeSafe, the
    probabilities.
  - The game is paused while the bot thinks, so model latency never changes the outcome.

## Output

Each run writes a folder, `bot-runs/<time>-<style>-<brain>-<mode>-s<seed>/`. `bot-runs/` is ignored
by git.

| File | What it is |
| --- | --- |
| `round-N.replay.json` | The round as a [replay](../docs/FILE_FORMATS.md#replay-replayjson). |
| `report.json` | Every decision with its actions and reasons, refused actions, probabilities, token usage and fallbacks. Also each round's result, Clover and achievements, and the Council purchases. |
| `requests.jsonl` | TypeSafe and mock brains: every request (state and questions) and what came back. |
| `profile.json` | The bot's progress after the campaign. Pass it to `--profile` to carry on. |
| `video.webm` | Browser mode only: the whole run. |

A campaign (`--rounds N`) plays round after round from `--seed`, `--seed + 1` and so on. After each
round the bot is paid Clover and achievements as a player would be, and shops at the Warren Council
before the next round.

## Watching a replay

In the game, open **World (M) → ▶ Watch a replay…** and choose a `.replay.json`.
- The game creates a world from the replay's seed and upgrades and plays the bot's actions at the
  ticks they were taken.
- The clock stops where the recording ended. Use the speed buttons to fast-forward.
- You can watch but not act, and a watched round pays no Clover.

Rounds are deterministic. A replay recorded headless ends in the same state in the browser, and the
reverse: the end-to-end tests check that the final `stateHash` matches. `npm run bots:verify`
checks it from the command line.

## TypeSafe setup

The TypeSafe brain runs only in Node, and the game never sees the key: the site is static, so a key
in the bundle would be public. A unit test fails if anything under `src/` imports the SDK or reads
the key.

1. Get an API key at [console.typesafe.ai](https://console.typesafe.ai).
2. Set it as the `TYPESAFE_API_KEY` environment variable.
3. Allow network access to `api.typesafe.ai`. To read the docs, also allow `docs.typesafe.ai`.

In a Claude Code cloud session, both go in the environment's settings: the key as an environment
variable, and the hosts under Network access.

Without a key, `--brain typesafe` stops with a message saying what is missing.

The brain was written against the `@typesafe-ai/sdk` v0.6.0 type definitions. The live docs at
`docs.typesafe.ai` could not be reached from the environment it was built in. Check the question
design against them before relying on the model's choices.
