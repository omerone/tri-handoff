/**
 * The secrets manager, as the Edge runtime sees it: nothing.
 *
 * Next compiles `instrumentation.ts` for the Edge runtime as well as for Node, and everything
 * it can reach comes with it — including `./instrumentation-node`, which reaches `env.ts`,
 * which reaches the real manager and its `dotenv` and AWS SDK. Those are built on `fs`,
 * `path` and `os`, none of which exist on Edge, so the whole build fails on a module that can
 * never execute there. `serverExternalPackages` does not help: it applies to the Node server
 * bundle only.
 *
 * `next.config.ts` therefore points the Edge build at this file instead. Nothing on Edge can
 * reach these functions — the only Edge code in the app is `middleware.ts`, which imports one
 * pure string helper and never touches the environment — so returning nothing is not a
 * degraded mode, it is the honest description of a code path that does not run.
 */

export async function loadSecrets(): Promise<Record<string, string>> {
  return {};
}

export function clearSecretsCache(): void {}

export function getCacheTTL(): number {
  return 0;
}

export function isAwsSecretsManagerEnabled(): boolean {
  return false;
}
