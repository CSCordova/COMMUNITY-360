import { useState } from 'react';
import { BarChart, ChartCard, DonutChart, categoryLabel, formatNumber } from './charts';
import { FluidNumber } from './motion';
import { ViewTabs } from './ui';

const dimensions = [
  { id: 'edad', label: 'Grupos de edad', field: 'por_rango_edad', type: 'bars' },
  { id: 'especies', label: 'Categorías / especies', field: 'por_especie', type: 'donut' },
  { id: 'intereses', label: 'Intereses clave', field: 'por_interes', type: 'bars' },
  { id: 'plataformas', label: 'Plataformas', field: 'por_plataforma', type: 'donut' },
];

export default function DemographyPanel({ history, error, busy, refresh, consulted }) {
  const [selected, setSelected] = useState('edad');
  const current = dimensions.find(item => item.id === selected);
  const h = history?.indicadores;
  const rows = [...(h?.[current.field] || [])].sort((a, b) => b.total - a.total || a.categoria.localeCompare(b.categoria));
  const total = rows.reduce((sum, row) => sum + row.total, 0);
  return <section aria-label="Datos históricos" className="demography-view">
    <div className="section-toolbar"><p>Perfil del padrón original. Estos datos no cambian al filtrar las interacciones.</p><button className="secondary-button" onClick={refresh} disabled={busy}>{busy ? 'Actualizando…' : 'Actualizar histórico'}</button></div>
    {error && <div className="dashboard-error"><p role="alert">{error}</p>{h && <p>Conservamos la última lectura disponible mientras recuperamos el servicio.</p>}<button className="secondary-button" onClick={refresh}>Reintentar consulta</button></div>}
    {(!error || h) && <>
    <div className="audience-summary"><div><span>Miembros del padrón</span><FluidNumber value={h?.usuarios}/></div><div><span>Artistas</span><FluidNumber value={h?.artistas}/></div><div><span>Mensajes del corte de 30 días</span><FluidNumber value={h?.mensajes_30d}/></div><div><span>Consulta</span><strong>{consulted ? consulted.toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' }) : 'En curso'}</strong></div></div>
    <ViewTabs idPrefix="audiencia" label="Dimensión del padrón" tabs={dimensions} selected={selected} onChange={setSelected}/>
    {dimensions.map(dimension => <div key={dimension.id} role="tabpanel" id={`audiencia-panel-${dimension.id}`} aria-labelledby={`audiencia-${dimension.id}`} hidden={selected !== dimension.id} className="audience-layout">{selected === dimension.id && <>
      <ChartCard title={current.label} subtitle="Composición de los miembros registrados en el corte original.">{current.type === 'donut' ? <DonutChart unit="miembros" singular="miembro" data={rows} label={`Distribución del padrón: ${current.label}`} loading={!h}/> : <BarChart data={rows} label={`Distribución del padrón: ${current.label}`} loading={!h} limit={30}/>}</ChartCard>
      <aside className="audience-breakdown"><div><h3>Desglose de la selección</h3><p>{formatNumber(total)} miembros distribuidos en {rows.length} categorías.</p></div>{rows.map(row => <div className="audience-category" key={row.categoria}><p><span>{categoryLabel(row.categoria)}</span><strong>{formatNumber(row.total)}</strong><span>{total ? (row.total / total * 100).toFixed(1) : '0'}%</span></p><div aria-hidden="true"><i style={{ width: `${total ? row.total / total * 100 : 0}%` }}/></div></div>)}{!rows.length && <p>Esperando categorías del padrón.</p>}</aside>
    </>}</div>)}
    </>}
  </section>;
}
