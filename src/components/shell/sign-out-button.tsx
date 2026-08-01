import { LogOut } from 'lucide-react';
import { signOutAction } from '@/app/actions/auth';

/**
 * A form post rather than a link: signing out changes state, so it must not be reachable by
 * a GET that a prefetcher or an <img> tag could trigger.
 */
export function SignOutButton({ label }: { label: string }) {
  return (
    <form action={signOutAction}>
      <button
        type="submit"
        title={label}
        aria-label={label}
        className="border-line bg-raised text-dim hover:text-text flex items-center rounded-full border px-3 py-1.5 text-xs"
      >
        <LogOut size={13} aria-hidden />
      </button>
    </form>
  );
}
