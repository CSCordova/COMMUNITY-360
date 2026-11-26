import { useLayoutEffect, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { FluidNumber, MotionLink as Link, useMotion } from './motion';
import { Icon, ViewTabs } from './ui';
import { BarChart, ChartCard, DonutChart, TrendChart, categoryLabel, formatNumber } from './charts';
import { cleanFilters, filterDraft, filterRequest, filterNames, filterLabel, interactionLabel, leaders } from './analysis';
import ActivityFilters from './ActivityFilters';
import InteractionRecords from './InteractionRecords';
import SelectionSummary from './SelectionSummary';
import { ActivityInsights, HistoricalContext } from './CommunityInsights';
import { TopicAnalysis, TrendAnalysis, HourAnalysis } from './ExplorationCharts';

const date = value => new Date(value).toLocaleDateString('es-MX', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'UTC' });

function Panel({ prefix, id, selected, children }) {
  return <div className="chart-tab-panel" role="tabpanel" id={`${prefix}-panel-${id}`} aria-labelledby={`${prefix}-${id}`} hidden={selected !== id} tabIndex="0">{children}</div>;
}

export default function ActivityPanel({ view, live, history, historyError }) {
  const navigate = useNavigate();
  const location = useLocation();
  const transition = useMotion();
  const { data, options, status, event, warning, confirmedFilters, applyFilters } = live;
  const [applied, setApplied] = useState(cleanFilters);
  const [filterOpen, setFilterOpen] = useState(false);
  const [filterVersion, setFilterVersion] = useState(0);
  const [selected, setSelected] = useState('canales');
  useLayoutEffect(() => {
    const tab = location.state?.exploreTab;
    if (view === 'explorar' && ['canales', 'temas', 'tendencia', 'horarios', 'registros'].includes(tab)) setSelected(tab);
  }, [location.key, view]);
  function changeExploreTab(tab) { setSelected(tab); navigate('/dashboard/explorar', { replace: true, state: { exploreTab: tab } }); }
  const filterButton = useRef(null);
  const selections = useRef([]);
  const [undoCount, setUndoCount] = useState(0);
  const activeFilters = Object.entries(applied).filter(([, value]) => value);
  const displayedFilters = Object.entries(filterDraft(confirmedFilters)).filter(([, value]) => value);
  const isActivity = view === 'resumen' || view === 'explorar';
  const labels = { conectado: 'En vivo', conectando: 'Conectando…', reconectando: 'Reconectando…', sincronizando: 'Actualización pendiente', filtrando: 'Aplicando filtros…' };
  const actions = { creada: 'Interacción creada', modificada: 'Interacción modificada', eliminada: 'Interacción eliminada' };
  const metrics = [
    ['Interacciones', data?.total_interacciones, 'Registros en esta selección', 0, 'total_interacciones'],
    ['Participantes', data?.usuarios_participantes, 'Personas distintas con actividad', 0, 'usuarios_participantes'],
    ['Sentimiento promedio', data?.sentimiento_promedio, 'Puntuación media de los registros (−1 a +1)', 3, 'sentimiento_promedio'],
    ['Reacciones recibidas', data?.reacciones_recibidas, 'Suma de reacciones recibidas', 0, 'reacciones_recibidas'],
  ];
  const loading = !data;
  const peakDays = leaders(data?.por_dia);
  function appliedFilters(filters, restoreFocus = false) { setApplied(filters); setFilterOpen(false); if (restoreFocus) filterButton.current?.focus({ preventScroll: true }); }
  function selectFilters(next, restoreFocus = false) {
    const request = filterRequest(next);
    const previous = filterDraft(confirmedFilters);
    if (JSON.stringify(request) !== JSON.stringify(filterRequest(previous))) { selections.current = [...selections.current.slice(-9), previous]; setUndoCount(selections.current.length); }
    if (status !== 'conectado' || JSON.stringify(request) !== JSON.stringify(filterRequest(previous))) applyFilters(request);
    appliedFilters(next, restoreFocus); setFilterVersion(previous => previous + 1);
  }
  function undoSelection() {
    const previous = selections.current.pop();
    if (!previous) return;
    setUndoCount(selections.current.length); applyFilters(filterRequest(previous)); appliedFilters(previous, true); setFilterVersion(value => value + 1);
  }
  function explore(tab, field, value) {
    if (value) selectFilters({ ...filterDraft(confirmedFilters), [field]: value });
    transition(() => { setSelected(tab); navigate('/dashboard/explorar', { state: { exploreTab: tab } }); }, 'page');
  }
  function toggleCategory(field, value) { selectFilters({ ...filterDraft(confirmedFilters), [field]: confirmedFilters?.[field] === value ? '' : value }); }
  function chooseDay(day) { const draft = filterDraft(confirmedFilters); const clear = draft.inicio === day && draft.fin === day; selectFilters({ ...draft, inicio: clear ? '' : day, fin: clear ? '' : day }); }
  function chooseHour(row) { const same = confirmedFilters?.dia_semana === row.dia_semana && confirmedFilters?.hora === row.hora; selectFilters({ ...filterDraft(confirmedFilters), dia_semana: same ? '' : String(row.dia_semana), hora: same ? '' : String(row.hora) }); }
  function chooseDimension(field, value) { selectFilters({ ...filterDraft(confirmedFilters), [field]: String(confirmedFilters?.[field]) === value ? '' : value }); }
  const pending = status !== 'conectado';
  const selectedDay = confirmedFilters?.inicio?.slice(0, 10) === confirmedFilters?.fin?.slice(0, 10) ? confirmedFilters?.inicio?.slice(0, 10) : null;
  return <>
    <section className="activity-view" hidden={!isActivity} aria-label="Indicadores de actividad">
      <div className="activity-toolbar"><div><span className={`live-status ${status}`} role="status"><span/>{labels[status]}</span></div><div className="selection-tools">{view === 'resumen' && <Link className="inline-action" to="/dashboard/explorar">Explorar estos datos<Icon name="arrow" width="16" height="16"/></Link>}<button ref={filterButton} type="button" className={`secondary-button filter-toggle ${filterOpen ? 'is-open' : ''}`} aria-expanded={filterOpen} aria-controls="activity-filters" onClick={() => setFilterOpen(!filterOpen)}><Icon name="filter"/>Filtros{activeFilters.length ? ` (${activeFilters.length})` : ''}<span aria-hidden="true">⌄</span></button></div></div>
      <ActivityFilters key={filterVersion} open={filterOpen} initial={applied} options={options} range={data?.rango_datos} pending={status === 'filtrando'} onApply={draft => selectFilters(draft, true)} onClose={() => { setFilterOpen(false); filterButton.current?.focus({ preventScroll: true }); }}/>
      {data?.rango_datos?.inicio && <p className="available-range">Datos disponibles del {date(data.rango_datos.inicio)} al {date(data.rango_datos.fin)} · Horarios en UTC.</p>}
      {status !== 'conectado' && data && <p className="sync-note">{status === 'filtrando' ? 'Actualizando tu selección. Las cifras visibles corresponden a la lectura anterior.' : 'Mostrando la última lectura recibida. Esperando la conexión con el servidor.'}</p>}
      {warning && <div className="sync-note sync-recovery" role="alert"><p>{warning}</p><button type="button" className="secondary-button" onClick={() => selectFilters(filterDraft(confirmedFilters), true)}>{data ? "Recuperar selección anterior" : "Reintentar lectura"}</button></div>}
      <div className="metric-grid">{metrics.map(([label, value, detail, decimals, field]) => <article className={`metric-card ${loading ? "is-loading" : ""}`} key={label}><div className="metric-top"><h3>{label}</h3></div><FluidNumber fromZero className="metric-value" value={value} decimals={decimals}/><p>{detail}</p><MetricDelta comparison={data?.comparacion} field={field} value={value}/></article>)}</div>
      {data?.comparacion && <p className="comparison-context">{data.comparacion.disponible ? `Comparación con ${date(data.comparacion.inicio_anterior)} a ${date(data.comparacion.fin_anterior)} · mismos filtros, ${data.comparacion.dias} días UTC. Las variaciones indican dirección, no una mejora automática.` : data.comparacion.motivo}</p>}
      <details className="metric-explainer"><summary>Cómo se calculan estos indicadores</summary><dl><div><dt>Interacciones</dt><dd>Cuenta los registros que cumplen los filtros para medir el volumen de actividad. Cada mensaje, comentario, reacción, encuesta o confirmación de evento cuenta una vez.</dd></div><div><dt>Participantes</dt><dd>Cuenta personas distintas con al menos una interacción en la selección para saber cuántas aportaron actividad. Una persona con varios registros cuenta una sola vez.</dd></div><div><dt>Sentimiento promedio</dt><dd>Resume las puntuaciones de sentimiento que ya vienen en los datos: suma de puntuaciones dividida entre el número de interacciones. Escala de −1 a +1. No es un porcentaje de satisfacción. Un cero puede mezclar puntuaciones positivas y negativas. Sin registros, no se calcula un promedio.</dd></div><div><dt>Reacciones recibidas</dt><dd>Suma las reacciones que recibieron los registros seleccionados para medir su respuesta acumulada. Por ejemplo, 3 registros con 2, 5 y 0 reacciones suman 7. Este total no cuenta personas únicas ni equivale al número de registros de tipo reacción.</dd></div></dl></details>
      <div className="activity-update" aria-live="polite">{event ? <><span><i/>{actions[event.operation] || 'Lectura recibida'}{event.id ? ` · ${event.id}` : ''}</span><time dateTime={event.date}>Actualizado a las {new Date(event.date).toLocaleTimeString('es-MX')}</time></> : <span>Esperando la lectura de actividad…</span>}</div>
      {data?.total_interacciones === 0 && <div className="empty-selection" role="status"><strong>No encontramos interacciones con estos filtros.</strong><p>Amplía las fechas o prueba otro canal o tema.</p><button className="secondary-button" disabled={status === 'filtrando'} onClick={() => selectFilters(cleanFilters)}>Ver todos los registros</button></div>}
    </section>
    <SelectionSummary hidden={!isActivity} filters={confirmedFilters} total={data?.total_interacciones} pending={pending} undoCount={undoCount} onUndo={undoSelection} onClear={() => selectFilters(cleanFilters, true)} onRemove={key => selectFilters({ ...filterDraft(confirmedFilters), [key]: "" }, true)}/>
    <section className="overview-view" hidden={view !== 'resumen'} aria-label="Resumen de la comunidad"><div className="analysis-main"><ChartCard className="main-trend" title="La conversación a lo largo del tiempo" subtitle="Interacciones por día en UTC. Puntos en los días con registros."><TrendChart data={data?.por_dia} loading={loading} onSelect={chooseDay} selected={selectedDay} disabled={pending}/>{peakDays.length > 0 && <p className="chart-reading">{peakDays.length === 1 ? <>Mayor actividad el <strong>{date(peakDays[0].fecha)}</strong>: {formatNumber(peakDays[0].total)} {interactionLabel(peakDays[0].total)}.</> : <>{peakDays.length} días comparten el máximo de {formatNumber(peakDays[0].total)} {interactionLabel(peakDays[0].total)}.</>}</p>}</ChartCard><ActivityInsights data={data} filters={confirmedFilters} pending={status !== 'conectado'} onCategory={(field, value) => explore(field === 'canal' ? 'canales' : 'temas', field, value)} onHours={() => explore('horarios')}/></div><div className="analysis-context"><ChartCard title="Cómo participa la comunidad" subtitle="Distribución de los tipos de interacción de esta selección."><DonutChart data={data?.por_tipo} label="Distribución de tipos de interacción" loading={loading} onSelect={value => toggleCategory('tipo', value)} selected={confirmedFilters?.tipo} disabled={pending}/></ChartCard><HistoricalContext history={history} error={historyError}/></div></section>
    <section className="explore-view" hidden={view !== 'explorar'} aria-label="Explorar interacciones"><ViewTabs label="Visualizaciones de actividad" idPrefix="explorar" selected={selected} onChange={changeExploreTab} tabs={[{ id: 'canales', label: 'Canales y tipos' }, { id: 'temas', label: 'Temas' }, { id: 'tendencia', label: 'Tendencia' }, { id: 'horarios', label: 'Mapa de calor' }, { id: 'registros', label: 'Registros' }]}/>
      <Panel prefix="explorar" id="canales" selected={selected}><div className="chart-grid"><ChartCard title="Dónde ocurre la conversación" subtitle="Selecciona un canal para filtrar toda la actividad."><BarChart data={data?.por_canal} label="Interacciones por canal" loading={loading} onSelect={value => toggleCategory('canal', value)} selected={confirmedFilters?.canal} disabled={pending}/></ChartCard><ChartCard title="Formas de participar" subtitle="Selecciona un tipo en la leyenda para aplicar el filtro."><DonutChart data={data?.por_tipo} label="Distribución de tipos de interacción" loading={loading} onSelect={value => toggleCategory('tipo', value)} selected={confirmedFilters?.tipo} disabled={pending}/></ChartCard></div></Panel>
      <Panel prefix="explorar" id="temas" selected={selected}><TopicAnalysis data={data} loading={loading} pending={pending} filters={confirmedFilters} onTopic={value => toggleCategory('tema', value)}/></Panel>
      <Panel prefix="explorar" id="tendencia" selected={selected}><TrendAnalysis data={data} loading={loading} pending={pending} selectedDay={selectedDay} onDay={chooseDay}/></Panel>
      <Panel prefix="explorar" id="horarios" selected={selected}><HourAnalysis data={data} loading={loading} pending={pending} filters={confirmedFilters} onCell={chooseHour} onDimension={chooseDimension}/></Panel>
      <Panel prefix="explorar" id="registros" selected={selected}><InteractionRecords active={view === 'explorar' && selected === 'registros'} filters={confirmedFilters} snapshot={data} pending={pending} hasFilters={displayedFilters.length > 0} onClearFilters={() => selectFilters(cleanFilters, true)}/></Panel>
      {data?.rango_datos?.inicio && <p className="section-footnote">Datos disponibles del {date(data.rango_datos.inicio)} al {date(data.rango_datos.fin)} · Fechas y horas en UTC.</p>}
    </section>
  </>;
}


function MetricDelta({ comparison, field, value }) {
  if (!comparison?.disponible) return null;
  const previous = comparison.indicadores[field];
  if (previous == null || value == null) return <span className="metric-delta">Sin promedio comparable</span>;
  if (field !== 'sentimiento_promedio' && previous === 0) return <span className="metric-delta">{value ? 'Sin base porcentual (antes: 0)' : 'Sin variación (ambos: 0)'}</span>;
  const delta = field === 'sentimiento_promedio' ? value - previous : (value - previous) / previous * 100;
  return <span className={`metric-delta ${delta > 0 ? 'rising' : delta < 0 ? 'falling' : ''}`}>{delta > 0 ? '↗ +' : delta < 0 ? '↘ ' : '→ '}{delta.toFixed(field === 'sentimiento_promedio' ? 3 : 1)}{field === 'sentimiento_promedio' ? ' puntos' : '%'} <small>vs. periodo anterior</small></span>;
}
