-- Who shares a login, per tenant, by name.
--
-- The two-brother household was a code constant, which made it every tenant's household —
-- including the operator's own single-person tenant, whose finance screen would have been
-- split between two names that are not theirs. Empty means one person: no switch, no owner
-- on new rows, no filter on any screen.
ALTER TABLE "tenants" ADD COLUMN IF NOT EXISTS "household" TEXT[] NOT NULL DEFAULT '{}';

-- Every tenant that exists before this migration was living under the constant, and their
-- rows already carry these names. The operator's own tenant is excluded by domain in case it
-- was onboarded first; a solo tenant created after gets the default.
UPDATE "tenants"
SET "household" = ARRAY['יוני', 'אביתר']
WHERE "domain" NOT IN ('omer.troinvest.uk');
