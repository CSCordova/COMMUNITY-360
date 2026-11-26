import { useCallback, useEffect, useRef, useState } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { MotionLink as Link, MotionNavLink as NavLink, usePageMotion } from './motion';
import { api } from './api';
import { useAuth } from './auth';
import { useRealtime } from './useRealtime';
import ActivityPanel from './ActivityPanel';
import AccountPanel from './AccountPanel';
import DemographyPanel from './DemographyPanel';
import TerritoryPanel from './TerritoryPanel';
import ParticipationPanel from './ParticipationPanel';
import CommandPalette from './CommandPalette';
import { LiveTicker, LiveEventFeed, useEventLog } from './LiveEvents';
import { Brand, Icon } from './ui';

const views = {
  resumen: { label: 'Resumen', icon: 'overview', title: 'Actividad de la comunidad', description: 'Identifica dónde, cuándo y sobre qué se está conversando.' },
  explorar: { label: 'Explorar actividad', icon: 'explore', title: 'Explorar actividad', description: 'Cruza fechas, canales y temas para entender la participación.' },
  historico: { label: 'Histórico', icon: 'history', title: 'Histórico de la comunidad', description: 'Consulta el perfil y la participación del padrón de origen.' },
  territorio: { label: 'Territorio', icon: 'territory', title: 'Territorio de la comunidad', description: 'Mapa de ciudades con datos autorizados y ubicaciones agrupadas.' },
  participacion: { label: 'Participación', icon: 'participation', title: 'Seguimiento de participación', description: 'Consulta los estados del padrón y el tiempo registrado sin actividad.' },
  cuenta: { label: 'Mi cuenta', icon: 'user', title: 'Mi cuenta', description: 'Consulta tu acceso y actualiza tu contraseña.' },
};

const searchViews = {
  ...views,
  calor: { label: 'Mapa de calor', icon: 'chart', description: 'Actividad por día de la semana y hora UTC.', to: '/dashboard/explorar', state: { exploreTab: 'horarios' } },
  registros: { label: 'Buscar interacciones', icon: 'search', description: 'Buscar y consultar el contenido de los registros.', to: '/dashboard/explorar', state: { exploreTab: 'registros' } },
};

export default function Dashboard() {
  const location = useLocation();
  const view = location.pathname.split('/')[2] || 'resumen';
  const current = views[view];
  const { user, signOut, expire, error: sessionError, refresh } = useAuth();
  const live = useRealtime(expire);
  const events = useEventLog(live.event);
  const [collapsed, setCollapsed] = useState(false);
  const [mobile, setMobile] = useState(() => Boolean(window.matchMedia?.('(max-width: 600px)').matches));
  useEffect(() => {
    const query = window.matchMedia?.('(max-width: 600px)');
    const update = () => setMobile(Boolean(query?.matches));
    query?.addEventListener?.('change', update);
    return () => query?.removeEventListener?.('change', update);
  }, []);
  const [mobileMore, setMobileMore] = useState(false);
  const [confirmLogout, setConfirmLogout] = useState(false);
  const moreSheet = useRef(null);
  const moreTrigger = useRef(null);
  useEffect(() => {
    if (!mobileMore) return;
    const before = document.activeElement;
    const sheet = moreSheet.current;
    sheet?.querySelector('button')?.focus();
    function keys(event) {
      if (event.key === 'Escape') { event.preventDefault(); setMobileMore(false); }
      if (event.key !== 'Tab') return;
      const controls = [...sheet.querySelectorAll('button:not(:disabled),a[href]')];
      const first = controls[0], last = controls.at(-1);
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    }
    sheet?.addEventListener('keydown', keys);
    return () => { sheet?.removeEventListener('keydown', keys); if (sheet?.contains(document.activeElement)) before?.focus?.({preventScroll:true}); };
  }, [mobileMore]);
  useEffect(() => { if (!mobile) setMobileMore(false); }, [mobile]);
  const logoutDialog = useRef(null);
  const lastFocus = useRef(null);
  useEffect(() => {
    if (confirmLogout) {
      lastFocus.current = document.activeElement;
      if (logoutDialog.current?.showModal) logoutDialog.current.showModal();
      else logoutDialog.current?.setAttribute('open', '');
      logoutDialog.current?.querySelector('button')?.focus();
    } else {
      if (logoutDialog.current?.close) logoutDialog.current.close();
      else logoutDialog.current?.removeAttribute('open');
    }
  }, [confirmLogout]);
  const [history, setHistory] = useState(null);
  const [historyError, setHistoryError] = useState('');
  const [historyBusy, setHistoryBusy] = useState(false);
  const [historyDate, setHistoryDate] = useState(null);
  const [logoutError, setLogoutError] = useState('');
  const [busy, setBusy] = useState(false);
  const heading = useRef(null);
  const content = useRef(null);
  usePageMotion(view, content);
  const request = useRef(0);
  const loadHistory = useCallback(async () => {
    const id = ++request.current;
    setHistoryBusy(true);
    try {
      const data = await api('/api/analitica/usuarios');
      if (request.current === id) { setHistory(data); setHistoryError(''); setHistoryDate(new Date()); }
    } catch (error) {
      if (request.current === id) { if (error.status === 401) expire(); else setHistoryError(error.message); }
    } finally { if (request.current === id) setHistoryBusy(false); }
  }, [expire]);
  useEffect(() => { loadHistory(); return () => { request.current++; }; }, [loadHistory]);
  useEffect(() => {
    setMobileMore(false);
    heading.current?.focus({ preventScroll: true });
    window.scrollTo?.({ top: 0, left: 0, behavior: 'instant' });
  }, [view]);
  function logout() { setConfirmLogout(true); }
  async function confirmedLogout() {
    setConfirmLogout(false);
    setBusy(true); setLogoutError('');
    try { await signOut(); } catch (error) { setLogoutError(`No se pudo cerrar la sesión. ${error.message}`); }
    finally { setBusy(false); }
  }
  if (!current) return <Navigate to="/dashboard/resumen" replace/>;
  if (location.pathname === '/dashboard' || location.pathname === '/dashboard/') return <Navigate to="/dashboard/resumen" replace/>;
  return <div className={`dashboard-layout workspace obsidian ${collapsed ? 'rail-collapsed' : ''}`}><a className="skip-link" href="#workspace-content">Ir al contenido</a>
    <aside className="workspace-rail" hidden={mobile}><Link to="/dashboard/resumen" className="rail-brand" aria-label="COMMUNITY 360, ir al resumen"><Brand/></Link><p className="rail-caption">Comunidad y participación</p><nav className="workspace-navigation desktop-navigation" aria-label="Secciones del dashboard">{Object.entries(views).map(([id, item]) => <NavLink key={id} aria-label={item.label} title={item.label} to={`/dashboard/${id}`} className={({ isActive }) => `workspace-nav-item ${isActive ? 'is-active' : ''}`}>{({ isActive }) => <>{isActive && <i className="nav-current" aria-hidden="true"/>}<Icon name={item.icon}/><span>{item.label}</span></>}</NavLink>)}</nav>
      <div className="rail-bottom"><button className="rail-collapse" type="button" aria-label={collapsed ? "Expandir menú lateral" : "Plegar menú lateral"} aria-expanded={!collapsed} onClick={() => setCollapsed(value => !value)}><Icon name="collapse"/><span>Plegar menú</span></button><div className="rail-session"><span className="account-monogram" aria-hidden="true">{user.usuario.slice(0, 2).toUpperCase()}</span><div><strong>{user.usuario}</strong><span>Sesión verificada</span></div></div><button className="rail-logout" aria-label={busy ? "Cerrando sesión" : "Cerrar sesión"} type="button" onClick={logout} disabled={busy}><Icon name="logout"/>{busy ? 'Cerrando…' : 'Cerrar sesión'}</button></div>
    </aside>
    <div className="workspace-body"><header className="workspace-top"><div className="telemetry-context"><span className={`status-dot ${live.status === "conectado" ? "" : "amber"}`} title={live.status === "conectado" ? "Datos conectados" : "Conexión de datos pendiente"}/><span>{current.label}</span></div><CommandPalette views={searchViews}/><div><span className={`connection-label ${live.status === 'conectado' ? 'is-live' : ''}`}><i/>{live.status === 'conectado' ? 'Datos en vivo' : live.status === 'filtrando' ? 'Aplicando filtros' : 'Conectando datos'}</span><Link to="/dashboard/cuenta" className="profile-link" aria-label={`Mi cuenta, ${user.usuario}`}><Icon name="user"/><span>{user.usuario}</span></Link></div></header>
      <main ref={content} className="workspace-content" id="workspace-content"><div className="workspace-title"><div><h1 ref={heading} tabIndex="-1">{current.title}</h1><p>{current.description}</p></div></div>
        {sessionError && <div className="dashboard-error"><p role="alert">No se pudo comprobar tu sesión. {sessionError}</p><button className="secondary-button" onClick={refresh}>Comprobar sesión</button></div>}
        {logoutError && <div className="dashboard-error"><p role="alert">{logoutError}</p><button className="secondary-button" onClick={logout} disabled={busy}>Reintentar cierre de sesión</button></div>}
        <ActivityPanel view={view} live={live} history={history} historyError={historyError} historyBusy={historyBusy} historyDate={historyDate} refreshHistory={loadHistory}/>
        {view === 'resumen' && <LiveEventFeed events={events}/>}
        {view === 'historico' && <DemographyPanel history={history} error={historyError} busy={historyBusy} refresh={loadHistory} consulted={historyDate}/>}
        <section hidden={view !== 'territorio'}><TerritoryPanel active={view === 'territorio'} revision={events[0]?.key}/></section>
        <section hidden={view !== 'participacion'}><ParticipationPanel active={view === 'participacion'}/></section>
        <AccountPanel active={view === 'cuenta'} logout={logout} logoutBusy={busy}/>
        <footer className="workspace-footer"><span>Actividad y padrón de la comunidad</span><span><Icon name="shield" width="13" height="13"/>Espacio privado</span></footer>
      </main>
      <LiveTicker event={events[0]}/>
      {mobile && <nav className="mobile-dock" aria-label="Accesos rápidos">{['resumen','explorar','historico','territorio'].map(id => <NavLink key={id} to={`/dashboard/${id}`} aria-label={views[id].label} className={({ isActive }) => isActive ? 'is-active' : ''}><Icon name={views[id].icon}/><span>{views[id].label === 'Explorar actividad' ? 'Explorar' : views[id].label}</span></NavLink>)}<button ref={moreTrigger} type="button" aria-label="Más secciones" aria-expanded={mobileMore} onClick={() => setMobileMore(value => !value)}><Icon name="more"/><span>Más</span></button></nav>}
      {mobileMore && <div className="mobile-more-backdrop" onClick={event => { if (event.target === event.currentTarget) setMobileMore(false); }}><section ref={moreSheet} className="mobile-more-sheet" role="dialog" aria-modal="true" aria-label="Más secciones"><div><h2>Tu espacio</h2><button aria-label="Cerrar más secciones" onClick={() => setMobileMore(false)}>×</button></div>{['participacion','cuenta'].map(id => <Link key={id} to={`/dashboard/${id}`}><Icon name={views[id].icon}/>{views[id].label}<Icon name="arrow"/></Link>)}<button className="secondary-button" onClick={logout}>Cerrar sesión</button></section></div>}
      <dialog className="logout-dialog" ref={logoutDialog} aria-labelledby="logout-confirm-title" onCancel={() => setConfirmLogout(false)} onClose={() => { setConfirmLogout(false); lastFocus.current?.focus?.({ preventScroll: true }); }}><Icon name="shield" width="32" height="32"/><h2 id="logout-confirm-title">Cerrar tus sesiones</h2><p>Se cerrarán todas las sesiones de esta cuenta. Podrás volver a entrar con tu usuario y contraseña.</p><div><button className="secondary-button" onClick={() => setConfirmLogout(false)}>Seguir en el dashboard</button><button className="primary-button" onClick={confirmedLogout}>Cerrar mis sesiones</button></div></dialog>
    </div>
  </div>;
}
