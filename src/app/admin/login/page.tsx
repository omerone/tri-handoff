import { redirect } from 'next/navigation';
import { Card } from '@/components/ui/card';
import { getAdmin } from '@/lib/auth/admin-session';
import { AdminLoginForm } from './admin-login-form';

export default async function AdminLoginPage() {
  if (await getAdmin()) redirect('/admin');

  return (
    <div className="mx-auto max-w-sm pt-16">
      <Card>
        <h1 className="pt-2 pb-3 text-lg font-extrabold">TRO — super admin</h1>
        <AdminLoginForm />
      </Card>
    </div>
  );
}
