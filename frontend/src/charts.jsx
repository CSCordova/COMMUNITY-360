import { useId, useRef, useState } from 'react';
import { FluidNumber, useBarReorder, useFluidLine, useTweenMap } from './motion';
import { hourLabel, interactionLabel } from './analysis';

export const palette = ['#10b981', '#34d399', '#f59e0b', '#fbbf24', '#94a3b8', '#f43f5e', '#6ee7b7', '#6b7280'];
export const formatNumber = value => value == null ? '—' : new Intl.NumberFormat('es-MX', { maximumFractionDigits: 2 }).format(value);
export const categoryLabel = value => ({ mensaje: 'Mensajes', comentario: 'Comentarios', reaccion: 'Reacciones', respuesta_encuesta: 'Encuestas', rsvp_evento: 'Confirmaciones de evento', en_riesgo: 'En riesgo', activo: 'Activo', inactivo: 'Inactivo', ocasional: 'Ocasional', arte_comisiones: 'Arte y comisiones', eventos_convenciones: 'Eventos y convenciones', memes_humor: 'Memes y humor', reglas_moderacion: 'Reglas y moderación', seguridad_privacidad: 'Seguridad y privacidad' }[value] || value);
export function ChartCard({ title, subtitle, children, className = '' }) {
  const id = useId();
  return <figure className={`chart-card ${className}`} aria-labelledby={id}><figcaption><div><h3 id={id}>{title}</h3><p>{subtitle}</p></div></figcaption>{children}</figure>;
}
export function EmptyChart({ loading = false }) {
  return <div className={`chart-empty ${loading ? 'is-loading' : ''}`}><span aria-hidden="true">⌁</span>{loading && <div className="chart-skeleton resource-skeleton" aria-hidden="true"><i/><i/><i/><i/><i/></div>}<p>{loading ? 'Esperando los datos…' : 'No hay registros para esta selección.'}</p></div>;
}
export function BarChart({ data = [], label, limit = 10, loading = false, onSelect, selected, disabled }) {
  const rows = [...data].sort((a, b) => b.total - a.total || a.categoria.localeCompare(b.categoria)).slice(0, limit);
  const max = Math.max(...rows.map(row => row.total), 1);
  const total = data.reduce((sum, row) => sum + row.total, 0);
  const container = useBarReorder(rows.map(row => row.categoria).join('|'));
  if (!rows.length) return <EmptyChart loading={loading}/>;
  return <div ref={container} className={`horizontal-bars ${onSelect ? 'interactive-bars' : ''}`} role={onSelect ? 'group' : 'img'} aria-label={label}>
    {rows.map(row => { const Tag = onSelect ? 'button' : 'div'; return <Tag className={`horizontal-bar-row ${selected === row.categoria ? 'is-selected' : ''}`} data-bar-key={row.categoria} key={row.categoria}
      {...(onSelect ? { type: 'button', disabled, 'aria-pressed': selected === row.categoria, 'aria-label': `${selected === row.categoria ? 'Quitar filtro' : 'Filtrar por'} ${categoryLabel(row.categoria)}`, onClick: () => onSelect(row.categoria) } : { tabIndex: 0 })}
      title={`${categoryLabel(row.categoria)}: ${formatNumber(row.total)} (${total ? (row.total / total * 100).toFixed(1) : '0'}%)`}>
      <span>{categoryLabel(row.categoria)}</span><span className="horizontal-bar-track" aria-hidden="true"><i style={{ width: `${row.total / max * 100}%`, background: row.total === max ? palette[0] : '#07875f' }}/></span><FluidNumber value={row.total}/>
    </Tag>; })}{onSelect && <div className="chart-filter-help"><p className="chart-interaction-hint">{selected ? `Filtro activo: ${categoryLabel(selected)}. Todas las gráficas usan esta selección.` : 'Selecciona una barra para ver solo esa categoría. La barra más larga representa la mayor cantidad.'}</p>{selected && <button type="button" className="chart-select-action" disabled={disabled} onClick={() => onSelect(selected)}>Quitar filtro de esta gráfica</button>}</div>}
  </div>;
}
export function DonutChart({ data = [], label, unit = 'interacciones', singular = 'interacción', loading = false, onSelect, selected, disabled }) {
  const [inspected, setInspected] = useState(null);
  const total = data.reduce((sum, row) => sum + row.total, 0);
  const colors = useRef(new Map());
  for (const row of data) if (!colors.current.has(row.categoria)) colors.current.set(row.categoria, palette[colors.current.size % palette.length]);
  const totals = new Map(data.map(row => [row.categoria, row.total]));
  const ratios = useTweenMap(Object.fromEntries([...colors.current.keys()].filter(category => totals.has(category)).map(category => [category, total ? totals.get(category) / total : 0])), 700, true);
  const segments = Object.entries(ratios);
  if (!total && !segments.some(([, ratio]) => ratio > .0001)) return <EmptyChart loading={loading}/>;
  const focus = data.find(row => row.categoria === inspected);
  let offset = 0;
  const circumference = 2 * Math.PI * 65;
  return <div className="donut-layout"><svg viewBox="0 0 200 200" role="img" aria-label={label}><title>{label}</title><circle className="donut-track" cx="100" cy="100" r="65" fill="none" stroke="#30393a" strokeWidth="25"/>
    {segments.map(([category, ratio]) => {
      const row = data.find(item => item.categoria === category);
      const length = Math.max(0, ratio) * circumference;
      const start = offset; offset += length;
      const description = `${categoryLabel(category)}: ${formatNumber(row?.total ?? 0)}, ${(total && row ? row.total / total * 100 : 0).toFixed(1)}%`;
      return <circle key={category} cx="100" cy="100" r="65" fill="none" stroke={colors.current.get(category)} strokeWidth="25" strokeDasharray={`${length} ${Math.max(0, circumference - length)}`} strokeDashoffset={-start} transform="rotate(-90 100 100)" opacity={focus && inspected !== category ? .3 : 1} onMouseEnter={() => setInspected(category)} onMouseLeave={() => setInspected(null)} aria-label={description}><title>{description}</title></circle>;
    })}<FluidNumber as="text" x="100" y="100" textAnchor="middle" className="donut-total" value={focus?.total ?? total}/><text x="100" y="121" textAnchor="middle" className="donut-caption">{(focus?.total ?? total) === 1 ? singular : unit}</text></svg>
    <ul className="chart-legend">{data.map(row => { const Tag = onSelect ? 'button' : 'div'; return <li key={row.categoria}><Tag className={`legend-entry ${selected === row.categoria ? 'is-selected' : ''}`} onMouseEnter={() => setInspected(row.categoria)} onMouseLeave={() => setInspected(null)} onFocus={() => setInspected(row.categoria)} onBlur={() => setInspected(null)}
      {...(onSelect ? { type: 'button', disabled, 'aria-pressed': selected === row.categoria, 'aria-label': `${selected === row.categoria ? 'Quitar filtro' : 'Filtrar por'} ${categoryLabel(row.categoria)}`, onClick: () => onSelect(row.categoria) } : {})}>
      <span className="legend-dot" style={{ background: colors.current.get(row.categoria) }}/><span>{categoryLabel(row.categoria)}</span><span className="legend-count">{formatNumber(row.total)}</span><strong>{(total ? row.total / total * 100 : 0).toFixed(1)}<small>%</small></strong>
    </Tag></li>; })}</ul></div>;
}
const dateLabel = value => new Date(`${value}T00:00:00Z`).toLocaleDateString('es-MX', { day: '2-digit', month: 'short', timeZone: 'UTC' });
export function TrendChart({ data = [], loading = false, onSelect, selected, disabled }) {
  const [inspectedDate, setInspectedDate] = useState(null);
  const hintId = useId();
  const inspected = data.find(row => row.fecha === inspectedDate) || data.at(-1);
  const times = data.map(row => Date.parse(`${row.fecha}T00:00:00Z`));
  const min = Math.min(...times), max = Math.max(...times), top = Math.max(...data.map(row => row.total), 1);
  const points = data.map((row, index) => ({ ...row, x: max === min ? 350 : 48 + (times[index] - min) / (max - min) * 620, y: 175 - row.total / top * 140 }));
  const animated = useFluidLine(points.map(({ x, y }) => ({ x, y })));
  if (!data.length || !animated.length) return <EmptyChart loading={loading}/>;
  const line = animated.reduce((path, point, index) => {
    if (!index) return `M${point.x},${point.y}`;
    const before = animated[index - 1], middle = (before.x + point.x) / 2;
    return `${path} C${middle},${before.y} ${middle},${point.y} ${point.x},${point.y}`;
  }, '');
  const gradientId = `trend-${hintId.replace(/[^a-zA-Z0-9_-]/g, '')}`;
  function pointer(event) {
    const bounds = event.currentTarget.getBoundingClientRect();
    if (!bounds.width) return;
    const x = (event.clientX - bounds.left) / bounds.width * 710;
    const point = points.reduce((nearest, point) => Math.abs(point.x - x) < Math.abs(nearest.x - x) ? point : nearest);
    setInspectedDate(point.fecha);
  }
  function keys(event) {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault(); const current = data.indexOf(inspected);
    const next = event.key === 'Home' ? 0 : event.key === 'End' ? data.length - 1 : Math.max(0, Math.min(data.length - 1, current + (event.key === 'ArrowRight' ? 1 : -1)));
    setInspectedDate(data[next].fecha);
  }
  return <><div className="trend-scroll"><svg className="trend-chart" viewBox="0 0 710 220" role="img" aria-label="Interacciones por día en UTC" aria-describedby={hintId} tabIndex="0" onKeyDown={keys} onPointerMove={pointer} onPointerDown={pointer}>
    <title>Interacciones por día en UTC; puntos en los días con registros.</title>{[0, .5, 1].filter(level => Number.isInteger(top * level)).map(level => <g key={level}><line x1="48" y1={175 - level * 140} x2="680" y2={175 - level * 140} stroke="#ffffff14" strokeDasharray="4 5"/><text x="35" y={179 - level * 140} textAnchor="end">{formatNumber(top * level)}</text></g>)}
    <defs><linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#10b981" stopOpacity=".32"/><stop offset="100%" stopColor="#10b981" stopOpacity="0"/></linearGradient></defs>
    <path d={`${line} L${animated.at(-1).x},175 L${animated[0].x},175 Z`} fill={`url(#${gradientId})`}/><path d={line} fill="none" stroke="#34d399" strokeWidth="2.5" strokeLinejoin="round"/>
    {points.map(point => <circle key={point.fecha} cx={point.x} cy={point.y} r={inspected.fecha === point.fecha ? 6 : 3.5} fill="#34d399" stroke="#1b1f27" strokeWidth="1.5" onMouseEnter={() => setInspectedDate(point.fecha)} onFocus={() => setInspectedDate(point.fecha)} onClick={() => setInspectedDate(point.fecha)} aria-label={`${point.fecha}: ${point.total} interacciones`}><title>{point.fecha}: {point.total} interacciones</title></circle>)}
    {[...new Set([0, Math.floor((data.length - 1) / 2), data.length - 1])].map(index => <text key={index} x={points[index].x} y="205" textAnchor={index === 0 ? 'start' : index === data.length - 1 ? 'end' : 'middle'}>{dateLabel(data[index].fecha)}</text>)}
  </svg></div><div className="trend-readout"><p><time dateTime={inspected.fecha}>{inspected.fecha}</time><strong>{formatNumber(inspected.total)} {interactionLabel(inspected.total)}</strong></p>{onSelect && <button className="chart-select-action" type="button" disabled={disabled} onClick={() => onSelect(inspected.fecha)}>{selected === inspected.fecha ? 'Quitar filtro de este día' : 'Filtrar este día'}</button>}<span id={hintId}>Toca la gráfica o usa las flechas para consultar un día.</span></div></>;
}
const days = ['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom'];
export function Heatmap({ data = [], loading = false, onSelect, selected = {}, disabled }) {
  const [inspectedKey, setInspectedKey] = useState(null);
  const hintId = useId();
  const max = Math.max(...data.map(row => row.total), 0);
  if (!max) return <EmptyChart loading={loading}/>;
  const inspected = data.find(row => `${row.dia_semana}-${row.hora}` === inspectedKey) || data.reduce((best, row) => row.total > best.total ? row : best);
  const active = selected.dia_semana === inspected.dia_semana && selected.hora === inspected.hora;
  function inspect(day, hour) { setInspectedKey(`${Math.max(0, Math.min(6, day))}-${Math.max(0, Math.min(23, hour))}`); }
  function pointer(event) {
    const bounds = event.currentTarget.getBoundingClientRect();
    if (!bounds.width || !bounds.height) return;
    inspect(Math.floor(((event.clientY - bounds.top) / bounds.height * 225 - 28) / 25), Math.floor(((event.clientX - bounds.left) / bounds.width * 810 - 44) / 31));
  }
  function keys(event) {
    const change = { ArrowLeft: [0, -1], ArrowRight: [0, 1], ArrowUp: [-1, 0], ArrowDown: [1, 0] }[event.key];
    if (!change) return;
    event.preventDefault(); inspect(inspected.dia_semana + change[0], inspected.hora + change[1]);
  }
  return <><div className="heatmap-scroll"><svg viewBox="0 0 810 225" role="img" tabIndex="0" aria-label="Mapa de calor de interacciones por día de la semana y hora UTC" aria-describedby={hintId} onKeyDown={keys} onPointerDown={pointer} onPointerMove={pointer}>
    <title>Actividad por día de la semana y hora UTC</title>{days.map((day, index) => <text key={day} x="0" y={44 + index * 25}>{day}</text>)}{Array.from({ length: 24 }, (_, hour) => <text key={hour} x={57 + hour * 31} y="16" textAnchor="middle">{hour.toString().padStart(2, '0')}</text>)}
    {data.map(row => <rect key={`${row.dia_semana}-${row.hora}`} x={44 + row.hora * 31} y={28 + row.dia_semana * 25} width="26" height="20" rx="4" fill={row.total ? `rgba(16,185,129,${.2 + row.total / max * .8})` : '#2b3335'} stroke={row === inspected ? '#34d399' : 'transparent'} strokeWidth="2" onMouseEnter={() => inspect(row.dia_semana, row.hora)} onClick={() => inspect(row.dia_semana, row.hora)} aria-label={`${days[row.dia_semana]}, ${row.hora}:00 UTC: ${row.total} interacciones`}><title>{days[row.dia_semana]}, {row.hora}:00 UTC: {row.total} interacciones</title></rect>)}
  </svg></div><div className="heatmap-key"><span>Menor actividad</span><i style={{ background: '#2b3335' }}/>{[.3, .55, .8, 1].map(alpha => <i key={alpha} style={{ background: `rgba(16,185,129,${alpha})` }}/>) }<span>Mayor actividad</span></div>
    <div className="heatmap-inspector"><div><strong>{hourLabel(inspected)} UTC</strong><p>{formatNumber(inspected.total)} {interactionLabel(inspected.total)} en esta franja.</p><span id={hintId}>Selecciona una celda o usa las flechas para recorrer los horarios.</span></div>{onSelect && <button type="button" className="chart-select-action" disabled={disabled} onClick={() => onSelect(inspected)}>{active ? 'Quitar filtro de esta franja' : 'Filtrar esta franja'}</button>}</div>
  </>;
}
