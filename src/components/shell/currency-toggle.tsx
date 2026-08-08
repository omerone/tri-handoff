'use client';

import { useEffect, useId, useRef, useState, useTransition } from 'react';
import { setDisplayCurrencyAction } from '@/app/actions/preferences';
import { CURRENCY_SYMBOL, SUPPORTED_CURRENCIES, type Currency } from '@/lib/money/currency';

/**
 * The reading currency, in the header beside the theme.
 *
 * It lived on the Settings page next to the language and the theme, which is where a
 * preference belongs when it is set once. This one is not: a trader whose account is in
 * dollars and whose life is in shekels flips between the two while looking at the same
 * screen, and a control you have to leave the screen to reach — and leave it again to come
 * back — is one nobody uses twice. The theme toggle is in the header for the same reason and
 * this now sits next to it.
 *
 * The button *is* the current answer: it shows the symbol being read in, so the header states
 * which currency the figures below are in without spending a word on a label.
 *
 * A menu rather than a cycle-through. Four currencies means three presses to get back to
 * where you started, and two of the intermediate states redraw every figure on the page.
 */
export function CurrencyToggle({ current, label }: { current: Currency; label: string }) {
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const menuId = useId();
  const box = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;

    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setOpen(false);
        trigger.current?.focus();
      }
    };
    // A press anywhere else closes it. `pointerdown` rather than `click` so it closes on the
    // way down, before whatever was pressed underneath does its own thing.
    const onOutside = (event: PointerEvent) => {
      if (!box.current?.contains(event.target as Node)) setOpen(false);
    };

    document.addEventListener('keydown', onKey);
    document.addEventListener('pointerdown', onOutside);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('pointerdown', onOutside);
    };
  }, [open]);

  const choose = (next: Currency) => {
    setOpen(false);
    trigger.current?.focus();
    if (next === current) return;
    startTransition(() => setDisplayCurrencyAction(next));
  };

  return (
    <div ref={box} className="relative">
      <button
        ref={trigger}
        type="button"
        disabled={pending}
        onClick={() => setOpen((was) => !was)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        aria-label={label}
        // Only while it is shut. The hint answers "what is this button", and once the menu is
        // open the menu answers it better — leaving both up puts a tooltip over the choices.
        data-tip={open ? undefined : label}
        /* Matched to the theme toggle beside it, down to the tap target: these two read as a
           pair and a half-pixel difference in a round button is visible. */
        className="tri-tap border-line bg-raised text-text flex h-[34px] w-[34px] items-center justify-center rounded-full border text-[15px] leading-none font-semibold disabled:opacity-60"
      >
        <span aria-hidden>{CURRENCY_SYMBOL[current]}</span>
      </button>

      {open ? (
        <div
          id={menuId}
          role="menu"
          aria-label={label}
          /* Anchored to the inline end so it opens *into* the page rather than off the edge —
             the left in Hebrew, the right in English, without either being named. */
          className="border-line bg-surface absolute end-0 z-50 mt-1.5 flex min-w-[8.5rem] flex-col gap-0.5 rounded-[12px] border p-1 shadow-2xl"
        >
          {SUPPORTED_CURRENCIES.map((code) => {
            const active = code === current;
            return (
              <button
                key={code}
                type="button"
                role="menuitemradio"
                aria-checked={active}
                onClick={() => choose(code)}
                className={`flex items-center justify-between gap-3 rounded-[8px] px-2.5 py-1.5 text-[13px] ${
                  active
                    ? 'bg-brand text-on-brand font-bold'
                    : 'text-dim hover:bg-raised hover:text-text font-medium'
                }`}
              >
                <span>{code}</span>
                <span className="tri-num text-[15px]">{CURRENCY_SYMBOL[code]}</span>
              </button>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}
