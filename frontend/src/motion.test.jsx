import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, renderHook, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { densify, FluidNumber, MotionLink, MotionProvider, useFluidLine } from './motion';
import { DonutChart } from './charts';

let frames, id, originalAnimate;
function step(time) {
  act(() => {
    const pending = [...frames.values()]; frames.clear();
    pending.forEach(callback => callback(time));
  });
}
beforeEach(() => {
  frames = new Map(); id = 0;
  vi.stubGlobal('requestAnimationFrame', callback => { frames.set(++id, callback); return id; });
  vi.stubGlobal('cancelAnimationFrame', token => frames.delete(token));
  vi.stubGlobal('matchMedia', () => ({ matches: false, addEventListener() {}, removeEventListener() {} }));
  originalAnimate = Object.getOwnPropertyDescriptor(Element.prototype, 'animate');
  Object.defineProperty(Element.prototype, 'animate', { configurable: true, value: undefined });
});
afterEach(() => {
  cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); delete document.startViewTransition; localStorage.removeItem('community360.motion');
  if (originalAnimate) Object.defineProperty(Element.prototype, 'animate', originalAnimate);
  else delete Element.prototype.animate;
});

// jsdom has no animation engine: opt in only for the interpolation tests.
function enableMotion() { Object.defineProperty(Element.prototype, 'animate', { configurable: true, get: () => () => ({ cancel() {} }) }); }

describe('Movimiento continuo de los datos', () => {
  it('cuenta los KPI desde cero y cancela el conteo anterior al actualizar', () => {
    enableMotion();
    const view = render(<FluidNumber fromZero value={100}/>);
    expect(screen.getByText('0')).toBeInTheDocument();
    step(0); step(325);
    expect(screen.getByText('88')).toBeInTheDocument();
    view.rerender(<FluidNumber fromZero value={200}/>);
    expect(frames.size).toBe(1);
    step(325);
    expect(screen.getByText('0')).toBeInTheDocument();
    step(975);
    expect(screen.getByText('200')).toBeInTheDocument();
    expect(frames.size).toBe(0);
  });
  it('conserva el orden y el color de los segmentos aunque cambie el ranking', () => {
    enableMotion();
    const view = render(<DonutChart label="Prueba" data={[{ categoria: 'arte', total: 10 }, { categoria: 'musica', total: 20 }]}/>);
    const before = [...document.querySelectorAll('circle[aria-label]')].map(circle => circle.getAttribute('stroke'));
    view.rerender(<DonutChart label="Prueba" data={[{ categoria: 'musica', total: 10 }, { categoria: 'arte', total: 30 }]}/>);
    step(0); step(700);
    const circles = [...document.querySelectorAll('circle[aria-label]')];
    expect(circles.map(circle => circle.getAttribute('stroke'))).toEqual(before);
    expect(circles[0]).toHaveAttribute('aria-label', 'arte: 30, 75.0%');
    expect(circles[1]).toHaveAttribute('aria-label', 'musica: 10, 25.0%');
    expect(Number(circles[0].getAttribute('stroke-dasharray').split(' ')[0])).toBeCloseTo(2 * Math.PI * 65 * .75);
  });
  it('integra el movimiento sin un selector ni depender de preferencias anteriores', () => {
    enableMotion();
    localStorage.setItem('community360.motion', 'reducido');
    const content = value => <MotionProvider><FluidNumber value={value}/></MotionProvider>;
    const view = render(content(100));
    view.rerender(content(200)); step(0); step(325);
    expect(screen.getByText('188')).toBeInTheDocument();
    expect(screen.queryByRole('combobox')).not.toBeInTheDocument();
    expect(document.documentElement).toHaveAttribute('data-motion', 'fluido');
    step(650); expect(screen.getByText('200')).toBeInTheDocument();
  });
  it('retoma una cifra desde el fotograma visible ante una segunda actualización', () => {
    enableMotion();
    const view = render(<FluidNumber value={100}/>);
    view.rerender(<FluidNumber value={200}/>);
    step(0); step(325);
    expect(screen.getByText('188')).toBeInTheDocument();
    expect(document.querySelector('.fluid-number')).toHaveAttribute('aria-label', '200');
    view.rerender(<FluidNumber value={50}/>);
    step(325);
    expect(screen.getByText('188')).toBeInTheDocument();
    step(650);
    const middle = Number(document.querySelector('.fluid-number span').textContent);
    expect(middle).toBeGreaterThan(50); expect(middle).toBeLessThan(188);
    step(975);
    expect(screen.getByText('50')).toBeInTheDocument();
    expect(frames.size).toBe(0);
  });
  it('mueve la curva entre conjuntos de distinto tamaño y termina en puntos exactos', () => {
    enableMotion();
    const initial = [{ x: 0, y: 10 }, { x: 100, y: 20 }];
    const next = [{ x: 0, y: 30 }, { x: 50, y: 0 }, { x: 100, y: 40 }];
    const hook = renderHook(({ points }) => useFluidLine(points), { initialProps: { points: initial } });
    hook.rerender({ points: next }); step(0); step(350);
    expect(hook.result.current).toHaveLength(120);
    expect(hook.result.current[0].y).toBeGreaterThan(10);
    expect(hook.result.current[0].y).toBeLessThan(30);
    const visible = hook.result.current[0].y;
    hook.rerender({ points: initial }); step(350);
    expect(hook.result.current[0].y).toBe(visible);
    step(1050);
    expect(hook.result.current).toEqual(initial);
    expect(densify(next, 120)).toEqual(expect.arrayContaining(next));
    expect(frames.size).toBe(0);
  });
  it('acorta el movimiento automáticamente y cancela fotogramas al desmontar', () => {
    enableMotion();
    const view = render(<FluidNumber value={100}/>);
    view.rerender(<FluidNumber value={200}/>);
    expect(frames.size).toBeGreaterThan(0);
    view.unmount(); expect(frames.size).toBe(0);
    vi.stubGlobal('matchMedia', () => ({ matches: true, addEventListener() {}, removeEventListener() {} }));
    const reduced = render(<FluidNumber value={2}/>);
    reduced.rerender(<FluidNumber value={-0.3} decimals={3}/>);
    step(0); step(140);
    expect(screen.getByText('-0.300')).toBeInTheDocument();
    expect(frames.size).toBe(0);
  });
});

describe('Transición entre vistas', () => {
  it('solo confirma el último destino si se navega antes de terminar la transición', async () => {
    const pending = [];
    document.startViewTransition = vi.fn(callback => {
      let resolve;
      const transition = { ready: Promise.resolve(), finished: new Promise(done => { resolve = done; }), skipTransition: vi.fn() };
      pending.push({ callback, resolve, transition }); return transition;
    });
    render(<MemoryRouter initialEntries={['/dashboard/resumen']}><MotionProvider>
      <MotionLink to="/dashboard/explorar">Explorar</MotionLink><MotionLink to="/dashboard/cuenta">Cuenta</MotionLink>
      <Routes><Route path="/dashboard/resumen" element={<h1>Resumen</h1>}/><Route path="/dashboard/explorar" element={<h1>Exploración</h1>}/><Route path="/dashboard/cuenta" element={<h1>Tu cuenta</h1>}/></Routes>
    </MotionProvider></MemoryRouter>);
    fireEvent.click(screen.getByText('Explorar')); fireEvent.click(screen.getByText('Cuenta'));
    expect(pending[0].transition.skipTransition).toHaveBeenCalled();
    act(() => pending[0].callback());
    expect(screen.getByRole('heading')).toHaveTextContent('Resumen');
    act(() => pending[1].callback());
    expect(screen.getByRole('heading')).toHaveTextContent('Tu cuenta');
    await act(async () => pending.forEach(item => item.resolve()));
    expect(document.documentElement).not.toHaveAttribute('data-motion-scope');
  });
});
