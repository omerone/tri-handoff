-- CreateEnum
CREATE TYPE "TenantStatus" AS ENUM ('active', 'suspended');

-- CreateEnum
CREATE TYPE "Locale" AS ENUM ('he', 'en');

-- CreateEnum
CREATE TYPE "Mt5Status" AS ENUM ('pending', 'connected', 'error', 'disconnected');

-- CreateEnum
CREATE TYPE "AssetClass" AS ENUM ('forex', 'crypto', 'indices', 'stocks', 'commodities', 'other');

-- CreateEnum
CREATE TYPE "Direction" AS ENUM ('long', 'short');

-- CreateEnum
CREATE TYPE "TradeStyle" AS ENUM ('day', 'swing');

-- CreateEnum
CREATE TYPE "DealKind" AS ENUM ('trade', 'balance', 'credit', 'correction');

-- CreateEnum
CREATE TYPE "FinanceType" AS ENUM ('income', 'expense');

-- CreateEnum
CREATE TYPE "SyncStatus" AS ENUM ('running', 'success', 'error');

-- CreateEnum
CREATE TYPE "SyncTrigger" AS ENUM ('login', 'manual', 'admin', 'backfill');

-- CreateTable
CREATE TABLE "tenants" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "domain" TEXT NOT NULL,
    "status" "TenantStatus" NOT NULL DEFAULT 'active',
    "notes" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "tenants_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "users" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "password_hash" TEXT NOT NULL,
    "locale" "Locale" NOT NULL DEFAULT 'he',
    "display_currency" TEXT NOT NULL DEFAULT 'ILS',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "last_login_at" TIMESTAMP(3),

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sessions" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "token_hash" TEXT NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_seen_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ip" TEXT,
    "user_agent" TEXT,

    CONSTRAINT "sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "password_reset_tokens" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "token_hash" TEXT NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "used_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "password_reset_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "super_admins" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "password_hash" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "super_admins_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "super_admin_sessions" (
    "id" TEXT NOT NULL,
    "super_admin_id" TEXT NOT NULL,
    "token_hash" TEXT NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "super_admin_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "mt5_accounts" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "login" TEXT NOT NULL,
    "server" TEXT NOT NULL,
    "investor_pw_encrypted" TEXT NOT NULL,
    "status" "Mt5Status" NOT NULL DEFAULT 'pending',
    "last_sync_at" TIMESTAMP(3),
    "account_currency" TEXT,
    "balance" DECIMAL(20,8),
    "equity" DECIMAL(20,8),
    "provider_account_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "mt5_accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "trades" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "ticket" TEXT NOT NULL,
    "kind" "DealKind" NOT NULL DEFAULT 'trade',
    "symbol" TEXT NOT NULL,
    "asset_class" "AssetClass" NOT NULL,
    "direction" "Direction" NOT NULL,
    "style" "TradeStyle" NOT NULL,
    "open_at" TIMESTAMP(3) NOT NULL,
    "close_at" TIMESTAMP(3),
    "volume" DECIMAL(20,8) NOT NULL,
    "entry_price" DECIMAL(20,8) NOT NULL,
    "exit_price" DECIMAL(20,8),
    "sl" DECIMAL(20,8),
    "tp" DECIMAL(20,8),
    "commission" DECIMAL(20,8) NOT NULL DEFAULT 0,
    "swap" DECIMAL(20,8) NOT NULL DEFAULT 0,
    "profit" DECIMAL(20,8) NOT NULL,
    "risk" DECIMAL(20,8),
    "rr" DECIMAL(20,8),
    "note" TEXT,
    "tags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "rating" INTEGER,
    "mood" TEXT,
    "strategy" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "trades_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "finance_entries" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "type" "FinanceType" NOT NULL,
    "category" TEXT NOT NULL DEFAULT 'other',
    "label" TEXT NOT NULL,
    "amount_ils" DECIMAL(14,2) NOT NULL,
    "entry_date" DATE NOT NULL,
    "is_recurring" BOOLEAN NOT NULL DEFAULT false,
    "recurring_until" DATE,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "finance_entries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "long_positions" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "symbol" TEXT NOT NULL,
    "qty" DECIMAL(20,8) NOT NULL,
    "buy_price" DECIMAL(20,8) NOT NULL,
    "buy_date" DATE NOT NULL,
    "current_price" DECIMAL(20,8) NOT NULL,
    "value_updated_at" TIMESTAMP(3) NOT NULL,
    "fees" DECIMAL(20,8) NOT NULL DEFAULT 0,
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "realized_pnl" DECIMAL(20,8),
    "closed_at" TIMESTAMP(3),
    "note" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "long_positions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sync_logs" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "started_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finished_at" TIMESTAMP(3),
    "status" "SyncStatus" NOT NULL DEFAULT 'running',
    "trigger" "SyncTrigger" NOT NULL DEFAULT 'login',
    "trades_imported" INTEGER NOT NULL DEFAULT 0,
    "trades_updated" INTEGER NOT NULL DEFAULT 0,
    "error" TEXT,

    CONSTRAINT "sync_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "fx_rates" (
    "id" TEXT NOT NULL,
    "base" TEXT NOT NULL,
    "quote" TEXT NOT NULL,
    "rate" DECIMAL(20,10) NOT NULL,
    "as_of" DATE NOT NULL,
    "fetched_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "fx_rates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "rate_limits" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "count" INTEGER NOT NULL DEFAULT 0,
    "window_start" TIMESTAMP(3) NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "rate_limits_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "tenants_domain_key" ON "tenants"("domain");

-- CreateIndex
CREATE INDEX "tenants_status_idx" ON "tenants"("status");

-- CreateIndex
CREATE UNIQUE INDEX "users_tenant_id_key" ON "users"("tenant_id");

-- CreateIndex
CREATE UNIQUE INDEX "users_tenant_id_email_key" ON "users"("tenant_id", "email");

-- CreateIndex
CREATE UNIQUE INDEX "sessions_token_hash_key" ON "sessions"("token_hash");

-- CreateIndex
CREATE INDEX "sessions_user_id_idx" ON "sessions"("user_id");

-- CreateIndex
CREATE INDEX "sessions_expires_at_idx" ON "sessions"("expires_at");

-- CreateIndex
CREATE UNIQUE INDEX "password_reset_tokens_token_hash_key" ON "password_reset_tokens"("token_hash");

-- CreateIndex
CREATE INDEX "password_reset_tokens_user_id_idx" ON "password_reset_tokens"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "super_admins_email_key" ON "super_admins"("email");

-- CreateIndex
CREATE UNIQUE INDEX "super_admin_sessions_token_hash_key" ON "super_admin_sessions"("token_hash");

-- CreateIndex
CREATE INDEX "super_admin_sessions_super_admin_id_idx" ON "super_admin_sessions"("super_admin_id");

-- CreateIndex
CREATE UNIQUE INDEX "mt5_accounts_user_id_key" ON "mt5_accounts"("user_id");

-- CreateIndex
CREATE INDEX "trades_user_id_close_at_idx" ON "trades"("user_id", "close_at");

-- CreateIndex
CREATE INDEX "trades_user_id_kind_close_at_idx" ON "trades"("user_id", "kind", "close_at");

-- CreateIndex
CREATE INDEX "trades_user_id_asset_class_idx" ON "trades"("user_id", "asset_class");

-- CreateIndex
CREATE INDEX "trades_user_id_direction_idx" ON "trades"("user_id", "direction");

-- CreateIndex
CREATE INDEX "trades_user_id_style_idx" ON "trades"("user_id", "style");

-- CreateIndex
CREATE UNIQUE INDEX "trades_user_id_ticket_key" ON "trades"("user_id", "ticket");

-- CreateIndex
CREATE INDEX "finance_entries_user_id_entry_date_idx" ON "finance_entries"("user_id", "entry_date");

-- CreateIndex
CREATE INDEX "finance_entries_user_id_type_idx" ON "finance_entries"("user_id", "type");

-- CreateIndex
CREATE INDEX "long_positions_user_id_closed_at_idx" ON "long_positions"("user_id", "closed_at");

-- CreateIndex
CREATE INDEX "sync_logs_user_id_started_at_idx" ON "sync_logs"("user_id", "started_at");

-- CreateIndex
CREATE INDEX "fx_rates_base_quote_as_of_idx" ON "fx_rates"("base", "quote", "as_of");

-- CreateIndex
CREATE UNIQUE INDEX "fx_rates_base_quote_as_of_key" ON "fx_rates"("base", "quote", "as_of");

-- CreateIndex
CREATE UNIQUE INDEX "rate_limits_key_key" ON "rate_limits"("key");

-- CreateIndex
CREATE INDEX "rate_limits_expires_at_idx" ON "rate_limits"("expires_at");

-- AddForeignKey
ALTER TABLE "users" ADD CONSTRAINT "users_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "password_reset_tokens" ADD CONSTRAINT "password_reset_tokens_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "super_admin_sessions" ADD CONSTRAINT "super_admin_sessions_super_admin_id_fkey" FOREIGN KEY ("super_admin_id") REFERENCES "super_admins"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "mt5_accounts" ADD CONSTRAINT "mt5_accounts_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "trades" ADD CONSTRAINT "trades_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "finance_entries" ADD CONSTRAINT "finance_entries_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "long_positions" ADD CONSTRAINT "long_positions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sync_logs" ADD CONSTRAINT "sync_logs_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
