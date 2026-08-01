/**
 * Process-level background maintenance.
 *
 * The real work lives in `./instrumentation-node`, imported only under the Node runtime.
 * Next compiles this file for the Edge runtime as well (the middleware bundle), and anything
 * that reaches the database from there is a build error — so the database import has to sit
 * behind the runtime check, in a module the Edge build never has a reason to follow.
 */
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME !== 'nodejs') return;
  const { startMaintenanceSweep } = await import('./instrumentation-node');
  startMaintenanceSweep();
}
