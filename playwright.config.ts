import { defineConfig } from '@playwright/test';

/**
 * E2E テスト用 Playwright 設定。
 *
 * 現在のスコープは「フロント無しの API E2E」。`request` フィクスチャだけで
 * 実サーバ（pnpm start）に対して HTTP を実行するので、ブラウザバイナリは不要。
 * 将来 UI を足す際は `use.browserName` 等を入れて拡張する。
 *
 * テスト並列度は意図的に 1。実 DB を共有する黒箱テストなので、並列に走らせると
 * beforeEach の seed リセットが他テストの assert と競合する。
 */
export default defineConfig({
  testDir: './tests/e2e',
  globalSetup: './tests/e2e/global-setup.ts',

  fullyParallel: false,
  workers: 1,

  reporter: process.env.CI ? [['github'], ['list']] : [['list']],

  use: {
    baseURL: 'http://localhost:3000',
    extraHTTPHeaders: { 'content-type': 'application/json' },
    // 失敗時のデバッグ用。レスポンスを保存する
    trace: 'retain-on-failure',
  },

  // ローカルでは既存サーバを再利用、CI では毎回 fresh に立ち上げる。
  // /health が 200 を返した時点で ready とみなす。
  webServer: {
    command: 'pnpm start',
    url: 'http://localhost:3000/health',
    reuseExistingServer: !process.env.CI,
    timeout: 30_000,
    stdout: 'pipe',
    stderr: 'pipe',
  },
});
