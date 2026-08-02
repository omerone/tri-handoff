-- Audit trigger setup for comprehensive database audit logging
-- Creates triggers on sensitive tables to log all INSERT/UPDATE/DELETE operations
-- Used by: src/lib/db/audit-triggers.ts

-- Create audit trigger function
CREATE OR REPLACE FUNCTION audit_trigger_function() RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO database_audit_logs (
    table_name,
    operation,
    record_id,
    old_values,
    new_values,
    user_id,
    tenant_id,
    ip_address,
    user_agent,
    created_at
  ) VALUES (
    TG_TABLE_NAME,
    TG_OP,
    COALESCE(NEW.id, OLD.id)::text,
    CASE WHEN TG_OP = 'DELETE' OR TG_OP = 'UPDATE' THEN row_to_json(OLD) ELSE NULL END,
    CASE WHEN TG_OP = 'INSERT' OR TG_OP = 'UPDATE' THEN row_to_json(NEW) ELSE NULL END,
    COALESCE(NEW.user_id, OLD.user_id)::text,
    COALESCE(NEW.tenant_id, OLD.tenant_id)::text,
    NULL, -- IP address set by application layer
    NULL, -- User agent set by application layer
    CURRENT_TIMESTAMP
  );

  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Create triggers on sensitive tables

-- Users table: all operations
CREATE TRIGGER audit_users_insert AFTER INSERT ON users
  FOR EACH ROW EXECUTE FUNCTION audit_trigger_function();

CREATE TRIGGER audit_users_update AFTER UPDATE ON users
  FOR EACH ROW EXECUTE FUNCTION audit_trigger_function();

CREATE TRIGGER audit_users_delete AFTER DELETE ON users
  FOR EACH ROW EXECUTE FUNCTION audit_trigger_function();

-- Trades table: all operations
CREATE TRIGGER audit_trades_insert AFTER INSERT ON trades
  FOR EACH ROW EXECUTE FUNCTION audit_trigger_function();

CREATE TRIGGER audit_trades_update AFTER UPDATE ON trades
  FOR EACH ROW EXECUTE FUNCTION audit_trigger_function();

CREATE TRIGGER audit_trades_delete AFTER DELETE ON trades
  FOR EACH ROW EXECUTE FUNCTION audit_trigger_function();

-- Sessions table: all operations
CREATE TRIGGER audit_sessions_insert AFTER INSERT ON sessions
  FOR EACH ROW EXECUTE FUNCTION audit_trigger_function();

CREATE TRIGGER audit_sessions_update AFTER UPDATE ON sessions
  FOR EACH ROW EXECUTE FUNCTION audit_trigger_function();

CREATE TRIGGER audit_sessions_delete AFTER DELETE ON sessions
  FOR EACH ROW EXECUTE FUNCTION audit_trigger_function();

-- MT5 Accounts table: all operations
CREATE TRIGGER audit_mt5_accounts_insert AFTER INSERT ON mt5_accounts
  FOR EACH ROW EXECUTE FUNCTION audit_trigger_function();

CREATE TRIGGER audit_mt5_accounts_update AFTER UPDATE ON mt5_accounts
  FOR EACH ROW EXECUTE FUNCTION audit_trigger_function();

CREATE TRIGGER audit_mt5_accounts_delete AFTER DELETE ON mt5_accounts
  FOR EACH ROW EXECUTE FUNCTION audit_trigger_function();

-- Password Reset Tokens: all operations
CREATE TRIGGER audit_password_reset_tokens_insert AFTER INSERT ON password_reset_tokens
  FOR EACH ROW EXECUTE FUNCTION audit_trigger_function();

CREATE TRIGGER audit_password_reset_tokens_delete AFTER DELETE ON password_reset_tokens
  FOR EACH ROW EXECUTE FUNCTION audit_trigger_function();

-- Super Admins table: all operations
CREATE TRIGGER audit_super_admins_insert AFTER INSERT ON super_admins
  FOR EACH ROW EXECUTE FUNCTION audit_trigger_function();

CREATE TRIGGER audit_super_admins_update AFTER UPDATE ON super_admins
  FOR EACH ROW EXECUTE FUNCTION audit_trigger_function();

CREATE TRIGGER audit_super_admins_delete AFTER DELETE ON super_admins
  FOR EACH ROW EXECUTE FUNCTION audit_trigger_function();

-- Tenants table: all operations
CREATE TRIGGER audit_tenants_insert AFTER INSERT ON tenants
  FOR EACH ROW EXECUTE FUNCTION audit_trigger_function();

CREATE TRIGGER audit_tenants_update AFTER UPDATE ON tenants
  FOR EACH ROW EXECUTE FUNCTION audit_trigger_function();

CREATE TRIGGER audit_tenants_delete AFTER DELETE ON tenants
  FOR EACH ROW EXECUTE FUNCTION audit_trigger_function();

-- Create index for retention cleanup queries
CREATE INDEX idx_database_audit_logs_created_at ON database_audit_logs(created_at DESC);
CREATE INDEX idx_database_audit_logs_archived ON database_audit_logs(archived, created_at DESC);

-- Enable row security if needed (future enhancement)
ALTER TABLE database_audit_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE data_change_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE schema_audit_logs ENABLE ROW LEVEL SECURITY;
