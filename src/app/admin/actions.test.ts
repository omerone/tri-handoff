import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * Every operator action is gated.
 *
 * The actions in this directory rename clients, rebind their domains, set their passwords and
 * delete them — all through `@/lib/db/unscoped`, which by definition has no tenant scoping to
 * fall back on. The only thing standing between a form post and a deleted client is the
 * `requireAdmin()` at the top of each one, and a server action is reachable by anyone who can
 * find its id: nothing about being defined next to an admin page protects it.
 *
 * So this reads the source rather than calling anything. Invoking an action would need
 * `cookies()`, a request scope and a database, which is a lot of scaffolding to end up
 * asserting the same single line — and it would only cover the actions someone remembered to
 * write a case for. Reading the directory covers the one that gets added next year.
 */

const ADMIN_DIR = dirname(fileURLToPath(import.meta.url));

/**
 * The two that legitimately do not call `requireAdmin()`, and why.
 *
 * Neither can: one *is* the sign-in, and the other only tears down whatever session the
 * caller already has. Both are listed by name so that adding a third exception is a
 * deliberate edit to this file rather than a silent gap.
 */
const NOT_ADMIN_ONLY: Record<string, string> = {
  // Gated by assertAdminHost() plus per-IP and per-account rate limits — see the assertions
  // below. Requiring an admin here would make signing in impossible.
  adminSignInAction: 'the sign-in itself',
  // Destroys the caller's own cookie and session row and nothing else.
  adminSignOutAction: 'ends the caller’s own session',
};

type ActionModule = { file: string; source: string };

function actionModules(): ActionModule[] {
  return readdirSync(ADMIN_DIR)
    .filter((file) => file.endsWith('.ts') && !file.endsWith('.test.ts'))
    .map((file) => ({ file, source: readFileSync(join(ADMIN_DIR, file), 'utf8') }));
}

/** The body of an exported async function, up to the next top-level `export`. */
function exportedActions(source: string): { name: string; body: string }[] {
  const found: { name: string; body: string }[] = [];
  const signature = /^export async function (\w+)\(/gm;

  for (const match of source.matchAll(signature)) {
    const start = match.index + match[0].length;
    const next = source.slice(start).search(/^export /m);
    found.push({ name: match[1]!, body: next === -1 ? source.slice(start) : source.slice(start, start + next) });
  }

  return found;
}

describe('the operator action modules', () => {
  const modules = actionModules();

  it('are the ones this test thinks they are', () => {
    // If the files are renamed or split, the loop below would happily pass over an empty
    // list and report that everything is gated.
    expect(modules.map((m) => m.file).sort()).toEqual(['actions.ts', 'tenant-actions.ts']);
  });

  it.each(actionModules())('$file marks itself as server-only actions', ({ source }) => {
    expect(source.trimStart().startsWith("'use server'")).toBe(true);
  });
});

describe('requireAdmin gating', () => {
  const actions = actionModules().flatMap(({ file, source }) =>
    exportedActions(source).map((action) => ({ ...action, file })),
  );

  it('finds the actions to check', () => {
    const names = actions.map((action) => action.name);
    expect(names).toContain('deleteTenantAction');
    expect(names).toContain('setClientPasswordAction');
    expect(names.length).toBeGreaterThanOrEqual(6);
  });

  it.each(actions)('$file › $name', ({ name, body }) => {
    if (name in NOT_ADMIN_ONLY) {
      expect(body).not.toContain('requireAdmin(');
      return;
    }
    expect(body).toContain('requireAdmin()');
  });

  it('gates the sign-in on the platform host instead', () => {
    // The panel is not served on a client domain at all, so the login form must 404 there
    // rather than accept credentials — otherwise a client could probe for operator accounts
    // from their own domain.
    const signIn = exportedActions(
      readFileSync(join(ADMIN_DIR, 'actions.ts'), 'utf8'),
    ).find((action) => action.name === 'adminSignInAction')!;

    expect(signIn.body).toContain('assertAdminHost()');
    expect(signIn.body).toContain('consumeRateLimit(');
  });

  it('makes requireAdmin a host check as well as an identity check', () => {
    // Every gated action above inherits the host restriction from this one line; without it
    // each would have to remember `assertAdminHost()` for itself.
    const session = readFileSync(join(ADMIN_DIR, '../../lib/auth/admin-session.ts'), 'utf8');
    const requireAdmin = exportedActions(session).find((fn) => fn.name === 'requireAdmin')!;

    expect(requireAdmin.body).toContain('assertAdminHost()');
    expect(requireAdmin.body).toContain("redirect('/admin/login')");
  });
});
