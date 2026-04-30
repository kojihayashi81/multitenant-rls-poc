/**
 * Integration tests for withTenant + RLS.
 *
 * Hits the real local Postgres (via pg.Pool, app_user role) and exercises the
 * actual RLS policies. Seed data is loaded automatically before the suite via
 * beforeAll, so the only prerequisite is that the schema migrations have been
 * applied (pnpm db:reset && pnpm drizzle-kit migrate, or just leave the DB up
 * after a previous run).
 *
 * Run:  pnpm test
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ZodError } from "zod";
import { pool } from "../src/db/client";
import { postsTable } from "../src/db/schema";
import { withTenant } from "../src/db/with-tenant";

const T1 = "01900000-0000-7000-8000-000000000001";
const T2 = "01900000-0000-7000-8000-000000000002";
const UNKNOWN_TENANT = "01900000-0000-7000-8000-999999999999";

beforeAll(async () => {
  // Reload seed data with postgres SUPERUSER (bypasses RLS / FORCE).
  // The seed file TRUNCATEs first, so this is idempotent.
  const adminUrl = process.env.ADMIN_DATABASE_URL;
  if (!adminUrl) {
    throw new Error(
      "ADMIN_DATABASE_URL is not set. Did you run with `pnpm test` from a shell that loaded .env, or is dotenv import wired correctly in client.ts?",
    );
  }

  const sqlPath = resolve(import.meta.dirname, "../src/db/seeds/dev.sql");
  const seedSql = readFileSync(sqlPath, "utf8");

  const adminPool = new Pool({ connectionString: adminUrl });
  try {
    await adminPool.query(seedSql);
  } finally {
    await adminPool.end();
  }
});

afterAll(async () => {
  await pool.end();
});

describe("withTenant", () => {
  it("T1 セッションでは T1 の posts のみ可視（Alice / Bob の 2 件）", async () => {
    const posts = await withTenant(T1, async (tx) =>
      tx.select().from(postsTable),
    );

    expect(posts).toHaveLength(2);
    const titles = posts.map((p) => p.title).sort();
    expect(titles).toEqual(["Alice T1 post", "Bob T1 post"]);
  });

  it("T2 セッションでは T2 の posts のみ可視（Carol の 1 件）", async () => {
    const posts = await withTenant(T2, async (tx) =>
      tx.select().from(postsTable),
    );

    expect(posts).toHaveLength(1);
    expect(posts[0]?.title).toBe("Carol T2 post");
  });

  it("T1 → T2 → T1 を連続呼び出しても、各呼び出しで自テナントだけ見える（プール再利用がコンテキストを持ち越さない）", async () => {
    const t1First = await withTenant(T1, async (tx) =>
      tx.select().from(postsTable),
    );
    const t2 = await withTenant(T2, async (tx) =>
      tx.select().from(postsTable),
    );
    const t1Second = await withTenant(T1, async (tx) =>
      tx.select().from(postsTable),
    );

    expect(t1First).toHaveLength(2);
    expect(t2).toHaveLength(1);
    expect(t1Second).toHaveLength(2);
  });

  it("不正な UUID を渡すと、DB に到達する前に ZodError でリジェクト", async () => {
    await expect(
      withTenant("not-a-uuid", async (tx) =>
        tx.select().from(postsTable),
      ),
    ).rejects.toBeInstanceOf(ZodError);
  });

  it("存在しないテナント ID（v7 形式は妥当）を渡すと、エラーではなく 0 件返る（RLS の正常動作）", async () => {
    const posts = await withTenant(UNKNOWN_TENANT, async (tx) =>
      tx.select().from(postsTable),
    );

    expect(posts).toHaveLength(0);
  });
});

/**
 * Characterization test: demonstrates WHY withTenant uses SET LOCAL inside a
 * transaction. This is the failure mode that withTenant prevents.
 *
 * Uses a dedicated Pool with max=1 so connection reuse is guaranteed; nothing
 * here touches the runtime `pool` exported from src/db/client.ts. If the runtime
 * code is ever changed to use plain SET (or set_config with is_local=false),
 * the safety guarantees this PoC documents would break — and this test would
 * keep silently passing while the safe-path tests would start leaking. The
 * point of this block is to make the danger reproducible, not to assert app
 * correctness.
 */
describe("DANGER: session-level SET leaks tenant context across pool reuse", () => {
  it("set_config(..., is_local=false) survives connection release and contaminates the next caller", async () => {
    const adminUrl = process.env.APP_DATABASE_URL;
    if (!adminUrl) throw new Error("APP_DATABASE_URL is not set");

    // Dedicated pool, max=1 → both queries are guaranteed to reuse the same
    // physical connection (mimicking the worst-case multi-request scenario).
    const dangerPool = new Pool({ connectionString: adminUrl, max: 1 });

    try {
      // "Request A": set tenant context at session level (DANGER pattern).
      await dangerPool.query("SELECT set_config('app.tenant_id', $1, false)", [
        T1,
      ]);

      // Simulated end of "Request A": no explicit RESET, connection returns
      // to the pool. pg.Pool does NOT auto-reset session state on release.

      // "Request B": new caller that forgot to set the tenant. If session
      // state is leaking, current_setting still returns T1.
      const leaked = await dangerPool.query<{ value: string | null }>(
        "SELECT current_setting('app.tenant_id', true) AS value",
      );

      expect(leaked.rows[0]?.value).toBe(T1);

      // And — critically — RLS-protected reads from this contaminated session
      // would return T1's rows, even though Request B never identified itself.
      const leakedPosts = await dangerPool.query<{ count: string }>(
        "SELECT count(*)::text AS count FROM posts",
      );
      expect(Number(leakedPosts.rows[0]?.count)).toBe(2); // T1's two posts
    } finally {
      await dangerPool.end();
    }
  });
});
