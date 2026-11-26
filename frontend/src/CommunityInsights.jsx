import { leaders, hourLabel, interactionLabel, riskReading, share } from './analysis';
import { categoryLabel, formatNumber } from './charts';
import { MotionLink as Link } from './motion';

function CategoryReading({ title, rows, total, noun, onExplore, disabled, selected }) {
  const top = leaders(rows);
  return <div className="reading-item"><h3>{title}</h3>{top.length ? <>
    <strong>{top.length === 1 ? categoryLabel(top[0].categoria) : `${top.length} ${noun} empatados`}</strong>
    <p>{top.length === 1 ? `${share(top[0].total, total)}% de las interacciones de esta selección.` : `${formatNumber(top[0].total)} ${interactionLabel(top[0].total)} por ${noun === 'canales' ? 'canal' : 'tema'}.`}</p>
    <button type="button" className="reading-action" disabled={disabled} onClick={() => onExplore(top.length === 1 && !selected ? top[0].categoria : null)}>{selected ? `Ver ${noun}` : top.length === 1 ? `Explorar ${categoryLabel(top[0].categoria)}` : `Comparar ${noun}`}<span aria-hidden="true">↗</span></button>
  </> : <p>Sin interacciones para identificar un {noun === 'canales' ? 'canal' : 'tema'} principal.</p>}</div>;
}

export function ActivityInsights({ data, filters = {}, pending, onCategory, onHours }) {
  const hours = leaders(data?.actividad_semanal);
  return <aside className="activity-readings" aria-labelledby="readings-title"><div className="reading-heading"><h2 id="readings-title">Claves de esta selección</h2><p>Un punto de partida para planear contenido y participación.</p></div>
    {!data ? <p className="reading-placeholder">Esperando la lectura de actividad…</p> : <>
      <CategoryReading title={filters.canal ? 'Canal seleccionado' : 'Canal con más actividad'} selected={filters.canal} rows={data.por_canal} total={data.total_interacciones} noun="canales" onExplore={category => onCategory('canal', category)} disabled={pending}/>
      <CategoryReading title={filters.tema ? 'Tema seleccionado' : 'Tema más frecuente'} selected={filters.tema} rows={data.por_tema} total={data.total_interacciones} noun="temas" onExplore={category => onCategory('tema', category)} disabled={pending}/>
      <div className="reading-item"><h3>Cuándo se concentra la actividad</h3>{hours.length ? <><strong>{hours.length === 1 ? hourLabel(hours[0]) : `${hours.length} franjas empatadas`}</strong><p>{formatNumber(hours[0].total)} {interactionLabel(hours[0].total)} por franja de una hora. Horario UTC, acumulado del periodo.</p><button className="reading-action" type="button" onClick={onHours} disabled={pending}>Ver mapa de calor<span aria-hidden="true">↗</span></button></> : <p>Sin actividad para identificar una franja horaria.</p>}</div>
    </>}
  </aside>;
}

export function HistoricalContext({ history, error }) {
  const h = history?.indicadores;
  const risk = riskReading(h);
  return <aside className="community-context" aria-labelledby="community-context-title"><h2 id="community-context-title">El contexto de la comunidad</h2>{h ? <><p><strong>{formatNumber(h.usuarios)}</strong> {h.usuarios === 1 ? 'persona registrada' : 'personas registradas'} en el padrón de origen.</p>{risk && <p><strong>{formatNumber(risk.total)}</strong> {risk.total === 1 ? 'persona clasificada' : 'personas clasificadas'} en riesgo{risk.percentage != null ? ` (${risk.percentage}%)` : ''}.</p>}<p className="context-scope">La clasificación pertenece al corte histórico. Los filtros de actividad no la modifican.</p>{error && <p className="context-scope">La consulta más reciente falló. Esta es la última lectura disponible.</p>}</> : <p>{error ? 'No se pudo consultar el padrón. Puedes reintentar desde Histórico.' : 'Consultando el padrón de la comunidad…'}</p>}<Link className="reading-action" to="/dashboard/participacion">Revisar participación<span aria-hidden="true">↗</span></Link></aside>;
}

export function HistoricalReading({ history }) {
  const risk = riskReading(history);
  if (!risk) return null;
  return <aside className="historical-reading" aria-label="Lectura de participación"><div><h3>Participación que conviene revisar</h3><p>{formatNumber(risk.total)} de {formatNumber(history.usuarios)} personas {risk.total === 1 ? 'está clasificada' : 'están clasificadas'} en riesgo{risk.percentage != null ? `: ${risk.percentage}% del padrón` : ''}.</p></div><p>Esta clasificación viene del archivo de origen; no es una predicción calculada con las interacciones actuales.</p></aside>;
}
