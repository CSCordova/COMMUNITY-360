import { useState } from 'react';
import { categoryLabel, formatNumber } from './charts';
import { ResourceFeedback, useReadResource } from './useReadResource';

export default function ParticipationPanel({ active }) {
  const [status, setStatus] = useState('en_riesgo');
  const [sort, setSort] = useState('inactividad');
  const [page, setPage] = useState({ key: '', offset: 0 });
  const key = `${status}:${sort}`;
  const offset = page.key === key ? page.offset : 0;
  const query = new URLSearchParams({ orden: sort, limite: 20, desplazamiento: offset, ...(status ? { estatus: status } : {}) });
  const resource = useReadResource(`/api/analitica/participacion?${query}`, active);
  const data = resource.data;
  return <section className="participation-view" aria-label="Participación del padrón"><div className="participation-notice"><span className="status-dot amber"/><div><h2>Participación que conviene revisar</h2><p>Los estados vienen del padrón original. Los días sin actividad se cuentan hasta la última fecha de actividad registrada en todo el padrón, no hasta hoy. No se calcula una probabilidad de abandono.</p></div></div>
    <div className="records-controls"><label>Estado de participación<select value={status} onChange={event => setStatus(event.target.value)}><option value="en_riesgo">En riesgo</option><option value="inactivo">Inactivo</option><option value="activo">Activo</option><option value="">Todos los estados</option></select></label><label>Orden de participación<select value={sort} onChange={event => setSort(event.target.value)}><option value="inactividad">Más días sin actividad</option><option value="estatus">Estado y última actividad</option></select></label></div>
    <ResourceFeedback resource={resource}/>
    {data && <><div className="section-toolbar"><p><strong>{formatNumber(data.total)}</strong> {data.total === 1 ? 'miembro' : 'miembros'} en esta selección</p><span>Fecha de referencia: {data.fecha_corte || 'Sin fecha'}</span></div><div className="records-table-scroll"><table className="participation-table"><thead><tr><th>Miembro</th><th>Estado de origen</th><th>Última actividad</th><th>Días sin actividad</th><th>Mensajes / 30 días</th></tr></thead><tbody>{data.items.map(row => <tr key={row.referencia}><td>{row.usuario}</td><td><span className={`participation-status ${row.estatus}`}>{categoryLabel(row.estatus)}</span></td><td>{row.ultima_actividad}</td><td>{row.dias_sin_actividad}</td><td>{formatNumber(row.mensajes_30d)}</td></tr>)}</tbody></table></div>{!data.items.length && <p className="records-empty">No hay miembros con este estado en el padrón.</p>}<div className="records-pagination"><p>{data.total ? `${offset + 1}–${Math.min(offset + 20, data.total)} de ${data.total}` : '0 miembros'}</p><div><button className="secondary-button" disabled={resource.busy || !offset} onClick={() => setPage({ key, offset: offset - 20 })}>Anterior</button><button className="secondary-button" disabled={resource.busy || offset + 20 >= data.total} onClick={() => setPage({ key, offset: offset + 20 })}>Siguiente</button></div></div></>}
  </section>;
}
