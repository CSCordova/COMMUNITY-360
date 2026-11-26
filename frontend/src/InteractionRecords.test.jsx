import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import InteractionRecords from './InteractionRecords';

const { expire } = vi.hoisted(() => ({ expire: vi.fn() }));
vi.mock('./auth', () => ({ useAuth: () => ({ expire }) }));
const snapshot = { total_interacciones: 11 };
const rows = count => Array.from({ length: count }, (_, index) => ({ id_interaccion: `I${String(index + 1).padStart(7, '0')}`, id_usuario: 'U000001', timestamp: '2026-11-23T00:00:00Z', canal: 'Telegram', tipo: 'mensaje', tema: 'arte', sentimiento: .5, reacciones_recibidas: 2 }));
const reply = (data, status = 200) => ({ ok: status < 400, status, json: async () => data });
beforeEach(() => { expire.mockClear(); vi.stubGlobal('fetch', vi.fn()); });
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

it('consulta solo al abrir registros, conserva lunes y medianoche, y corrige una última página eliminada', async () => {
  let count = 11;
  fetch.mockImplementation(async path => {
    const offset = Number(new URL(path, 'http://local').searchParams.get('desplazamiento'));
    return reply({ total: count, items: rows(count).slice(offset, offset + 10) });
  });
  const props = { filters: { dia_semana: 0, hora: 0 }, snapshot, pending: false };
  const view = render(<InteractionRecords {...props} active={false}/>);
  expect(fetch).not.toHaveBeenCalled();
  view.rerender(<InteractionRecords {...props} active pending/>);
  expect(fetch).not.toHaveBeenCalled();
  view.rerender(<InteractionRecords {...props} active/>);
  expect(await screen.findByText('I0000001')).toBeVisible();
  expect(fetch.mock.calls[0][0]).toContain('dia_semana=0&hora=0');
  await userEvent.click(screen.getByRole('button', { name: 'Siguiente' }));
  expect(await screen.findByText('I0000011')).toBeVisible();
  count = 9;
  view.rerender(<InteractionRecords {...props} active snapshot={{ total_interacciones: 9 }}/>);
  expect(await screen.findByText(/1–9 de 9 interacciones/)).toBeVisible();
  expect(screen.queryByText('I0000011')).not.toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Siguiente' })).toBeDisabled();
  expect(fetch.mock.calls.every(([, options]) => !options.method || options.method === 'GET')).toBe(true);
});

it('busca solo al confirmar, conserva filtros generales y reinicia página al cambiar la consulta', async () => {
  const user = userEvent.setup();
  fetch.mockImplementation(async path => {
    const query = new URL(path, 'http://local').searchParams;
    const offset = Number(query.get('desplazamiento'));
    return reply({ total: query.get('buscar') ? 1 : 11, items: query.get('buscar') ? rows(1) : rows(11).slice(offset, offset + 10) });
  });
  render(<InteractionRecords active filters={{ canal: 'Telegram', hora: 0 }} snapshot={snapshot}/>);
  await screen.findByText('I0000001');
  await user.click(screen.getByRole('button', { name: 'Siguiente' }));
  await screen.findByText('I0000011');
  const before = fetch.mock.calls.length;
  await user.type(screen.getByRole('searchbox'), 'música');
  expect(fetch).toHaveBeenCalledTimes(before);
  await user.click(screen.getByRole('button', { name: 'Buscar', exact: true }));
  await screen.findByText('I0000001');
  const query = new URL(fetch.mock.calls.at(-1)[0], 'http://local').searchParams;
  expect(query.get('buscar')).toBe('música');
  expect(query.get('canal')).toBe('Telegram');
  expect(query.get('hora')).toBe('0');
  expect(query.get('desplazamiento')).toBe('0');
  await user.click(screen.getByRole('button', { name: 'Limpiar búsqueda' }));
  await screen.findByRole('button', { name: 'Última' });
  await waitFor(() => expect(new URL(fetch.mock.calls.at(-1)[0], 'http://local').searchParams.get('buscar')).toBe(''));
});

it('ordena, cambia tamaño, salta a una página y abre el contenido del registro sin escribir datos', async () => {
  const user = userEvent.setup();
  fetch.mockImplementation(async path => {
    const query = new URL(path, 'http://local').searchParams;
    const offset = Number(query.get('desplazamiento')), limit = Number(query.get('limite'));
    return reply({ total: 51, items: rows(51).slice(offset, offset + limit).map(row => ({ ...row, texto: 'Comentario de prueba', etiquetas: ['música'] })) });
  });
  render(<InteractionRecords active filters={{}} snapshot={snapshot}/>);
  await screen.findByText('I0000001');
  await user.selectOptions(screen.getByLabelText('Ordenar por'), 'reacciones_desc');
  await waitFor(() => expect(fetch.mock.calls.at(-1)[0]).toContain('orden=reacciones_desc'));
  await user.selectOptions(screen.getByLabelText('Registros por página'), '25');
  await screen.findByText('I0000025');
  await user.type(screen.getByLabelText('Ir a página'), '3');
  await user.click(screen.getByRole('button', { name: 'Ir', exact: true }));
  await screen.findByText('I0000051');
  expect(fetch.mock.calls.at(-1)[0]).toContain('desplazamiento=50');
  await user.click(screen.getByRole('button', { name: 'Ver detalle de I0000051' }));
  expect(screen.getByText('Comentario de prueba')).toBeVisible();
  await user.click(screen.getByRole('button', { name: 'Cerrar detalle', exact: true }));
  expect(screen.queryByText('Comentario de prueba')).not.toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Ver detalle de I0000051' })).toHaveFocus();
  expect(fetch.mock.calls.every(([, options]) => !options.method || options.method === 'GET')).toBe(true);
});

it('cancela la consulta anterior y descarta una respuesta tardía de otros filtros', async () => {
  let first;
  fetch.mockImplementationOnce(() => new Promise(resolve => { first = resolve; }));
  fetch.mockResolvedValue(reply({ total: 1, items: [{ ...rows(1)[0], id_interaccion: 'I0000099', canal: 'Discord' }] }));
  const view = render(<InteractionRecords active filters={{ canal: 'Telegram' }} snapshot={snapshot}/>);
  await waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));
  view.rerender(<InteractionRecords active filters={{ canal: 'Discord' }} snapshot={snapshot}/>);
  expect(await screen.findByText('I0000099')).toBeVisible();
  expect(fetch.mock.calls[0][1].signal.aborted).toBe(true);
  await act(async () => { first(reply({ total: 1, items: rows(1) })); });
  expect(screen.queryByText('I0000001')).not.toBeInTheDocument();
  expect(screen.getByText('Discord')).toBeVisible();
});

it('permite reintentar un fallo y responde a la revocación de sesión', async () => {
  fetch.mockResolvedValueOnce(reply({ detail: 'Consulta temporalmente no disponible.' }, 503));
  fetch.mockResolvedValueOnce(reply({ total: 0, items: [] }));
  const view = render(<InteractionRecords active filters={{}} snapshot={snapshot}/>);
  expect(await screen.findByRole('alert')).toHaveTextContent('Consulta temporalmente');
  await userEvent.click(screen.getByRole('button', { name: 'Reintentar registros' }));
  expect(await screen.findByText('No hay registros para esta selección.')).toBeVisible();
  fetch.mockResolvedValueOnce(reply({}, 401));
  view.rerender(<InteractionRecords active filters={{}} snapshot={{ total_interacciones: 1 }}/>);
  await waitFor(() => expect(expire).toHaveBeenCalledTimes(1));
});
