'use client';

import { useEffect } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { useAuth } from './AuthProvider';

export function AuthGate({ children }: { children: React.ReactNode }) {
  const auth = useAuth();
  const pathname = usePathname();
  const router = useRouter();

  useEffect(() => {
    if (auth.status !== 'anonymous') return;
    router.replace(`/login?next=${encodeURIComponent(pathname || '/')}`);
  }, [auth.status, pathname, router]);

  if (auth.status === 'loading') {
    return <div className="grid min-h-screen place-items-center text-sm text-text-secondary">로그인 상태를 확인하는 중…</div>;
  }
  if (auth.status === 'error') {
    return (
      <div className="grid min-h-screen place-items-center px-4 text-center text-sm text-text-secondary">
        <div>
          <p>서버에 연결하지 못했습니다.</p>
          <button className="mt-3 rounded-md bg-primary px-4 py-2 text-primary-foreground" onClick={() => void auth.refresh()}>
            다시 시도
          </button>
        </div>
      </div>
    );
  }
  if (auth.status === 'anonymous') return null;
  return <>{children}</>;
}
