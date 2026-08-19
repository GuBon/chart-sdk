import type { ReactNode } from 'react';
import { AuthGate } from '@/components/auth/AuthGate';

// 에디터 셸: 전역 GNB 없이 풀폭(자체 Top Bar 사용). S2 차트 편집.
export default function EditorLayout({ children }: { children: ReactNode }) {
  return <AuthGate><div className="flex h-screen flex-col">{children}</div></AuthGate>;
}
