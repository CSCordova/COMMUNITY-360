import { useEffect, useRef, useState } from 'react';
import { api } from './api';
import { useAuth } from './auth';
import { Icon } from './ui';

const initial = { password_actual: '', password_nueva: '', confirmacion: '' };

export default function AccountPanel({ active, logout, logoutBusy }) {
  const { user, expire } = useAuth();
  const [values, setValues] = useState(initial);
  const [visible, setVisible] = useState({});
  const [errors, setErrors] = useState({});
  const [busy, setBusy] = useState(false);
  const form = useRef(null);
  useEffect(() => {
    if (!active && !busy) { setValues(initial); setVisible({}); setErrors({}); }
  }, [active, busy]);
  async function submit(event) {
    event.preventDefault();
    if (busy) return;
    const next = {};
    if (!values.password_actual) next.password_actual = 'Escribe tu contraseña actual.';
    if (values.password_nueva.length < 8 || values.password_nueva.length > 14) next.password_nueva = 'Usa entre 8 y 14 caracteres.';
    else if (values.password_actual === values.password_nueva) next.password_nueva = 'Elige una contraseña diferente de la actual.';
    if (!values.confirmacion) next.confirmacion = 'Confirma tu nueva contraseña.';
    else if (values.confirmacion !== values.password_nueva) next.confirmacion = 'Las contraseñas nuevas no coinciden.';
    setErrors(next);
    if (Object.keys(next).length) { form.current?.querySelector(`[name="${Object.keys(next)[0]}"]`)?.focus(); return; }
    setBusy(true);
    try {
      await api('/auth/password', { method: 'POST', body: JSON.stringify(values) });
      setValues(initial); setVisible({});
      expire('Contraseña actualizada. Todas tus sesiones se cerraron; inicia sesión con tu nueva contraseña.');
    } catch (error) {
      if (error.status === 401) expire();
      else { setErrors({ general: error.message }); setValues(previous => ({ ...previous, password_actual: '' })); }
    } finally { setBusy(false); }
  }
  return <section hidden={!active} className="account-view" aria-labelledby="account-title">
    <div className="identity-card"><span className="account-avatar" aria-hidden="true">{user.usuario.slice(0, 2).toUpperCase()}</span><div><p className="eyebrow">TU CUENTA DE ACCESO</p><h2 id="account-title">{user.usuario}</h2><p>Cuenta habilitada para consultar el observatorio de la comunidad.</p></div><div className="identity-controls"><span className="identity-badge"><Icon name="shield"/>Acceso autorizado</span><button className="secondary-button" type="button" onClick={logout} disabled={logoutBusy}><Icon name="logout"/>{logoutBusy ? 'Cerrando sesiones…' : 'Cerrar todas mis sesiones'}</button></div></div>
    <div className="account-columns"><form ref={form} className="password-form" aria-label="Cambiar contraseña" onSubmit={submit} noValidate aria-busy={busy}>
      <div className="form-section-title"><Icon name="lock"/><div><h3>Cambiar contraseña</h3><p>Al guardarla, se cerrarán todas las sesiones de tu cuenta.</p></div></div>
      {[
        ['password_actual', 'Contraseña actual', 'current-password'],
        ['password_nueva', 'Nueva contraseña', 'new-password'],
        ['confirmacion', 'Confirmar nueva contraseña', 'new-password'],
      ].map(([key, label, autocomplete]) => <div className="account-field" key={key}><label htmlFor={key}>{label}</label><div className="input-wrap"><Icon name="lock"/><input id={key} name={key} type={visible[key] ? 'text' : 'password'} autoComplete={autocomplete} required maxLength={key === 'password_actual' ? 1024 : 14} minLength={key === 'password_actual' ? 1 : 8} disabled={busy} value={values[key]} onChange={event => { setValues(previous => ({ ...previous, [key]: event.target.value })); setErrors(previous => ({ ...previous, [key]: '', general: '' })); }} aria-invalid={Boolean(errors[key])} aria-describedby={errors[key] ? `${key}-error` : key === 'password_nueva' ? 'password-rule' : undefined}/><button className="visibility-button" type="button" disabled={busy} aria-label={`${visible[key] ? 'Ocultar' : 'Mostrar'} ${label.toLowerCase()}`} aria-pressed={Boolean(visible[key])} onClick={() => setVisible(previous => ({ ...previous, [key]: !previous[key] }))}><Icon name="eye"/></button></div>{key === 'password_nueva' && <p id="password-rule" className="field-hint">Entre 8 y 14 caracteres. Respeta mayúsculas y espacios.</p>}{errors[key] && <p id={`${key}-error`} className="field-error" role="alert">{errors[key]}</p>}</div>)}
      {errors.general && <p className="error-message" role="alert">{errors.general}</p>}
      <div className="password-actions"><button type="button" className="secondary-button" disabled={busy} onClick={() => { setValues(initial); setVisible({}); setErrors({}); }}>Limpiar campos</button><button type="submit" className="primary-button" disabled={busy}>{busy ? 'Guardando contraseña…' : 'Guardar contraseña'}</button></div>
    </form><aside className="account-guidance"><p className="eyebrow">ACCESO BAJO TU CONTROL</p><h3>Una cuenta.<br/>Un espacio privado.</h3><ul><li><Icon name="shield"/><span>Las contraseñas se almacenan protegidas mediante hash.</span></li><li><Icon name="lock"/><span>Tu sesión expira automáticamente. Si termina, podrás volver al apartado en el que estabas.</span></li><li><Icon name="user"/><span>Las cuentas nuevas las habilita el administrador. No necesitas registrar un perfil del padrón para acceder.</span></li></ul></aside></div>
  </section>;
}
