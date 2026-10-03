import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

const validatorsSrc = fileURLToPath(new URL('../validators/src/', import.meta.url));
const dbEntry = fileURLToPath(new URL('../db/index.ts', import.meta.url));

export default defineConfig({
  resolve: {
    // Resolve workspace packages to source (validators then needs no build).
    // @repo/db is always mocked in setup.ts, but its path must be stable: if it
    // resolved via dist/, a rebuild of @repo/db during a run (e.g. watch mode)
    // could change the module id mid-run and bypass the mock.
    alias: [
      { find: /^@repo\/db$/, replacement: dbEntry },
      { find: /^@repo\/validators$/, replacement: `${validatorsSrc}index.ts` },
      { find: /^@repo\/validators\/(.*)$/, replacement: `${validatorsSrc}$1.ts` },
    ],
  },
  test: {
    globals: true,
    environment: 'node',
    include: ['src/**/*.{test,spec}.{js,ts}'],
    setupFiles: ['./src/__tests__/setup.ts'],
    // Prevent hanging in CI/CD
    watch: false,
    // Increase timeout for AI agent calls
    testTimeout: 60000, // 60 seconds
    hookTimeout: 60000, // 60 seconds
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html'],
      include: ['src/**/*.ts'],
      exclude: ['src/**/*.test.ts', 'src/**/*.spec.ts']
    },
  }
});
