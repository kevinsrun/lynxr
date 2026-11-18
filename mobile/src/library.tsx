import { randomUUID } from 'expo-crypto';
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { AppState } from 'react-native';
import { creatorApi } from './creator-api';
import type { CreatorApi } from './creator-api';
import { entries, hasWork } from './contracts';
import type { Allowance, CreatorData } from './contracts';
import { client } from './native-client';

type Library = {
  api: CreatorApi;
  data?: CreatorData;
  allowance?: Allowance;
  error: string | null;
  refresh: () => Promise<void>;
};

const LibraryContext = createContext<Library | null>(null);

export function LibraryProvider({ userId, children }: { userId: string; children: ReactNode }) {
  const api = useMemo(() => creatorApi(client!, userId, randomUUID), [userId]);
  const [data, setData] = useState<CreatorData>();
  const [allowance, setAllowance] = useState<Allowance>();
  const [error, setError] = useState<string | null>(null);
  const [foreground, setForeground] = useState(AppState.currentState == null || AppState.currentState === 'active');
  const revision = useRef(0);
  const inFlight = useRef(false);

  const refresh = useCallback(async () => {
    const requestId = ++revision.current;
    inFlight.current = true;
    const [row, room] = await Promise.allSettled([api.read(), api.allowance()]);
    if (requestId !== revision.current) return;
    inFlight.current = false;
    if (row.status === 'fulfilled') setData(row.value?.data ?? {});
    if (room.status === 'fulfilled') setAllowance(room.value);
    else setAllowance(undefined);
    setError(row.status === 'rejected'
      ? 'Couldn’t refresh your library. Check your connection and try again.'
      : null);
  }, [api]);

  useEffect(() => {
    const state = AppState.addEventListener('change', (next) => setForeground(next === 'active'));
    return () => {
      state.remove();
      revision.current++;
      inFlight.current = false;
    };
  }, []);

  useEffect(() => {
    if (foreground) void refresh();
  }, [foreground, refresh]);

  const jobs = entries(data).filter(hasWork);
  const interval = jobs.some(({ status }) => status === 'queued' || status === 'running') ? 8000
    : jobs.length ? 30000 : null;
  useEffect(() => {
    if (!foreground || !interval) return;
    const timer = setInterval(() => {
      if (!inFlight.current) void refresh();
    }, interval);
    return () => clearInterval(timer);
  }, [foreground, interval, refresh]);

  return <LibraryContext.Provider value={{ api, data, allowance, error, refresh }}>
    {children}
  </LibraryContext.Provider>;
}

export function useLibrary(): Library {
  const state = useContext(LibraryContext);
  if (!state) throw new Error('Library is available only in a signed-in route');
  return state;
}
