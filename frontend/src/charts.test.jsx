import { afterEach, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { DonutChart, TrendChart } from './charts';

afterEach(cleanup);

it('consulta un día por teclado y recupera una lectura válida si ese día desaparece', () => {
  const view = render(<TrendChart data={[{ fecha: '2026-11-01', total: 2 }, { fecha: '2026-11-02', total: 5 }]}/>);
  expect(screen.getByText('5 interacciones')).toBeInTheDocument();
  fireEvent.focus(screen.getByLabelText('2026-11-01: 2 interacciones'));
  expect(screen.getByText('2 interacciones')).toBeInTheDocument();
  view.rerender(<TrendChart data={[{ fecha: '2026-11-02', total: 1 }]}/>);
  expect(screen.getByText('1 interacción')).toBeInTheDocument();
  expect(screen.queryByText('2 interacciones')).not.toBeInTheDocument();
  view.rerender(<TrendChart data={[]}/>);
  expect(screen.getByText('No hay registros para esta selección.')).toBeInTheDocument();
});

it('muestra la unidad de la dona sin confundir miembros e interacciones', () => {
  const view = render(<DonutChart data={[{categoria:'Telegram',total:10}]} label="Padrón" unit="miembros" singular="miembro"/>);
  expect(document.querySelector('.donut-caption')).toHaveTextContent('miembros');
  view.rerender(<DonutChart data={[{categoria:'Telegram',total:1}]} label="Actividad"/>);
  expect(document.querySelector('.donut-caption')).toHaveTextContent('interacción');
});
