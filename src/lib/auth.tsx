import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { fetchMe, loginAccount, logoutAccount, registerAccount, type AuthUser } from './api';
import { clearProfileCache } from './storage';

type AuthContextValue = {
  user: AuthUser | null;
  loading: boolean;
  refresh: () => Promise<void>;
  login: (email: string, password: string) => Promise<AuthUser>;
  register: (name: string, email: string, password: string) => Promise<AuthUser>;
  logout: () => Promise<void>;
  setUser: (user: AuthUser | null) => void;
};

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(true);

  async function refresh() {
    try {
      const data = await fetchMe();
      setUser(data.user);
    } catch {
      setUser(null);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void refresh();
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({
      user,
      loading,
      refresh,
      setUser,
      async login(email, password) {
        clearProfileCache();
        const data = await loginAccount({ email, password });
        setUser(data.user);
        return data.user;
      },
      async register(name, email, password) {
        clearProfileCache();
        const data = await registerAccount({ name, email, password });
        setUser(data.user);
        return data.user;
      },
      async logout() {
        clearProfileCache();
        await logoutAccount();
        setUser(null);
      },
    }),
    [loading, user],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider');
  return ctx;
}
