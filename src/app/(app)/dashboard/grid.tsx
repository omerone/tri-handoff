'use client';

import {
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
  type PointerEvent,
  type ReactNode,
} from 'react';
import { useTranslations } from 'next-intl';
import { GripVertical, Minus, Plus, RotateCcw } from 'lucide-react';
import {
  canResize,
  COLUMNS,
  DEFAULT_LAYOUT,
  isDefaultLayout,
  isWidgetId,
  moveWidget,
  NARROW_SPAN,
  reorderWidget,
  resizeWidget,
  WIDGETS,
  type LayoutItem,
  type WidgetId,
} from '@/lib/dashboard/layout';
import { saveDashboardLayoutAction } from './layout-actions';

/** How long after the last change the arrangement is written. */
const SAVE_DEBOUNCE_MS = 600;

/**
 * The dashboard grid the user arranges (SPEC §1.1).
 *
 * The widgets themselves are rendered on the server and handed in as nodes — this component
 * owns the arrangement and nothing else, so none of the trading data or the money formatting
 * crosses into the client bundle.
 *
 * Two ways to rearrange, both of them real:
 *
 *  - **Drag** the handle. The reorder happens live under the cursor rather than on drop, so
 *    the grid the user is looking at while dragging is the grid they will get.
 *  - **Keyboard.** The handle is a button; arrows move the card, and the two buttons beside
 *    it change its width. A drag-only implementation would put the one feature whose whole
 *    point is "the user builds their own layout" out of reach of anyone who cannot use a
 *    mouse, and the arrow keys cost about ten lines.
 *
 * The labels are translated here rather than passed in. They are the one thing on this
 * screen that has to be re-rendered as the user drags — "position 3 of 9" changes on every
 * move — so a formatter would have had to cross the server/client boundary, which is not a
 * thing a function can do.
 *
 * Rearranging is behind an explicit edit mode. Without it, a handle on every card is
 * permanent clutter on a screen whose stated design goal is "clarity over noise", and a
 * mis-grab while reading turns into an accidental save.
 */
export function DashboardGrid({
  initial,
  widgets,
  names,
  rtl,
}: {
  initial: readonly LayoutItem[];
  widgets: Readonly<Record<WidgetId, ReactNode>>;
  names: Readonly<Record<WidgetId, string>>;
  rtl: boolean;
}) {
  const t = useTranslations('layout');
  const [layout, setLayout] = useState<readonly LayoutItem[]>(initial);
  const [editing, setEditing] = useState(false);
  const [dragging, setDragging] = useState<WidgetId | null>(null);
  const [status, setStatus] = useState('');

  // Saved on a trailing debounce rather than per change: a keyboard user crossing the grid
  // presses the arrow six times, and that is one arrangement, not six.
  const saved = useRef(initial);
  const pending = useRef(initial);

  // `saved.current` advances only once the write comes back `ok`. Advancing it optimistically
  // meant a save that failed — offline, a 500, a session revoked out from under the tab — was
  // dropped with no retry and no sign, while the live region said it had been saved.
  const persist = (next: readonly LayoutItem[]) =>
    saveDashboardLayoutAction(next).then(
      (result) => {
        if (result === 'saved') saved.current = next;
        setStatus(t(result === 'saved' ? 'saved' : 'notSaved'));
      },
      () => setStatus(t('notSaved')),
    );

  useEffect(() => {
    pending.current = layout;
    if (layout === saved.current) return;
    const timer = setTimeout(() => void persist(layout), SAVE_DEBOUNCE_MS);
    return () => clearTimeout(timer);
    // `persist` closes over nothing that outlives the render it was made in.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [layout, t]);

  // Six hundred milliseconds is long enough to move a card and click a nav link, and the
  // cleanup above would then cancel the write on the way out — the user would come back to
  // an arrangement they watched themselves make and then lose. Flushing on unmount costs one
  // request that was going to happen anyway. It covers React unmounts, which is where the
  // in-app navigation goes; a closed tab inside the same window is still lost.
  useEffect(
    () => () => {
      if (pending.current !== saved.current) void saveDashboardLayoutAction(pending.current);
    },
    [],
  );

  const apply = (next: readonly LayoutItem[], announce?: string) => {
    // A move that changed nothing returns the same array by identity. Without this check the
    // arrow key held against the end of the grid re-saves an identical arrangement and
    // announces it, over and over.
    if (next === layout) return;
    setStatus(announce ?? '');
    setLayout(next);
  };

  const startDrag = (event: PointerEvent<HTMLElement>, id: WidgetId) => {
    if (event.pointerType === 'mouse' && event.button !== 0) return;
    event.preventDefault();
    // `preventDefault` suppresses the focus a mousedown would have given the handle, and the
    // hint tells the user they can then move the card with the arrow keys. Focus it by hand.
    event.currentTarget.focus();
    event.currentTarget.setPointerCapture(event.pointerId);
    setDragging(id);
  };

  const onDragMove = (event: PointerEvent<HTMLElement>) => {
    if (dragging === null) return;

    // No button held means this is a plain hover, not a drag.
    //
    // It reads like a belt-and-braces check and it is not. Reordering forwards makes React
    // re-insert the dragged wrapper, which detaches the handle inside it, and detaching the
    // capture target implicitly releases the capture — so the drag ends without any of the
    // events that would tell us. The card then keeps its dragging styles, and every later
    // `pointermove` over *another* card's handle reorders the card we still think is held.
    // Reproduced: dropping a KPI tile and then merely hovering a different handle sent the
    // dropped tile to the end of the grid, and saved it.
    if (event.buttons === 0) {
      endDrag(event);
      return;
    }

    // The pointer is captured by the handle, so the event target is useless for "what am I
    // over" — hit-testing the point is what actually answers it.
    const over = document
      .elementFromPoint(event.clientX, event.clientY)
      ?.closest<HTMLElement>('[data-widget]')?.dataset.widget;
    if (!isWidgetId(over) || over === dragging) return;

    setLayout((prev) => {
      const target = prev.findIndex((item) => item.id === over);
      return target === -1 ? prev : reorderWidget(prev, dragging, target);
    });
    setStatus((current) => (current === '' ? current : ''));
  };

  const endDrag = (event: PointerEvent<HTMLElement>) => {
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    setDragging(null);
  };

  const onHandleKey = (event: KeyboardEvent, id: WidgetId) => {
    // Left and right are mirrored in Hebrew: "previous" is the key pointing at the start of
    // the line, whichever side of the screen that is.
    const back = rtl ? 'ArrowRight' : 'ArrowLeft';
    const forward = rtl ? 'ArrowLeft' : 'ArrowRight';
    const delta =
      event.key === back || event.key === 'ArrowUp'
        ? -1
        : event.key === forward || event.key === 'ArrowDown'
          ? 1
          : 0;
    if (delta === 0) return;

    event.preventDefault();
    const next = moveWidget(layout, id, delta);
    // Say where it landed. The handle's own `aria-label` changes too, but whether a screen
    // reader re-reads the label of an element that already has focus is up to the screen
    // reader — the live region is the part that is not left to chance.
    apply(
      next,
      t('move', {
        name: names[id],
        position: next.findIndex((item) => item.id === id) + 1,
        total: next.length,
      }),
    );
  };

  const reset = () => {
    setEditing(false);
    setStatus('');
    setLayout(DEFAULT_LAYOUT);
  };

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-end gap-2">
        {editing ? (
          <>
            <p className="text-dim me-auto text-[11px]">
              {t('hint')}
              {/* The width caveat is only true — and the controls it describes only shown —
                  where the chosen span is actually read. It also wraps to four lines on a
                  phone, above the grid it is explaining. */}
              <span className="hidden lg:inline"> {t('hintWidth')}</span>
            </p>
            <button
              type="button"
              onClick={reset}
              disabled={isDefaultLayout(layout)}
              className="border-line text-dim hover:text-text inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1 text-xs disabled:opacity-40"
            >
              <RotateCcw size={13} aria-hidden />
              {t('reset')}
            </button>
          </>
        ) : null}
        <button
          type="button"
          onClick={() => setEditing((on) => !on)}
          aria-pressed={editing}
          className={`rounded-lg border px-2.5 py-1 text-xs ${
            editing
              ? 'bg-brand border-brand font-bold text-white'
              : 'border-line text-dim hover:text-text'
          }`}
        >
          {t(editing ? 'done' : 'edit')}
        </button>
      </div>

      <div className="grid grid-cols-12 gap-3">
        {layout.map((item, index) => {
          const narrow = NARROW_SPAN[WIDGETS[item.id].kind];
          return (
            <div
              key={item.id}
              data-widget={item.id}
              className={`tri-widget relative min-w-0 ${
                dragging === item.id ? 'ring-brand z-10 opacity-70 ring-2' : ''
              }`}
              style={
                {
                  '--tri-span': item.span,
                  '--tri-span-md': narrow.md,
                  '--tri-span-base': narrow.base,
                } as CSSProperties
              }
            >
              {widgets[item.id]}

              {editing ? (
                /*
                 * A scrim rather than a corner toolbar. Floating the controls over the card
                 * covered whatever was in that corner — on a KPI tile that is the label, so
                 * "Account balance" read as "Account balan". It also leaves the card's own
                 * links live, and a mis-aimed click while arranging navigates away and loses
                 * the arrangement. Covering the card says what mode this is and answers both.
                 */
                <div className="bg-surface/50 ring-brand/40 absolute inset-0 z-20 flex items-center justify-center rounded-[18px] ring-2">
                  <div className="border-line bg-raised flex items-center gap-0.5 rounded-lg border p-0.5 shadow-sm">
                    {/*
                     * Width is only read at the desktop breakpoint, so below it these
                     * controls changed the readout, marked the layout dirty and saved —
                     * while the card in front of the user did not move a pixel. An enabled
                     * control that does nothing is worse than no control.
                     */}
                    <div className="hidden items-center gap-0.5 lg:flex">
                      <ResizeButton
                        label={t('narrower', { name: names[item.id] })}
                        disabled={!canResize(item.span, -1)}
                        onClick={() => apply(resizeWidget(layout, item.id, -1))}
                      >
                        <Minus size={14} aria-hidden />
                      </ResizeButton>
                      <span dir="ltr" className="text-dim w-8 text-center text-[11px] tabular-nums">
                        {item.span}/{COLUMNS}
                      </span>
                      <ResizeButton
                        label={t('wider', { name: names[item.id] })}
                        disabled={!canResize(item.span, 1)}
                        onClick={() => apply(resizeWidget(layout, item.id, 1))}
                      >
                        <Plus size={14} aria-hidden />
                      </ResizeButton>
                    </div>
                    <button
                      type="button"
                      aria-label={t('move', {
                        name: names[item.id],
                        position: index + 1,
                        total: layout.length,
                      })}
                      onPointerDown={(event) => startDrag(event, item.id)}
                      onPointerMove={onDragMove}
                      onPointerUp={endDrag}
                      onPointerCancel={endDrag}
                      onLostPointerCapture={endDrag}
                      onKeyDown={(event) => onHandleKey(event, item.id)}
                      // `touch-none`, or a touch drag scrolls the page instead of moving the card.
                      className="text-dim hover:text-text cursor-grab touch-none rounded-md p-1.5 active:cursor-grabbing"
                    >
                      <GripVertical size={15} aria-hidden />
                    </button>
                  </div>
                </div>
              ) : null}
            </div>
          );
        })}
      </div>

      <p role="status" aria-live="polite" className="text-dim sr-only text-[11px]">
        {status}
      </p>
    </div>
  );
}

function ResizeButton({
  label,
  disabled,
  onClick,
  children,
}: {
  label: string;
  disabled: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      disabled={disabled}
      onClick={onClick}
      className="text-dim hover:text-text rounded-md p-1 disabled:opacity-30"
    >
      {children}
    </button>
  );
}
