import { chromium, type Browser, type BrowserContext, type Page } from '@playwright/test';
import { existsSync, mkdirSync, renameSync } from 'node:fs';
import { createServer as netServer } from 'node:net';
import { join, resolve } from 'node:path';
import { createServer, type ViteDevServer } from 'vite';
import type { PlayerProfile } from '../../src/core/profile';
import type { DefenseObservation } from '../../src/sim/defense/session';
import type { BotAction, OptionSummary } from '../brain';
import type { ActOutcome, Table } from '../play';

const ROOT = resolve(import.meta.dirname, '../..');
/** Software WebGL, as in the end-to-end tests, so the game renders without a GPU. */
const GL_ARGS = ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'];
const PREINSTALLED = [process.env.PLAYWRIGHT_CHROMIUM_PATH, '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', '/opt/pw-browsers/chromium/chrome-linux/chrome'].find((p): p is string => !!p && existsSync(p));
/** Real milliseconds between looks at the round while it runs. */
const POLL_MS = 60;

async function freePort(): Promise<number> {
  return new Promise((ok, fail) => {
    const s = netServer();
    s.once('error', fail);
    s.listen(0, '127.0.0.1', () => {
      const port = (s.address() as { port: number }).port;
      s.close(() => ok(port));
    });
  });
}

export interface BrowserOptions {
  /** Show the browser window (needs a display). */
  headed: boolean;
  /** Record a video into this folder. */
  videoDir?: string;
  /** Play the game at this address instead of starting a local Vite server. */
  url?: string;
}

/**
 * The game in a real browser, for watching bots play: starts Vite (unless given a URL), opens
 * Chromium, and records a video if asked.
 */
export class BrowserSession {
  private constructor(
    readonly page: Page,
    private readonly context: BrowserContext,
    private readonly browser: Browser,
    private readonly server: ViteDevServer | null,
    private readonly videoDir: string | undefined,
  ) {}

  static async open(opts: BrowserOptions): Promise<BrowserSession> {
    let server: ViteDevServer | null = null;
    let url = opts.url;
    if (!url) {
      const port = await freePort();
      server = await createServer({ root: ROOT, configFile: join(ROOT, 'vite.config.ts'), logLevel: 'warn', server: { host: '127.0.0.1', port, strictPort: true } });
      await server.listen();
      url = `http://127.0.0.1:${port}/`;
    }
    const browser = await chromium.launch({ headless: !opts.headed, args: GL_ARGS, ...(PREINSTALLED ? { executablePath: PREINSTALLED } : {}) });
    const size = { width: 1280, height: 720 };
    if (opts.videoDir) mkdirSync(opts.videoDir, { recursive: true });
    const context = await browser.newContext({ viewport: size, ...(opts.videoDir ? { recordVideo: { dir: opts.videoDir, size } } : {}) });
    const page = await context.newPage();
    page.on('pageerror', (e) => console.error(`[game] ${e.message}`));
    await page.goto(url);
    await page.waitForSelector('body[data-ready="true"]', { timeout: 60_000 });
    await page.evaluate(() => window.__game!.setStartVisible(false));
    return new BrowserSession(page, context, browser, server, opts.videoDir);
  }

  /** Closes everything; returns where the video went, if one was recorded. */
  async close(videoName = 'video.webm'): Promise<string | null> {
    const video = this.page.video();
    await this.context.close();
    await this.browser.close();
    await this.server?.close();
    if (!video || !this.videoDir) return null;
    const to = join(this.videoDir, videoName);
    renameSync(await video.path(), to);
    return to;
  }

  /** A fresh Warren Defense round for a bot: its profile in place, the world created paused. */
  async newRound(name: string, seed: number, profile: PlayerProfile, speed: number): Promise<BrowserTable> {
    const err = await this.page.evaluate((p) => window.__game!.importProfile(p), profile as unknown as Record<string, unknown>);
    if (err) throw new Error(`The game refused the bot's profile: ${err}`);
    await this.page.evaluate(() => window.__game!.ecoSpeed(0));
    await this.page.evaluate(({ name, seed }) => window.__game!.createWorld(name, 'defense', seed), { name, seed });
    return new BrowserTable(this.page, speed);
  }
}

/** A bot's table in the browser: the game runs at its own pace and is paused while the bot thinks. */
export class BrowserTable implements Table {
  readonly mode = 'browser' as const;

  constructor(
    private readonly page: Page,
    private readonly speed: number,
  ) {}

  async observe(): Promise<DefenseObservation> {
    const o = await this.page.evaluate(() => window.__game!.defenseObserve());
    if (!o) throw new Error('The game is not showing a Warren Defense round.');
    return o;
  }

  async options(): Promise<OptionSummary[]> {
    return this.page.evaluate(() => window.__game!.defenseOptions());
  }

  async act(action: BotAction): Promise<ActOutcome> {
    return this.page.evaluate((a) => window.__game!.defenseAct(a), action);
  }

  async runTo(tick: number): Promise<void> {
    for (;;) {
      const s = await this.page.evaluate(() => {
        const o = window.__game!.defenseObserve();
        return o ? { tick: o.tick, over: o.outcome !== 'playing' } : null;
      });
      if (!s || s.over || s.tick >= tick) return;
      await this.page.waitForTimeout(POLL_MS);
    }
  }

  async pause(): Promise<void> {
    await this.page.evaluate(() => window.__game!.ecoSpeed(0));
  }

  async resume(): Promise<void> {
    await this.page.evaluate((s) => window.__game!.ecoSpeed(s), this.speed);
  }

  async hash(): Promise<string> {
    return (await this.page.evaluate(() => window.__game!.defenseHash())) ?? '';
  }

  async show(text: string): Promise<void> {
    await this.page.evaluate((t) => window.__game!.botOverlay(t), text);
  }
}
