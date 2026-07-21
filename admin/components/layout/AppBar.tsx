'use client';

import { Suspense } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { BarChart3, Plus } from 'lucide-react';
import { cn } from '@/lib/cn';
import { Button } from '@/components/ui/Button';
import { SearchBox } from './SearchBox';

// Figma App Bar(183:17) + GNB 내비(282:390). 모든 화면이 공유하는 전역 상단바.
// 검색 상태/제출은 S1 화면에서 연결한다(여기서는 골격만).
const NAV = [
  { href: '/datasources', label: '데이터소스', activePrefixes: ['/datasources', '/data'] },
  { href: '/tokens', label: '토큰 관리', activePrefixes: ['/tokens'] },
];

export function AppBar() {
  const pathname = usePathname();

  return (
    <header className="flex items-center gap-2.5 border-b border-border bg-bg-panel px-6 py-3.5">
      <Link href="/" className="flex items-center gap-2">
        <BarChart3 className="size-5 text-text-primary" aria-hidden />
        <span className="text-lg font-semibold text-text-primary">차트 솔루션</span>
      </Link>

      <div className="flex-1" />

      <Suspense fallback={<div className="h-[34px] w-60" />}>
        <SearchBox />
      </Suspense>

      <nav className="flex items-center gap-5 text-[13px]">
        {NAV.map(({ href, label, activePrefixes }) => {
          const active = activePrefixes.some((prefix) => pathname.startsWith(prefix));
          return (
            <Link
              key={href}
              href={href}
              className={cn('transition-colors hover:text-text-primary', active ? 'text-text-primary' : 'text-text-secondary')}
            >
              {label}
            </Link>
          );
        })}
      </nav>

      <Link href="/charts/new">
        <Button icon={<Plus className="size-4" aria-hidden />}>새 차트</Button>
      </Link>
    </header>
  );
}
