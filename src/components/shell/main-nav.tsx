'use client';

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

export function MainNav({ items }: { items: NavItem[] }) {
  const pathname = usePathname();

  return (
    <nav className="mx-auto flex max-w-6xl gap-1 overflow-x-auto px-2 pb-2">
      {items.map((item) => {
        const Icon = ICONS[item.key] ?? LayoutDashboard;
        const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
        return (
          <Link
            key={item.key}
            href={item.href}
            aria-current={active ? 'page' : undefined}
            className={`flex items-center gap-1.5 rounded-[10px] px-3 py-1.5 text-[13px] whitespace-nowrap ${
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
}
