'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { cn } from '@/lib/cn';

const ITEMS = [
  { href: '/admin/users', label: '사용자' },
  { href: '/admin/charts', label: '전체 차트' },
];

export function AdminSectionNav() {
  const pathname = usePathname();
  return (
    <nav className="mb-6 flex gap-1 border-b border-border" aria-label="관리자 메뉴">
      {ITEMS.map((item) => (
        <Link
          key={item.href}
          href={item.href}
          className={cn(
            'border-b-2 px-4 py-3 text-sm font-medium',
            pathname.startsWith(item.href)
              ? 'border-primary text-text-primary'
              : 'border-transparent text-text-secondary hover:text-text-primary',
          )}
        >
          {item.label}
        </Link>
      ))}
    </nav>
  );
}
