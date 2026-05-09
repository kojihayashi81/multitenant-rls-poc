import 'dotenv/config';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { Pool } from 'pg';

/**
 * dev seed (src/db/seeds/dev.sql) を SUPERUSER 接続で流し直す。
 *
 * seed 自体が `TRUNCATE ... CASCADE` で先頭リセットしてから INSERT するので、
 * 何度呼んでも初期状態に戻る。各 E2E テストの beforeEach で呼ぶことで、
 * テスト間の独立性（前のテストの書き込みが次に漏れない）を保証する。
 *
 * 接続には ADMIN_DATABASE_URL（postgres SUPERUSER）を使う必要がある。
 * APP_DATABASE_URL（app_user）だと FORCE ROW LEVEL SECURITY に阻まれて
 * 自テナント以外を TRUNCATE できないため。
 */
export async function reseed(): Promise<void> {
  const adminUrl = process.env.ADMIN_DATABASE_URL;
  if (!adminUrl) {
    throw new Error(
      'ADMIN_DATABASE_URL is not set; ensure .env is loaded by `pnpm test:e2e`',
    );
  }

  const sqlPath = resolve(import.meta.dirname, '../../../src/db/seeds/dev.sql');
  const seedSql = readFileSync(sqlPath, 'utf8');

  const pool = new Pool({ connectionString: adminUrl });
  try {
    await pool.query(seedSql);
  } finally {
    await pool.end();
  }
}

/** seed が定義する固定 UUIDv7（ヒューマンリーダブルな suffix で並べてある）。 */
export const FIXTURES = {
  T1: '01900000-0000-7000-8000-000000000001',
  T2: '01900000-0000-7000-8000-000000000002',
  UNKNOWN_T: '01900000-0000-7000-8000-999999999999',

  T1_ALICE: '01900000-0000-7000-8000-aaaaaaaaaaaa',
  T1_BOB: '01900000-0000-7000-8000-bbbbbbbbbbbb',
  T2_CAROL: '01900000-0000-7000-8000-cccccccccccc',

  T1_ALICE_POST: '01900000-0000-7000-8000-dddddddddddd',
  T1_BOB_POST: '01900000-0000-7000-8000-eeeeeeeeeeee',
  T2_CAROL_POST: '01900000-0000-7000-8000-ffffffffffff',
} as const;
