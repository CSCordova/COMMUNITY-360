import { useEffect, useState } from 'react';
import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { api } from './api';
import { useAuth } from './auth';

function Icon({ name, ...props }) {
  const paths = {
    lock: <><rect x="5" y="10" width="14" height="11" rx="3"/><path d="M8 10V7a4 4 0 0 1 8 0v3M12 14v3"/></>,
    user: <><circle cx="12" cy="8" r="4"/><path d="M4 21v-2a8 8 0 0 1 16 0v2"/></>,
    eye: <><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z"/><circle cx="12" cy="12" r="3"/></>,
    shield: <><path d="m12 3 8 3v6c0 5-8 9-8 9s-8-4-8-9V6Z"/><path d="m8 12 3 3 5-6"/></>,
    logout: <><path d="M9 4H4v16h5M13 8l4 4-4 4M8 12h13"/></>,
    chart: <><path d="M4 3v18h17M9 16v-5M14 16V6M19 16v-8"/></>,
  };
  return <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" {...props}>{paths[name]}</svg>;
}

function Brand({ light = false }) {
  return <div className={`brand ${light ? 'brand-light' : ''}`}><span className="brand-symbol" aria-hidden="true">C<span /></span><span>COMMUNITY <strong>360</strong></span></div>;
}

function CommunityArt() {
  return <div className="community-art" aria-hidden="true">
    <svg viewBox="0 0 480 280" fill="none">
      <circle cx="240" cy="140" r="112" className="orbit"/><ellipse cx="240" cy="140" rx="186" ry="75" className="orbit" transform="rotate(-25 240 140)"/>
      <path d="m105 80 135 60 134-54M89 200l151-60 118 84M240 140l-8-113" className="connection"/>
      <circle cx="240" cy="140" r="44" fill="#22494a" stroke="#7ed5b8" strokeOpacity=".4"/>
      <circle cx="240" cy="129" r="10" stroke="#b5f1dc" strokeWidth="2"/><path d="M221 155c0-17 38-17 38 0" stroke="#b5f1dc" strokeWidth="2"/>
      {[[105,80],[374,86],[89,200],[358,224],[232,27]].map(([x,y], i) => <g key={i}><circle cx={x} cy={y} r={i === 0 ? 15 : 9} fill={i === 0 ? '#d6ed84' : '#8dcebc'}/><circle cx={x} cy={y} r={i === 0 ? 23 : 15} stroke="#a9e3d0" strokeOpacity=".18"/></g>)}
    </svg>
    <span className="art-label art-label-one">Personas</span><span className="art-label art-label-two">Conexiones</span><span className="art-label art-label-three">Comunidad</span>
  </div>;
}

function Loading() {
  return <main className="center-state"><Brand /><p role="status">Comprobando tu sesión…</p></main>;
}

function Protected({ children }) {
  const { user, loading, error, refresh } = useAuth();
  if (loading) return <Loading />;
  if (error) return <main className="center-state"><Brand /><p role="alert">{error}</p><button className="primary-button" onClick={refresh}>Reintentar</button></main>;
  return user ? children : <Navigate to="/login" replace />;
}

function Login() {
  const { user, loading, error: sessionError, signIn } = useAuth();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [visible, setVisible] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  if (loading) return <Loading />;
  if (user) return <Navigate to="/dashboard" replace />;

  async function submit(event) {
    event.preventDefault();
    if (busy) return;
    setError(''); setBusy(true);
    try { await signIn(username.trim(), password); setPassword(''); }
    catch (e) { setError(e.status === 401 ? 'Usuario o contraseña incorrectos.' : e.message); setPassword(''); }
    finally { setBusy(false); }
  }

  return <main className="login-layout">
    <section className="story-panel">
      <Brand light />
      <div className="story-copy"><p className="eyebrow">CONECTAR. COMPRENDER. CRECER.</p><h1>Una comunidad.<br />Muchas historias.<br /><span>Una nueva mirada.</span></h1><p className="story-description">Un espacio para comprender lo que nos une y descubrir hacia dónde podemos crecer.</p><CommunityArt /></div>
      <div className="story-footer"><Icon name="shield"/><span>La confianza comienza con el cuidado de los datos.</span></div>
    </section>
    <section className="access-panel" aria-labelledby="login-title">
      <div className="access-top"><span>ESPACIO DE ANÁLISIS</span><span className="access-tag"><Icon name="lock"/>Acceso privado</span></div>
      <div className="form-wrap"><div className="form-emblem"><Icon name="lock" width="25" height="25"/></div><p className="eyebrow">BIENVENIDO A COMMUNITY 360</p><h2 id="login-title">Tu comunidad,<br />desde otra perspectiva.</h2><p className="form-description">Inicia sesión con tu cuenta autorizada para acceder a tu espacio de trabajo.</p>
        <form onSubmit={submit} aria-label="Inicio de sesión">
          <label htmlFor="usuario">Usuario</label><div className="input-wrap"><Icon name="user"/><input id="usuario" name="usuario" autoComplete="username" placeholder="Tu nombre de usuario" value={username} onChange={e => setUsername(e.target.value)} minLength="4" maxLength="32" required disabled={busy}/></div>
          <label htmlFor="password">Contraseña</label><div className="input-wrap"><Icon name="lock"/><input id="password" name="password" type={visible ? 'text' : 'password'} autoComplete="current-password" placeholder="Escribe tu contraseña" value={password} onChange={e => setPassword(e.target.value)} maxLength="1024" required disabled={busy}/><button type="button" className="visibility-button" aria-label={visible ? 'Ocultar contraseña' : 'Mostrar contraseña'} aria-pressed={visible} onClick={() => setVisible(!visible)}><Icon name="eye"/></button></div>
          {(error || sessionError) && <p className="error-message" role="alert">{error || sessionError}</p>}
          <button className="primary-button" type="submit" disabled={busy}>{busy ? 'Verificando acceso…' : 'Iniciar sesión'}</button>
        </form>
        <p className="access-help">¿Necesitas acceso o ayuda con tu cuenta?<br /><span>Comunícate con la persona que administra la comunidad.</span></p>
      </div>
      <footer className="access-footer"><span>COMMUNITY 360</span><span>Análisis con propósito.</span></footer>
    </section>
  </main>;
}

function Dashboard() {
  const { user, signOut, expire } = useAuth();
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let active = true;
    api('/api/dashboard').then(value => { if (active) { setData(value); setError(''); } })
      .catch(e => { if (active) { if (e.status === 401) expire(); else setError(e.message); } });
    return () => { active = false; };
  }, [attempt]);
  async function logout() {
    setBusy(true); setError('');
    try { await signOut(); } catch (e) { setError(`No se pudo cerrar la sesión. ${e.message}`); }
    finally { setBusy(false); }
  }
  return <div className="dashboard-layout"><header className="dashboard-header"><Brand/><div className="account-menu"><span><Icon name="user"/>{user.usuario}</span><button className="secondary-button" onClick={logout} disabled={busy}><Icon name="logout"/>{busy ? 'Cerrando…' : 'Cerrar sesión'}</button></div></header>
    <main className="dashboard-main"><p className="eyebrow">TU ESPACIO DE TRABAJO</p><h1>Hola, {user.usuario}.</h1><p className="dashboard-description">Bienvenido a COMMUNITY 360.</p>
      {error && <div className="dashboard-error"><p role="alert">{error}</p><button className="secondary-button" onClick={() => setAttempt(attempt + 1)}>Reintentar consulta</button></div>}
      {!data && !error ? <p role="status">Cargando tu espacio…</p> : data && <section className="welcome-card"><div className="welcome-icon"><Icon name="chart" width="32" height="32"/></div><p className="eyebrow">UNA MIRADA COMPARTIDA</p><h2>El próximo capítulo<br />de tu comunidad.</h2><p>Tu acceso está listo. Las herramientas para explorar la actividad y conocer mejor a la comunidad estarán disponibles próximamente.</p><span className="verified-note"><Icon name="shield"/>Sesión verificada</span></section>}
      <p className="dashboard-footnote">Este espacio está reservado para cuentas autorizadas. Al terminar, cierra tu sesión.</p>
    </main></div>;
}

export default function App() {
  const location = useLocation();
  useEffect(() => { document.title = `COMMUNITY 360 · ${location.pathname === '/dashboard' ? 'Mi espacio' : 'Acceso'}`; }, [location.pathname]);
  return <Routes><Route path="/login" element={<Login/>}/><Route path="/dashboard" element={<Protected><Dashboard/></Protected>}/><Route path="*" element={<Navigate to="/login" replace/>}/></Routes>;
}
