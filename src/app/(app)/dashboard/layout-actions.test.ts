import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_LAYOUT, WIDGET_IDS } from '@/lib/dashboard/layout';
import { makeTenantContext } from '@/lib/db/context';

/**
 * The action is the only door the browser has into the stored layout, and its argument is a
 * value a user can post by hand.
 *
 * `normalizeLayout` is tested on its own, but a test of a sanitiser proves nothing about a
 * caller that forgot to call it — so these assert what actually reaches the database.
 *
 * Storing the default as `null` is the half nobody sees: the reset e2e test watches the order
 * come back, which it would do just as happily if the default had been written out as data.
 * The difference only surfaces the day the default changes, on exactly the users who reset.
 */

const ctx = makeTenantContext('tenant-1', 'user-1');

const getSession = vi.fn();
vi.mock('@/lib/auth/session', () => ({ getSession: () => getSession() }));

const saveDashboardLayout = vi.fn();
vi.mock('@/lib/db', () => ({
  saveDashboardLayout: (...args: unknown[]) => saveDashboardLayout(...args),
}));

const { saveDashboardLayoutAction } = await import('./layout-actions');

beforeEach(() => {
  getSession.mockReset();
  saveDashboardLayout.mockReset();
  getSession.mockResolvedValue({ ctx });
});

describe('saveDashboardLayoutAction', () => {
  it('writes nothing, and says so, when nobody is signed in', async () => {
    // A server action is reachable by anyone who can find its id; sitting in a file next to a
    // page behind the login wall protects nothing. And the caller has to be able to tell the
    // difference — a session revoked while the tab sat open used to report a save that never
    // happened, which is the one case where the user needed to know.
    getSession.mockResolvedValue(null);
    await expect(saveDashboardLayoutAction([{ id: 'equity', span: 12 }])).resolves.toBe(
      'unauthenticated',
    );
    expect(saveDashboardLayout).not.toHaveBeenCalled();
  });

  it('rebuilds the argument instead of storing what the browser sent', async () => {
    await saveDashboardLayoutAction([
      { id: 'equity', span: 999 },
      { id: 'a-widget-we-removed', span: 4 },
      'not an entry',
    ]);

    const written = saveDashboardLayout.mock.calls[0]?.[1] as { id: string; span: number }[];
    expect(written[0]).toEqual({ id: 'equity', span: 12 });
    expect(written.map((item) => item.id).sort()).toEqual([...WIDGET_IDS].sort());
  });

  it('stores the default arrangement as null, so a reset is a reset', async () => {
    // Not "as the default". The row has to read as never-been-arranged, or a user who reset
    // stays pinned to whatever the default happened to be the day they pressed the button.
    await saveDashboardLayoutAction([...DEFAULT_LAYOUT]);
    expect(saveDashboardLayout).toHaveBeenCalledWith(ctx, null);
    await expect(saveDashboardLayoutAction([...DEFAULT_LAYOUT])).resolves.toBe('saved');
  });

  it('scopes the write to the caller, never to an id from the argument', async () => {
    await saveDashboardLayoutAction([{ id: 'recent', span: 4 }]);
    expect(saveDashboardLayout.mock.calls[0]?.[0]).toBe(ctx);
  });
});
