'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import { BarChart3 } from 'lucide-react';
import { apiErrorMessage } from '@/lib/api';
import { safeLoginNext } from '@/lib/authRedirect';
import { useAuth } from '@/components/auth/AuthProvider';
import { Button } from '@/components/ui/Button';
import { Field } from '@/components/ui/Field';
import { Input } from '@/components/ui/Input';

export default function LoginPage() {
  const auth = useAuth();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // 이미 로그인된 방문이든 방금 로그인했든 이동 경로는 하나다 — 안전한 `next` 로 전체 로드해
  // 이전 세션에서 만들어진 클라이언트 상태를 버린다. (submit 과 effect 가 서로 다른 곳으로 경쟁하지 않는다.)
  useEffect(() => {
    if (auth.status !== 'authenticated') return;
    const candidate = new URLSearchParams(window.location.search).get('next');
    window.location.replace(safeLoginNext(candidate, window.location.origin));
  }, [auth.status]);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      await auth.login({ username, password });
    } catch (cause) {
      setError(apiErrorMessage(cause, '로그인에 실패했습니다.'));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="grid min-h-screen place-items-center bg-bg-base px-4">
      <form onSubmit={submit} className="w-full max-w-[400px] rounded-xl border border-border bg-bg-panel p-8 shadow-sm">
        <div className="mb-7 flex items-center gap-2 text-text-primary">
          <BarChart3 className="size-6 text-primary" aria-hidden />
          <h1 className="text-xl font-semibold">차트 솔루션 로그인</h1>
        </div>
        <div className="flex flex-col gap-4">
          <Field label="아이디" htmlFor="username">
            <Input id="username" name="username" autoComplete="username" required autoFocus value={username} onChange={(e) => setUsername(e.target.value)} />
          </Field>
          <Field label="비밀번호" htmlFor="password">
            <Input id="password" name="password" type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} />
          </Field>
          {error && <p className="text-[13px] text-danger" role="alert">{error}</p>}
          <Button type="submit" className="mt-1 w-full" disabled={submitting}>
            {submitting ? '로그인 중…' : '로그인'}
          </Button>
        </div>
        <p className="mt-5 text-center text-[13px] text-text-secondary">
          계정이 없나요? <Link href="/signup" className="font-medium text-primary hover:underline">회원가입</Link>
        </p>
      </form>
    </main>
  );
}
