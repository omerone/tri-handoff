-- CreateTable for user_consents (GDPR Compliance - Consent Management)
CREATE TABLE "user_consents" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "granted" BOOLEAN NOT NULL,
    "granted_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMP(3),
    "ip_address" TEXT,
    "user_agent" TEXT,
    "source" TEXT NOT NULL DEFAULT 'api',
    "notes" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "user_consents_pkey" PRIMARY KEY ("id")
);

-- Create indices for query performance
CREATE INDEX "user_consents_user_id_idx" ON "user_consents"("user_id");
CREATE INDEX "user_consents_type_idx" ON "user_consents"("type");
CREATE INDEX "user_consents_granted_at_idx" ON "user_consents"("granted_at");
CREATE INDEX "user_consents_expires_at_idx" ON "user_consents"("expires_at");

-- Add comment for documentation
COMMENT ON TABLE "user_consents" IS 'User consent tracking for GDPR compliance. Tracks consent for data processing, marketing, analytics, and cookies.';
COMMENT ON COLUMN "user_consents"."type" IS 'Consent type: gdpr_processing, marketing_email, analytics_cookies, preference_cookies, essential_cookies, terms_of_service, privacy_policy';
COMMENT ON COLUMN "user_consents"."granted" IS 'True if consent granted, false if revoked';
COMMENT ON COLUMN "user_consents"."source" IS 'Source of consent: banner, settings, implicit, api';
