import { filterDraft, filterNames, filterLabel } from './analysis';
import { categoryLabel, formatNumber } from './charts';

export default function SelectionSummary({ filters, total, pending, undoCount, onUndo, onClear, onRemove, hidden }) {
  const entries = Object.entries(filterDraft(filters)).filter(([, value]) => value !== '');
  return <section hidden={hidden} className={`selection-dock ${entries.length ? 'has-filters' : ''}`} aria-label="Selección aplicada">
    <div className="selection-dock-heading"><p>{entries.length ? <><strong>Filtros aplicados</strong><span>{pending ? 'Actualizando la selección…' : `${formatNumber(total)} interacciones en esta selección`}</span></> : <><strong>{total == null ? "Esperando la primera lectura" : "Todos los registros disponibles"}</strong><span>{total == null ? "Los indicadores aparecerán cuando recibamos los datos." : "Las gráficas y los registros comparten los filtros generales."}</span></>}</p><div className="selection-shortcuts">{undoCount > 0 && <button type="button" disabled={pending} onClick={onUndo}>Deshacer selección</button>}{entries.length > 0 && <button className="selection-reset" type="button" disabled={pending} onClick={onClear}>Quitar todos</button>}</div></div>
    {entries.length > 0 && <><div className="filter-chips selection-caption">{entries.map(([key, value]) => <span key={key}><span>{filterNames[key]}: {categoryLabel(filterLabel(key, value))}</span><button type="button" aria-label={`Quitar filtro ${filterNames[key]}: ${categoryLabel(filterLabel(key, value))}`} disabled={pending} onClick={() => onRemove(key)}>×</button></span>)}</div><p className="selection-exit-hint">Quita un criterio con × o usa «Quitar todos» para salir de la selección filtrada.</p></>}
  </section>;
}
