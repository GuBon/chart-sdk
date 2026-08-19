'use client';

import { useEffect, useState } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { Search } from 'lucide-react';
import { Input } from '@/components/ui/Input';

// 차트 목록 검색 — 현재 목록 범위를 유지하면서 URL ?q 에 반영한다. 검색어는 차트 이름·설명·소유자에 걸린다.
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
      placeholder="차트 검색 (차트 이름, 설명, 소유자)"
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
        router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false });
      }}
    />
  );
}
