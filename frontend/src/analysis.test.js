import { describe, expect, it } from 'vitest';
import { filterDraft, filterRequest, hourLabel, leaders, periodPreset, riskReading, share } from './analysis';

describe('Lectura de los datos de la comunidad', () => {
  it('identifica todos los líderes empatados y no interpreta una selección vacía', () => {
    const rows = [{ categoria: 'arte', total: 4 }, { categoria: 'musica', total: 2 }, { categoria: 'eventos', total: 4 }];
    expect(leaders(rows)).toEqual([rows[0], rows[2]]);
    expect(leaders([{ categoria: 'arte', total: 0 }])).toEqual([]);
    expect(leaders()).toEqual([]);
    expect(share(3, 8)).toBe('37.5');
    expect(share(0, 0)).toBeNull();
  });
  it('mantiene el corte UTC y los demás filtros al retirar una sola categoría', () => {
    const original = { inicio: '2026-11-01T00:00:00Z', fin: '2026-11-25T23:59:59.999999Z', canal: 'Telegram', tema: 'arte' };
    const draft = filterDraft(original);
    expect(filterRequest(draft)).toEqual(original);
    expect(filterRequest({ ...draft, canal: '' })).toEqual({ inicio: original.inicio, fin: original.fin, tema: 'arte' });
    expect(original.canal).toBe('Telegram');
  });
  it('distingue clasificación histórica ausente, cero casos y porcentaje sobre el padrón', () => {
    expect(riskReading({ usuarios: 100 })).toBeNull();
    expect(riskReading({ usuarios: 100, por_estatus: [{ categoria: 'en_riesgo', total: 12 }, { categoria: 'activo', total: 88 }] })).toEqual({ total: 12, percentage: '12' });
    expect(riskReading({ usuarios: 0, por_estatus: [] })).toEqual({ total: 0, percentage: null });
    expect(hourLabel({ dia_semana: 6, hora: 23 })).toBe('Domingo, 23:00–24:00');
  });
  it('usa la última fecha del conjunto y conserva los ceros de lunes a medianoche', () => {
    expect(periodPreset({ fin: '2026-11-08T00:15:00Z' }, 7)).toEqual({ inicio: '2026-11-02', fin: '2026-11-08' });
    expect(periodPreset({ fin: '2026-03-02T00:00:00Z' }, 7)).toEqual({ inicio: '2026-02-24', fin: '2026-03-02' });
    expect(periodPreset({}, 7)).toBeNull();
    expect(filterRequest(filterDraft({ dia_semana: 0, hora: 0, tema: 'arte' }))).toEqual({ tema: 'arte', dia_semana: 0, hora: 0 });
  });
});
