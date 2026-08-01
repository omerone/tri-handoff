import { getTranslations } from 'next-intl/server';
import { Card } from '@/components/ui/card';

/**
 * P0 placeholder. The KPI row, R-strip, equity curve and recent-trades panel land in M1.4,
 * once there are synced trades to put in them; until then the honest state is "no data".
 */
export default async function DashboardPage() {
  const t = await getTranslations();

  return (
    <div className="flex flex-col gap-4">
      <Card title={t('nav.dash')}>
        <p className="text-dim py-6 text-center text-sm">{t('dash.empty')}</p>
      </Card>
    </div>
  );
}
