'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { BarChart3, LogOut, Plus } from 'lucide-react';
import { cn } from '@/lib/cn';
import { Button } from '@/components/ui/Button';
import { useAuth } from '@/components/auth/AuthProvider';

// Figma App Bar(183:17) + GNB 내비(282:390). 모든 화면이 공유하는 전역 상단바.
const NAV = [
  { href: '/datasources', label: '데이터소스', activePrefixes: ['/datasources'] },
];

export function AppBar() {
  const pathname = usePathname();
  const auth = useAuth();
  const nav = auth.user?.role === 'admin'
    ? [...NAV, { href: '/admin/users', label: '관리자', activePrefixes: ['/admin'] }]
    : NAV;

  async function logout() {
    try {
      await auth.logout();
    } finally {
      // JS 메모리의 캐시·민감 상태까지 확실히 폐기한다.
      window.location.replace('/login');
    }
  }

  return (
    <header className="flex items-center gap-2.5 border-b border-border bg-bg-panel px-6 py-3.5">
      <Link href="/" className="flex items-center gap-2">
        <BarChart3 className="size-5 text-text-primary" aria-hidden />
        <span className="text-lg font-semibold text-text-primary">차트 솔루션</span>
      </Link>

      <div className="flex-1" />

      <nav className="flex items-center gap-5 text-[13px]">
        {nav.map(({ href, label, activePrefixes }) => {
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

      <div className="ml-2 flex items-center gap-2 border-l border-border pl-4">
        <span className="max-w-40 truncate text-xs text-text-secondary" title={auth.user?.username}>
          {auth.user?.displayName}
        </span>
        <Button variant="ghost" size="sm" aria-label="로그아웃" title="로그아웃" icon={<LogOut className="size-4" aria-hidden />} onClick={() => void logout()} />
      </div>

      <Link href="/charts/new">
        <Button icon={<Plus className="size-4" aria-hidden />}>새 차트</Button>
      </Link>
    </header>
  );
}
