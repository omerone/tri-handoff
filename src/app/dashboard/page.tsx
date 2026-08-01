import { getTranslations } from 'next-intl/server';

export default async function DashboardPage() {
  const t = await getTranslations('app');
  return (
    <main className="mx-auto max-w-6xl px-4 py-6">
      <h1 className="text-lg font-extrabold">{t('name')}</h1>
      <p className="text-dim text-sm">{t('tagline')}</p>
    </main>
  );
}
