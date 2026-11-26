import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { AuthProvider } from './auth';
import App from './App';

let loggedIn;
let failLogin;
let failLogout;
let unavailable;
let failPassword;
let failHistory;
const account = { id_cuenta: 1, usuario: 'cuenta_prueba' };
class TestSocket {
  static OPEN = 1;
  static connections = [];
  readyState = 0;
  constructor(url) { this.url = url; TestSocket.connections.push(this); }
  send = vi.fn();
  close = vi.fn(() => { this.readyState = 3; });
  emit(data) { this.readyState = 1; this.onmessage?.({ data: JSON.stringify(data) }); }
}
function snapshot(revision, changes = {}) {
  return { tipo: revision ? 'interacciones_actualizadas' : 'estado_inicial', servidor: 'prueba', revision,
    fecha: '2026-11-26T00:00:00Z', indicadores: { total_interacciones: 207, usuarios_participantes: 100,
      sentimiento_promedio: 0.5, reacciones_recibidas: 444, ...changes } };
}
beforeEach(() => {
  loggedIn = false; failLogin = false; failLogout = false; unavailable = false; failPassword = false; failHistory = false;
  TestSocket.connections = [];
  vi.stubGlobal('WebSocket', TestSocket);
  vi.stubGlobal('fetch', vi.fn(async (path, options = {}) => {
    let status = 200; let data = {};
    if (unavailable) { status = 503; data = { detail: 'Servicio temporalmente no disponible.' }; }
    else if (path === '/auth/me') { status = loggedIn ? 200 : 401; data = loggedIn ? account : {}; }
    else if (path === '/auth/login') { status = failLogin ? 401 : 200; loggedIn = !failLogin; data = { access_token: 'NO-ALMACENAR', expires_in: 1800 }; }
    else if (path === '/auth/logout') { status = failLogout ? 503 : 200; if (!failLogout) loggedIn = false; }
    else if (path === '/api/dashboard') { status = loggedIn ? 200 : 401; data = { cuenta: account, analitica_disponible: false }; }
    else if (path === '/auth/password') { status = failPassword ? 400 : 200; data = failPassword ? { detail: 'No se pudo validar la cuenta y su contraseña actual.' } : {}; if (!failPassword) loggedIn = false; }
    else if (path.startsWith('/api/interacciones?')) { data = { total: 0, items: [] }; }
    else if (path === '/api/analitica/usuarios') { status = failHistory ? 503 : 200; data = failHistory ? { detail: 'Histórico temporalmente no disponible.' } : { indicadores: { usuarios: 1068, artistas: 400 } }; }
    return { ok: status < 400, status, json: async () => data };
  }));
});

describe('Actividad en tiempo real', () => {
  async function dashboard(path = '/dashboard') {
    loggedIn = true; mount(path);
    await screen.findByText('Sesión verificada');
    await waitFor(() => expect(TestSocket.connections.length).toBeGreaterThan(0));
    return TestSocket.connections.at(-1);
  }
  it('permite recuperar la selección anterior cuando se rechaza un filtro', async () => {
    const socket = await dashboard('/dashboard/explorar');
    act(() => socket.emit(snapshot(0, { opciones_filtros: { canal: ['Telegram', 'Discord'] } })));
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Filtros', exact: true }));
    await user.selectOptions(screen.getByLabelText('Canal'), 'Telegram');
    await user.click(screen.getByRole('button', { name: 'Aplicar filtros' }));
    act(() => socket.emit({ ...snapshot(0, { total_interacciones: 33, opciones_filtros: { canal: ['Telegram', 'Discord'] } }), solicitud: 1 }));
    await user.click(screen.getByRole('button', { name: 'Filtros (1)', exact: true }));
    await user.selectOptions(screen.getByLabelText('Canal'), 'Discord');
    await user.click(screen.getByRole('button', { name: 'Aplicar filtros' }));
    act(() => socket.emit({ tipo: 'error_filtros', solicitud: 2 }));
    expect(screen.getByText('Canal: Telegram')).toBeVisible();
    await user.click(screen.getByRole('button', { name: 'Recuperar selección anterior' }));
    expect(JSON.parse(socket.send.mock.calls.at(-1)[0])).toEqual({tipo:'suscribir', solicitud:3, filtros:{canal:'Telegram'}});
    act(() => socket.emit({ ...snapshot(0, { total_interacciones: 33, opciones_filtros: { canal: ['Telegram', 'Discord'] } }), solicitud: 3 }));
    expect(screen.getByText('En vivo')).toBeVisible();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Filtros (1)', exact: true }));
    expect(screen.getByLabelText('Canal')).toHaveValue('Telegram');
  });
  it('ofrece reintento de la primera lectura sin afirmar que ya hay datos', async () => {
    const socket = await dashboard();
    act(() => socket.emit({ tipo: 'error_datos', solicitud: 0 }));
    expect(screen.getByRole('alert')).toHaveTextContent('Todavía no se pudo cargar');
    expect(screen.getByRole('alert')).not.toHaveTextContent('Conservamos');
    expect(screen.getByText('Esperando la primera lectura')).toBeVisible();
    await userEvent.click(screen.getByRole('button', { name: 'Reintentar lectura' }));
    expect(JSON.parse(socket.send.mock.calls.at(-1)[0])).toMatchObject({tipo:'suscribir',solicitud:1,filtros:{}});
    act(() => socket.emit({ ...snapshot(0), solicitud: 1 }));
    expect(screen.getByText('En vivo')).toBeVisible();
    expect(screen.queryByText('Esperando la primera lectura')).not.toBeInTheDocument();
  });
  it('abre directamente el mapa de calor y los registros desde la búsqueda', async () => {
    const socket = await dashboard('/dashboard/resumen');
    act(() => socket.emit(snapshot(0)));
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Buscar secciones' }));
    await user.type(screen.getByRole('textbox', { name: 'Buscar una sección' }), 'calor');
    await user.keyboard('{Enter}');
    expect(screen.getByRole('tab', { name: 'Mapa de calor', exact: true })).toHaveAttribute('aria-selected', 'true');
    await user.click(screen.getByRole('link', { name: 'Resumen', exact: true }));
    await user.click(screen.getByRole('button', { name: 'Buscar secciones' }));
    await user.type(screen.getByRole('textbox', { name: 'Buscar una sección' }), 'registros');
    await user.keyboard('{Enter}');
    expect(screen.getByRole('tab', { name: 'Registros', exact: true })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('form', { name: 'Buscar registros' })).toBeVisible();
    expect(TestSocket.connections).toHaveLength(1);
  });
  it('recibe cifras por WebSocket y actualiza sin otra consulta REST', async () => {
    const socket = await dashboard();
    expect(socket.url).toMatch(/\/ws\/dashboard$/);
    expect(socket.url).not.toContain('token');
    expect(screen.queryByText('207')).not.toBeInTheDocument();
    act(() => socket.emit(snapshot(0)));
    expect(await screen.findByText('207')).toBeInTheDocument();
    const count = fetch.mock.calls.length;
    act(() => socket.emit({ ...snapshot(1, { total_interacciones: 208, sentimiento_promedio: -0.3 }), operacion: 'creada', id_interaccion: 'I9000001' }));
    expect(screen.getByText('208')).toBeInTheDocument();
    expect(within(screen.getByRole('heading', { name: 'Sentimiento promedio', exact: true }).closest('article')).getByText('-0.300')).toBeInTheDocument();
    expect(screen.getByText('Interacción creada · I9000001')).toBeInTheDocument();
    expect(fetch.mock.calls).toHaveLength(count);
  });
  it('convierte un hallazgo en filtro y permite quitarlo conservando los demás', async () => {
    const socket = await dashboard('/dashboard/resumen');
    act(() => socket.emit(snapshot(0, { total_interacciones: 10,
      por_canal: [{ categoria: 'Telegram', total: 8 }, { categoria: 'Discord', total: 2 }],
      por_tema: [{ categoria: 'arte', total: 6 }, { categoria: 'musica', total: 4 }],
      opciones_filtros: { canal: ['Telegram', 'Discord'], tema: ['arte', 'musica'] } })));
    const user = userEvent.setup();
    expect(screen.getByText('80% de las interacciones de esta selección.')).toBeVisible();
    await user.click(screen.getByRole('button', { name: 'Explorar Telegram' }));
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Explorar actividad');
    expect(JSON.parse(socket.send.mock.calls.at(-1)[0])).toEqual({ tipo: 'suscribir', solicitud: 1, filtros: { canal: 'Telegram' } });
    act(() => socket.emit({ ...snapshot(1, { total_interacciones: 8, opciones_filtros: { tema: ['arte'] } }), solicitud: 1 }));
    // A selected category is scope, not a new finding; viewing it must not resubscribe.
    act(() => socket.emit({ ...snapshot(1, { total_interacciones: 8, por_canal: [{ categoria: 'Telegram', total: 8 }], opciones_filtros: { tema: ['arte'] } }), solicitud: 1 }));
    await user.click(screen.getByRole('link', { name: 'Resumen', exact: true }));
    expect(screen.getByRole('heading', { name: 'Canal seleccionado' })).toBeVisible();
    const subscriptions = socket.send.mock.calls.length;
    await user.click(screen.getByRole('button', { name: 'Ver canales' }));
    expect(socket.send.mock.calls).toHaveLength(subscriptions);
    await user.click(screen.getByRole('button', { name: 'Filtros (1)', exact: true }));
    expect(screen.getByLabelText('Canal', { exact: true })).toHaveValue('Telegram');
    await user.selectOptions(screen.getByLabelText('Tema', { exact: true }), 'arte');
    await user.click(screen.getByRole('button', { name: 'Aplicar filtros' }));
    act(() => socket.emit({ ...snapshot(2, { total_interacciones: 3 }), solicitud: 2 }));
    await user.click(screen.getByRole('button', { name: 'Quitar filtro Canal: Telegram' }));
    expect(JSON.parse(socket.send.mock.calls.at(-1)[0])).toEqual({ tipo: 'suscribir', solicitud: 3, filtros: { tema: 'arte' } });
    expect(screen.getByText('Canal: Telegram')).toBeVisible();
    act(() => socket.emit({ ...snapshot(3, { total_interacciones: 6 }), solicitud: 3 }));
    expect(screen.queryByText('Canal: Telegram')).not.toBeInTheDocument();
    expect(screen.getByText('Tema: arte')).toBeVisible();
    await user.click(screen.getByRole('button', { name: 'Filtros (1)', exact: true }));
    expect(screen.getByLabelText('Canal', { exact: true })).toHaveValue('');
    expect(screen.getByLabelText('Tema', { exact: true })).toHaveValue('arte');
    expect(TestSocket.connections).toHaveLength(1);
  });
  it('abre el horario destacado y muestra los empates sin inventar un ganador', async () => {
    const socket = await dashboard('/dashboard/resumen');
    act(() => socket.emit(snapshot(0, { total_interacciones: 8,
      por_canal: [{ categoria: 'Telegram', total: 4 }, { categoria: 'Discord', total: 4 }],
      actividad_semanal: [{ dia_semana: 4, hora: 18, total: 8 }] })));
    expect(screen.getByText('2 canales empatados')).toBeVisible();
    expect(screen.getByText('Viernes, 18:00–19:00')).toBeVisible();
    await userEvent.click(screen.getByRole('button', { name: 'Ver mapa de calor' }));
    expect(screen.getByRole('tab', { name: 'Mapa de calor', exact: true })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('img', { name: 'Mapa de calor de interacciones por día de la semana y hora UTC' })).toBeVisible();
    expect(socket.send).not.toHaveBeenCalled();
  });
  it('prepara fechas y franjas sin consultar hasta aplicar, y cierra filtros con Escape', async () => {
    const socket = await dashboard('/dashboard/resumen');
    act(() => socket.emit(snapshot(0, { rango_datos: { inicio: '2026-10-10T00:00:00Z', fin: '2026-11-08T12:00:00Z' } })));
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Filtros', exact: true }));
    expect(document.getElementById('activity-filters')).toHaveClass('is-open');
    await user.click(screen.getByRole('button', { name: '7 días del periodo' }));
    expect(screen.getByLabelText('Desde')).toHaveValue('2026-11-02');
    expect(screen.getByLabelText('Hasta')).toHaveValue('2026-11-08');
    await user.selectOptions(screen.getByLabelText('Día de la semana'), '0');
    await user.selectOptions(screen.getByLabelText('Franja horaria'), '0');
    expect(socket.send).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: 'Aplicar filtros' }));
    expect(JSON.parse(socket.send.mock.calls.at(-1)[0]).filtros).toEqual({ inicio: '2026-11-02T00:00:00Z', fin: '2026-11-08T23:59:59.999999Z', dia_semana: 0, hora: 0 });
    act(() => socket.emit({ ...snapshot(1), solicitud: 1 }));
    expect(screen.getByText('Día: Lunes')).toBeVisible();
    expect(screen.getByText('Hora: 00:00 UTC')).toBeVisible();
    await user.click(screen.getByRole('button', { name: 'Filtros (4)', exact: true }));
    await user.click(screen.getByLabelText('Desde'));
    await user.keyboard('{Escape}');
    expect(document.getElementById('activity-filters')).toHaveAttribute('inert');
    expect(screen.getByRole('button', { name: 'Filtros (4)', exact: true })).toHaveFocus();
  });
  it('filtra desde barras, leyenda, tendencia y mapa de calor con la misma selección', async () => {
    const socket = await dashboard('/dashboard/explorar');
    const data = { total_interacciones: 3, por_canal: [{ categoria: 'Telegram', total: 3 }], por_tipo: [{ categoria: 'mensaje', total: 3 }], por_dia: [{ fecha: '2026-11-23', total: 3 }], actividad_semanal: [{ dia_semana: 0, hora: 0, total: 3 }] };
    act(() => socket.emit(snapshot(0, data)));
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Filtrar por Telegram', exact: true }));
    expect(JSON.parse(socket.send.mock.calls.at(-1)[0]).filtros).toEqual({ canal: 'Telegram' });
    act(() => socket.emit({ ...snapshot(1, data), solicitud: 1 }));
    await user.click(screen.getByRole('button', { name: 'Filtrar por Mensajes', exact: true }));
    expect(JSON.parse(socket.send.mock.calls.at(-1)[0]).filtros).toEqual({ canal: 'Telegram', tipo: 'mensaje' });
    act(() => socket.emit({ ...snapshot(2, data), solicitud: 2 }));
    await user.click(screen.getByRole('tab', { name: 'Tendencia', exact: true }));
    await user.click(screen.getByRole('button', { name: 'Filtrar este día' }));
    expect(JSON.parse(socket.send.mock.calls.at(-1)[0]).filtros.inicio).toBe('2026-11-23T00:00:00Z');
    act(() => socket.emit({ ...snapshot(3, data), solicitud: 3 }));
    await user.click(screen.getByRole('tab', { name: 'Mapa de calor', exact: true }));
    await user.click(screen.getByRole('button', { name: 'Filtrar esta franja' }));
    expect(JSON.parse(socket.send.mock.calls.at(-1)[0]).filtros).toEqual({ inicio: '2026-11-23T00:00:00Z', fin: '2026-11-23T23:59:59.999999Z', canal: 'Telegram', tipo: 'mensaje', dia_semana: 0, hora: 0 });
    act(() => socket.emit({ ...snapshot(4, data), solicitud: 4 }));
    await user.click(screen.getByRole('button', { name: 'Deshacer selección' }));
    expect(JSON.parse(socket.send.mock.calls.at(-1)[0]).filtros).toEqual({ inicio: '2026-11-23T00:00:00Z', fin: '2026-11-23T23:59:59.999999Z', canal: 'Telegram', tipo: 'mensaje' });
    expect(TestSocket.connections).toHaveLength(1);
  });
  it('ignora revisiones antiguas y conserva cifras ante un fallo de actualización', async () => {
    const socket = await dashboard();
    act(() => socket.emit(snapshot(2, { total_interacciones: 209 })));
    act(() => socket.emit(snapshot(1)));
    expect(screen.getByText('209')).toBeInTheDocument();
    act(() => socket.emit({ tipo: 'error_datos' }));
    expect(screen.getByRole('alert')).toHaveTextContent('Conservamos la última lectura');
    expect(screen.getByText('209')).toBeInTheDocument();
    expect(screen.queryByText('En vivo')).not.toBeInTheDocument();
  });
  it('termina la sesión cuando el servidor revoca el socket', async () => {
    const socket = await dashboard();
    await act(async () => { await socket.onclose({ code: 4401 }); });
    expect(await screen.findByRole('button', { name: 'Iniciar sesión' })).toBeInTheDocument();
    expect(socket.close).toHaveBeenCalled();
  });
  it('reconecta y recupera el estado después de una interrupción', async () => {
    const socket = await dashboard();
    vi.useFakeTimers();
    try {
      await act(async () => { await socket.onclose({ code: 1006 }); });
      expect(screen.getByText('Reconectando…')).toBeInTheDocument();
      await act(async () => { await vi.advanceTimersByTimeAsync(1400); });
      const next = TestSocket.connections.at(-1);
      expect(next).not.toBe(socket);
      act(() => next.emit({ ...snapshot(0, { total_interacciones: 210 }), servidor: 'reiniciado' }));
      expect(screen.getByText('210')).toBeInTheDocument();
      expect(screen.getByText('En vivo')).toBeInTheDocument();
    } finally { vi.useRealTimers(); }
  });
  it('envía los filtros por WebSocket y descarta respuestas de una selección anterior', async () => {
    const socket = await dashboard('/dashboard/explorar');
    act(() => socket.emit(snapshot(0, { opciones_filtros: { canal: ['Telegram', 'Discord'], tema: ['arte'], tipo: ['mensaje'] } })));
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Filtros', exact: true }));
    await user.selectOptions(screen.getByLabelText('Canal'), 'Telegram');
    const requests = fetch.mock.calls.length;
    await user.click(screen.getByRole('button', { name: 'Aplicar filtros' }));
    expect(screen.getByText('207')).toBeVisible();
    expect(screen.getByText('Todos los registros disponibles')).toBeVisible();
    expect(screen.queryByText('Canal: Telegram')).not.toBeInTheDocument();
    expect(screen.getByText(/Las cifras visibles corresponden a la lectura anterior/)).toBeVisible();
    expect(JSON.parse(socket.send.mock.calls.at(-1)[0])).toEqual({ tipo: 'suscribir', solicitud: 1, filtros: { canal: 'Telegram' } });
    act(() => socket.emit(snapshot(5, { total_interacciones: 999 })));
    expect(screen.queryByText('999')).not.toBeInTheDocument();
    act(() => socket.emit({ ...snapshot(5, { total_interacciones: 20, por_canal: [{ categoria: 'Telegram', total: 20 }], por_tipo: [{ categoria: 'mensaje', total: 20 }] }), solicitud: 1 }));
    expect(within(screen.getByRole('heading', { name: 'Interacciones', exact: true }).closest('article')).getByText('20')).toBeInTheDocument();
    expect(screen.getByRole('group', { name: 'Interacciones por canal' })).toBeInTheDocument();
    expect(screen.getByRole('img', { name: 'Distribución de tipos de interacción' })).toBeInTheDocument();
    expect(screen.getByText('Canal: Telegram')).toBeVisible();
    expect(screen.queryByText(/Las cifras visibles corresponden a la lectura anterior/)).not.toBeInTheDocument();
    expect(fetch.mock.calls).toHaveLength(requests);
    await user.click(screen.getByRole('button', { name: 'Filtros (1)', exact: true }));
    await user.click(screen.getByRole('button', { name: 'Limpiar filtros' }));
    expect(JSON.parse(socket.send.mock.calls.at(-1)[0])).toEqual({ tipo: 'suscribir', solicitud: 2, filtros: {} });
  });
  it('valida fechas y envía el último instante del día final en UTC', async () => {
    const socket = await dashboard('/dashboard/explorar');
    await userEvent.click(screen.getByRole('button', { name: 'Filtros', exact: true }));
    act(() => socket.emit(snapshot(0)));
    fireEvent.change(screen.getByLabelText('Desde'), { target: { value: '2026-11-26' } });
    fireEvent.change(screen.getByLabelText('Hasta'), { target: { value: '2026-11-25' } });
    fireEvent.submit(screen.getByRole('form', { name: 'Filtros de actividad' }));
    expect(screen.getByRole('alert')).toHaveTextContent('La fecha inicial');
    expect(socket.send).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText('Hasta'), { target: { value: '2026-11-27' } });
    fireEvent.submit(screen.getByRole('form', { name: 'Filtros de actividad' }));
    expect(JSON.parse(socket.send.mock.calls.at(-1)[0]).filtros).toEqual({ inicio: '2026-11-26T00:00:00Z', fin: '2026-11-27T23:59:59.999999Z' });
  });
  it('muestra selección vacía sin inventar valores o gráficas', async () => {
    const socket = await dashboard();
    act(() => socket.emit(snapshot(0, { total_interacciones: 0, usuarios_participantes: 0, sentimiento_promedio: null, reacciones_recibidas: 0 })));
    expect(screen.getByText('No encontramos interacciones con estos filtros.')).toBeInTheDocument();
    expect(screen.queryByRole('img', { name: 'Distribución de tipos de interacción' })).not.toBeInTheDocument();
    expect(screen.queryByText('NaN')).not.toBeInTheDocument();
    expect(screen.queryByText('0.000')).not.toBeInTheDocument();
  });
  it('conserva la selección al reconectar y cuando desaparece su categoría', async () => {
    const socket = await dashboard('/dashboard/explorar');
    await userEvent.click(screen.getByRole('button', { name: 'Filtros', exact: true }));
    act(() => socket.emit(snapshot(0, { opciones_filtros: { tema: ['arte'] } })));
    await userEvent.selectOptions(screen.getByLabelText('Tema'), 'arte');
    await userEvent.click(screen.getByRole('button', { name: 'Aplicar filtros' }));
    act(() => socket.emit({ ...snapshot(0, { total_interacciones: 0, sentimiento_promedio: null, opciones_filtros: { tema: [] } }), solicitud: 1 }));
    expect(screen.getByLabelText('Tema')).toHaveValue('arte');
    vi.useFakeTimers();
    try {
      await act(async () => { await socket.onclose({ code: 1006 }); });
      await act(async () => { await vi.advanceTimersByTimeAsync(1400); });
      const next = TestSocket.connections.at(-1);
      act(() => { next.readyState = 1; next.onopen(); });
      expect(JSON.parse(next.send.mock.calls.at(-1)[0])).toEqual({ tipo: 'suscribir', solicitud: 1, filtros: { tema: 'arte' } });
      act(() => next.emit(snapshot(0, { total_interacciones: 999 })));
      expect(screen.queryByText('999')).not.toBeInTheDocument();
      act(() => next.emit({ ...snapshot(0, { total_interacciones: 5 }), solicitud: 1, servidor: 'nuevo' }));
      expect(screen.getByText('En vivo')).toBeInTheDocument();
    } finally { vi.useRealTimers(); }
  });
});
describe('Recorrido del observatorio', () => {
  it('presenta estados de uso sin etiquetas técnicas de transporte', async () => {
    loggedIn = true; mount('/dashboard/resumen');
    await screen.findByText('Sesión verificada');
    act(() => TestSocket.connections.at(-1).emit(snapshot(0)));
    expect(screen.getByText('En vivo')).toBeVisible();
    expect(document.body.textContent).not.toMatch(/WebSocket|\bREST\b/);
  });
  it('navega entre vistas sin perder la suscripción, selección ni filtros', async () => {
    loggedIn = true; mount('/dashboard/explorar');
    await screen.findByText('Sesión verificada');
    await waitFor(() => expect(TestSocket.connections.length).toBe(1));
    const socket = TestSocket.connections[0];
    act(() => socket.emit(snapshot(0, { opciones_filtros: { canal: ['Telegram'] } })));
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Filtros', exact: true }));
    await user.selectOptions(screen.getByLabelText('Canal'), 'Telegram');
    await user.click(screen.getByRole('button', { name: 'Aplicar filtros' }));
    act(() => socket.emit({ ...snapshot(0, { total_interacciones: 33 }), solicitud: 1 }));
    expect(screen.getByRole('button', { name: 'Filtros (1)', exact: true })).toHaveAttribute('aria-expanded', 'false');
    await user.click(screen.getByRole('link', { name: 'Histórico', exact: true }));
    expect(await screen.findByRole('heading', { name: 'Histórico de la comunidad' })).toHaveFocus();
    await user.click(screen.getByRole('link', { name: 'Resumen', exact: true }));
    expect(screen.getByText('Canal: Telegram')).toBeVisible();
    expect(screen.getByText('33')).toBeVisible();
    await user.click(screen.getByRole('link', { name: 'Explorar actividad', exact: true }));
    await user.click(screen.getByRole('tab', { name: 'Mapa de calor', exact: true }));
    await user.keyboard('{ArrowLeft}');
    expect(screen.getByRole('tab', { name: 'Tendencia', exact: true })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('tab', { name: 'Tendencia', exact: true })).toHaveFocus();
    await user.click(screen.getByRole('button', { name: 'Filtros (1)', exact: true }));
    expect(screen.getByLabelText('Canal')).toHaveValue('Telegram');
    expect(TestSocket.connections).toHaveLength(1);
    expect(fetch.mock.calls.filter(([path]) => path === '/api/analitica/usuarios')).toHaveLength(1);
  });
  it('explica el acceso por administrador y regresa a la vista protegida solicitada', async () => {
    mount('/dashboard/historico');
    const user = userEvent.setup();
    await user.click(await screen.findByRole('link', { name: 'Cómo obtener acceso' }));
    expect(screen.getByRole('heading', { name: 'Tu entrada al observatorio.' })).toBeVisible();
    expect(screen.getByText(/No hay registro público automático/)).toBeVisible();
    expect(screen.queryByRole('form')).not.toBeInTheDocument();
    await user.click(screen.getByRole('link', { name: 'Volver a iniciar sesión' }));
    await enter();
    expect(await screen.findByRole('heading', { name: 'Histórico de la comunidad' })).toBeVisible();
  });
  it('valida el cambio de contraseña antes de enviarlo y limpia secretos al salir', async () => {
    loggedIn = true; mount('/dashboard/cuenta');
    const user = userEvent.setup();
    await screen.findByRole('form', { name: 'Cambiar contraseña' });
    await user.type(screen.getByLabelText('Contraseña actual', { exact: true }), 'Anterior123');
    await user.type(screen.getByLabelText('Nueva contraseña', { exact: true }), 'Nueva1234');
    await user.type(screen.getByLabelText('Confirmar nueva contraseña', { exact: true }), 'Otra12345');
    await user.click(screen.getByRole('button', { name: 'Guardar contraseña' }));
    expect(screen.getByRole('alert')).toHaveTextContent('no coinciden');
    expect(fetch.mock.calls.filter(([path]) => path === '/auth/password')).toHaveLength(0);
    await user.click(screen.getByRole('link', { name: 'Resumen', exact: true }));
    await user.click(screen.getByRole('link', { name: 'Mi cuenta', exact: true }));
    expect(screen.getByLabelText('Contraseña actual', { exact: true })).toHaveValue('');
    expect(screen.getByLabelText('Nueva contraseña', { exact: true })).toHaveValue('');
  });
  it('cambia contraseña y muestra confirmación en el login con sesiones cerradas', async () => {
    loggedIn = true; mount('/dashboard/cuenta');
    const user = userEvent.setup();
    await screen.findByRole('form', { name: 'Cambiar contraseña' });
    for (const [label, value] of [['Contraseña actual', 'Anterior123'], ['Nueva contraseña', 'Nueva1234'], ['Confirmar nueva contraseña', 'Nueva1234']]) await user.type(screen.getByLabelText(label, { exact: true }), value);
    await user.click(screen.getByRole('button', { name: 'Guardar contraseña' }));
    expect(await screen.findByRole('form', { name: 'Inicio de sesión' })).toBeVisible();
    expect(screen.getByText(/Contraseña actualizada. Todas tus sesiones/)).toBeVisible();
    const call = fetch.mock.calls.find(([path]) => path === '/auth/password');
    expect(JSON.parse(call[1].body)).toEqual({ password_actual: 'Anterior123', password_nueva: 'Nueva1234', confirmacion: 'Nueva1234' });
    expect(screen.getByLabelText('Contraseña', { selector: 'input' })).toHaveValue('');
  });
  it('permite corregir contraseña actual y reintentar sin perder la sesión', async () => {
    loggedIn = true; failPassword = true; mount('/dashboard/cuenta');
    const user = userEvent.setup();
    await screen.findByRole('form', { name: 'Cambiar contraseña' });
    for (const [label, value] of [['Contraseña actual', 'Incorrecta'], ['Nueva contraseña', 'Nueva1234'], ['Confirmar nueva contraseña', 'Nueva1234']]) await user.type(screen.getByLabelText(label, { exact: true }), value);
    await user.click(screen.getByRole('button', { name: 'Guardar contraseña' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('No se pudo validar');
    expect(screen.getByLabelText('Contraseña actual', { exact: true })).toHaveValue('');
    expect(screen.getByRole('button', { name: 'Guardar contraseña' })).toBeEnabled();
    expect(screen.getByRole('form', { name: 'Cambiar contraseña' })).toBeVisible();
  });
  it('reintenta la consulta histórica conservando la última lectura disponible', async () => {
    loggedIn = true; mount('/dashboard/historico');
    await screen.findByRole('heading', { name: 'Histórico de la comunidad' });
    const region = screen.getByRole('region', { name: 'Datos históricos', exact: true });
    await within(region).findByText('1,068');
    failHistory = true;
    await userEvent.click(screen.getByRole('button', { name: 'Actualizar histórico' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Histórico temporalmente');
    expect(within(region).getByText('1,068')).toBeVisible();
    failHistory = false;
    await userEvent.click(screen.getByRole('button', { name: 'Reintentar consulta' }));
    await waitFor(() => expect(screen.queryByRole('alert')).not.toBeInTheDocument());
  });
});

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
function mount(path = '/login') {
  return render(<MemoryRouter initialEntries={[path]}><AuthProvider><App/></AuthProvider></MemoryRouter>);
}
async function enter() {
  const user = userEvent.setup();
  await user.type(await screen.findByLabelText('Usuario'), 'cuenta_prueba');
  await user.type(screen.getByLabelText('Contraseña', { selector: 'input' }), 'password-solo-prueba');
  await user.click(screen.getByRole('button', { name: 'Iniciar sesión' }));
  return user;
}

describe('Acceso y sesión', () => {
  it('retira operaciones de la navegación y redirige su antigua ruta al resumen', async () => {
    loggedIn = true; mount('/dashboard/operaciones');
    await screen.findByRole('heading', { name: 'Actividad de la comunidad', exact: true });
    expect(screen.queryByRole('link', { name: 'Operaciones API' })).not.toBeInTheDocument();
    expect(screen.queryByText('Guía de operaciones API')).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Buscar secciones' }));
    await userEvent.type(screen.getByRole('textbox', { name: 'Buscar una sección' }), 'operaciones');
    expect(screen.getByText('No encontramos una sección con ese nombre.')).toBeVisible();
  });
  it('permite cancelar el cierre sin revocar la sesión', async () => {
    loggedIn = true; mount('/dashboard/resumen');
    await screen.findByText('Sesión verificada');
    await userEvent.click(screen.getByRole('button', { name: 'Cerrar sesión', exact: true }));
    expect(screen.getByRole('dialog', { name: 'Cerrar tus sesiones' })).toBeVisible();
    await userEvent.click(screen.getByRole('button', { name: 'Seguir en el dashboard' }));
    expect(screen.queryByRole('dialog', { name: 'Cerrar tus sesiones' })).not.toBeInTheDocument();
    expect(fetch.mock.calls.some(([path]) => path === '/auth/logout')).toBe(false);
    expect(screen.getByText('Sesión verificada')).toBeVisible();
  });
  it('ignora una respuesta anterior de sesión que llega después del cierre', async () => {
    loggedIn = true; mount('/dashboard/resumen');
    await screen.findByText('Sesión verificada');
    let resolve;
    fetch.mockImplementationOnce(() => new Promise(done => { resolve = done; }));
    act(() => window.dispatchEvent(new Event('focus')));
    await userEvent.click(screen.getByRole('button', { name: 'Cerrar sesión', exact: true }));
    await userEvent.click(screen.getByRole('button', { name: 'Cerrar mis sesiones' }));
    await screen.findByRole('form', { name: 'Inicio de sesión' });
    await act(async () => { resolve({ ok: true, status: 200, json: async () => account }); });
    expect(screen.getByRole('form', { name: 'Inicio de sesión' })).toBeVisible();
    expect(screen.queryByText('Sesión verificada')).not.toBeInTheDocument();
  });
  it('redirige el dashboard sin sesión al formulario', async () => {
    mount('/dashboard');
    expect(await screen.findByRole('form', { name: 'Inicio de sesión' })).toBeInTheDocument();
    expect(screen.queryByText('Sesión verificada')).not.toBeInTheDocument();
  });
  it('inicia sesión y permite cerrar sesión sin guardar JWT en Web Storage', async () => {
    const storage = vi.spyOn(Storage.prototype, 'setItem');
    mount(); const user = await enter();
    expect(await screen.findByText('Sesión verificada')).toBeInTheDocument();
    expect(storage).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: 'Cerrar sesión' }));
    await user.click(screen.getByRole('button', { name: 'Cerrar mis sesiones' }));
    expect(await screen.findByRole('button', { name: 'Iniciar sesión' })).toBeInTheDocument();
  });
  it('muestra credenciales incorrectas y limpia la contraseña', async () => {
    failLogin = true; mount(); await enter();
    expect(await screen.findByRole('alert')).toHaveTextContent('Usuario o contraseña incorrectos.');
    expect(screen.getByLabelText('Contraseña', { selector: 'input' })).toHaveValue('');
  });
  it('permite mostrar y ocultar la contraseña', async () => {
    mount(); const user = userEvent.setup();
    const input = await screen.findByLabelText('Contraseña', { selector: 'input' });
    expect(input).toHaveAttribute('type', 'password');
    await user.click(screen.getByRole('button', { name: 'Mostrar contraseña' }));
    expect(input).toHaveAttribute('type', 'text');
    await user.click(screen.getByRole('button', { name: 'Ocultar contraseña' }));
    expect(input).toHaveAttribute('type', 'password');
  });
  it('restaura una sesión existente al abrir el dashboard', async () => {
    loggedIn = true; mount('/dashboard');
    expect(await screen.findByText('Sesión verificada')).toBeInTheDocument();
  });
  it('detecta la revocación al volver a la ventana', async () => {
    loggedIn = true; mount('/dashboard');
    await screen.findByText('Sesión verificada');
    loggedIn = false; window.dispatchEvent(new Event('focus'));
    expect(await screen.findByRole('button', { name: 'Iniciar sesión' })).toBeInTheDocument();
  });
  it('mantiene la vista abierta si el servidor no confirma el logout', async () => {
    loggedIn = true; failLogout = true; mount('/dashboard');
    await screen.findByText('Sesión verificada');
    await userEvent.click(screen.getByRole('button', { name: 'Cerrar sesión' }));
    await userEvent.click(screen.getByRole('button', { name: 'Cerrar mis sesiones' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('No se pudo cerrar la sesión.');
    expect(screen.queryByRole('button', { name: 'Iniciar sesión' })).not.toBeInTheDocument();
  });
  it('permite reintentar una sesión cuando vuelve el servicio', async () => {
    unavailable = true; loggedIn = true; mount('/dashboard');
    expect(await screen.findByRole('alert')).toHaveTextContent('Servicio temporalmente no disponible.');
    unavailable = false;
    await userEvent.click(screen.getByRole('button', { name: 'Reintentar' }));
    expect(await screen.findByText('Sesión verificada')).toBeInTheDocument();
  });
});
