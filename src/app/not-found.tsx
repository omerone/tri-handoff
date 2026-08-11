import { getTranslations } from 'next-intl/server';
import { Notice } from '@/components/tenant-gate';
import { resolveTenant } from '@/lib/tenant/resolve';

/**
 * Doubles as the "this domain isn't a TRi client" page. The tenant lookup is request-cached,
 * so re-resolving here costs nothing and lets one 404 carry the right explanation: an
 * unknown host gets the domain message, a real tenant gets a plain page-not-found.
 */
export default async function NotFound() {
  const t = await getTranslations('error');
  const lookup = await resolveTenant();
  const body = lookup.state === 'unknown' ? t('unknownTenant') : t('notFound');

  return <Notice title="TRO" body={body} />;
}
