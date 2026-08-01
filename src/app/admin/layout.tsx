import { assertAdminHost } from '@/lib/auth/admin-session';

/**
 * Operator panel. English-only on purpose: the he/en requirement in SPEC §4 is about the
 * client-facing product, and this screen has exactly one audience. P4 can revisit if the
 * platform is ever operated by someone else.
 */
export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  await assertAdminHost();

  return (
    <div dir="ltr" className="min-h-screen">
      <div className="mx-auto max-w-4xl px-4 py-8">{children}</div>
    </div>
  );
}
