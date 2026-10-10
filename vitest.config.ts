import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/unit/**/*.test.ts'],
    environment: 'node',
    // The simulation tests play whole rounds: seconds on a fast machine, several times that on a busy CI runner.
    testTimeout: 30_000,
  },
});
