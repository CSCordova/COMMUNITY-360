export const cleanFilters = { inicio: '', fin: '', canal: '', tipo: '', tema: '', dia_semana: '', hora: '' };
export const weekDays = ['Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado', 'Domingo'];
export const interactionLabel = total => total === 1 ? 'interacción' : 'interacciones';

export function filterDraft(filters = {}) {
  return Object.fromEntries(Object.keys(cleanFilters).map(key => [key, filters[key] != null && filters[key] !== '' ? ['inicio', 'fin'].includes(key) ? filters[key].slice(0, 10) : String(filters[key]) : '']));
}

export function filterRequest(draft) {
  const filters = Object.fromEntries(Object.entries(draft).filter(([, value]) => value != null && value !== ''));
  if (filters.inicio) filters.inicio += 'T00:00:00Z';
  if (filters.fin) filters.fin += 'T23:59:59.999999Z';
  for (const key of ['dia_semana', 'hora']) if (filters[key] != null) filters[key] = Number(filters[key]);
  return filters;
}

export function periodPreset(range, days) {
  if (!days) return { inicio: '', fin: '' };
  if (!range?.fin) return null;
  const end = new Date(range.fin);
  if (Number.isNaN(end.getTime())) return null;
  const start = new Date(end);
  start.setUTCDate(start.getUTCDate() - days + 1);
  return { inicio: start.toISOString().slice(0, 10), fin: end.toISOString().slice(0, 10) };
}

export const filterNames = { inicio: 'Desde', fin: 'Hasta', canal: 'Canal', tipo: 'Tipo', tema: 'Tema', dia_semana: 'Día', hora: 'Hora' };
export function filterLabel(key, value) {
  if (key === 'dia_semana') return weekDays[Number(value)];
  if (key === 'hora') return `${String(value).padStart(2, '0')}:00 UTC`;
  return value;
}

// Preserve ties; a category with zero records cannot be a leading category.
export function leaders(rows = []) {
  const maximum = Math.max(0, ...rows.map(row => row.total));
  return maximum ? rows.filter(row => row.total === maximum) : [];
}

export function share(value, total) {
  return total > 0 && Number.isFinite(value) ? new Intl.NumberFormat('es-MX', { maximumFractionDigits: 1 }).format(value / total * 100) : null;
}

export function riskReading(history) {
  if (!history || !Array.isArray(history.por_estatus)) return null;
  const total = history.por_estatus.filter(row => row.categoria.replaceAll('_', ' ').trim().toLowerCase() === 'en riesgo').reduce((sum, row) => sum + row.total, 0);
  return { total, percentage: share(total, history.usuarios) };
}

export function hourLabel(row) {
  return `${weekDays[row.dia_semana]}, ${String(row.hora).padStart(2, '0')}:00–${String(row.hora + 1).padStart(2, '0')}:00`;
}

// All bins use the same filtered snapshot, including hours or weekdays with zero activity.
export function timeDistributions(cells = []) {
  const days = weekDays.map((label, key) => ({ key: String(key), label, shortLabel: ['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom'][key], value: 0 }));
  const hours = Array.from({ length: 24 }, (_, key) => ({ key: String(key), label: `${String(key).padStart(2, '0')}:00`, value: 0 }));
  for (const cell of cells) {
    if (days[cell.dia_semana] && hours[cell.hora]) {
      days[cell.dia_semana].value += cell.total;
      hours[cell.hora].value += cell.total;
    }
  }
  return { days, hours };
}
