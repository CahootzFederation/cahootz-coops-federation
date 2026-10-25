import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

const validatorsSrc = fileURLToPath(new URL('../validators/src/', import.meta.url));
const dbEntry = fileURLToPath(new URL('../db/index.ts', import.meta.url));

/**
 * Tests that need a real Postgres database (locking, unique keys under load).
 * They run against TEST_DATABASE_URL and are skipped when it isn't set:
 *
 *   TEST_DATABASE_URL=postgresql://localhost:5432/<local clone> pnpm -F @repo/trpc test:db
 *
 * Never point this at a shared or production database: the tests write rows.
 */
export default defineConfig({
  resolve: {
    alias: [
      { find: /^@repo\/db$/, replacement: dbEntry },
      { find: /^@repo\/validators$/, replacement: `${validatorsSrc}index.ts` },
      { find: /^@repo\/validators\/(.*)$/, replacement: `${validatorsSrc}$1.ts` },
    ],
  },
  test: {
    globals: true,
    environment: 'node',
    include: ['src/**/*.db.test.ts'],
    env: process.env.TEST_DATABASE_URL ? { DATABASE_URL: process.env.TEST_DATABASE_URL } : {},
    watch: false,
    testTimeout: 60000,
    hookTimeout: 60000,
  },
});
