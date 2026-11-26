import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { api } from './api';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const refresh = useCallback(async () => {
    try { const account = await api('/auth/me'); setUser(account); setError(''); }
    catch (e) {
      if (e.status === 401) { setUser(null); setError(''); }
      else setError(e.message);
    } finally { setLoading(false); }
  }, []);
  useEffect(() => { refresh(); }, [refresh]);
  useEffect(() => {
    if (!user) return;
    const onFocus = () => refresh();
    const timer = setInterval(refresh, 60000);
    window.addEventListener('focus', onFocus);
    return () => { clearInterval(timer); window.removeEventListener('focus', onFocus); };
  }, [user?.id_cuenta, refresh]);

  async function signIn(usuario, password) {
    await api('/auth/login', { method: 'POST', body: JSON.stringify({ usuario, password }) });
    // La cookie HttpOnly conserva la sesión; el JWT de la respuesta no se almacena.
    const account = await api('/auth/me');
    setUser(account); setError('');
  }
  async function signOut() {
    try { await api('/auth/logout', { method: 'POST' }); }
    catch (e) { if (e.status !== 401) throw e; }
    setUser(null); setError('');
  }
  const expire = useCallback(() => setUser(null), []);
  return <AuthContext.Provider value={{ user, loading, error, refresh, signIn, signOut, expire }}>{children}</AuthContext.Provider>;
}

export const useAuth = () => useContext(AuthContext);
