import { LogOut } from 'lucide-react';
import { signOutAction } from '@/app/actions/auth';

/**
 * A form post rather than a link: signing out changes state, so it must not be reachable by
 * a GET that a prefetcher or an <img> tag could trigger.
 */
export function SignOutButton({ label, withText = false }: { label: string; withText?: boolean }) {
  return (
    <form action={signOutAction}>
      <button
        type="submit"
        title={label}
        aria-label={label}
        className={
          withText
            ? 'tri-tap border-line bg-raised text-dim hover:text-neg inline-flex items-center gap-2 rounded-[10px] border px-3 py-2 text-xs'
            : 'tri-tap border-line bg-raised text-dim hover:text-text flex items-center rounded-full border px-3 py-1.5 text-xs'
        }
      >
        <LogOut size={13} aria-hidden />
        {withText ? label : null}
      </button>
    </form>
  );
}
