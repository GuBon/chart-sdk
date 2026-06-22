'use client';

import { useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Search } from 'lucide-react';
import { Input } from '@/components/ui/Input';

// AppBar 차트 검색 — URL ?q 에 반영(S1 목록이 읽어 필터). useSearchParams 라 Suspense 안에서 렌더.
export function SearchBox() {
  const router = useRouter();
  const sp = useSearchParams();
  const [q, setQ] = useState(sp.get('q') ?? '');

  return (
    <Input
      icon={<Search className="size-3.5" aria-hidden />}
      wrapperClassName="h-[34px] w-60"
      placeholder="차트 검색 (이름·설명)"
      aria-label="차트 검색"
      value={q}
      onChange={(e) => {
        const v = e.target.value;
        setQ(v);
        router.replace(v ? `/?q=${encodeURIComponent(v)}` : '/');
      }}
    />
  );
}
