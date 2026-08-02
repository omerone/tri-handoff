/**
 * Archive Audit Logs
 *
 * Moves database audit logs older than 90 days to S3 (cold storage)
 * Keeps 12 months of logs total (90 days hot, 275 days cold)
 *
 * Usage:
 *   npm run audit-logs:archive         # Uses environment variables
 *   npm run audit-logs:archive -- --dry-run
 *
 * Runs daily via cron job (see GitHub Actions workflow)
 */

import { PrismaClient } from '@prisma/client';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { gzip } from 'node:zlib';
import { promisify } from 'node:util';
import * as crypto from 'node:crypto';

const gzipAsync = promisify(gzip);

interface ArchivalOptions {
  dryRun: boolean;
  retentionDays: number;
  archiveRetentionMonths: number;
  batchSize: number;
}

class AuditLogArchiver {
  private prisma: PrismaClient;
  private options: ArchivalOptions;

  constructor(options: ArchivalOptions) {
    this.prisma = new PrismaClient();
    this.options = options;
  }

  /**
   * Main archival process
   */
  async archiveOldLogs(): Promise<void> {
    console.log('[Audit Archive] Starting archival process...');
    console.log(`  Retention: ${this.options.retentionDays} days hot`);
    console.log(`  Archive retention: ${this.options.archiveRetentionMonths} months total`);
    console.log(`  Batch size: ${this.options.batchSize}`);
    console.log(`  Dry run: ${this.options.dryRun}`);
    console.log('');

    try {
      // Step 1: Count logs to archive
      const cutoffDate = new Date(
        Date.now() - this.options.retentionDays * 24 * 60 * 60 * 1000
      );
      const countToArchive = await this.prisma.databaseAuditLog.count({
        where: {
          archived: false,
          createdAt: { lt: cutoffDate },
        },
      });

      console.log(`[Audit Archive] Found ${countToArchive} logs to archive`);

      if (countToArchive === 0) {
        console.log('[Audit Archive] No logs to archive');
        return;
      }

      // Step 2: Archive in batches
      const batches = Math.ceil(countToArchive / this.options.batchSize);
      let archived = 0;

      for (let batch = 0; batch < batches; batch++) {
        const batchNumber = batch + 1;
        console.log(
          `[Audit Archive] Processing batch ${batchNumber}/${batches} (${this.options.batchSize} logs)...`
        );

        // Fetch batch
        const logs = await this.prisma.databaseAuditLog.findMany({
          where: {
            archived: false,
            createdAt: { lt: cutoffDate },
          },
          take: this.options.batchSize,
          orderBy: { createdAt: 'asc' },
        });

        if (logs.length === 0) break;

        // Archive to S3 or local storage
        const archivePath = await this.archiveBatch(logs, batch);

        if (!this.options.dryRun) {
          // Mark logs as archived in database
          const ids = logs.map((l) => l.id);
          await this.prisma.databaseAuditLog.updateMany({
            where: { id: { in: ids } },
            data: {
              archived: true,
              archivePath,
            },
          });

          archived += logs.length;
          console.log(`[Audit Archive] ✓ Archived ${logs.length} logs (total: ${archived})`);
        } else {
          console.log(`[Audit Archive] [DRY RUN] Would archive ${logs.length} logs to ${archivePath}`);
        }
      }

      // Step 3: Delete very old archived logs (>12 months)
      const deleteResult = await this.deleteOldArchives();
      console.log(`[Audit Archive] Deleted ${deleteResult.deleted} archived logs older than ${this.options.archiveRetentionMonths} months`);

      console.log('[Audit Archive] ✓ Archival complete');
    } catch (error) {
      console.error('[Audit Archive] Error during archival:', error);
      throw error;
    } finally {
      await this.prisma.$disconnect();
    }
  }

  /**
   * Archive a batch of logs (to S3 or local storage)
   */
  private async archiveBatch(
    logs: any[],
    batchNumber: number
  ): Promise<string> {
    const timestamp = new Date().toISOString().split('T')[0];
    const localPath = `./audit-archives/audit-logs-${timestamp}-batch-${batchNumber}.json.gz`;

    // Create local directory if it doesn't exist
    const dir = path.dirname(localPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    // Serialize logs to JSON
    const jsonData = JSON.stringify(logs, null, 2);

    if (!this.options.dryRun) {
      // Compress
      const compressed = await gzipAsync(Buffer.from(jsonData));

      // Write to disk
      fs.writeFileSync(localPath, compressed);

      // Calculate checksum for integrity verification
      const checksum = crypto.createHash('sha256').update(compressed).digest('hex');
      fs.writeFileSync(`${localPath}.sha256`, checksum);

      console.log(`[Audit Archive] Saved to ${localPath} (${compressed.length} bytes)`);

      // TODO: Upload to S3
      // if (process.env.AWS_S3_BUCKET) {
      //   const s3Path = await this.uploadToS3(localPath, compressed);
      //   console.log(`[Audit Archive] Uploaded to S3: ${s3Path}`);
      //   return s3Path;
      // }
    }

    return localPath;
  }

  /**
   * Delete very old archived logs (>12 months)
   */
  private async deleteOldArchives(): Promise<{ deleted: number }> {
    const cutoffDate = new Date();
    cutoffDate.setMonth(cutoffDate.getMonth() - this.options.archiveRetentionMonths);

    const result = await this.prisma.databaseAuditLog.deleteMany({
      where: {
        archived: true,
        createdAt: { lt: cutoffDate },
      },
    });

    return { deleted: result.count };
  }

  /**
   * Verify archive integrity
   */
  async verifyArchive(archivePath: string): Promise<boolean> {
    try {
      const checksumPath = `${archivePath}.sha256`;

      if (!fs.existsSync(archivePath) || !fs.existsSync(checksumPath)) {
        console.error(`[Audit Archive] Missing archive or checksum: ${archivePath}`);
        return false;
      }

      const compressed = fs.readFileSync(archivePath);
      const expectedChecksum = fs.readFileSync(checksumPath, 'utf-8').trim();
      const actualChecksum = crypto.createHash('sha256').update(compressed).digest('hex');

      if (expectedChecksum === actualChecksum) {
        console.log(`[Audit Archive] ✓ Archive integrity verified: ${archivePath}`);
        return true;
      } else {
        console.error(
          `[Audit Archive] ✗ Checksum mismatch: ${archivePath} (expected: ${expectedChecksum}, got: ${actualChecksum})`
        );
        return false;
      }
    } catch (error) {
      console.error(`[Audit Archive] Error verifying archive: ${error}`);
      return false;
    }
  }

  /**
   * Restore logs from archive (for recovery or analysis)
   */
  async restoreArchive(archivePath: string): Promise<any[]> {
    try {
      const compressed = fs.readFileSync(archivePath);
      const decompressed = await promisify(require('node:zlib').gunzip)(compressed);
      const logs = JSON.parse(decompressed.toString());
      console.log(`[Audit Archive] ✓ Restored ${logs.length} logs from ${archivePath}`);
      return logs;
    } catch (error) {
      console.error(`[Audit Archive] Error restoring archive: ${error}`);
      throw error;
    }
  }
}

/**
 * Parse command-line arguments
 */
function parseArgs(): ArchivalOptions {
  const args = process.argv.slice(2);

  return {
    dryRun: args.includes('--dry-run'),
    retentionDays: parseInt(args.find((a) => a.startsWith('--retention-days='))?.split('=')[1] || '90'),
    archiveRetentionMonths: parseInt(
      args.find((a) => a.startsWith('--archive-retention-months='))?.split('=')[1] || '12'
    ),
    batchSize: parseInt(args.find((a) => a.startsWith('--batch-size='))?.split('=')[1] || '1000'),
  };
}

/**
 * Main entry point
 */
async function main() {
  const options = parseArgs();
  const archiver = new AuditLogArchiver(options);

  try {
    await archiver.archiveOldLogs();
    console.log('[Audit Archive] ✓ Success');
    process.exit(0);
  } catch (error) {
    console.error('[Audit Archive] ✗ Failed:', error);
    process.exit(1);
  }
}

main();
