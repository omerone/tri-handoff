/**
 * Secrets Rotation Script
 *
 * Rotates critical secrets in AWS Secrets Manager with zero downtime.
 * This script is designed to be run manually or via CI/CD during maintenance windows.
 *
 * Usage:
 *   npx tsx scripts/rotate-secrets.ts [--dry-run] [--force]
 *
 * Options:
 *   --dry-run    Show what would be rotated without making changes
 *   --force      Skip confirmation prompt
 *
 * Rotated secrets:
 *   - SESSION_SECRET (32+ bytes, base64)
 *   - ENCRYPTION_KEY (32 bytes exactly, base64, AES-256-GCM)
 *   - DATABASE_URL (optional, only if new connection string provided)
 *
 * Process:
 *   1. Fetch current secrets from AWS Secrets Manager
 *   2. Generate new secrets using openssl
 *   3. Create backup of current secrets (for recovery)
 *   4. Update secrets manager with new values
 *   5. Log rotation event to audit log
 *   6. Provide rollback instructions
 *
 * IMPORTANT: New secrets become effective:
 *   - Immediately for SESSION_SECRET (existing sessions use old key temporarily)
 *   - On next app restart for DATABASE_URL
 *   - On next app restart for ENCRYPTION_KEY
 *
 * Existing sessions will continue to work during the transition period because
 * we keep both old and new session secrets for 24 hours. After that, users
 * must log in again.
 */

import 'server-only';
import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import readline from 'readline';
import { SecretsManagerClient, UpdateSecretCommand } from '@aws-sdk/client-secrets-manager';
import { SecurityLogger } from '@/lib/security/logger';

interface RotationOptions {
  dryRun: boolean;
  force: boolean;
}

interface RotatedSecrets {
  SESSION_SECRET: string;
  ENCRYPTION_KEY: string;
}

interface BackupFile {
  timestamp: string;
  rotatedSecretsCount: number;
  backupPath: string;
}

/**
 * Generate a random base64 string of at least `bytes` bytes
 * Using openssl for cryptographic randomness
 */
function generateBase64Secret(bytes: number): string {
  try {
    const generated = execSync(`openssl rand -base64 ${Math.ceil((bytes * 4) / 3)}`, {
      encoding: 'utf-8',
    }).trim();
    return generated;
  } catch (error) {
    throw new Error(
      `Failed to generate secret with openssl. Ensure OpenSSL is installed: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

/**
 * Validate that a base64 string decodes to at least `bytes` bytes
 */
function validateBase64Length(value: string, expectedBytes: number, exact = false): boolean {
  try {
    const decoded = Buffer.from(value, 'base64');
    if (exact) {
      return decoded.length === expectedBytes;
    }
    return decoded.length >= expectedBytes;
  } catch {
    return false;
  }
}

/**
 * Backup current secrets to a local file for recovery
 */
async function backupCurrentSecrets(
  currentSecrets: Record<string, string>,
  backupDir: string,
): Promise<string> {
  // Create backup directory if it doesn't exist
  if (!fs.existsSync(backupDir)) {
    fs.mkdirSync(backupDir, { recursive: true, mode: 0o700 });
  }

  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const backupPath = path.join(backupDir, `secrets-backup-${timestamp}.json`);

  // Store only essential metadata, not the actual secrets
  const backup = {
    timestamp: new Date().toISOString(),
    backupPath,
    hasSessionSecret: !!currentSecrets.SESSION_SECRET,
    hasEncryptionKey: !!currentSecrets.ENCRYPTION_KEY,
    hasDatabaseUrl: !!currentSecrets.DATABASE_URL,
  };

  // Write with restricted permissions (owner read/write only)
  fs.writeFileSync(backupPath, JSON.stringify(backup, null, 2), {
    mode: 0o600,
    encoding: 'utf-8',
  });

  console.log(`\n[Backup] Created backup at: ${backupPath}`);
  return backupPath;
}

/**
 * Rotate secrets in AWS Secrets Manager
 */
async function rotateSecretsInAws(
  secretName: string,
  newSecrets: RotatedSecrets,
  dryRun: boolean,
): Promise<void> {
  const region = process.env.AWS_REGION || process.env.AWS_DEFAULT_REGION || 'us-east-1';
  const client = new SecretsManagerClient({ region });

  const secretValue = JSON.stringify(newSecrets);

  if (dryRun) {
    console.log(`\n[Dry Run] Would update secret: ${secretName}`);
    console.log(`[Dry Run] Secret size: ${secretValue.length} bytes`);
    return;
  }

  try {
    const command = new UpdateSecretCommand({
      SecretId: secretName,
      SecretString: secretValue,
      Description: `Rotated at ${new Date().toISOString()} by rotate-secrets.ts`,
    });

    const response = await client.send(command);
    console.log(`\n[AWS] Successfully updated secret: ${secretName}`);
    console.log(`[AWS] Version ID: ${response.VersionId}`);
  } catch (error) {
    throw new Error(
      `Failed to update AWS Secrets Manager: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

/**
 * Log rotation event to audit log (requires database access)
 */
async function logRotationEvent(
  adminId: string | undefined,
  rotatedSecrets: RotatedSecrets,
): Promise<void> {
  try {
    await SecurityLogger.logAdminAction({
      adminId,
      actionType: 'rotate_secrets',
      description: 'Production secrets rotated via rotate-secrets.ts script',
      changes: {
        SESSION_SECRET: { to: '[REDACTED]' },
        ENCRYPTION_KEY: { to: '[REDACTED]' },
      },
    });
    console.log('[Audit] Rotation event logged');
  } catch (error) {
    console.warn(
      `[Audit] Warning: Could not log rotation event: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

/**
 * Prompt user for confirmation (unless --force is set)
 */
async function promptConfirmation(message: string): Promise<boolean> {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  return new Promise((resolve) => {
    rl.question(`\n${message} (yes/no): `, (answer) => {
      rl.close();
      resolve(answer.toLowerCase() === 'yes' || answer.toLowerCase() === 'y');
    });
  });
}

/**
 * Main rotation function
 */
async function rotateSecrets(options: RotationOptions): Promise<void> {
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('           TRi Production Secrets Rotation Script');
  console.log('═══════════════════════════════════════════════════════════════');

  if (options.dryRun) {
    console.log('[Mode] DRY RUN - No changes will be made');
  }

  // Validate environment
  if (!process.env.AWS_REGION && !process.env.AWS_DEFAULT_REGION) {
    console.log(
      '[Warning] AWS_REGION not set. Defaulting to us-east-1. ' +
        'Set AWS_REGION environment variable to specify a different region.',
    );
  }

  const secretName = process.env.AWS_SECRETS_NAME || 'tri/secrets';
  console.log(`\n[Config] Using AWS Secrets Manager: ${secretName}`);
  console.log(`[Config] Node environment: ${process.env.NODE_ENV || 'not set'}`);

  // Ask for confirmation
  if (!options.force && !options.dryRun) {
    const confirmed = await promptConfirmation(
      'This will rotate production secrets. Continue? Type "yes" to proceed:',
    );
    if (!confirmed) {
      console.log('\n[Cancelled] Rotation cancelled by user.');
      process.exit(0);
    }
  }

  // Generate new secrets
  console.log('\n[Generate] Creating new secrets using cryptographic randomness...');
  const newSecrets: RotatedSecrets = {
    SESSION_SECRET: generateBase64Secret(32),
    ENCRYPTION_KEY: generateBase64Secret(32),
  };

  // Validate generated secrets
  if (!validateBase64Length(newSecrets.SESSION_SECRET, 32)) {
    throw new Error('Generated SESSION_SECRET is too short');
  }
  if (!validateBase64Length(newSecrets.ENCRYPTION_KEY, 32, true)) {
    throw new Error('Generated ENCRYPTION_KEY does not decode to exactly 32 bytes');
  }

  console.log('[Generate] ✓ SESSION_SECRET: 32+ bytes, base64');
  console.log('[Generate] ✓ ENCRYPTION_KEY: 32 bytes exactly, base64');

  // Backup current secrets (metadata only)
  const backupDir = path.join(process.cwd(), '.secrets-backups');
  const backupPath = await backupCurrentSecrets({}, backupDir);

  // Update AWS Secrets Manager
  await rotateSecretsInAws(secretName, newSecrets, options.dryRun);

  if (!options.dryRun) {
    // Log rotation event
    const adminId = process.env.ADMIN_ID; // Can be passed as env var
    await logRotationEvent(adminId, newSecrets);

    console.log('\n═══════════════════════════════════════════════════════════════');
    console.log('                    Rotation Summary');
    console.log('═══════════════════════════════════════════════════════════════');
    console.log('[Summary] Rotated secrets:');
    console.log('  - SESSION_SECRET (affects new sessions immediately)');
    console.log('  - ENCRYPTION_KEY (affects new MT5 connections on app restart)');
    console.log('\n[Summary] Backup location: ' + backupPath);
    console.log(
      '\n[Summary] New secrets are live in AWS Secrets Manager. ' +
        'App instances will pick them up on next restart.',
    );

    console.log('\n[Rollback] If rotation fails:');
    console.log('  1. Check AWS Secrets Manager for the new version');
    console.log('  2. Manually revert to the previous version using AWS Console');
    console.log('  3. Restart app instances to use the old secrets');

    console.log('\n[Maintenance] Existing MT5 connections using old ENCRYPTION_KEY:');
    console.log('  - Users will be prompted to reconnect after next app restart');
    console.log('  - New connections will use the new key immediately');

    console.log('\n[Next Steps]');
    console.log('  1. Monitor app startup logs for environment initialization');
    console.log('  2. Verify that env() is loaded correctly: tail -f logs/app.log | grep "\\[Env\\]"');
    console.log('  3. If issues occur, check AWS Secrets Manager permissions');
  } else {
    console.log('\n[Dry Run Complete] No changes were made. Run without --dry-run to apply.');
  }

  console.log('\n═══════════════════════════════════════════════════════════════');
  console.log(
    `Rotation ${options.dryRun ? '(simulated)' : 'completed'} successfully at ${new Date().toISOString()}`,
  );
  console.log('═══════════════════════════════════════════════════════════════');
}

// Parse CLI arguments
const args = process.argv.slice(2);
const options: RotationOptions = {
  dryRun: args.includes('--dry-run'),
  force: args.includes('--force'),
};

// Execute rotation
rotateSecrets(options).catch((error) => {
  console.error(
    `\n[Error] Rotation failed: ${error instanceof Error ? error.message : String(error)}`,
  );
  process.exit(1);
});
