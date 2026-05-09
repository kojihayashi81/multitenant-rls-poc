/**
 * RLS failsafe テスト（M6-B）。
 *
 * 「開発者が `withTenant` を呼ばずに app_user で生クエリを叩いた場合、
 *  全テナントのデータが漏れたりしないか？」を検証する。
 *
 * 期待挙動：
 *   - 0003_enable_rls.sql のポリシーが `current_setting('app.tenant_id')::uuid`
 *     を厳格モードで参照しているため、`app.tenant_id` が未設定だと SELECT/
 *     INSERT/UPDATE/DELETE すべてが `unrecognized configuration parameter`
 *     を投げて停止する（silent な空集合返却ではなく明示的にエラー）。
 *   - set_config 済みでも、tenant_id が現在のテナントと一致しない INSERT/
 *     UPDATE は WITH CHECK で 42501 (insufficient_privilege) として弾かれる。
 *
 * 接続は `APP_DATABASE_URL`（app_user）を直接使う。withTenant ヘルパは
 * 通さない＝「ヘルパを忘れた／意図的にバイパスした」シナリオを再現する。
 */

import 'dotenv/config';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const T1 = '01900000-0000-7000-8000-000000000001';
const T2 = '01900000-0000-7000-8000-000000000002';
const T1_ALICE = '01900000-0000-7000-8000-aaaaaaaaaaaa';
const T2_CAROL = '01900000-0000-7000-8000-cccccccccccc';
const T2_CAROL_POST = '01900000-0000-7000-8000-ffffffffffff';

let appPool: Pool;

beforeAll(async () => {
  const appUrl = process.env.APP_DATABASE_URL;
  const adminUrl = process.env.ADMIN_DATABASE_URL;
  if (!appUrl || !adminUrl) {
    throw new Error('APP_DATABASE_URL / ADMIN_DATABASE_URL not set');
  }

  // SUPERUSER で seed をリセット（FORCE RLS をバイパスして TRUNCATE できる）。
  const sqlPath = resolve(import.meta.dirname, '../../src/db/seeds/dev.sql');
  const adminPool = new Pool({ connectionString: adminUrl });
  try {
    await adminPool.query(readFileSync(sqlPath, 'utf8'));
  } finally {
    await adminPool.end();
  }

  appPool = new Pool({ connectionString: appUrl, max: 2 });
});

afterAll(async () => {
  await appPool?.end();
});

describe('RLS failsafe: raw app_user without app.tenant_id', () => {
  it('SELECT は "unrecognized configuration parameter" で停止する', async () => {
    await expect(appPool.query('SELECT * FROM posts')).rejects.toThrow(
      /unrecognized configuration parameter.*app\.tenant_id/,
    );
  });

  it('INSERT も同じく停止する（USING/WITH CHECK が評価できない）', async () => {
    await expect(
      appPool.query(
        `INSERT INTO posts (tenant_id, user_id, title, body)
         VALUES ($1::uuid, $2::uuid, 'sneaky', 'should not insert')`,
        [T1, T1_ALICE],
      ),
    ).rejects.toThrow(/unrecognized configuration parameter/);
  });

  it('UPDATE も停止する', async () => {
    await expect(
      appPool.query(`UPDATE posts SET title = 'hacked'`),
    ).rejects.toThrow(/unrecognized configuration parameter/);
  });

  it('DELETE も停止する', async () => {
    await expect(appPool.query('DELETE FROM posts')).rejects.toThrow(
      /unrecognized configuration parameter/,
    );
  });
});

describe('RLS failsafe: cross-tenant write attempts inside set_config(T1)', () => {
  it('tenant_id を T2 にした INSERT は WITH CHECK 違反 (42501) で弾かれる', async () => {
    const client = await appPool.connect();
    try {
      await client.query('BEGIN');
      await client.query(`SELECT set_config('app.tenant_id', $1, true)`, [T1]);

      await expect(
        client.query(
          `INSERT INTO posts (tenant_id, user_id, title, body)
           VALUES ($1::uuid, $2::uuid, 'cross', 'attempt')`,
          [T2, T2_CAROL],
        ),
      ).rejects.toMatchObject({ code: '42501' });

      await client.query('ROLLBACK');
    } finally {
      client.release();
    }
  });

  it('user_id だけ T2 ユーザにした INSERT も同様に 42501 で弾かれる（EXISTS 副条件で防御）', async () => {
    const client = await appPool.connect();
    try {
      await client.query('BEGIN');
      await client.query(`SELECT set_config('app.tenant_id', $1, true)`, [T1]);

      // tenant_id は T1 (許可) だが user_id が T2 のユーザ（policy の EXISTS が落ちる）
      await expect(
        client.query(
          `INSERT INTO posts (tenant_id, user_id, title, body)
           VALUES ($1::uuid, $2::uuid, 'attribution', 'attempt')`,
          [T1, T2_CAROL],
        ),
      ).rejects.toMatchObject({ code: '42501' });

      await client.query('ROLLBACK');
    } finally {
      client.release();
    }
  });

  it('T2 の post を直接 UPDATE しようとしても 0 行更新（USING にマッチしない）', async () => {
    const client = await appPool.connect();
    try {
      await client.query('BEGIN');
      await client.query(`SELECT set_config('app.tenant_id', $1, true)`, [T1]);

      const res = await client.query(
        `UPDATE posts SET title = 'hijacked' WHERE id = $1::uuid`,
        [T2_CAROL_POST],
      );
      expect(res.rowCount).toBe(0);

      await client.query('ROLLBACK');
    } finally {
      client.release();
    }
  });

  it('T2 の post を直接 DELETE しようとしても 0 行削除', async () => {
    const client = await appPool.connect();
    try {
      await client.query('BEGIN');
      await client.query(`SELECT set_config('app.tenant_id', $1, true)`, [T1]);

      const res = await client.query(`DELETE FROM posts WHERE id = $1::uuid`, [
        T2_CAROL_POST,
      ]);
      expect(res.rowCount).toBe(0);

      await client.query('ROLLBACK');
    } finally {
      client.release();
    }
  });
});

describe('RLS failsafe: 正常系の対照（set_config 済みなら期待通り見える）', () => {
  it('set_config(T1) 済みの SELECT は T1 の 2 件だけ返す（USING が効く）', async () => {
    const client = await appPool.connect();
    try {
      await client.query('BEGIN');
      await client.query(`SELECT set_config('app.tenant_id', $1, true)`, [T1]);

      const res = await client.query<{ c: string }>(
        'SELECT count(*)::text AS c FROM posts',
      );
      expect(res.rows[0]?.c).toBe('2');

      await client.query('COMMIT');
    } finally {
      client.release();
    }
  });
});
