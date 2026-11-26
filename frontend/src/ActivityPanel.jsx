import { useState } from 'react';
import { useRealtime } from './useRealtime';
import { BarChart, ChartCard, DonutChart, Heatmap, TrendChart, categoryLabel, formatNumber } from './charts';

const cleanFilters = { inicio: '', fin: '', canal: '', tipo: '', tema: '' };
const date = value => new Date(value).toLocaleDateString('es-MX', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'UTC' });

function Filters({ options = {}, status, applyFilters, onApplied }) {
  const [draft, setDraft] = useState(cleanFilters);
  const [error, setError] = useState('');
  const change = (key, value) => setDraft(previous => ({ ...previous, [key]: value }));
  const choices = key => [...new Set([...(options[key] || []), ...(draft[key] ? [draft[key]] : [])])];
  function submit(event) {
    event.preventDefault();
    if (draft.inicio && draft.fin && draft.inicio > draft.fin) { setError('La fecha inicial debe ser anterior o igual a la fecha final.'); return; }
    setError('');
    const filters = Object.fromEntries(Object.entries(draft).filter(([, value]) => value));
    if (filters.inicio) filters.inicio += 'T00:00:00Z';
    if (filters.fin) filters.fin += 'T23:59:59.999999Z';
    applyFilters(filters); onApplied({ ...draft });
  }
  function reset() { setDraft(cleanFilters); setError(''); applyFilters({}); onApplied(cleanFilters); }
  return <form className="dashboard-filters" aria-label="Filtros de actividad" onSubmit={submit}>
    <div className="filter-intro"><span className="filter-icon" aria-hidden="true">≡</span><div><strong>Explora la actividad</strong><span>Filtra los indicadores y las gráficas en vivo.</span></div><span className="timezone-note">Fechas en UTC</span></div>
    <div className="filter-fields"><label>Desde<input aria-label="Desde" type="date" value={draft.inicio} max={draft.fin || '9999-12-31'} onChange={e => change('inicio', e.target.value)}/></label><label>Hasta<input aria-label="Hasta" type="date" value={draft.fin} min={draft.inicio || '0001-01-01'} onChange={e => change('fin', e.target.value)}/></label>{[['canal', 'Canal'], ['tipo', 'Tipo de interacción'], ['tema', 'Tema']].map(([key, label]) => <label key={key}>{label}<select aria-label={label} value={draft[key]} onChange={e => change(key, e.target.value)}><option value="">{key === 'canal' ? 'Todos los canales' : key === 'tipo' ? 'Todos los tipos' : 'Todos los temas'}</option>{choices(key).map(value => <option key={value} value={value}>{categoryLabel(value)}</option>)}</select></label>)}</div>
    <div className="filter-actions"><span>El resumen histórico conserva su corte de origen.</span><div><button className="text-button" type="button" onClick={reset} disabled={status === 'filtrando'}>Limpiar filtros</button><button className="primary-button apply-button" type="submit" disabled={status === 'filtrando'}>{status === 'filtrando' ? 'Aplicando…' : 'Aplicar filtros'}</button></div></div>{error && <p className="filter-error" role="alert">{error}</p>}
  </form>;
}

function Historical({ history }) {
  const h = history?.indicadores;
  const risk = h?.por_estatus?.filter(row => row.categoria.replaceAll('_', ' ').toLowerCase() === 'en riesgo').reduce((total, row) => total + row.total, 0);
  const cards = [
    ['Personas registradas', h?.usuarios, 'Total de miembros en el padrón'],
    ['Artistas', h?.artistas, h?.usuarios ? `${(h.artistas / h.usuarios * 100).toFixed(1)}% de la comunidad` : 'Miembros que se identifican como artistas'],
    ['Miembros en riesgo', risk, 'Clasificación del padrón de origen'],
    ['Mensajes del corte de 30 días', h?.mensajes_30d, 'Suma histórica registrada en el padrón'],
  ];
  return <section id="historico" className="historical-section" aria-labelledby="history-title"><div className="section-heading"><div><p className="eyebrow">CONTEXTO DE LA COMUNIDAD</p><h2 id="history-title">La comunidad en números</h2><p>Una fotografía del padrón original para entender a las personas detrás de la actividad.</p></div><span className="section-source historical">Histórico · REST</span></div>
    <div className="historical-metrics">{cards.map(([label, value, detail]) => <article key={label}><span>{label}</span><strong>{formatNumber(value)}</strong><p>{detail}</p></article>)}</div>
    <div className="chart-grid"><ChartCard title="Estado de participación" subtitle="Distribución de los miembros según el padrón." source="REST"><DonutChart data={h?.por_estatus} label="Miembros por estado de participación" loading={!h}/></ChartCard><ChartCard title="Plataformas de la comunidad" subtitle="Plataforma principal de cada miembro." source="REST"><BarChart data={h?.por_plataforma} label="Miembros por plataforma principal" loading={!h}/></ChartCard><ChartCard title="Intereses que nos reúnen" subtitle="Los 10 intereses principales con más miembros." source="REST"><BarChart data={h?.por_interes} label="Miembros por interés principal" loading={!h}/></ChartCard><ChartCard title="Rangos de edad" subtitle="Composición de la comunidad por rango de edad." source="REST"><BarChart data={h?.por_rango_edad} label="Miembros por rango de edad" loading={!h}/></ChartCard></div><p className="section-footnote">Este bloque se consulta al abrir el dashboard. Los cambios en las interacciones no modifican los indicadores del padrón histórico.</p>
  </section>;
}

export default function ActivityPanel({ expire, history }) {
  const { data, options, status, event, warning, applyFilters } = useRealtime(expire);
  const [applied, setApplied] = useState(cleanFilters);
  const labels = { conectado: 'En vivo', conectando: 'Conectando…', reconectando: 'Reconectando…', sincronizando: 'Actualización pendiente', filtrando: 'Aplicando filtros…' };
  const actions = { creada: 'Interacción creada', modificada: 'Interacción modificada', eliminada: 'Interacción eliminada' };
  const metrics = [
    ['Interacciones', formatNumber(data?.total_interacciones), 'Registros que coinciden con los filtros', '↗'],
    ['Participantes', formatNumber(data?.usuarios_participantes), 'Personas distintas con actividad', '◎'],
    ['Sentimiento promedio', data?.sentimiento_promedio == null ? '—' : Number(data.sentimiento_promedio).toFixed(3), 'Promedio de sentimiento · escala −1 a 1', '≈'],
    ['Reacciones recibidas', formatNumber(data?.reacciones_recibidas), 'Suma de las reacciones de estos registros', '♡'],
  ];
  const activeFilters = Object.entries(applied).filter(([, value]) => value);
  const loading = !data;
  return <>
    <section id="actividad" className="activity-section" aria-labelledby="activity-title">
      <div className="section-heading"><div><p className="eyebrow">EL PULSO DE TU COMUNIDAD</p><h2 id="activity-title">Actividad en tiempo real</h2><p>Explora lo que ocurre, reconoce patrones y encuentra oportunidades para conectar.</p></div><span className={`live-status ${status}`} role="status"><span/>{labels[status]}</span></div>
      <Filters options={options} status={status} applyFilters={applyFilters} onApplied={setApplied}/>
      <div className="selection-info"><div className="filter-chips">{activeFilters.length ? activeFilters.map(([key, value]) => <span key={key}>{({ inicio: 'Desde', fin: 'Hasta', canal: 'Canal', tipo: 'Tipo', tema: 'Tema' })[key]}: {categoryLabel(value)}</span>) : <span className="all-data">Todos los registros disponibles</span>}</div><span className="section-source">WebSocket</span></div>
      {status !== 'conectado' && data && <p className="sync-note">Mostrando la última lectura recibida. Esperando la conexión con el servidor.</p>}
      {warning && <p className="sync-note" role="alert">{warning}</p>}
      <div className="metric-grid">{metrics.map(([label, value, detail, icon]) => <article className="metric-card" key={label}><div className="metric-top"><h3>{label}</h3><span aria-hidden="true">{icon}</span></div><strong>{value}</strong><p>{detail}</p></article>)}</div>
      <div className="activity-update" aria-live="polite">{event ? <><span><i/>{actions[event.operation] || 'Lectura recibida'}{event.id ? ` · ${event.id}` : ''}</span><time dateTime={event.date}>Actualizado a las {new Date(event.date).toLocaleTimeString('es-MX')}</time></> : <span>Esperando la lectura de actividad…</span>}</div>
    </section>
    <section id="distribucion" className="distribution-section" aria-labelledby="distribution-title"><div className="section-heading"><div><p className="eyebrow">DE LOS DATOS A LAS CONEXIONES</p><h2 id="distribution-title">Así participa la comunidad</h2><p>Estas visualizaciones comparten los filtros de actividad y se actualizan automáticamente.</p></div></div>
      {data?.total_interacciones === 0 && <div className="empty-selection" role="status"><strong>No encontramos interacciones con estos filtros.</strong><p>Prueba con otro canal, tema o intervalo de fechas.</p></div>}
      <div className="chart-grid"><ChartCard title="Dónde ocurre la conversación" subtitle="Interacciones registradas por canal." source="WebSocket"><BarChart data={data?.por_canal} label="Interacciones por canal" loading={loading}/></ChartCard><ChartCard title="Formas de participar" subtitle="Proporción de cada tipo de interacción." source="WebSocket"><DonutChart data={data?.por_tipo} label="Distribución de tipos de interacción" loading={loading}/></ChartCard><ChartCard title="El ritmo de la comunidad" subtitle="Evolución diaria. Puntos en los días con registros · UTC." source="WebSocket" className="chart-wide"><TrendChart data={data?.por_dia} loading={loading}/></ChartCard><ChartCard title="Temas que generan conversación" subtitle="Los 10 temas con mayor número de interacciones." source="WebSocket"><BarChart data={data?.por_tema} label="Interacciones por tema" loading={loading}/></ChartCard><ChartCard title="Una lectura del sentimiento" subtitle="Promedio de los registros seleccionados, de −1 a 1." source="WebSocket"><div className="sentiment-reading"><strong>{data?.sentimiento_promedio == null ? '—' : Number(data.sentimiento_promedio).toFixed(3)}</strong><div className="sentiment-track"><span style={{ display: data?.sentimiento_promedio == null ? 'none' : undefined, left: `${((data?.sentimiento_promedio ?? 0) + 1) / 2 * 100}%` }}/></div><div className="sentiment-scale"><span>−1 · Negativo</span><span>0</span><span>+1 · Positivo</span></div><p>{data?.total_interacciones ? `Calculado sobre ${formatNumber(data.total_interacciones)} interacciones.` : 'Sin promedio disponible hasta recibir registros.'}</p></div></ChartCard><ChartCard title="Los momentos de mayor actividad" subtitle="Interacciones por día de la semana y hora. Zona horaria UTC." source="WebSocket" className="chart-wide"><Heatmap data={data?.actividad_semanal} loading={loading}/></ChartCard></div>
      {data?.rango_datos?.inicio && <p className="section-footnote">Datos disponibles del {date(data.rango_datos.inicio)} al {date(data.rango_datos.fin)} · Las fechas y el mapa de calor utilizan UTC.</p>}
    </section>
    <Historical history={history}/>
  </>;
}
