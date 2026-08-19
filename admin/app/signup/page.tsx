'use client';

import Link from 'next/link';
import { useState } from 'react';
import type { FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { BarChart3 } from 'lucide-react';
import { apiErrorMessage, apiFieldError, authApi } from '@/lib/api';
import { Button } from '@/components/ui/Button';
import { Field } from '@/components/ui/Field';
import { Input } from '@/components/ui/Input';

const MIN_PASSWORD_LENGTH = 8;

export default function SignupPage() {
  const router = useRouter();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [passwordConfirm, setPasswordConfirm] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<unknown>(null);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      await authApi.signup({ username, password, passwordConfirm });
      router.replace('/login?registered=1');
    } catch (cause) {
      setError(cause);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="grid min-h-screen place-items-center bg-bg-base px-4 py-8">
      <form onSubmit={submit} className="w-full max-w-[420px] rounded-xl border border-border bg-bg-panel p-8 shadow-sm">
        <div className="mb-2 flex items-center gap-2 text-text-primary">
          <BarChart3 className="size-6 text-primary" aria-hidden />
          <h1 className="text-xl font-semibold">회원가입</h1>
        </div>
        <p className="mb-7 text-[13px] text-text-secondary">가입 후 로그인하면 개인 차트 공간이 생성됩니다.</p>
        <div className="flex flex-col gap-4">
          <Field label="아이디" htmlFor="username">
            <Input id="username" name="username" autoComplete="username" required autoFocus maxLength={100} value={username} onChange={(e) => setUsername(e.target.value)} />
            {apiFieldError(error, 'username') && <p className="text-xs text-danger">{apiFieldError(error, 'username')}</p>}
          </Field>
          <Field label={`비밀번호 (최소 ${MIN_PASSWORD_LENGTH}자)`} htmlFor="password">
            <Input id="password" name="password" type="password" autoComplete="new-password" required minLength={MIN_PASSWORD_LENGTH} value={password} onChange={(e) => setPassword(e.target.value)} />
            {apiFieldError(error, 'password') && <p className="text-xs text-danger">{apiFieldError(error, 'password')}</p>}
          </Field>
          <Field label="비밀번호 확인" htmlFor="passwordConfirm">
            <Input id="passwordConfirm" name="passwordConfirm" type="password" autoComplete="new-password" required value={passwordConfirm} onChange={(e) => setPasswordConfirm(e.target.value)} />
            {apiFieldError(error, 'passwordConfirm') && <p className="text-xs text-danger">{apiFieldError(error, 'passwordConfirm')}</p>}
          </Field>
          {error != null && !apiFieldError(error, 'username') && !apiFieldError(error, 'password') && !apiFieldError(error, 'passwordConfirm') && (
            <p className="text-[13px] text-danger" role="alert">{apiErrorMessage(error, '회원가입에 실패했습니다.')}</p>
          )}
          <Button type="submit" className="mt-1 w-full" disabled={submitting}>
            {submitting ? '가입 중…' : '회원가입'}
          </Button>
        </div>
        <p className="mt-5 text-center text-[13px] text-text-secondary">
          이미 계정이 있나요? <Link href="/login" className="font-medium text-primary hover:underline">로그인</Link>
        </p>
      </form>
    </main>
  );
}
