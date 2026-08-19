import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { MockProvider } from '@/components/MockProvider';
import { AuthProvider } from '@/components/auth/AuthProvider';
import './globals.css';

export const metadata: Metadata = {
  title: '차트 솔루션',
  description: '사내 임베드 차트 관리 콘솔',
};

// 루트는 공통 셸(폰트·목킹)만. GNB·풀폭 여부는 route group 레이아웃이 결정한다.
export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="ko">
      <body>
        <MockProvider><AuthProvider>{children}</AuthProvider></MockProvider>
      </body>
    </html>
  );
}
