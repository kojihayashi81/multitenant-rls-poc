-- 関数の作成
CREATE OR REPLACE FUNCTION set_updated_at() RETURNS trigger AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- トリガーの作成
CREATE TRIGGER trg_set_updated_at_tenants BEFORE UPDATE ON tenants FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER trg_set_updated_at_users BEFORE UPDATE ON users FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER trg_set_updated_at_posts BEFORE UPDATE ON posts FOR EACH ROW EXECUTE FUNCTION set_updated_at();