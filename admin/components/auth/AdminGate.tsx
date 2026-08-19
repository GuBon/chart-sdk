'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from './AuthProvider';

export function AdminGate({ children }: { children: React.ReactNode }) {
  const auth = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (auth.status === 'authenticated' && auth.user.role !== 'admin') router.replace('/');
  }, [auth, router]);

  if (auth.status !== 'authenticated' || auth.user.role !== 'admin') return null;
  return <>{children}</>;
}
