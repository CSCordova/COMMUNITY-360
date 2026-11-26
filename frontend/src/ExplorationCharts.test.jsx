import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { ColumnChart, SentimentBars, SentimentTrend, TopicAnalysis, HourAnalysis } from './ExplorationCharts';
import { timeDistributions } from './analysis';

afterEach(cleanup);

it('las distribuciones horarias conservan los totales y los ceros de lunes y medianoche', () => {
  const result = timeDistributions([{ dia_semana: 0, hora: 0, total: 2 }, { dia_semana: 1, hora: 0, total: 3 }, { dia_semana: 0, hora: 23, total: 4 }]);
  expect(result.days).toHaveLength(7);
  expect(result.hours).toHaveLength(24);
  expect(result.days[0].value).toBe(6);
  expect(result.hours[0].value).toBe(5);
  expect(result.days.reduce((sum, row) => sum + row.value, 0)).toBe(9);
  expect(result.hours.reduce((sum, row) => sum + row.value, 0)).toBe(9);
  expect(result.hours[22].value).toBe(0);
});

it('las columnas inspeccionan sin filtrar y permiten seleccionar una hora cero', () => {
  const select = vi.fn();
  const view = render(<ColumnChart rows={[{ key: '0', label: '00:00', value: 0 }, { key: '1', label: '01:00', value: 3 }]} label="Horas" onSelect={select}/>);
  fireEvent.click(screen.getByRole('button', { name: 'Consultar 00:00: 0 interacciones' }));
  expect(select).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Filtrar esta selección' }));
  expect(select).toHaveBeenCalledWith('0');
  view.rerender(<ColumnChart rows={[{ key: '1', label: '01:00', value: 3 }]} label="Horas" onSelect={select}/>);
  fireEvent.click(screen.getByRole('button', { name: 'Filtrar esta selección' }));
  expect(select).toHaveBeenLastCalledWith('1');
});

it('los temas cambian de medida usando reacciones reales y conservan la selección', () => {
  const select = vi.fn();
  render(<TopicAnalysis data={{ por_tema: [{ categoria: 'arte', total: 2 }], analisis_temas: [{ categoria: 'arte', total: 2, reacciones_recibidas: 0, sentimiento_promedio: -.25 }] }} filters={{}} onTopic={select}/>);
  fireEvent.click(screen.getByRole('button', { name: 'Reacciones recibidas', exact: true }));
  const ranking = screen.getByRole('group', { name: 'Reacciones recibidas por tema' });
  expect(within(ranking).getByLabelText('0')).toBeInTheDocument();
  fireEvent.click(within(ranking).getByRole('button', { name: 'Filtrar por arte' }));
  expect(select).toHaveBeenCalledWith('arte');
  fireEvent.click(screen.getByRole('button', { name: 'Explorar tema arte: sentimiento -0.25' }));
  expect(select).toHaveBeenCalledTimes(2);
});

it('un promedio cero es válido sin afirmar que todos los registros son neutros', () => {
  const view = render(<SentimentBars data={[{ categoria: 'arte', total: 2, sentimiento_promedio: 0 }]} onSelect={() => {}}/>);
  expect(screen.getByRole('button', { name: 'Explorar tema arte: sentimiento 0' })).toBeInTheDocument();
  expect(screen.getByText(/Cero puede resultar de mezclar valores positivos y negativos/)).toBeInTheDocument();
  view.rerender(<SentimentBars data={[]}/>);
  expect(screen.getByText('No hay registros para esta selección.')).toBeInTheDocument();
});

it('un tema filtrado muestra cantidades con unidad en lugar de una barra comparativa sin contexto', () => {
  const select = vi.fn();
  const data = { por_tema: [{ categoria: 'arte_comisiones', total: 48 }], analisis_temas: [{ categoria: 'arte_comisiones', total: 48, reacciones_recibidas: 146, sentimiento_promedio: .24 }] };
  const view = render(<TopicAnalysis data={data} filters={{ tema: 'arte_comisiones' }} onTopic={select}/>);
  expect(screen.getByText('Las 48 interacciones de este tema acumulan 146 reacciones recibidas.')).toBeInTheDocument();
  expect(screen.getByText('Calculado con 48 interacciones de esta selección.')).toBeInTheDocument();
  expect(screen.queryByRole('group', { name: 'Interacciones por tema' })).not.toBeInTheDocument();
  expect(screen.getByText(/\+0.60 y −0.12 tienen un promedio de \+0.24/)).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Comparar con otros temas' }));
  expect(select).toHaveBeenCalledWith('arte_comisiones');
  view.rerender(<TopicAnalysis data={data} filters={{ tema: 'arte_comisiones' }} onTopic={select} pending/>);
  expect(screen.getByRole('button', { name: 'Comparar con otros temas' })).toBeDisabled();
});

it('explica que las reacciones se agrupan por la fecha del registro y no por la fecha de reacción', async () => {
  const { TrendAnalysis } = await import('./ExplorationCharts');
  render(<TrendAnalysis data={{ analisis_diario: [{ fecha: '2026-11-01', total: 1, reacciones_recibidas: 0, sentimiento_promedio: 0 }] }} onDay={() => {}}/>);
  expect(screen.getByText(/La fecha es la de la interacción que las recibió/)).toBeInTheDocument();
  expect(screen.getByText('Base: 1 interacción.')).toBeInTheDocument();
});

it('un día con registros y cero reacciones conserva el cero en la escala y en la lectura', () => {
  const view = render(<ColumnChart rows={[{ key: '2026-11-01', label: '2026-11-01', value: 0 }]} unit="reacciones recibidas" label="Reacciones"/>);
  expect(document.querySelector('.column-scale>span').textContent).toBe('0');
  expect(screen.getByRole('button', { name: 'Consultar 2026-11-01: 0 reacciones recibidas' })).toBeInTheDocument();
  expect(screen.getByText('Hay registros, pero no reacciones recibidas en esta selección.')).toBeInTheDocument();
  view.rerender(<ColumnChart rows={[{ key: '2026-11-01', label: '2026-11-01', value: 1 }]} unit="reacciones recibidas" label="Reacciones"/>);
  expect(screen.getByRole('button', { name: 'Consultar 2026-11-01: 1 reacción recibida' })).toBeInTheDocument();
});

it('el sentimiento diario conserva signo, navegación por teclado y se recupera al desaparecer una fecha', () => {
  const select = vi.fn();
  const data = [{ fecha: '2026-11-01', sentimiento_promedio: -.5 }, { fecha: '2026-11-02', sentimiento_promedio: 0 }];
  const view = render(<SentimentTrend data={data} onSelect={select}/>);
  fireEvent.keyDown(screen.getByRole('img'), { key: 'Home' });
  expect(screen.getByLabelText('-0.500')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Explorar esta fecha' }));
  expect(select).toHaveBeenCalledWith('2026-11-01');
  view.rerender(<SentimentTrend data={data.slice(1)} onSelect={select}/>);
  expect(screen.getByLabelText('0.000')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Explorar esta fecha' }));
  expect(select).toHaveBeenLastCalledWith('2026-11-02');
});

it('las nuevas selecciones horarias distinguen la hora del día y se bloquean mientras llega el filtro', () => {
  const select = vi.fn();
  const props = { data: { total_interacciones: 2, actividad_semanal: [{ dia_semana: 0, hora: 0, total: 2 }] }, filters: {}, onDimension: select };
  const view = render(<HourAnalysis {...props}/>);
  fireEvent.click(screen.getByRole('button', { name: 'Filtrar esta hora' }));
  expect(select).toHaveBeenCalledWith('hora', '0');
  fireEvent.click(screen.getByRole('button', { name: 'Filtrar este día de la semana' }));
  expect(select).toHaveBeenCalledWith('dia_semana', '0');
  view.rerender(<HourAnalysis {...props} pending/>);
  expect(screen.getByRole('button', { name: 'Filtrar esta hora' })).toBeDisabled();
});
