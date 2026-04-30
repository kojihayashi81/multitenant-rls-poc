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
-- =============================================================================

BEGIN;

-- Reset to a known state. RESTART IDENTITY is harmless here (no serial cols),
-- but kept as convention so future tables with sequences are also reset.
TRUNCATE TABLE posts, users, tenants RESTART IDENTITY CASCADE;

-- -----------------------------------------------------------------------------
-- Tenants
-- -----------------------------------------------------------------------------
-- Fixed UUIDs so verification queries are easy to read and copy-paste.
INSERT INTO tenants (id, name) VALUES
  ('11111111-1111-1111-1111-111111111111', 'tenant-1'),
  ('22222222-2222-2222-2222-222222222222', 'tenant-2');

-- -----------------------------------------------------------------------------
-- Users
--   T1: Alice, Bob   (so we can test "T1 sees its own users only")
--   T2: Carol        (so cross-tenant attribution can be tried with Carol)
-- -----------------------------------------------------------------------------
INSERT INTO users (id, tenant_id, email, name) VALUES
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
   '11111111-1111-1111-1111-111111111111',
   'alice@t1.example', 'Alice (T1)'),

  ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
   '11111111-1111-1111-1111-111111111111',
   'bob@t1.example',   'Bob (T1)'),

  ('cccccccc-cccc-cccc-cccc-cccccccccccc',
   '22222222-2222-2222-2222-222222222222',
   'carol@t2.example', 'Carol (T2)');

-- -----------------------------------------------------------------------------
-- Posts
--   Each post is consistent (post.tenant_id matches its author's tenant_id).
--   Cross-tenant attribution attacks are exercised at runtime by app_user,
--   not here.
-- -----------------------------------------------------------------------------
INSERT INTO posts (id, tenant_id, user_id, title, body) VALUES
  ('dddddddd-dddd-dddd-dddd-dddddddddddd',
   '11111111-1111-1111-1111-111111111111',
   'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
   'Alice T1 post', 'visible to T1 only'),

  ('eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee',
   '11111111-1111-1111-1111-111111111111',
   'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
   'Bob T1 post',   'visible to T1 only'),

  ('ffffffff-ffff-ffff-ffff-ffffffffffff',
   '22222222-2222-2222-2222-222222222222',
   'cccccccc-cccc-cccc-cccc-cccccccccccc',
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
