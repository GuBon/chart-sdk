'use client';

import { useEffect, useState } from 'react';

// 개발 환경에서만 MSW 워커를 기동한다. 워커 준비 전 fetch 가 실서버로 새는 것을
// 막기 위해, 준비될 때까지 children 렌더를 보류한다(프로덕션은 곧바로 통과).
const MOCKING =
  process.env.NODE_ENV === 'development' &&
  (process.env.NEXT_PUBLIC_E2E_MSW === 'true' ||
    (process.env.NEXT_PUBLIC_ENABLE_MSW !== 'false' && !process.env.NEXT_PUBLIC_API_BASE));

export function MockProvider({ children }: { children: React.ReactNode }) {
  const [ready, setReady] = useState(!MOCKING);

  useEffect(() => {
    if (ready) return;
    import('@/mocks/browser').then(({ worker }) =>
      worker.start({ onUnhandledRequest: 'bypass' }).then(() => setReady(true)),
    );
  }, [ready]);

  if (!ready) return null;
  return <>{children}</>;
}
