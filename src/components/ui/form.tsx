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

export function SubmitButton({ children }: { children: ReactNode }) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      aria-busy={pending}
      className="bg-brand rounded-[10px] px-4 py-2.5 text-sm font-bold text-white transition-opacity disabled:opacity-60"
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
