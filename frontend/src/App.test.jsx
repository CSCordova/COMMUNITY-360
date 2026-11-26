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
  loggedIn = false; failLogin = false; failLogout = false; unavailable = false;
  TestSocket.connections = [];
  vi.stubGlobal('WebSocket', TestSocket);
  vi.stubGlobal('fetch', vi.fn(async (path, options = {}) => {
    let status = 200; let data = {};
    if (unavailable) { status = 503; data = { detail: 'Servicio temporalmente no disponible.' }; }
    else if (path === '/auth/me') { status = loggedIn ? 200 : 401; data = loggedIn ? account : {}; }
    else if (path === '/auth/login') { status = failLogin ? 401 : 200; loggedIn = !failLogin; data = { access_token: 'NO-ALMACENAR', expires_in: 1800 }; }
    else if (path === '/auth/logout') { status = failLogout ? 503 : 200; if (!failLogout) loggedIn = false; }
    else if (path === '/api/dashboard') { status = loggedIn ? 200 : 401; data = { cuenta: account, analitica_disponible: false }; }
    else if (path === '/api/analitica/usuarios') { data = { indicadores: { usuarios: 1068, artistas: 400 } }; }
    return { ok: status < 400, status, json: async () => data };
  }));
});

describe('Actividad en tiempo real', () => {
  async function dashboard() {
    loggedIn = true; mount('/dashboard');
    await screen.findByText('Sesión verificada');
    await waitFor(() => expect(TestSocket.connections.length).toBeGreaterThan(0));
    return TestSocket.connections.at(-1);
  }
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
    const socket = await dashboard();
    act(() => socket.emit(snapshot(0, { opciones_filtros: { canal: ['Telegram', 'Discord'], tema: ['arte'], tipo: ['mensaje'] } })));
    const user = userEvent.setup();
    await user.selectOptions(screen.getByLabelText('Canal'), 'Telegram');
    const requests = fetch.mock.calls.length;
    await user.click(screen.getByRole('button', { name: 'Aplicar filtros' }));
    expect(JSON.parse(socket.send.mock.calls.at(-1)[0])).toEqual({ tipo: 'suscribir', solicitud: 1, filtros: { canal: 'Telegram' } });
    act(() => socket.emit(snapshot(5, { total_interacciones: 999 })));
    expect(screen.queryByText('999')).not.toBeInTheDocument();
    act(() => socket.emit({ ...snapshot(5, { total_interacciones: 20, por_canal: [{ categoria: 'Telegram', total: 20 }], por_tipo: [{ categoria: 'mensaje', total: 20 }] }), solicitud: 1 }));
    expect(within(screen.getByRole('heading', { name: 'Interacciones', exact: true }).closest('article')).getByText('20')).toBeInTheDocument();
    expect(screen.getByRole('img', { name: 'Interacciones por canal' })).toBeInTheDocument();
    expect(screen.getByRole('img', { name: 'Distribución de tipos de interacción' })).toBeInTheDocument();
    expect(fetch.mock.calls).toHaveLength(requests);
    await user.click(screen.getByRole('button', { name: 'Limpiar filtros' }));
    expect(JSON.parse(socket.send.mock.calls.at(-1)[0])).toEqual({ tipo: 'suscribir', solicitud: 2, filtros: {} });
  });
  it('valida fechas y envía el último instante del día final en UTC', async () => {
    const socket = await dashboard();
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
    const socket = await dashboard();
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
