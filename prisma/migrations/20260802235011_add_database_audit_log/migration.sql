-- CreateTable
CREATE TABLE "database_audit_logs" (
    "id" TEXT NOT NULL,
    "table_name" TEXT NOT NULL,
    "operation" TEXT NOT NULL,
    "record_id" TEXT NOT NULL,
    "old_values" JSONB,
    "new_values" JSONB,
    "user_id" TEXT,
    "tenant_id" TEXT,
    "ip_address" TEXT,
    "user_agent" TEXT,
    "execution_time_ms" INTEGER,
    "suspicious" BOOLEAN NOT NULL DEFAULT false,
    "suspicion_reason" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "archived" BOOLEAN NOT NULL DEFAULT false,
    "archive_path" VARCHAR(500),

    CONSTRAINT "database_audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "data_change_logs" (
    "id" TEXT NOT NULL,
    "audit_log_id" TEXT,
    "table_name" TEXT NOT NULL,
    "operation" TEXT NOT NULL,
    "record_id" TEXT NOT NULL,
    "column_name" TEXT,
    "old_value" TEXT,
    "new_value" TEXT,
    "sensitive" BOOLEAN NOT NULL DEFAULT false,
    "user_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "data_change_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "schema_audit_logs" (
    "id" TEXT NOT NULL,
    "statement" TEXT NOT NULL,
    "admin_id" TEXT,
    "result" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "schema_audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "database_audit_logs_table_name_idx" ON "database_audit_logs"("table_name");

-- CreateIndex
CREATE INDEX "database_audit_logs_operation_idx" ON "database_audit_logs"("operation");

-- CreateIndex
CREATE INDEX "database_audit_logs_user_id_idx" ON "database_audit_logs"("user_id");

-- CreateIndex
CREATE INDEX "database_audit_logs_tenant_id_idx" ON "database_audit_logs"("tenant_id");

-- CreateIndex
CREATE INDEX "database_audit_logs_created_at_idx" ON "database_audit_logs"("created_at");

-- CreateIndex
CREATE INDEX "database_audit_logs_archived_created_at_idx" ON "database_audit_logs"("archived", "created_at");

-- CreateIndex
CREATE INDEX "database_audit_logs_suspicious_idx" ON "database_audit_logs"("suspicious");

-- CreateIndex
CREATE INDEX "data_change_logs_audit_log_id_idx" ON "data_change_logs"("audit_log_id");

-- CreateIndex
CREATE INDEX "data_change_logs_table_name_idx" ON "data_change_logs"("table_name");

-- CreateIndex
CREATE INDEX "data_change_logs_record_id_idx" ON "data_change_logs"("record_id");

-- CreateIndex
CREATE INDEX "data_change_logs_user_id_idx" ON "data_change_logs"("user_id");

-- CreateIndex
CREATE INDEX "data_change_logs_created_at_idx" ON "data_change_logs"("created_at");

-- CreateIndex
CREATE INDEX "schema_audit_logs_admin_id_idx" ON "schema_audit_logs"("admin_id");

-- CreateIndex
CREATE INDEX "schema_audit_logs_created_at_idx" ON "schema_audit_logs"("created_at");
