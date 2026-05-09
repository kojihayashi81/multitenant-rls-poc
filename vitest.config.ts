import { defineConfig } from 'vitest/config';

/**
 * vitest はデフォルトで *.test.ts と *.spec.ts の両方を拾うが、
 * このリポジトリでは Playwright の E2E spec を tests/e2e/ 配下に置いている。
 * 同じ extension で衝突するので明示的に除外する。
 */
export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    exclude: ['node_modules/**', 'tests/e2e/**'],
  },
});
