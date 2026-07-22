'use client';

import { useEffect, useState } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { Search } from 'lucide-react';
import { Input } from '@/components/ui/Input';

// AppBar 차트 검색 — URL ?q 에 반영(S1 목록이 읽어 필터). useSearchParams 라 Suspense 안에서 렌더.
export function SearchBox() {
  const router = useRouter();
  const pathname = usePathname();
  const sp = useSearchParams();
  const urlQuery = sp.get('q') ?? '';
  const [q, setQ] = useState(urlQuery);

  useEffect(() => setQ(urlQuery), [urlQuery]);

  return (
    <Input
      id="chart-search"
      name="chartSearch"
      icon={<Search className="size-3.5" aria-hidden />}
      wrapperClassName="h-[34px] w-60"
      placeholder="차트 검색 (이름·설명)"
      aria-label="차트 검색"
      value={q}
      onChange={(e) => {
        const v = e.target.value;
        setQ(v);
        const next = new URLSearchParams(sp.toString());
        if (v) next.set('q', v);
        else next.delete('q');
        next.delete('page');
        next.delete('view');
        next.delete('datasourceId');
        const query = next.toString();
        const targetPath = /^\/data\/[^/]+\/?$/.test(pathname) ? pathname : '/';
        router.replace(query ? `${targetPath}?${query}` : targetPath);
      }}
    />
  );
}
