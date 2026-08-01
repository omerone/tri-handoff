'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { burnPasswordVerification } from '@/lib/auth/anti-timing';
import {
  assertAdminHost,
  endAdminSession,
  requireAdmin,
  startAdminSession,
} from '@/lib/auth/admin-session';
import { clientIp, limitKey, LIMITS } from '@/lib/auth/limits';
import { hashPassword, MIN_PASSWORD_LENGTH, verifyPassword } from '@/lib/crypto/password';
import {
  consumeRateLimit,
  findSuperAdminByEmail,
  provisionTenant,
  setTenantStatus,
} from '@/lib/db';

export type AdminFormState = { error?: string; notice?: string };

// ---------------------------------------------------------------------------
// Operator sign-in
// ---------------------------------------------------------------------------

export async function adminSignInAction(
  _prev: AdminFormState,
  formData: FormData,
): Promise<AdminFormState> {
  await assertAdminHost();

  const email = String(formData.get('email') ?? '')
    .trim()
    .toLowerCase();
  const password = String(formData.get('password') ?? '');

  const ip = await clientIp();
  const verdict = await consumeRateLimit(
    limitKey('admin-login', ip),
    LIMITS.loginPerIp.limit,
    LIMITS.loginPerIp.windowMs,
  );
  if (!verdict.allowed) return { error: 'Too many attempts. Try again later.' };

  const admin = await findSuperAdminByEmail(email);
  if (!admin) {
    await burnPasswordVerification(password);
    return { error: 'Wrong email or password' };
  }
  if (!(await verifyPassword(admin.passwordHash, password))) {
    return { error: 'Wrong email or password' };
  }

  await startAdminSession(admin.id);
  redirect('/admin');
}

export async function adminSignOutAction(): Promise<void> {
  await endAdminSession();
  redirect('/admin/login');
}

// ---------------------------------------------------------------------------
// Provisioning
// ---------------------------------------------------------------------------

const createSchema = z.object({
  name: z.string().trim().min(1),
  domain: z.string().trim().min(1),
  email: z.string().trim().toLowerCase().email(),
  password: z.string().min(MIN_PASSWORD_LENGTH),
});

export async function createTenantAction(
  _prev: AdminFormState,
  formData: FormData,
): Promise<AdminFormState> {
  await requireAdmin();

  const parsed = createSchema.safeParse({
    name: formData.get('name'),
    domain: formData.get('domain'),
    email: formData.get('email'),
    password: formData.get('password'),
  });
  if (!parsed.success) {
    return { error: `Check the form — the password must be at least ${MIN_PASSWORD_LENGTH} characters.` };
  }

  const result = await provisionTenant({
    name: parsed.data.name,
    domain: parsed.data.domain,
    email: parsed.data.email,
    passwordHash: await hashPassword(parsed.data.password),
  });

  if (!result.ok) {
    return {
      error:
        result.reason === 'domain-taken'
          ? 'That domain is already assigned to a client.'
          : 'That domain is not a valid hostname.',
    };
  }

  revalidatePath('/admin');
  return { notice: `Created ${result.domain}. Point its DNS at this server and it will get a certificate on first request.` };
}

export async function setTenantStatusAction(formData: FormData): Promise<void> {
  await requireAdmin();

  const tenantId = String(formData.get('tenantId') ?? '');
  const status = String(formData.get('status') ?? '');
  if (!tenantId || (status !== 'active' && status !== 'suspended')) return;

  await setTenantStatus(tenantId, status);
  revalidatePath('/admin');
}
