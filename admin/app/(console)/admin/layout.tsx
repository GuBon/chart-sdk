import type { ReactNode } from 'react';
import { AdminGate } from '@/components/auth/AdminGate';

export default function AdminLayout({ children }: { children: ReactNode }) {
  return <AdminGate>{children}</AdminGate>;
}
