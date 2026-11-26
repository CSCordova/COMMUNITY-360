import { useState } from 'react';
import { categoryLabel } from './charts';
import { cleanFilters, filterRequest, periodPreset, weekDays } from './analysis';
import { Icon } from './ui';

export default function ActivityFilters({ open, initial, options = {}, range, pending, onApply, onClose }) {
  const [draft, setDraft] = useState(initial);
  const [error, setError] = useState('');
  const changes = Object.keys(cleanFilters).filter(key => draft[key] !== initial[key]).length;
  const change = (key, value) => { setDraft(previous => ({ ...previous, [key]: value })); setError(''); };
  const choices = key => [...new Set([...(options[key] || []), ...(draft[key] ? [draft[key]] : [])])];
  function submit(event) {
    event.preventDefault();
    if (draft.inicio && draft.fin && draft.inicio > draft.fin) { setError('La fecha inicial debe ser anterior o igual a la fecha final.'); return; }
    setError(''); onApply(draft, filterRequest(draft));
  }
  function preset(days) {
    const dates = periodPreset(range, days);
    if (dates) { setDraft(previous => ({ ...previous, ...dates })); setError(''); }
  }
  return <div id="activity-filters" className={`filter-disclosure ${open ? 'is-open' : ''}`} aria-hidden={!open} inert={!open} onKeyDown={event => { if (open && event.key === 'Escape') { event.preventDefault(); onClose(); } }}>
    <div className="filter-disclosure-clip"><form className="dashboard-filters filter-workbench" aria-label="Filtros de actividad" onSubmit={submit}>
      <div className="filter-heading"><div><h2>Delimita la conversación</h2><p>Combina criterios o selecciona directamente una gráfica.</p></div><button className="filter-close" type="button" aria-label="Cerrar filtros" onClick={onClose}><span aria-hidden="true">×</span></button></div>
      <fieldset disabled={pending}><legend className="sr-only">Criterios de selección</legend>
        <div className="period-presets" role="group" aria-label="Atajos del periodo"><span>Periodo</span>{[[0, 'Todo el periodo'], [7, '7 días del periodo'], [30, '30 días del periodo']].map(([days, label]) => { const value = periodPreset(range, days); const selected = value && draft.inicio === value.inicio && draft.fin === value.fin; return <button key={days} type="button" aria-pressed={Boolean(selected)} disabled={!value} onClick={() => preset(days)}>{label}</button>; })}</div>
        <p className="period-hint">Los atajos terminan en la fecha más reciente de los datos disponibles. Horarios en UTC.</p>
        <div className="filter-fields"><label>Desde<input aria-label="Desde" type="date" value={draft.inicio} max={draft.fin || '9999-12-31'} onChange={event => change('inicio', event.target.value)}/></label><label>Hasta<input aria-label="Hasta" type="date" value={draft.fin} min={draft.inicio || '0001-01-01'} onChange={event => change('fin', event.target.value)}/></label>
          {[['canal', 'Canal'], ['tipo', 'Tipo de interacción'], ['tema', 'Tema']].map(([key, label]) => <label key={key}>{label}<select aria-label={label} value={draft[key]} onChange={event => change(key, event.target.value)}><option value="">{key === 'canal' ? 'Todos los canales' : key === 'tipo' ? 'Todos los tipos' : 'Todos los temas'}</option>{choices(key).map(value => <option key={value} value={value}>{categoryLabel(value)}</option>)}</select></label>)}
          <label>Día de la semana<select aria-label="Día de la semana" value={draft.dia_semana} onChange={event => change('dia_semana', event.target.value)}><option value="">Todos los días</option>{weekDays.map((day, index) => <option value={String(index)} key={day}>{day}</option>)}</select></label>
          <label>Franja horaria<select aria-label="Franja horaria" value={draft.hora} onChange={event => change('hora', event.target.value)}><option value="">Todas las horas</option>{Array.from({ length: 24 }, (_, hour) => <option key={hour} value={String(hour)}>{String(hour).padStart(2, '0')}:00–{String(hour + 1).padStart(2, '0')}:00 UTC</option>)}</select></label>
        </div>
        <div className="filter-actions"><p aria-live="polite">{changes ? `${changes} ${changes === 1 ? 'criterio pendiente' : 'criterios pendientes'} de aplicar.` : 'Las gráficas reflejan la selección aplicada.'}</p><div><button className="text-button" type="button" onClick={() => { setDraft(cleanFilters); setError(''); onApply(cleanFilters, {}); }}>Limpiar filtros</button><button className="primary-button apply-button" type="submit"><Icon name="filter"/>{pending ? 'Aplicando…' : 'Aplicar filtros'}</button></div></div>
      </fieldset>{error && <p className="filter-error" role="alert">{error}</p>}
    </form></div>
  </div>;
}
