import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { AuthProvider } from './auth';
import App from './App';

let loggedIn;
let failLogin;
let failLogout;
let unavailable;
const account = { id_cuenta: 1, usuario: 'cuenta_prueba' };
beforeEach(() => {
  loggedIn = false; failLogin = false; failLogout = false; unavailable = false;
  vi.stubGlobal('fetch', vi.fn(async (path, options = {}) => {
    let status = 200; let data = {};
    if (unavailable) { status = 503; data = { detail: 'Servicio temporalmente no disponible.' }; }
    else if (path === '/auth/me') { status = loggedIn ? 200 : 401; data = loggedIn ? account : {}; }
    else if (path === '/auth/login') { status = failLogin ? 401 : 200; loggedIn = !failLogin; data = { access_token: 'NO-ALMACENAR', expires_in: 1800 }; }
    else if (path === '/auth/logout') { status = failLogout ? 503 : 200; if (!failLogout) loggedIn = false; }
    else if (path === '/api/dashboard') { status = loggedIn ? 200 : 401; data = { cuenta: account, analitica_disponible: false }; }
    return { ok: status < 400, status, json: async () => data };
  }));
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
