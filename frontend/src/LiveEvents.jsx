import { useEffect, useRef, useState } from 'react';
const labels = { creada: 'Interacción creada', modificada: 'Interacción modificada', eliminada: 'Interacción eliminada' };
export const maskedId = value => value ? `${value[0]}***${value.slice(-3)}` : 'Registro';

export function useEventLog(event) {
  const [events, setEvents] = useState([]);
  const seen = useRef(null);
  useEffect(() => {
    if (!event?.operation) return;
    const key = `${event.date}:${event.operation}:${event.id}`;
    if (seen.current === key) return;
    seen.current = key; setEvents(previous => [{ ...event, key }, ...previous].slice(0, 20));
  }, [event]);
  return events;
}

export function LiveTicker({ event }) {
  const [visible, setVisible] = useState(false);
  useEffect(() => { if (!event) return; setVisible(true); const timer = setTimeout(() => setVisible(false), 6500); return () => clearTimeout(timer); }, [event?.key]);
  return visible && event ? <div className="live-ticker" role="status"><span className="status-dot"/><span>{labels[event.operation]}<strong>{maskedId(event.id)}</strong></span><button aria-label="Ocultar aviso de actividad" onClick={() => setVisible(false)}>×</button></div> : null;
}

export function LiveEventFeed({ events }) {
  const [now, setNow] = useState(Date.now());
  const [paused, setPaused] = useState(false);
  const list = useRef(null);
  useEffect(() => { const timer = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(timer); }, []);
  useEffect(() => { if (!paused && list.current) list.current.scrollTop = 0; }, [events, paused]);
  return <section className="live-event-feed" aria-labelledby="event-feed-title"><div className="event-feed-heading"><div><span className="status-dot"/><h2 id="event-feed-title">Actividad recibida en esta sesión</h2></div><button onClick={() => setPaused(value => !value)}>{paused ? 'Seguir actualizaciones' : 'Pausar seguimiento'}</button></div>
    <p>Últimos 20 cambios confirmados. Identificadores enmascarados y horas UTC.</p><ol ref={list} onScroll={() => { if (list.current.scrollTop > 30) setPaused(true); }}>{events.map(event => <li key={event.key}><time dateTime={event.date}>{new Date(event.date).toLocaleTimeString('es-MX', { timeZone: 'UTC', hour12: false })}</time><span>{labels[event.operation]}</span><strong>{maskedId(event.id)}</strong><small>hace {Math.max(0, Math.floor((now - Date.parse(event.date)) / 1000))} s</small></li>)}</ol>{!events.length && <div className="event-feed-empty">Todavía no recibimos cambios en esta sesión. Las nuevas interacciones, sus cambios y las bajas aparecerán aquí cuando se confirmen.</div>}
  </section>;
}
