'use client';

import { createContext, useContext, useMemo, useState, type ReactNode } from 'react';

/**
 * One open editor at a time, across a whole table.
 *
 * Each row used to own its own mode, so clicking the pencil on a second row left the first
 * one open too — two half-filled forms stacked down the screen, each with its own Save, and
 * no way to tell from a glance which one a keystroke was going into. On a table where every
 * row has the same nine fields that is a real way to save the wrong holding.
 *
 * The state is therefore one value for the table rather than one per row: which row is open,
 * and what it is open *for*. Opening anything closes whatever was open, which is what a
 * person means by clicking the second pencil.
 *
 * Deliberately not the URL, unlike the trades table's filters. A half-typed correction is not
 * a place someone wants to link to or hit back into, and putting it in the URL would make the
 * back button discard an edit in progress.
 */

/** What a row is open for. `price` and `close` are the holdings table's narrow editors. */
export type RowMode = 'edit' | 'price' | 'close';

type OpenRow = {
  /** Null when every row is collapsed. */
  openId: string | null;
  mode: RowMode | null;
  open: (id: string, mode: RowMode) => void;
  closeRow: () => void;
};

const Context = createContext<OpenRow | null>(null);

export function OpenRowProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<{ id: string; mode: RowMode } | null>(null);

  const value = useMemo<OpenRow>(
    () => ({
      openId: state?.id ?? null,
      mode: state?.mode ?? null,
      // Setting rather than toggling: the second click is always "open this one", and the
      // previous row collapses because there is only one slot to be in.
      open: (id, mode) => setState({ id, mode }),
      closeRow: () => setState(null),
    }),
    [state],
  );

  return <Context.Provider value={value}>{children}</Context.Provider>;
}

/**
 * A row's own view of the shared slot.
 *
 * Returns `mode` only when *this* row holds it, so a row can read its state without knowing
 * that any other row exists. Outside a provider it degrades to per-row state, which keeps the
 * rows usable if one is ever rendered somewhere that has not been wrapped — a missing
 * provider should not mean an editor that cannot open.
 */
export function useRowMode(id: string): {
  mode: RowMode | null;
  open: (mode: RowMode) => void;
  close: () => void;
} {
  const shared = useContext(Context);
  const [fallback, setFallback] = useState<RowMode | null>(null);

  if (shared === null) {
    return {
      mode: fallback,
      open: (mode) => setFallback(mode),
      close: () => setFallback(null),
    };
  }

  return {
    mode: shared.openId === id ? shared.mode : null,
    open: (mode) => shared.open(id, mode),
    close: shared.closeRow,
  };
}
