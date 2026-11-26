import { useId } from 'react';

export const palette = ['#22685a', '#b6d56d', '#79b8b1', '#e6bb72', '#8b99ad', '#cf8f86', '#78964d', '#afa3ba'];
export const formatNumber = value => value == null ? '—' : new Intl.NumberFormat('es-MX', { maximumFractionDigits: 2 }).format(value);
export const categoryLabel = value => ({ mensaje: 'Mensajes', comentario: 'Comentarios', reaccion: 'Reacciones', respuesta_encuesta: 'Encuestas', rsvp_evento: 'Confirmaciones de evento', en_riesgo: 'En riesgo', activo: 'Activo', inactivo: 'Inactivo', ocasional: 'Ocasional' }[value] || value);
export function ChartCard({ title, subtitle, source, children, className = '' }) {
  const id = useId();
  return <figure className={`chart-card ${className}`} aria-labelledby={id}><figcaption><div><h3 id={id}>{title}</h3><p>{subtitle}</p></div><span className={`source-tag ${source === 'REST' ? 'historical' : ''}`}>{source}</span></figcaption>{children}</figure>;
}
export function EmptyChart({ loading = false }) {
  return <div className="chart-empty"><span aria-hidden="true">⌁</span><p>{loading ? 'Esperando los datos…' : 'No hay registros para esta selección.'}</p></div>;
}
export function BarChart({ data = [], label, limit = 10, loading = false }) {
  const rows = [...data].sort((a, b) => b.total - a.total || a.categoria.localeCompare(b.categoria)).slice(0, limit);
  const max = Math.max(...rows.map(row => row.total), 1);
  if (!rows.length) return <EmptyChart loading={loading}/>;
  return <div className="horizontal-bars" role="img" aria-label={label}>{rows.map((row, index) => <div className="horizontal-bar-row" key={row.categoria} tabIndex="0" title={`${categoryLabel(row.categoria)}: ${formatNumber(row.total)}`}><span>{categoryLabel(row.categoria)}</span><div className="horizontal-bar-track"><i style={{ width: `${row.total / max * 100}%`, background: index === 0 ? palette[0] : '#81b5a0' }}/></div><strong>{formatNumber(row.total)}</strong></div>)}</div>;
}
export function DonutChart({ data = [], label, loading = false }) {
  const total = data.reduce((sum, row) => sum + row.total, 0);
  if (!total) return <EmptyChart loading={loading}/>;
  let offset = 0;
  const circumference = 2 * Math.PI * 65;
  return <div className="donut-layout"><svg viewBox="0 0 200 200" role="img" aria-label={label}><title>{label}</title><circle cx="100" cy="100" r="65" fill="none" stroke="#edf2ee" strokeWidth="25"/>{data.map((row, index) => {
    const length = row.total / total * circumference;
    const start = offset; offset += length;
    return <circle key={row.categoria} cx="100" cy="100" r="65" fill="none" stroke={palette[index % palette.length]} strokeWidth="25" strokeDasharray={`${length} ${circumference - length}`} strokeDashoffset={-start} transform="rotate(-90 100 100)" tabIndex="0" aria-label={`${categoryLabel(row.categoria)}: ${formatNumber(row.total)}, ${(row.total / total * 100).toFixed(1)}%`}><title>{categoryLabel(row.categoria)}: {formatNumber(row.total)} ({(row.total / total * 100).toFixed(1)}%)</title></circle>;
  })}<text x="100" y="100" textAnchor="middle" className="donut-total">{formatNumber(total)}</text><text x="100" y="121" textAnchor="middle" className="donut-caption">registros</text></svg><ul className="chart-legend">{data.map((row, index) => <li key={row.categoria}><span className="legend-dot" style={{ background: palette[index % palette.length] }}/><span>{categoryLabel(row.categoria)}</span><strong>{(row.total / total * 100).toFixed(1)}<small>%</small></strong></li>)}</ul></div>;
}
const dateLabel = value => new Date(`${value}T00:00:00Z`).toLocaleDateString('es-MX', { day: '2-digit', month: 'short', timeZone: 'UTC' });
export function TrendChart({ data = [], loading = false }) {
  if (!data.length) return <EmptyChart loading={loading}/>;
  const times = data.map(row => Date.parse(`${row.fecha}T00:00:00Z`));
  const min = Math.min(...times), max = Math.max(...times), top = Math.max(...data.map(row => row.total), 1);
  const points = data.map((row, i) => ({ ...row, x: max === min ? 350 : 48 + (times[i] - min) / (max - min) * 620, y: 175 - row.total / top * 140 }));
  const line = points.map(point => `${point.x},${point.y}`).join(' ');
  return <div className="trend-scroll"><svg className="trend-chart" viewBox="0 0 710 220" role="img" aria-label="Interacciones por día en UTC"><title>Interacciones por día en UTC; puntos en los días con registros.</title>{[0, .5, 1].filter(level => Number.isInteger(top * level)).map(level => <g key={level}><line x1="48" y1={175 - level * 140} x2="680" y2={175 - level * 140} stroke="#e5ece7" strokeDasharray="4 5"/><text x="35" y={179 - level * 140} textAnchor="end">{formatNumber(top * level)}</text></g>)}<polygon points={`${points[0].x},175 ${line} ${points.at(-1).x},175`} fill="#e7f0d7"/><polyline points={line} fill="none" stroke="#387d64" strokeWidth="2.5" strokeLinejoin="round"/>{points.map(point => <circle key={point.fecha} cx={point.x} cy={point.y} r="3.5" fill="#387d64" stroke="#fff" strokeWidth="1.5" tabIndex="0" aria-label={`${point.fecha}: ${point.total} interacciones`}><title>{point.fecha}: {point.total} interacciones</title></circle>)}{[...new Set([0, Math.floor((data.length - 1) / 2), data.length - 1])].map(i => <text key={i} x={points[i].x} y="205" textAnchor="middle">{dateLabel(data[i].fecha)}</text>)}</svg></div>;
}
const days = ['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom'];
export function Heatmap({ data = [], loading = false }) {
  const max = Math.max(...data.map(row => row.total), 0);
  if (!max) return <EmptyChart loading={loading}/>;
  return <><div className="heatmap-scroll"><svg viewBox="0 0 810 225" role="img" aria-label="Mapa de calor de interacciones por día de la semana y hora UTC"><title>Actividad por día de la semana y hora UTC</title>{days.map((day, index) => <text key={day} x="0" y={44 + index * 25}>{day}</text>)}{Array.from({ length: 24 }, (_, hour) => <text key={hour} x={57 + hour * 31} y="16" textAnchor="middle">{hour.toString().padStart(2, '0')}</text>)}{data.map(row => <rect key={`${row.dia_semana}-${row.hora}`} x={44 + row.hora * 31} y={28 + row.dia_semana * 25} width="26" height="20" rx="4" fill={row.total ? `rgba(34,104,90,${.2 + row.total / max * .8})` : '#edf2ee'} tabIndex={row.total ? 0 : undefined} aria-label={`${days[row.dia_semana]}, ${row.hora}:00 UTC: ${row.total} interacciones`}><title>{days[row.dia_semana]}, {row.hora}:00 UTC: {row.total} interacciones</title></rect>)}</svg></div><div className="heatmap-key"><span>Menor actividad</span><i style={{ background: '#edf2ee' }}/>{[.3, .55, .8, 1].map(alpha => <i key={alpha} style={{ background: `rgba(34,104,90,${alpha})` }}/>) }<span>Mayor actividad · máximo {max}</span></div></>;
}
