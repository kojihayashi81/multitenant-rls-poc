-- 0002_create_roles.sql
-- This migration MUST be applied as postgres (SUPERUSER).
-- Subsequent migrations should be applied as migrator.
-- DEV PASSWORDS ONLY. Production must use IAM auth or Secrets Manager.

SET search_path = public, pg_catalog;

-- =============================================================================
-- 1. ログインロール作成
-- =============================================================================
-- 注意: app_user には BYPASSRLS や SUPERUSER を絶対に付けないこと。
--       これらが付くと RLS ポリシーが無視される。
--       NOBYPASSRLS は CREATE ROLE のデフォルトだが、安全のため明示する。

-- 1-1. アプリケーション接続用ロール
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_user') THEN
        CREATE ROLE app_user WITH LOGIN NOBYPASSRLS NOSUPERUSER PASSWORD 'app_user_password'; 
        RAISE NOTICE 'Role "app_user" created.';
    ELSE
        RAISE NOTICE 'Role "app_user" already exists, skipping.';
    END IF;
END $$;

-- 1-2. マイグレーション実行用ロール
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'migrator') THEN
        CREATE ROLE migrator WITH LOGIN NOBYPASSRLS NOSUPERUSER PASSWORD 'migrator_password';
        RAISE NOTICE 'Role "migrator" created.';
    ELSE
        RAISE NOTICE 'Role "migrator" already exists, skipping.';
    END IF;
END $$;

-- =============================================================================
-- 2. グループロール作成 (LOGIN なし、権限集約用)
-- =============================================================================
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_readwrite_group') THEN
        CREATE ROLE app_readwrite_group;
        RAISE NOTICE 'Role "app_readwrite_group" created.';
    ELSE
        RAISE NOTICE 'Role "app_readwrite_group" already exists, skipping.';
    END IF;
END $$;

-- =============================================================================
-- 3. 既存オブジェクトの所有権を migrator に移譲
-- =============================================================================
-- migrator が DDL (ALTER TABLE 等) を実行できるようにするため。
--
-- 重要: テーブルの owner は RLS をデフォルトでバイパスする。
--   - RLS 動作確認は必ず app_user で接続して行うこと。
--   - owner も縛りたい場合は ALTER TABLE ... FORCE ROW LEVEL SECURITY を使う。

ALTER TABLE IF EXISTS tenants               OWNER TO migrator;
ALTER TABLE IF EXISTS users                 OWNER TO migrator;
ALTER TABLE IF EXISTS posts                 OWNER TO migrator;
ALTER TABLE IF EXISTS __drizzle_migrations  OWNER TO migrator;
ALTER FUNCTION set_updated_at()             OWNER TO migrator;

-- =============================================================================
-- 4'. PUBLIC ロールからの権限剥奪（重要）                                           
-- =============================================================================     
-- PG <15 の伝統的デフォルトでは public スキーマの CREATE が PUBLIC に付いている。   
-- これがあると、app_user 等の RLS 適用対象ロールでも CREATE TABLE が通ってしまう。  
-- すべてのロールが暗黙的に PUBLIC メンバーであるため、ここで明示的に剥奪する。      
REVOKE CREATE ON SCHEMA public FROM PUBLIC;

-- =============================================================================
-- 4. グループロールに権限を付与 (既存オブジェクト)
-- =============================================================================
GRANT CONNECT ON DATABASE rls_poc TO app_readwrite_group;
GRANT USAGE   ON SCHEMA   public  TO app_readwrite_group;
 
GRANT SELECT, INSERT, UPDATE, DELETE
    ON ALL TABLES IN SCHEMA public
    TO app_readwrite_group;
 
GRANT USAGE, SELECT
    ON ALL SEQUENCES IN SCHEMA public
    TO app_readwrite_group;  -- INSERT 時の nextval() に必要

-- =============================================================================
-- 5. デフォルト権限 (今後 migrator が作成するオブジェクトにも自動適用)
-- =============================================================================
-- これがないと、migrator が後で新しいテーブルを作るたびに
-- app_user からアクセスできなくなる。
--
-- 重要: FOR ROLE migrator を明示すること。
--       デフォルト権限は「誰がそのオブジェクトを作ったか」に紐づくため、
--       postgres と migrator で挙動が異なる。
ALTER DEFAULT PRIVILEGES FOR ROLE migrator IN SCHEMA public
    GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES    TO app_readwrite_group;

ALTER DEFAULT PRIVILEGES FOR ROLE migrator IN SCHEMA public
    GRANT USAGE, SELECT                  ON SEQUENCES TO app_readwrite_group;
 
ALTER DEFAULT PRIVILEGES FOR ROLE migrator IN SCHEMA public
    GRANT EXECUTE                        ON FUNCTIONS TO app_readwrite_group;

-- =============================================================================
-- 6. ログインロールへグループ権限を割り当て
-- =============================================================================
GRANT app_readwrite_group TO app_user;
GRANT app_readwrite_group TO migrator;

-- migrator はスキーマに新規オブジェクトを作る必要がある (DDL 実行のため)
GRANT USAGE, CREATE ON SCHEMA public TO migrator;

-- =============================================================================
-- 7. 完了通知
-- =============================================================================
DO $$ BEGIN RAISE NOTICE 'Role setup and grants completed.'; END $$;
