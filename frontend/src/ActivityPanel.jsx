import { useRealtime } from './useRealtime';

const number = value => value == null ? '—' : new Intl.NumberFormat('es-MX').format(value);
export default function ActivityPanel({ expire, history }) {
  const { data, status, event, warning } = useRealtime(expire);
  const labels = { conectado: 'En vivo', conectando: 'Conectando…', reconectando: 'Reconectando…', sincronizando: 'Actualización pendiente' };
  const actions = { creada: 'Interacción creada', modificada: 'Interacción modificada', eliminada: 'Interacción eliminada' };
  const metrics = [
    ['Interacciones', number(data?.total_interacciones), 'Actividad registrada actualmente'],
    ['Participantes', number(data?.usuarios_participantes), 'Personas con al menos una interacción'],
    ['Sentimiento promedio', data?.sentimiento_promedio == null ? '—' : Number(data.sentimiento_promedio).toFixed(3), 'Escala de −1 a 1'],
    ['Reacciones', number(data?.reacciones_recibidas), 'Suma de las reacciones recibidas'],
  ];
  return <>
    <section className="activity-section" aria-labelledby="activity-title">
      <div className="activity-heading"><div><p className="eyebrow">EL PULSO DE TU COMUNIDAD</p><h2 id="activity-title">Actividad actual</h2></div><span className={`live-status ${status}`} role="status"><span/>{labels[status]}</span></div>
      <p className="activity-description">Los indicadores se actualizan automáticamente cuando cambia una interacción.</p>
      {status !== 'conectado' && data && <p className="sync-note">Mostrando la última lectura recibida. Esperando la conexión con el servidor.</p>}
      {warning && <p className="sync-note" role="alert">{warning}</p>}
      <div className="metric-grid">{metrics.map(([label, value, detail]) => <article className="metric-card" key={label}><h3>{label}</h3><strong>{value}</strong><p>{detail}</p></article>)}</div>
      <div className="activity-update" aria-live="polite">{event ? <><span>{actions[event.operation] || 'Lectura inicial recibida'}{event.id ? ` · ${event.id}` : ''}</span><time dateTime={event.date}>{new Date(event.date).toLocaleTimeString('es-MX')}</time></> : <span>Esperando la primera lectura de actividad…</span>}</div>
    </section>
    <section className="history-section" aria-labelledby="history-title"><div><p className="eyebrow">UNA MIRADA AL PADRÓN</p><h2 id="history-title">Resumen histórico</h2><p>Datos del padrón y su corte de origen. Se consultan al abrir esta pantalla.</p></div><div className="history-metrics"><article><strong>{number(history?.indicadores?.usuarios)}</strong><span>Personas registradas</span></article><article><strong>{number(history?.indicadores?.artistas)}</strong><span>Artistas en la comunidad</span></article></div></section>
  </>;
}
