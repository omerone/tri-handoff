'use client';

import { memo, useEffect, useRef } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  BarChart3,
  CalendarDays,
  LayoutDashboard,
  Settings,
  Table,
  TrendingUp,
  Wallet,
  type LucideIcon,
} from 'lucide-react';

export type NavItem = { key: string; href: string; label: string };

const ICONS: Record<string, LucideIcon> = {
  dash: LayoutDashboard,
  analytics: BarChart3,
  trades: Table,
  calendar: CalendarDays,
  finance: Wallet,
  long: TrendingUp,
  settings: Settings,
};

export const MainNav = memo(function MainNav({ items }: { items: NavItem[] }) {
  const pathname = usePathname();
  const strip = useRef<HTMLElement>(null);

  // The strip scrolls sideways on a phone, and the seven items do not fit. Landing on
  // Settings with the tab off-screen to the left reads as "the page I am on is not in the
  // nav", so the current one is brought into view. `nearest` keeps the common case — an item
  // already visible — completely still.
  useEffect(() => {
    strip.current?.querySelector('[aria-current="page"]')?.scrollIntoView({
      block: 'nearest',
      inline: 'nearest',
    });
  }, [pathname]);

  return (
    <nav
      ref={strip}
      className="mx-auto flex max-w-6xl gap-1 overflow-x-auto px-2 pb-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
    >
      {items.map((item) => {
        const Icon = ICONS[item.key] ?? LayoutDashboard;
        const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
        return (
          <Link
            key={item.key}
            href={item.href}
            aria-current={active ? 'page' : undefined}
            className={`tri-tap flex min-h-11 items-center gap-1.5 rounded-[10px] px-3 py-1.5 text-[13px] whitespace-nowrap md:min-h-0 ${
              active ? 'bg-raised text-text font-bold' : 'text-dim font-medium'
            }`}
          >
            <Icon size={14} aria-hidden />
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
});
