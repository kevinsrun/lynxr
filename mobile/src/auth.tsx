import type { Session } from '@supabase/supabase-js';
import { createContext, useContext, useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { AppState } from 'react-native';
import { client } from './native-client';

const AuthContext = createContext<Session | null>(null);

export function AuthProvider({ children, loading }: { children: ReactNode; loading: ReactNode }) {
  const [session, setSession] = useState<Session | null | undefined>(undefined);

  useEffect(() => {
    if (!client) return;
    const auth = client.auth;
    const { data: { subscription } } = auth.onAuthStateChange((_event, next) => {
      setSession(next?.user.is_anonymous ? null : next);
    });
    const activate = (state: string | null | undefined) => {
      if (state === 'active') void auth.startAutoRefresh();
      else void auth.stopAutoRefresh();
    };
    const listener = AppState.addEventListener('change', activate);
    activate(AppState.currentState);
    return () => {
      subscription.unsubscribe();
      listener.remove();
      void auth.stopAutoRefresh();
    };
  }, []);

  if (session === undefined) return loading;
  return <AuthContext.Provider value={session}>{children}</AuthContext.Provider>;
}

export function useSession() {
  return useContext(AuthContext);
}
