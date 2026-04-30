-- 全テーブルに対して「所有者も逃がさない」設定を適用
ALTER TABLE tenants ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenants FORCE ROW LEVEL SECURITY;

ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE users FORCE ROW LEVEL SECURITY;

ALTER TABLE posts ENABLE ROW LEVEL SECURITY;
ALTER TABLE posts FORCE ROW LEVEL SECURITY;

-- tenants のポリシー
CREATE POLICY tenants_select_policy ON tenants
    FOR SELECT
    TO app_user
    USING (id = current_setting('app.tenant_id')::uuid);

CREATE POLICY tenants_insert_policy ON tenants
    FOR INSERT
    TO app_user
    WITH CHECK (id = current_setting('app.tenant_id')::uuid);

CREATE POLICY tenants_update_policy ON tenants
    FOR UPDATE
    TO app_user
    USING (id = current_setting('app.tenant_id')::uuid)
    WITH CHECK (id = current_setting('app.tenant_id')::uuid);

CREATE POLICY tenants_delete_policy ON tenants
    FOR DELETE
    TO app_user
    USING (id = current_setting('app.tenant_id')::uuid);

-- users のポリシー
CREATE POLICY users_select_policy ON users
    FOR SELECT
    TO app_user
    USING (tenant_id = current_setting('app.tenant_id')::uuid);

CREATE POLICY users_insert_policy ON users
    FOR INSERT
    TO app_user
    WITH CHECK (tenant_id = current_setting('app.tenant_id')::uuid);

CREATE POLICY users_update_policy ON users
    FOR UPDATE
    TO app_user
    USING (tenant_id = current_setting('app.tenant_id')::uuid)
    WITH CHECK (tenant_id = current_setting('app.tenant_id')::uuid);

CREATE POLICY users_delete_policy ON users
    FOR DELETE
    TO app_user
    USING (tenant_id = current_setting('app.tenant_id')::uuid);

-- posts のポリシー
CREATE POLICY posts_select_policy ON posts
    FOR SELECT
    TO app_user
    USING (tenant_id = current_setting('app.tenant_id')::uuid);

CREATE POLICY posts_insert_policy ON posts
    FOR INSERT
    TO app_user
    WITH CHECK (
        tenant_id = current_setting('app.tenant_id')::uuid
        AND EXISTS (
          SELECT 1 FROM users
          WHERE id = posts.user_id AND tenant_id = posts.tenant_id
        )
    );

CREATE POLICY posts_update_policy ON posts
    FOR UPDATE
    TO app_user
    USING (
        tenant_id = current_setting('app.tenant_id')::uuid
        AND EXISTS (
          SELECT 1 FROM users
          WHERE id = posts.user_id AND tenant_id = posts.tenant_id
        )
    )
    WITH CHECK (
        tenant_id = current_setting('app.tenant_id')::uuid
        AND EXISTS (
          SELECT 1 FROM users
          WHERE id = posts.user_id AND tenant_id = posts.tenant_id
        )
    );

CREATE POLICY posts_delete_policy ON posts
    FOR DELETE
    TO app_user
    USING (
        tenant_id = current_setting('app.tenant_id')::uuid
    );
