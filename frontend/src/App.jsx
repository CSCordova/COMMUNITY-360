import { useEffect, useState } from 'react';
import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { MotionLink as Link, MotionProvider } from './motion';
import { useAuth } from './auth';
import Dashboard from './Dashboard';
import { Brand, Icon, Loading } from './ui';

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

function Protected({ children }) {
  const { user, loading, error, refresh } = useAuth();
  const location = useLocation();
  if (loading) return <Loading />;
  if (error && !user) return <main className="center-state"><Brand /><p role="alert">{error}</p><button className="primary-button" onClick={refresh}>Reintentar</button></main>;
  return user ? children : <Navigate to="/login" state={{ from: location.pathname }} replace />;
}

function Login() {
  const { user, loading, error: sessionError, notice, signIn } = useAuth();
  const location = useLocation();
  const allowed = ['/dashboard', '/dashboard/resumen', '/dashboard/explorar', '/dashboard/historico', '/dashboard/cuenta', '/dashboard/territorio', '/dashboard/participacion'];
  const requested = location.state?.from || new URLSearchParams(location.search).get('next');
  const destination = allowed.includes(requested) ? requested : '/dashboard/resumen';
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [visible, setVisible] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  if (loading) return <Loading />;
  if (user) return <Navigate to={destination} replace />;

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
      <div className="story-copy"><p className="login-system-label">COMMUNITY INTELLIGENCE</p><h1>La actividad<br/>tiene una historia.<br/><span>Hazla visible.</span></h1><p className="story-description">Conversaciones, personas y señales de participación en un solo espacio de análisis.</p><CommunityArt /></div>
      <div className="story-footer"><Icon name="shield"/><span>La confianza comienza con el cuidado de los datos.</span></div>
    </section>
    <section className="access-panel" aria-labelledby="login-title">
      <div className="access-top"><span>Acceso seguro</span><span className="access-tag"><Icon name="lock"/>Acceso privado</span></div>
      <div className="form-wrap"><div className="form-emblem"><Icon name="lock" width="25" height="25"/></div><p className="eyebrow">Portal de acceso</p><h2 id="login-title">Entra a tu<br/>centro de análisis.</h2><p className="form-description">Inicia sesión con tu cuenta autorizada para acceder a tu espacio de trabajo.</p>
        <form onSubmit={submit} aria-label="Inicio de sesión">
          {notice && <p className="login-notice" role="status">{notice}</p>}
          <label htmlFor="usuario">Usuario</label><div className="input-wrap"><Icon name="user"/><input id="usuario" name="usuario" autoComplete="username" placeholder="Tu nombre de usuario" value={username} onChange={e => setUsername(e.target.value)} minLength="4" maxLength="32" required disabled={busy}/></div>
          <label htmlFor="password">Contraseña</label><div className="input-wrap"><Icon name="lock"/><input id="password" name="password" type={visible ? 'text' : 'password'} autoComplete="current-password" placeholder="Escribe tu contraseña" value={password} onChange={e => setPassword(e.target.value)} maxLength="1024" required disabled={busy}/><button type="button" className="visibility-button" aria-label={visible ? 'Ocultar contraseña' : 'Mostrar contraseña'} aria-pressed={visible} onClick={() => setVisible(!visible)}><Icon name={visible ? "eyeOff" : "eye"}/></button></div>
          {(error || sessionError) && <p className="error-message" role="alert">{error || sessionError}</p>}
          <button className="primary-button" type="submit" disabled={busy}>{busy ? 'Verificando acceso…' : 'Iniciar sesión'}</button>
        </form>
        <div className="access-help"><p>¿Aún no tienes cuenta o necesitas recuperar tu acceso?</p><Link to="/acceso" state={{ from: destination }} className="account-access-link">Cómo obtener acceso<Icon name="arrow" width="16" height="16"/></Link></div>
      </div>
      <footer className="access-footer"><span><Icon name="shield" width="14" height="14"/>Argon2</span><span><Icon name="lock" width="14" height="14"/>Sesión HttpOnly</span><span><Icon name="user" width="14" height="14"/>Acceso autorizado</span></footer>
    </section>
  </main>;
}

function AccessInfo() {
  const location = useLocation();
  return <main className="access-info-page"><Link className="access-info-brand" to="/login"><Brand/></Link><div className="access-info-content"><span className="access-info-icon"><Icon name="shield" width="28" height="28"/></span><p className="eyebrow">ACCESO AUTORIZADO</p><h1>Tu entrada al <br/><em>observatorio.</em></h1><p>COMMUNITY 360 es un espacio privado. Las cuentas las crea y habilita la persona que administra la comunidad.</p><ol className="access-steps"><li><span>01</span><div><h2>Solicita tu cuenta</h2><p>Contacta directamente al administrador e indícale que necesitas entrar al panel de análisis.</p></div></li><li><span>02</span><div><h2>Recibe tus credenciales</h2><p>El administrador te entregará un usuario y una contraseña cuando autorice tu acceso.</p></div></li><li><span>03</span><div><h2>Haz tuyo el espacio</h2><p>Inicia sesión y cambia tu contraseña en Mi cuenta. Usa entre 8 y 14 caracteres.</p></div></li></ol><div className="access-recovery"><Icon name="lock"/><p><strong>¿Ya tenías una cuenta?</strong> Si olvidaste la contraseña o tu cuenta está deshabilitada, solicita ayuda al administrador para recuperar el acceso.</p></div><Link className="primary-button" to="/login" state={location.state}>Volver a iniciar sesión<Icon name="arrow" width="17" height="17"/></Link></div><span className="access-info-footnote">El acceso al panel se habilita por cuenta. No hay registro público automático.</span></main>;
}

function NotFound() {
  return <main className="center-state"><Brand/><p className="eyebrow">PÁGINA NO DISPONIBLE</p><h1>Volvamos al observatorio.</h1><p>Este enlace no corresponde a una vista disponible.</p><Link className="primary-button" to="/dashboard/resumen">Ir al resumen</Link></main>;
}

export default function App() {
  const location = useLocation();
  useEffect(() => {
    const title = ({ resumen: 'Resumen', explorar: 'Explorar actividad', historico: 'Histórico', territorio: 'Territorio', participacion: 'Participación', cuenta: 'Mi cuenta', acceso: 'Obtener acceso', login: 'Acceso' })[location.pathname.split('/').filter(Boolean).at(-1)] || 'Observatorio';
    document.title = `COMMUNITY 360 · ${title}`;
  }, [location.pathname]);
  return <MotionProvider><Routes><Route path="/login" element={<Login/>}/><Route path="/acceso" element={<AccessInfo/>}/><Route path="/dashboard/*" element={<Protected><Dashboard/></Protected>}/><Route path="/" element={<Navigate to="/dashboard/resumen" replace/>}/><Route path="*" element={<NotFound/>}/></Routes></MotionProvider>;
}
