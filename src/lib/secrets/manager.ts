import 'server-only';
import { SecretsManagerClient, GetSecretValueCommand } from '@aws-sdk/client-secrets-manager';
import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';

/**
 * Production-grade secrets management using AWS Secrets Manager.
 *
 * Features:
 * - Fetch secrets from AWS Secrets Manager on app startup
 * - Cache secrets with 5-minute TTL for performance
 * - Fallback to .env.local for local development (without AWS)
 * - Fallback to environment variables (for CI/CD, Docker)
 * - Comprehensive error handling with clear messages
 * - Never logs secret values
 *
 * Usage:
 *   const secrets = await loadSecrets();
 *   process.env.DATABASE_URL = secrets.DATABASE_URL;
 */

interface _SecretValue {
  [key: string]: string;
}

interface CacheEntry {
  value: Record<string, string>;
  timestamp: number;
}

const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes
const cache: Map<string, CacheEntry> = new Map();

let client: SecretsManagerClient | null = null;

function initSecretsManagerClient(): SecretsManagerClient {
  if (client) return client;

  const region = process.env.AWS_REGION || process.env.AWS_DEFAULT_REGION || 'us-east-1';
  client = new SecretsManagerClient({ region });
  return client;
}

/**
 * Load secrets from .env.local file (local development only)
 */
function loadFromDotEnvLocal(): Record<string, string> {
  const envLocalPath = path.join(process.cwd(), '.env.local');

  if (!fs.existsSync(envLocalPath)) {
    return {};
  }

  const content = fs.readFileSync(envLocalPath, 'utf-8');
  const parsed = dotenv.parse(content);
  return parsed;
}

/**
 * Fetch a secret from AWS Secrets Manager
 * The secret is expected to be stored as a JSON string with key-value pairs
 */
async function fetchFromAwsSecretsManager(secretName: string): Promise<Record<string, string>> {
  try {
    const awsClient = initSecretsManagerClient();

    const command = new GetSecretValueCommand({
      SecretId: secretName,
      VersionStage: 'AWSCURRENT',
    });

    const response = await awsClient.send(command);

    // The secret value can be either SecretString (JSON) or SecretBinary
    const secretValue = response.SecretString;

    if (!secretValue) {
      throw new Error('Secret value is empty');
    }

    // Parse as JSON
    const parsed = JSON.parse(secretValue) as Record<string, string>;
    return parsed;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Failed to fetch secret from AWS Secrets Manager: ${message}`);
  }
}

/**
 * Determine if we're running in a container or CI/CD environment
 * Heuristic: AWS_REGION is set, or running in specific CI/CD environments
 */
function shouldUseAwsSecretsManager(): boolean {
  // Explicit flag to disable AWS Secrets Manager (useful for testing)
  if (process.env.DISABLE_AWS_SECRETS_MANAGER === 'true') {
    return false;
  }

  // Use AWS if region is explicitly set
  if (process.env.AWS_REGION || process.env.AWS_DEFAULT_REGION) {
    return true;
  }

  // Detect CI/CD environments
  const ciEnv = process.env.CI || process.env.GITHUB_ACTIONS || process.env.GITLAB_CI;
  if (ciEnv) {
    // Only use AWS if running in CI and region is configured
    return !!(process.env.AWS_REGION || process.env.AWS_DEFAULT_REGION);
  }

  return false;
}

/**
 * Load secrets from all sources in order of precedence:
 * 1. AWS Secrets Manager (production)
 * 2. .env.local (local development)
 * 3. Environment variables (CI/CD, Docker)
 *
 * Returns an object with all loaded secrets (never logs values)
 */
export async function loadSecrets(): Promise<Record<string, string>> {
  const cacheKey = 'tri-secrets';
  const cached = cache.get(cacheKey);

  // Return cached secrets if still valid
  if (cached && Date.now() - cached.timestamp < CACHE_TTL_MS) {
    return cached.value;
  }

  const secrets: Record<string, string> = {};
  const loadedFrom: string[] = [];

  try {
    // Try AWS Secrets Manager first
    if (shouldUseAwsSecretsManager()) {
      try {
        const secretName = process.env.AWS_SECRETS_NAME || 'tri/secrets';
        const awsSecrets = await fetchFromAwsSecretsManager(secretName);
        Object.assign(secrets, awsSecrets);
        loadedFrom.push(`AWS Secrets Manager (${secretName})`);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.warn(`Warning: Could not load secrets from AWS Secrets Manager: ${message}`);
        // Don't throw here — fall back to other sources
      }
    }

    // Try .env.local for development (only if not already loaded from AWS)
    if (Object.keys(secrets).length === 0 && process.env.NODE_ENV !== 'production') {
      const envLocalSecrets = loadFromDotEnvLocal();
      if (Object.keys(envLocalSecrets).length > 0) {
        Object.assign(secrets, envLocalSecrets);
        loadedFrom.push('.env.local');
      }
    }

    // Fall back to process.env (always available, set by Docker, CI/CD, or .env)
    // This serves as the final fallback
    const requiredSecrets = [
      'DATABASE_URL',
      'SESSION_SECRET',
      'ENCRYPTION_KEY',
      'NODE_ENV',
      'APP_BASE_DOMAIN',
      'APP_PROTOCOL',
    ];

    for (const key of requiredSecrets) {
      if (!secrets[key] && process.env[key]) {
        secrets[key] = process.env[key]!;
      }
    }

    // Log which sources were used (without values)
    if (loadedFrom.length > 0) {
      console.warn(`[Secrets] Loaded from: ${loadedFrom.join(', ')}`);
    }

    if (Object.keys(secrets).length === 0) {
      console.warn(
        '[Secrets] No secrets loaded. Ensure AWS Secrets Manager, .env.local, or environment variables are configured.',
      );
    }

    // Cache the loaded secrets
    cache.set(cacheKey, {
      value: secrets,
      timestamp: Date.now(),
    });

    return secrets;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[Secrets] Fatal error loading secrets: ${message}`);
    throw new Error(`Failed to load secrets: ${message}`);
  }
}

/**
 * Clear the secrets cache (useful for testing or manual secret rotation)
 */
export function clearSecretsCache(): void {
  cache.clear();
}

/**
 * Get the current cache TTL in milliseconds
 */
export function getCacheTTL(): number {
  return CACHE_TTL_MS;
}

/**
 * Check if AWS Secrets Manager is enabled
 */
export function isAwsSecretsManagerEnabled(): boolean {
  return shouldUseAwsSecretsManager();
}
