import { createContext, useContext, useState, useEffect, ReactNode, useCallback } from 'react';
import { ConstellixCredentials } from '../utils/constellixApi';
import { getConstellixCredentials } from '../utils/userSettings';

interface CredentialsState {
  credentials: ConstellixCredentials | null;
  loading: boolean;
  refresh: () => Promise<void>;
}

const CredentialsContext = createContext<CredentialsState>({
  credentials: null,
  loading: true,
  refresh: async () => {},
});

export function CredentialsProvider({ children }: { children: ReactNode }) {
  const [credentials, setCredentials] = useState<ConstellixCredentials | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const creds = await getConstellixCredentials();
      setCredentials(creds);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  return (
    <CredentialsContext.Provider value={{ credentials, loading, refresh }}>
      {children}
    </CredentialsContext.Provider>
  );
}

export function useCredentials(): CredentialsState {
  return useContext(CredentialsContext);
}
