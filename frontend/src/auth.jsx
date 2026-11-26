import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { api } from './api';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const sessionVersion = useRef(0);
  const refresh = useCallback(async () => {
    const version = sessionVersion.current;
    try {
      const account = await api('/auth/me');
      if (version === sessionVersion.current) { setUser(account); setError(''); }
    }
    catch (e) {
      if (version === sessionVersion.current) {
        if (e.status === 401) { setUser(null); setError(''); }
        else setError(e.message);
      }
    } finally { if (version === sessionVersion.current) setLoading(false); }
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
    const version = ++sessionVersion.current;
    await api('/auth/login', { method: 'POST', body: JSON.stringify({ usuario, password }) });
    // La cookie HttpOnly conserva la sesión; el JWT de la respuesta no se almacena.
    const account = await api('/auth/me');
    if (version === sessionVersion.current) { setUser(account); setError(''); setNotice(''); }
  }
  async function signOut() {
    sessionVersion.current++;
    try { await api('/auth/logout', { method: 'POST' }); }
    catch (e) { if (e.status !== 401) throw e; }
    setUser(null); setError(''); setNotice('Sesión cerrada correctamente.');
  }
  const expire = useCallback(message => {
    sessionVersion.current++;
    setUser(null); setError('');
    setNotice(previous => message || previous || 'Tu sesión terminó. Inicia sesión para continuar.');
  }, []);
  return <AuthContext.Provider value={{ user, loading, error, notice, refresh, signIn, signOut, expire }}>{children}</AuthContext.Provider>;
}

export const useAuth = () => useContext(AuthContext);
