-- CreateTable AuthEvent
CREATE TABLE "auth_events" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "user_id" TEXT NOT NULL,
    "event_type" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "ip_address" TEXT,
    "user_agent" TEXT,
    "result" TEXT NOT NULL DEFAULT 'success',
    "details" JSONB DEFAULT '{}',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateIndex
CREATE INDEX "auth_events_user_id_idx" ON "auth_events"("user_id");

-- CreateIndex
CREATE INDEX "auth_events_event_type_idx" ON "auth_events"("event_type");

-- CreateIndex
CREATE INDEX "auth_events_created_at_idx" ON "auth_events"("created_at");

-- CreateTable AdminAuditLog
CREATE TABLE "admin_audit_logs" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "admin_id" TEXT,
    "tenant_id" TEXT,
    "user_id" TEXT,
    "action_type" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "changes" JSONB,
    "ip_address" TEXT,
    "user_agent" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateIndex
CREATE INDEX "admin_audit_logs_admin_id_idx" ON "admin_audit_logs"("admin_id");

-- CreateIndex
CREATE INDEX "admin_audit_logs_tenant_id_idx" ON "admin_audit_logs"("tenant_id");

-- CreateIndex
CREATE INDEX "admin_audit_logs_user_id_idx" ON "admin_audit_logs"("user_id");

-- CreateIndex
CREATE INDEX "admin_audit_logs_action_type_idx" ON "admin_audit_logs"("action_type");

-- CreateIndex
CREATE INDEX "admin_audit_logs_created_at_idx" ON "admin_audit_logs"("created_at");

-- CreateTable DataAccessLog
CREATE TABLE "data_access_logs" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "user_id" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "resource" TEXT NOT NULL,
    "record_count" INTEGER,
    "data_size_bytes" INTEGER,
    "ip_address" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateIndex
CREATE INDEX "data_access_logs_user_id_idx" ON "data_access_logs"("user_id");

-- CreateIndex
CREATE INDEX "data_access_logs_action_idx" ON "data_access_logs"("action");

-- CreateIndex
CREATE INDEX "data_access_logs_resource_idx" ON "data_access_logs"("resource");

-- CreateIndex
CREATE INDEX "data_access_logs_created_at_idx" ON "data_access_logs"("created_at");
