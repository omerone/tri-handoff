/**
 * Host normalisation, shared by the tenant middleware, the provisioning CLI and the admin
 * panel — so "Demo.TRi.App:443" typed into a form matches the row written by the CLI.
 *
 * Pure and dependency-free on purpose: this runs in the Edge middleware runtime too.
 */

/** Lowercase, strip the port, strip a trailing dot, strip a leading scheme if one slipped in. */
export function normalizeDomain(raw: string): string {
  let host = raw.trim().toLowerCase();
  host = host.replace(/^[a-z][a-z0-9+.-]*:\/\//, '');
  host = host.split('/')[0] ?? '';
  // IPv6 literals arrive as [::1]:3000; keep the brackets, drop the port.
  if (host.startsWith('[')) {
    const end = host.indexOf(']');
    if (end !== -1) return host.slice(0, end + 1);
  }
  const colon = host.lastIndexOf(':');
  if (colon !== -1) host = host.slice(0, colon);
  host = host.replace(/\.$/, '');

  // In development: localhost maps to demo.localhost for convenience
  if (host === 'localhost') {
    return 'demo.localhost';
  }

  return host;
}

const DOMAIN_PATTERN = /^(?=.{1,253}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)*[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/;

/**
 * Accepts real hostnames and the single-label hosts used in development
 * (`demo.localhost`, `localhost`). Rejects anything with a scheme, path, or whitespace.
 */
export function isValidDomain(candidate: string): boolean {
  return candidate.length > 0 && DOMAIN_PATTERN.test(candidate);
}
