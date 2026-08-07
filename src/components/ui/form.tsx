'use client';

import { useFormStatus } from 'react-dom';
import type { InputHTMLAttributes, ReactNode } from 'react';

export function Field({
  label,
  name,
  type = 'text',
  ...rest
}: { label: string; name: string } & InputHTMLAttributes<HTMLInputElement>) {
  const id = `field-${name}`;
  return (
    <label htmlFor={id} className="flex flex-col gap-1.5">
      <span className="text-dim text-xs font-semibold">{label}</span>
      <input
        id={id}
        name={name}
        type={type}
        className="border-line bg-raised text-text placeholder:text-dim/60 rounded-[10px] border px-3 py-2.5 text-sm"
        {...rest}
      />
    </label>
  );
}

/**
 * `className` is additive, and exists for one reason: on a phone this button belongs on a row
 * of its own at full width, and only the form around it knows that. Every caller that says
 * nothing keeps the shape it always had.
 *
 * `min-h-11` is 44px, the size a finger actually hits. It is a floor rather than a height, so
 * a button whose label wraps grows instead of clipping.
 */
export function SubmitButton({
  children,
  className = '',
}: {
  children: ReactNode;
  className?: string;
}) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      aria-busy={pending}
      className={`bg-brand inline-flex min-h-11 items-center justify-center rounded-[10px] px-4 py-2.5 text-sm font-bold text-white transition-opacity disabled:opacity-60 sm:min-h-9 ${className}`}
    >
      {children}
    </button>
  );
}

export function FormMessage({ error, notice }: { error?: string; notice?: string }) {
  if (!error && !notice) return null;
  return (
    <p
      role="status"
      aria-live="polite"
      className={`rounded-[10px] px-3 py-2 text-xs leading-relaxed ${
        error ? 'bg-neg/10 text-neg' : 'bg-pos/10 text-pos'
      }`}
    >
      {error ?? notice}
    </p>
  );
}
