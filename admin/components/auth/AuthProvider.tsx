'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { ApiError, authApi } from '@/lib/api';
import { AUTH_INVALID_EVENT, currentAuthGeneration } from '@/lib/api/client';
import type { AuthUser } from '@/lib/api';

type AuthState =
  | { status: 'loading'; user: null }
  | { status: 'error'; user: null }
  | { status: 'anonymous'; user: null }
  | { status: 'authenticated'; user: AuthUser };

type AuthContextValue = AuthState & {
  login(input: { username: string; password: string }): Promise<AuthUser>;
  logout(): Promise<void>;
  refresh(): Promise<void>;
};

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<AuthState>({ status: 'loading', user: null });

  const refresh = useCallback(async () => {
    // 대기 중 로그인·로그아웃이 끝나면(세대 변경) 이 조회는 이전 세션의 답이므로 상태에 반영하지 않는다.
    const generation = currentAuthGeneration();
    setState({ status: 'loading', user: null });
    try {
      const user = await authApi.me();
      if (generation !== currentAuthGeneration()) return;
      setState({ status: 'authenticated', user });
    } catch (error) {
      if (generation !== currentAuthGeneration()) return;
      if (error instanceof ApiError && error.status === 401) {
        setState({ status: 'anonymous', user: null });
        return;
      }
      // 서버 일시 장애를 로그아웃으로 오인시키지 않는다.
      setState({ status: 'error', user: null });
    }
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);
  useEffect(() => {
    const invalidate = () => setState({ status: 'anonymous', user: null });
    window.addEventListener(AUTH_INVALID_EVENT, invalidate);
    return () => window.removeEventListener(AUTH_INVALID_EVENT, invalidate);
  }, []);

  const login = useCallback(async (input: { username: string; password: string }) => {
    const user = await authApi.login(input);
    setState({ status: 'authenticated', user });
    return user;
  }, []);

  const logout = useCallback(async () => {
    await authApi.logout();
    setState({ status: 'anonymous', user: null });
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({ ...state, login, logout, refresh }),
    [state, login, logout, refresh],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth must be used inside AuthProvider');
  return context;
}
