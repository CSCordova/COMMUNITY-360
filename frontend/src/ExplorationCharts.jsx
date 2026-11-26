import { useId, useState } from 'react';
import { BarChart, ChartCard, EmptyChart, Heatmap, TrendChart, categoryLabel, formatNumber } from './charts';
import { FluidNumber, useFluidLine } from './motion';
import { timeDistributions } from './analysis';
import MeasurementGuide from './MeasurementGuide';

const shortDate = value => new Date(`${value}T00:00:00Z`).toLocaleDateString('es-MX', { day: 'numeric', month: 'short', timeZone: 'UTC' });
const unitLabel = (unit, value) => value !== 1 ? unit : unit === 'interacciones' ? 'interacción' : unit === 'reacciones recibidas' ? 'reacción recibida' : unit;

export function ColumnChart({ rows = [], label, unit = 'interacciones', loading, onSelect, selected, disabled, action = 'Filtrar esta selección' }) {
  const [inspected, setInspected] = useState(null);
  const current = rows.find(row => row.key === inspected) || rows.reduce((best, row) => !best || row.value > best.value ? row : best, null);
  const maximum = Math.max(0, ...rows.map(row => row.value));
  const max = Math.max(1, maximum);
  if (!rows.length) return <EmptyChart loading={loading}/>;
  return <div className="column-chart">
    <div className="column-scale"><span>{formatNumber(maximum)}</span><span>{unit}</span></div>
    <div className="column-scroll"><div className="column-plot" role="group" aria-label={label} style={{ '--columns': rows.length }}>
      {rows.map(row => <button key={row.key} type="button" className={`column-item ${current.key === row.key ? 'is-inspected' : ''} ${selected === row.key ? 'is-selected' : ''}`} aria-label={`Consultar ${row.label}: ${formatNumber(row.value)} ${unitLabel(unit, row.value)}`} aria-pressed={current.key === row.key} onFocus={() => setInspected(row.key)} onPointerEnter={() => setInspected(row.key)} onClick={() => setInspected(row.key)}>
        <span className="column-stem" aria-hidden="true"><i style={{ height: `${row.value / max * 100}%` }}/></span><span className="column-caption">{row.shortLabel || row.label}</span>
      </button>)}
    </div></div>
    <div className="plot-readout"><p><span>{current.label}</span><strong><FluidNumber value={current.value}/> {unitLabel(unit, current.value)}</strong></p>{onSelect && <button className="chart-select-action" type="button" disabled={disabled} onClick={() => onSelect(current.key)}>{selected === current.key ? 'Quitar este filtro' : action}</button>}</div>
    {rows.every(row => row.value === 0) && <p className="chart-interaction-hint">Hay {unit === 'reacciones recibidas' ? 'registros, pero no reacciones recibidas' : 'cero interacciones'} en esta selección.</p>}
  </div>;
}

export function SentimentBars({ data, loading, onSelect, selected, disabled }) {
  if (!data?.length) return <EmptyChart loading={loading}/>;
  const rows = [...data].sort((a, b) => b.total - a.total || a.categoria.localeCompare(b.categoria)).slice(0, 10);
  const single = rows.length === 1 && selected === rows[0].categoria;
  return <>{single && <div className="sentiment-single"><span>{categoryLabel(rows[0].categoria)}</span><p><strong>{rows[0].sentimiento_promedio > 0 ? '+' : ''}{formatNumber(rows[0].sentimiento_promedio)}</strong> puntos de sentimiento promedio</p><span>Calculado con {formatNumber(rows[0].total)} {unitLabel('interacciones', rows[0].total)} de esta selección.</span></div>}
    <div className="topic-sentiment-scale"><span>−1 Negativo</span><span>0</span><span>+1 Positivo</span></div><div className="sentiment-bars" role="group" aria-label="Sentimiento promedio por tema">
    {rows.map(row => <button type="button" key={row.categoria} className={`sentiment-row ${selected === row.categoria ? 'is-selected' : ''}`} disabled={disabled} aria-pressed={selected === row.categoria} aria-label={`Explorar tema ${categoryLabel(row.categoria)}: sentimiento ${formatNumber(row.sentimiento_promedio)}`} onClick={() => onSelect(row.categoria)}>
      <span>{categoryLabel(row.categoria)}<small>{formatNumber(row.total)} {unitLabel('interacciones', row.total)}</small></span><span className="topic-sentiment-track" aria-hidden="true"><i className={row.sentimiento_promedio < 0 ? 'is-negative' : ''} style={{ left: `${50 + Math.min(0, row.sentimiento_promedio) * 50}%`, width: `${Math.abs(row.sentimiento_promedio) * 50}%` }}/><b style={{ left: `${50 + row.sentimiento_promedio * 50}%` }}/></span><FluidNumber value={row.sentimiento_promedio} decimals={2}/>
    </button>)}
  </div><p className="chart-interaction-hint">Resume las puntuaciones ya registradas en los datos. Cero puede resultar de mezclar valores positivos y negativos. Selecciona un tema para profundizar.</p></>;
}

export function SentimentTrend({ data = [], loading, disabled, onSelect, selected }) {
  const [inspected, setInspected] = useState(null);
  const hint = useId();
  const current = data.find(row => row.fecha === inspected) || data.at(-1);
  const first = Date.parse(data[0]?.fecha), last = Date.parse(data.at(-1)?.fecha);
  const points = data.map(row => ({ x: first === last ? 350 : 50 + (Date.parse(row.fecha) - first) / (last - first) * 620, y: 110 - row.sentimiento_promedio * 75 }));
  const animated = useFluidLine(points);
  if (!data.length || !animated.length) return <EmptyChart loading={loading}/>;
  function keys(event) {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    const index = event.key === 'Home' ? 0 : event.key === 'End' ? data.length - 1 : Math.max(0, Math.min(data.length - 1, data.indexOf(current) + (event.key === 'ArrowRight' ? 1 : -1)));
    setInspected(data[index].fecha);
  }
  function pointer(event) {
    const bounds = event.currentTarget.getBoundingClientRect();
    if (!bounds.width) return;
    const x = (event.clientX - bounds.left) / bounds.width * 710;
    const index = points.reduce((best, point, index) => Math.abs(point.x - x) < Math.abs(points[best].x - x) ? index : best, 0);
    setInspected(data[index].fecha);
  }
  return <><div className="trend-scroll"><svg className="sentiment-line" viewBox="0 0 710 220" role="img" aria-label="Sentimiento promedio por día en UTC" aria-describedby={hint} tabIndex="0" onKeyDown={keys} onPointerMove={pointer} onPointerDown={pointer}>
    {[-1, 0, 1].map(value => <g key={value}><line x1="50" x2="680" y1={110 - value * 75} y2={110 - value * 75} className={value === 0 ? 'neutral-axis' : ''}/><text x="35" y={115 - value * 75} textAnchor="end">{value > 0 ? '+' : ''}{value}</text></g>)}
    <polyline points={animated.map(point => `${point.x},${point.y}`).join(' ')} fill="none" stroke="#34d399" strokeWidth="2.5"/>
    {points.map((point, index) => <circle key={data[index].fecha} cx={point.x} cy={point.y} r={current.fecha === data[index].fecha ? 6 : 3} fill={data[index].sentimiento_promedio < 0 ? '#fbbf24' : '#10b981'}><title>{data[index].fecha}: {formatNumber(data[index].sentimiento_promedio)}</title></circle>)}
    {[...new Set([0, Math.floor((data.length - 1) / 2), data.length - 1])].map(index => <text key={index} x={points[index].x} y="210" textAnchor={index === 0 ? 'start' : index === data.length - 1 ? 'end' : 'middle'}>{shortDate(data[index].fecha)}</text>)}
  </svg></div><div className="plot-readout"><p><span>{current.fecha}</span><strong>Promedio <FluidNumber value={current.sentimiento_promedio} decimals={3}/></strong>{Number.isFinite(current.total) && <span>Base: {formatNumber(current.total)} {unitLabel('interacciones', current.total)}.</span>}</p><button type="button" className="chart-select-action" disabled={disabled} onClick={() => onSelect(current.fecha)}>{selected === current.fecha ? 'Quitar filtro de fecha' : 'Explorar esta fecha'}</button></div><p id={hint} className="chart-interaction-hint">Escala fija de −1 a +1. Cada punto es el promedio de ese día; sin registros no se calcula. Toca la línea o usa las flechas para consultar.</p></>;
}

export function TopicAnalysis({ data, loading, pending, filters, onTopic }) {
  const [measure, setMeasure] = useState('total');
  const detail = data?.analisis_temas;
  const ranking = measure === 'total' ? data?.por_tema : detail?.map(row => ({ categoria: row.categoria, total: row.reacciones_recibidas }));
  const topic = filters?.tema ? detail?.find(row => row.categoria === filters.tema) : null;
  return <div className="analysis-pair"><ChartCard title={topic ? 'Actividad del tema seleccionado' : measure === 'total' ? 'Interacciones por tema' : 'Reacciones recibidas por tema'} subtitle={topic ? 'Cantidades de este tema con las fechas y los demás filtros aplicados.' : 'Compara los 10 temas con mayor cantidad en la medida elegida.'}>
    {topic ? <div className="topic-selection-reading"><h4>{categoryLabel(topic.categoria)}</h4><dl><div><dt>Interacciones registradas</dt><dd><FluidNumber value={topic.total}/></dd></div><div><dt>Reacciones que recibieron</dt><dd><FluidNumber value={topic.reacciones_recibidas}/></dd></div></dl><p>Las {formatNumber(topic.total)} {unitLabel('interacciones', topic.total)} de este tema acumulan {formatNumber(topic.reacciones_recibidas)} {unitLabel('reacciones recibidas', topic.reacciones_recibidas)}.</p><button type="button" className="chart-select-action" disabled={pending} onClick={() => onTopic(topic.categoria)}>Comparar con otros temas</button><p className="chart-interaction-hint">Quita únicamente el filtro de tema y conserva los demás filtros.</p></div> : <>
      <div className="chart-measures" role="group" aria-label="Medida del ranking de temas">{[['total', 'Interacciones'], ['reacciones', 'Reacciones recibidas']].map(([key, label]) => <button type="button" key={key} aria-pressed={measure === key} onClick={() => setMeasure(key)}>{label}</button>)}</div>
      <BarChart data={ranking} label={measure === 'total' ? 'Interacciones por tema' : 'Reacciones recibidas por tema'} loading={loading} onSelect={onTopic} selected={filters?.tema} disabled={pending}/>
      <p className="chart-reading">{measure === 'total' ? 'Cada registro cuenta como una interacción.' : 'Suma de las reacciones recibidas por los registros de cada tema.'}</p></>}
    <MeasurementGuide measure="topics"/>
  </ChartCard><ChartCard title="Sentimiento promedio por tema" subtitle={topic ? 'Promedio de las puntuaciones registradas para este tema en la selección.' : 'Compara la puntuación registrada de los 10 temas con más interacciones.'}><SentimentBars data={detail} loading={loading} onSelect={onTopic} selected={filters?.tema} disabled={pending}/><MeasurementGuide measure="sentiment"/></ChartCard></div>;
}

export function TrendAnalysis({ data, loading, pending, selectedDay, onDay }) {
  const rows = data?.analisis_diario?.map(row => ({ key: row.fecha, label: row.fecha, shortLabel: shortDate(row.fecha), value: row.reacciones_recibidas }));
  return <div className="analysis-suite"><ChartCard className="analysis-primary" title="Interacciones registradas por día" subtitle="Identifica las fechas con mayor volumen de actividad. Fechas en UTC."><TrendChart data={data?.por_dia} loading={loading} onSelect={onDay} selected={selectedDay} disabled={pending}/><MeasurementGuide measure="daily"/></ChartCard>
    <div className="analysis-pair"><ChartCard title="Reacciones según la fecha de la interacción" subtitle="Reacciones acumuladas por los registros creados en cada fecha UTC."><ColumnChart rows={rows} label="Reacciones recibidas por día" unit="reacciones recibidas" loading={loading} onSelect={onDay} selected={selectedDay} disabled={pending} action="Explorar este día"/><MeasurementGuide measure="reactions"/></ChartCard>
    <ChartCard title="Sentimiento promedio por día" subtitle="Compara la puntuación media de los registros de cada fecha."><SentimentTrend data={data?.analisis_diario} loading={loading} onSelect={onDay} selected={selectedDay} disabled={pending}/><MeasurementGuide measure="sentimentDaily"/></ChartCard></div></div>;
}

export function HourAnalysis({ data, loading, pending, filters, onCell, onDimension }) {
  const { days, hours } = timeDistributions(data?.actividad_semanal);
  return <div className="analysis-suite"><ChartCard className="analysis-primary" title="Mapa de calor de actividad" subtitle="Filas: días de la semana. Columnas: horas UTC. Un color más intenso significa más interacciones acumuladas en esa franja."><Heatmap data={data?.actividad_semanal} loading={loading} onSelect={onCell} selected={filters} disabled={pending}/><MeasurementGuide measure="hours"/></ChartCard>
    <div className="analysis-pair"><ChartCard title="A qué hora participa la comunidad" subtitle="Suma de cada hora entre todos los días seleccionados. UTC."><ColumnChart rows={data?.total_interacciones ? hours : []} label="Interacciones por hora" loading={loading} onSelect={key => onDimension('hora', key)} selected={filters?.hora == null ? null : String(filters.hora)} disabled={pending} action="Filtrar esta hora"/></ChartCard>
    <ChartCard title="Interacciones por día de la semana" subtitle="Total de registros de cada día de la semana dentro de la selección."><ColumnChart rows={data?.total_interacciones ? days : []} label="Interacciones por día de la semana" loading={loading} onSelect={key => onDimension('dia_semana', key)} selected={filters?.dia_semana == null ? null : String(filters.dia_semana)} disabled={pending} action="Filtrar este día de la semana"/></ChartCard></div></div>;
}
