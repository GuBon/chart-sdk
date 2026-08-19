import type { ReactNode } from 'react';
import { AppBar } from '@/components/layout/AppBar';
import { AuthGate } from '@/components/auth/AuthGate';

// 콘솔 셸: 전역 GNB + 가운데 정렬 컨테이너 (S1·S5·S7·홈).
export default function ConsoleLayout({ children }: { children: ReactNode }) {
  return (
    <AuthGate>
      <AppBar />
      <main className="mx-auto max-w-[1440px] px-6 py-6">{children}</main>
    </AuthGate>
  );
}
