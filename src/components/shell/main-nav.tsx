'use client';

import { memo, useEffect, useRef } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  BarChart3,
  CalendarDays,
  LayoutDashboard,
  ListChecks,
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
  goals: ListChecks,
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
      /*
       * Full width on a phone, sharing the row with the range picker from `md` up. `min-w-0`
       * is what makes the sharing work: without a minimum of zero a flex child refuses to
       * shrink below its content, so the tabs would push the dates off the screen instead of
       * scrolling — which is the one thing this strip is built to do.
       *
       * `py-1` is for the focus ring. `overflow-x: auto` makes the *vertical* axis clip too —
       * the spec computes `visible` to `auto` when the other axis is not visible — and this
       * strip was exactly as tall as its tabs, so a ring drawn 2px outside a tab with a 2px
       * offset lost 4px off the top and 4px off the bottom. What was left read as a frame
       * belonging to something other than the button it was on. The wrapper gives the four
       * pixels back below, so the header is the same height it was.
       */
      className="flex w-full min-w-0 gap-1 overflow-x-auto py-1 [scrollbar-width:none] md:w-auto md:flex-1 [&::-webkit-scrollbar]:hidden"
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
