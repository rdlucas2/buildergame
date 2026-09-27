import { defineConfig, devices } from '@playwright/test';
import { existsSync } from 'node:fs';

// Prefer the browser Playwright would download; fall back to a pre-installed Chromium
// (e.g. cloud containers that ship /opt/pw-browsers) when downloads are disabled.
const preinstalled = [
  process.env.PLAYWRIGHT_CHROMIUM_PATH,
  '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
  '/opt/pw-browsers/chromium/chrome-linux/chrome',
].find((p): p is string => !!p && existsSync(p));

export default defineConfig({
  testDir: 'tests/e2e',
  timeout: 60_000,
  fullyParallel: false,
  workers: 1,
  reporter: [['list']],
  use: {
    baseURL: 'http://localhost:5173',
    trace: 'retain-on-failure',
    launchOptions: {
      ...(preinstalled ? { executablePath: preinstalled } : {}),
      // Software WebGL so the game renders in headless CI containers without a GPU.
      args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
    },
  },
  // channel 'chromium' runs the full browser in new headless mode. The default headless shell
  // reports synthetic mouse movement while the pointer is locked, which scrambles mouse look.
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'], channel: 'chromium' } }],
  webServer: {
    command: 'npm run dev -- --port 5173 --strictPort',
    url: 'http://localhost:5173',
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
  },
});
