import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

const validatorsSrc = fileURLToPath(new URL('../validators/src/', import.meta.url));

export default defineConfig({
  resolve: {
    // Run against @repo/validators source so tests don't need its dist built first.
    alias: [
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
