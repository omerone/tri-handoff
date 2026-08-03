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
  /*
   * No host aliases here, and `localhost` least of all.
   *
   * A `localhost` → `demo.localhost` mapping was added twice for local convenience and
   * removed twice. This function is pure host parsing, and three security decisions read its
   * output, so aliasing one host to another breaks all three at once:
   *
   *   - `resolveTenant` treats every request carrying `Host: localhost` as a signed-in
   *     client's domain — in production as much as in development — so "only a provisioned
   *     domain reaches a tenant" stops being true;
   *   - `assertAdminHost` compares this function's output for `APP_BASE_DOMAIN` against the
   *     request's. With `APP_BASE_DOMAIN=localhost:3000` both sides become `demo.localhost`,
   *     which serves the *operator login* on a customer's own domain — the one thing that
   *     module exists to prevent;
   *   - the 404 that tells an unknown host it is not a TRi client stops firing for it.
   *
   * The convenience was not needed either: browsers and curl resolve `*.localhost` to the
   * loopback address with no `/etc/hosts` entry, which is why the demo tenant is provisioned
   * at `demo.localhost` in the first place.
   *
   * A development-only alias, if one is ever wanted, belongs in `resolveTenant` behind an
   * explicit `NODE_ENV` check — never in the function every boundary check parses hosts with.
   * `domain.test.ts` guards this.
   */
  return host.replace(/\.$/, '');
}

const DOMAIN_PATTERN = /^(?=.{1,253}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)*[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/;

/**
 * Accepts real hostnames and the single-label hosts used in development
 * (`demo.localhost`, `localhost`). Rejects anything with a scheme, path, or whitespace.
 */
export function isValidDomain(candidate: string): boolean {
  return candidate.length > 0 && DOMAIN_PATTERN.test(candidate);
}
