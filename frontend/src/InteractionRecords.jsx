import { Fragment, useEffect, useRef, useState } from 'react';
import { api } from './api';
import { useAuth } from './auth';
import { categoryLabel, formatNumber } from './charts';

const moment = value => new Date(value).toLocaleString('es-MX', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: 'UTC', hour12: false });

export default function InteractionRecords({ active, filters, snapshot, pending, onClearFilters, hasFilters }) {
  const { expire } = useAuth();
  const [draft, setDraft] = useState('');
  const [search, setSearch] = useState('');
  const [sort, setSort] = useState('fecha_desc');
  const [pageSize, setPageSize] = useState(10);
  const signature = JSON.stringify({ ...filters, buscar: search, orden: sort, limite: pageSize });
  const [page, setPage] = useState({ signature, offset: 0 });
  const offset = page.signature === signature ? page.offset : 0;
  const [jump, setJump] = useState('');
  const [detail, setDetail] = useState(null);
  const [result, setResult] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [retry, setRetry] = useState(0);
  const version = useRef(0);
  useEffect(() => {
    if (!active || !snapshot || pending) return;
    const request = ++version.current;
    const controller = new AbortController();
    setBusy(true); setError('');
    const query = new URLSearchParams({ ...JSON.parse(signature), desplazamiento: offset });
    api(`/api/interacciones?${query}`, { signal: controller.signal }).then(data => {
      if (request !== version.current) return;
      if (!Array.isArray(data.items) || !Number.isInteger(data.total) || data.total < 0) throw new Error('No se pudo interpretar la consulta de registros. Vuelve a intentarlo.');
      if (offset && data.total <= offset) { setPage({ signature, offset: Math.max(0, Math.floor((data.total - 1) / pageSize) * pageSize) }); return; }
      setResult({ ...data, signature, offset });
    }).catch(failure => {
      if (request !== version.current || controller.signal.aborted) return;
      if (failure.status === 401) expire(); else setError(failure.message);
    }).finally(() => { if (request === version.current) setBusy(false); });
    return () => { version.current++; controller.abort(); };
  }, [active, signature, offset, snapshot, pending, retry, expire, pageSize]);
  const available = result?.signature === signature && result?.offset === offset ? result : null;
  const totalPages = Math.max(1, Math.ceil((available?.total || 0) / pageSize));
  const currentPage = Math.floor(offset / pageSize) + 1;
  function goTo(index) { setPage({ signature, offset: index * pageSize }); setJump(''); setDetail(null); }
  function clearSearch() { setDraft(''); setSearch(''); setDetail(null); }
  function closeDetail(id) { setDetail(null); document.getElementById(`record-${id}`)?.focus({ preventScroll: true }); }
  return <section className="interaction-records" aria-label="Registros de la selección" aria-busy={busy || pending}>
    <div className="records-heading"><div><h3>Encuentra una interacción</h3><p>Busca dentro de los filtros generales aplicados y abre un registro para leer su contenido.</p></div><span className="read-only-note">Solo consulta</span></div>
    <form className="records-search" aria-label="Buscar registros" onSubmit={event => { event.preventDefault(); setSearch(draft.trim()); setDetail(null); }}>
      <label htmlFor="record-search">Texto, ID de interacción, participante o etiqueta</label><div><input id="record-search" type="search" maxLength="200" value={draft} onChange={event => setDraft(event.target.value)} placeholder="Ej. música, I0000123 o U000001"/><button className="chart-select-action" type="submit" disabled={pending}>Buscar</button>{(draft || search) && <button type="button" className="secondary-button" onClick={clearSearch}>Limpiar búsqueda</button>}</div>
      <p>Presiona Buscar o Enter. Esta búsqueda afecta solo a la tabla; las gráficas conservan los filtros generales.</p>
    </form>
    <div className="records-controls"><label>Ordenar por<select value={sort} onChange={event => { setSort(event.target.value); setDetail(null); }}><option value="fecha_desc">Más recientes primero</option><option value="fecha_asc">Más antiguos primero</option><option value="reacciones_desc">Más reacciones recibidas</option><option value="sentimiento_asc">Sentimiento: menor a mayor</option><option value="sentimiento_desc">Sentimiento: mayor a menor</option></select></label><label>Registros por página<select value={pageSize} onChange={event => { setPageSize(Number(event.target.value)); setDetail(null); }}>{[10, 25, 50].map(size => <option key={size} value={size}>{size}</option>)}</select></label></div>
    {search && <p className="records-search-applied">Búsqueda aplicada: <strong>«{search}»</strong></p>}
    {error && <div className="dashboard-error"><p role="alert">{error}</p><button className="secondary-button" type="button" onClick={() => setRetry(value => value + 1)}>Reintentar registros</button></div>}
    {(busy || pending) && <p role="status" className="records-status">{pending ? 'Esperando la selección aplicada antes de consultar sus registros…' : available ? 'Actualizando registros. La tabla corresponde a la lectura anterior.' : 'Consultando los registros de esta selección…'}</p>}
    {available && <>{available.total > 0 ? <div className="records-table-scroll"><table><caption className="sr-only">Interacciones de la selección aplicada. Fechas y horas en UTC.</caption><thead><tr><th>Interacción / fecha UTC</th><th>Participante</th><th>Canal y tipo</th><th>Tema</th><th>Sentimiento</th><th>Reacciones</th></tr></thead><tbody>{available.items.map(row => <Fragment key={row.id_interaccion}><tr><td><button id={`record-${row.id_interaccion}`} type="button" className="record-detail-toggle" aria-label={`${detail === row.id_interaccion ? 'Cerrar' : 'Ver'} detalle de ${row.id_interaccion}`} aria-expanded={detail === row.id_interaccion} aria-controls={detail === row.id_interaccion ? `detail-${row.id_interaccion}` : undefined} onClick={() => setDetail(detail === row.id_interaccion ? null : row.id_interaccion)}>{row.id_interaccion}<span aria-hidden="true">{detail === row.id_interaccion ? '−' : '+'}</span></button><time dateTime={row.timestamp}>{moment(row.timestamp)}</time></td><td>{row.id_usuario}</td><td>{row.canal}<small>{categoryLabel(row.tipo)}</small></td><td>{categoryLabel(row.tema)}</td><td>{Number(row.sentimiento).toFixed(3)}</td><td>{formatNumber(row.reacciones_recibidas)}</td></tr>{detail === row.id_interaccion && <tr className="record-detail-row" id={`detail-${row.id_interaccion}`}><td colSpan="6"><div><h4>Contenido de {row.id_interaccion}</h4><p className="record-content">{row.texto ?? 'Este registro de reacción no contiene texto.'}</p><p><strong>Etiquetas:</strong> {row.etiquetas?.length ? row.etiquetas.join(', ') : 'Sin etiquetas'}</p><button type="button" className="chart-select-action" onClick={() => closeDetail(row.id_interaccion)}>Cerrar detalle</button></div></td></tr>}</Fragment>)}</tbody></table></div> : <div className="records-empty"><p>No hay registros para esta selección.</p><p>{search ? 'Prueba menos palabras o limpia la búsqueda para volver a los registros de los filtros generales.' : 'Amplía las fechas o quita algún filtro general.'}</p>{search && <button type="button" className="chart-select-action" onClick={clearSearch}>Ver registros sin búsqueda</button>}{hasFilters && <button type="button" className="secondary-button" onClick={onClearFilters}>Quitar filtros generales</button>}</div>}
      <div className="records-pagination"><p aria-live="polite">{available.total ? `${offset + 1}–${Math.min(offset + pageSize, available.total)} de ${formatNumber(available.total)} interacciones` : '0 interacciones'}<span>Página {currentPage} de {totalPages}</span></p><div><button type="button" className="secondary-button" disabled={busy || pending || !offset} onClick={() => goTo(0)}>Primera</button><button type="button" className="secondary-button" disabled={busy || pending || !offset} onClick={() => goTo(currentPage - 2)}>Anterior</button><button type="button" className="secondary-button" disabled={busy || pending || currentPage >= totalPages} onClick={() => goTo(currentPage)}>Siguiente</button><button type="button" className="secondary-button" disabled={busy || pending || currentPage >= totalPages} onClick={() => goTo(totalPages - 1)}>Última</button></div></div>
      {totalPages > 1 && <form className="records-jump" aria-label="Ir a una página" onSubmit={event => { event.preventDefault(); const value = Number(jump); if (Number.isInteger(value) && value >= 1 && value <= totalPages) goTo(value - 1); }}><label htmlFor="records-page">Ir a página</label><input id="records-page" type="number" min="1" max={totalPages} step="1" required value={jump} onChange={event => setJump(event.target.value)} placeholder={String(currentPage)}/><button type="submit" className="secondary-button" disabled={busy || pending}>Ir</button></form>}
    </>}
  </section>;
}
