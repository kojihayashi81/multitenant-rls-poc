-- =============================================================================
-- Development seed data for the multi-tenant RLS PoC.
--
-- Intended to run via:  pnpm db:seed
-- Connects as postgres (SUPERUSER) so RLS / FORCE ROW LEVEL SECURITY does not
-- block the inserts. This file is explicitly OUTSIDE the drizzle-kit migration
-- pipeline so it never runs in production.
--
-- Re-runnable: TRUNCATE first to reset to a known state. CASCADE removes child
-- rows in users/posts so we don't have to worry about FK ordering.
--
-- UUIDs are valid UUIDv7 strings (version digit '7' at position 15, variant
-- digit '8' at position 20) so they pass strict z.uuidv7() validation in
-- application code (see src/db/with-tenant.ts). Last 12 chars are kept human-
-- readable (00..01, aaaa.., dddd..) so verification queries remain easy to copy.
-- =============================================================================

BEGIN;

-- Reset to a known state. RESTART IDENTITY is harmless here (no serial cols),
-- but kept as convention so future tables with sequences are also reset.
TRUNCATE TABLE posts, users, tenants RESTART IDENTITY CASCADE;

-- -----------------------------------------------------------------------------
-- Tenants
-- -----------------------------------------------------------------------------
INSERT INTO tenants (id, name) VALUES
  ('01900000-0000-7000-8000-000000000001', 'tenant-1'),
  ('01900000-0000-7000-8000-000000000002', 'tenant-2');

-- -----------------------------------------------------------------------------
-- Users
--   T1: Alice, Bob   (so we can test "T1 sees its own users only")
--   T2: Carol        (so cross-tenant attribution can be tried with Carol)
-- -----------------------------------------------------------------------------
INSERT INTO users (id, tenant_id, email, name) VALUES
  ('01900000-0000-7000-8000-aaaaaaaaaaaa',
   '01900000-0000-7000-8000-000000000001',
   'alice@t1.example', 'Alice (T1)'),

  ('01900000-0000-7000-8000-bbbbbbbbbbbb',
   '01900000-0000-7000-8000-000000000001',
   'bob@t1.example',   'Bob (T1)'),

  ('01900000-0000-7000-8000-cccccccccccc',
   '01900000-0000-7000-8000-000000000002',
   'carol@t2.example', 'Carol (T2)');

-- -----------------------------------------------------------------------------
-- Posts
--   Each post is consistent (post.tenant_id matches its author's tenant_id).
--   Cross-tenant attribution attacks are exercised at runtime by app_user,
--   not here.
-- -----------------------------------------------------------------------------
INSERT INTO posts (id, tenant_id, user_id, title, body) VALUES
  ('01900000-0000-7000-8000-dddddddddddd',
   '01900000-0000-7000-8000-000000000001',
   '01900000-0000-7000-8000-aaaaaaaaaaaa',
   'Alice T1 post', 'visible to T1 only'),

  ('01900000-0000-7000-8000-eeeeeeeeeeee',
   '01900000-0000-7000-8000-000000000001',
   '01900000-0000-7000-8000-bbbbbbbbbbbb',
   'Bob T1 post',   'visible to T1 only'),

  ('01900000-0000-7000-8000-ffffffffffff',
   '01900000-0000-7000-8000-000000000002',
   '01900000-0000-7000-8000-cccccccccccc',
   'Carol T2 post', 'visible to T2 only');

COMMIT;

-- -----------------------------------------------------------------------------
-- Sanity check (printed by psql when run interactively).
-- -----------------------------------------------------------------------------
SELECT 'tenants' AS table_name, count(*) AS rows FROM tenants
UNION ALL
SELECT 'users',   count(*) FROM users
UNION ALL
SELECT 'posts',   count(*) FROM posts
ORDER BY table_name;
