import 'server-only';
import { prismaBase } from './prisma';

/**
 * Retention for the database audit trail.
 *
 * The trail writes a row for every mutation the product makes and nothing deleted them. The
 * documented policy is twelve months in total — ninety days hot, the rest in cold storage —
 * and `scripts/archive-audit-logs.ts` implements the cold half: it gzips old rows to disk,
 * marks them `archived`, and drops the archived ones past a year.
 *
 * Nothing runs that script. The deploy workflow had a step that printed "Audit archival
 * scheduled" and scheduled nothing, so the ceiling existed only on paper.
 *
 * This is the floor under that: the hourly sweep drops rows past the retention window
 * whether or not anything ever archived them. It needs no bucket, no credentials and no
 * scheduler beyond the timer the app already runs, and it cannot delete anything younger than
 * the policy allows. Running the archiver as well is still worth doing — it is what keeps a
 * *copy* — but the table is now bounded without it.
 */

/**
 * Twelve months, which is the documented total retention rather than a number chosen here.
 *
 * Deliberately not the ninety-day hot window: that one describes where a row lives, and
 * without S3 configured there is nowhere else for it to go, so pruning at ninety days would
 * throw away nine months of history the policy promises to keep.
 */
export const AUDIT_RETENTION_DAYS = 365;

export async function pruneExpiredAuditLogs(): Promise<number> {
  const floor = new Date(Date.now() - AUDIT_RETENTION_DAYS * 86_400_000);

  // Through the unextended client: deleting audit rows must not write audit rows.
  const { count } = await prismaBase.databaseAuditLog.deleteMany({
    where: { createdAt: { lt: floor } },
  });
  return count;
}
