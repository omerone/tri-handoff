'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { requireAdmin } from '@/lib/auth/admin-session';
import { hashPassword, MIN_PASSWORD_LENGTH } from '@/lib/crypto/password';
import { deleteTenant, getTenantDetail, setPasswordHash, updateTenant } from '@/lib/db/unscoped';

export type TenantActionState = { error?: string; notice?: string };

const updateSchema = z.object({
  tenantId: z.string().min(1),
  name: z.string().trim().min(1).max(120),
  domain: z.string().trim().min(1).max(253),
  notes: z.string().trim().max(2000).optional(),
});

export async function updateTenantAction(
  _prev: TenantActionState,
  formData: FormData,
): Promise<TenantActionState> {
  await requireAdmin();

  const parsed = updateSchema.safeParse({
    tenantId: formData.get('tenantId'),
    name: formData.get('name'),
    domain: formData.get('domain'),
    notes: formData.get('notes') ?? undefined,
  });
  if (!parsed.success) return { error: 'Check the name and domain.' };

  const result = await updateTenant(parsed.data.tenantId, {
    name: parsed.data.name,
    domain: parsed.data.domain,
    notes: parsed.data.notes ?? null,
  });

  if (!result.ok) {
    const reasons = {
      'invalid-domain': 'That domain is not a valid hostname.',
      'domain-taken': 'That domain is already assigned to another client.',
      'reserved-domain': 'That is the platform domain and cannot be given to a client.',
      'not-found': 'That client no longer exists.',
    } as const;
    return { error: reasons[result.reason] };
  }

  revalidatePath('/admin');
  revalidatePath(`/admin/${parsed.data.tenantId}`);
  return { notice: 'Saved. If the domain changed, point its DNS here — a certificate is issued on the first request.' };
}

const passwordSchema = z.object({
  tenantId: z.string().min(1),
  password: z.string().min(MIN_PASSWORD_LENGTH),
});

/**
 * Sets a client's password on their behalf.
 *
 * The operator needs this because the self-service reset depends on the client being able to
 * receive email, and "my reset link never arrives" is precisely the situation where they call
 * the operator. It is a genuine privilege — hence the operator-only route, and the fact that
 * the new password is shown once and never stored in the clear.
 */
export async function setClientPasswordAction(
  _prev: TenantActionState,
  formData: FormData,
): Promise<TenantActionState> {
  await requireAdmin();

  const parsed = passwordSchema.safeParse({
    tenantId: formData.get('tenantId'),
    password: formData.get('password'),
  });
  if (!parsed.success) {
    return { error: `The password must be at least ${MIN_PASSWORD_LENGTH} characters.` };
  }

  const tenant = await getTenantDetail(parsed.data.tenantId);
  if (!tenant?.user) return { error: 'That client has no user account.' };

  // Look the user up through the tenant rather than trusting an id from the form.
  const { findUserForLogin } = await import('@/lib/db/unscoped');
  const user = await findUserForLogin(parsed.data.tenantId, tenant.user.email);
  if (!user) return { error: 'That client has no user account.' };

  await setPasswordHash(user.id, await hashPassword(parsed.data.password));

  revalidatePath(`/admin/${parsed.data.tenantId}`);
  return { notice: 'Password set. Send it to the client over a channel they already trust, and have them change it.' };
}

const deleteSchema = z.object({
  tenantId: z.string().min(1),
  domain: z.string().min(1),
  confirm: z.string().min(1),
});

/**
 * Deletes a client and all their data.
 *
 * Requires the operator to type the domain back. It cascades through every trade, finance
 * entry and position the client has, and there is no undo — a misplaced click on a table row
 * should not be able to do that.
 */
export async function deleteTenantAction(
  _prev: TenantActionState,
  formData: FormData,
): Promise<TenantActionState> {
  await requireAdmin();

  const parsed = deleteSchema.safeParse({
    tenantId: formData.get('tenantId'),
    domain: formData.get('domain'),
    confirm: formData.get('confirm'),
  });
  if (!parsed.success) return { error: 'Type the domain to confirm.' };

  if (parsed.data.confirm.trim().toLowerCase() !== parsed.data.domain.trim().toLowerCase()) {
    return { error: 'That does not match the domain.' };
  }

  await deleteTenant(parsed.data.tenantId);
  revalidatePath('/admin');
  redirect('/admin');
}
