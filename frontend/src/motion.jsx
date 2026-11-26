import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import { Link, NavLink, useLocation, useNavigate, useResolvedPath } from 'react-router-dom';

const MotionContext = createContext(update => update());
const ease = t => 1 - (1 - t) ** 3;
const reduced = () => Boolean(window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches);
const supported = () => typeof Element.prototype.animate === 'function';

export function MotionProvider({ children }) {
  useLayoutEffect(() => {
    document.documentElement.dataset.motion = 'fluido';
    return () => { delete document.documentElement.dataset.motion; };
  }, []);
  const current = useRef(null);
  const version = useRef(0);
  const run = useCallback((update, scope = 'page', direction = 1) => {
    const id = ++version.current;
    current.current?.skipTransition();
    if (!document.startViewTransition) { current.current = null; delete document.documentElement.dataset.motionScope; update(); return; }
    document.documentElement.dataset.motionScope = scope;
    document.documentElement.style.setProperty('--motion-direction', direction);
    let committed = false;
    const commit = () => {
      if (id !== version.current || committed) return;
      committed = true;
      flushSync(update);
    };
    try {
      const transition = document.startViewTransition(commit);
      current.current = transition;
      transition.ready.catch(() => {});
      transition.finished.catch(() => {}).finally(() => {
        if (id === version.current) { current.current = null; delete document.documentElement.dataset.motionScope; }
      });
    } catch { commit(); delete document.documentElement.dataset.motionScope; }
  }, []);
  useEffect(() => () => { version.current++; current.current?.skipTransition(); delete document.documentElement.dataset.motionScope; }, []);
  return <MotionContext.Provider value={run}>{children}</MotionContext.Provider>;
}

export const useMotion = () => useContext(MotionContext);
const order = ['resumen', 'explorar', 'historico', 'territorio', 'participacion', 'cuenta'];
function MotionAnchor({ active, to, onClick, ...props }) {
  const navigate = useNavigate();
  const location = useLocation();
  const destination = useResolvedPath(to);
  const transition = useMotion();
  const Component = active ? NavLink : Link;
  function click(event) {
    onClick?.(event);
    if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || props.target === '_blank') return;
    if (destination.pathname === location.pathname && destination.hash === location.hash && destination.search === location.search) return;
    event.preventDefault();
    const from = order.indexOf(location.pathname.split('/')[2]);
    const target = order.indexOf(destination.pathname.split('/')[2]);
    transition(() => navigate(to, { state: props.state, replace: props.replace }), 'page', target < from ? -1 : 1);
  }
  return <Component to={to} onClick={click} {...props}/>;
}
export const MotionLink = props => <MotionAnchor {...props}/>;
export const MotionNavLink = props => <MotionAnchor {...props} active/>;

export function usePageMotion(key, ref) {
  useLayoutEffect(() => {
    if (!supported() || document.documentElement.dataset.motionScope === 'page') return;
    const element = ref.current;
    const animation = element?.animate(reduced() ? [{ opacity: .65 }, { opacity: 1 }] : [{ opacity: .35, transform: 'translateY(10px)' }, { opacity: 1, transform: 'translateY(0)' }], { duration: reduced() ? 120 : 360, easing: 'cubic-bezier(.2,.7,.2,1)' });
    return () => animation?.cancel();
  }, [key, ref]);
}

export function useReducedMotion() {
  const [value, setValue] = useState(reduced);
  useEffect(() => {
    const query = window.matchMedia?.('(prefers-reduced-motion: reduce)');
    const update = () => setValue(reduced());
    query?.addEventListener?.('change', update);
    return () => query?.removeEventListener?.('change', update);
  }, []);
  return value;
}

// Retarget from the currently drawn frame, never from an obsolete snapshot.
export function useTweenMap(target, duration = 650, enterFromZero = false, restartFromZero = false) {
  const signature = JSON.stringify(target);
  const latest = useRef(target);
  latest.current = target;
  const drawn = useRef(restartFromZero ? {} : target);
  const [frame, setFrame] = useState(restartFromZero ? {} : target);
  const reduce = useReducedMotion();
  useLayoutEffect(() => {
    const next = latest.current;
    if (!supported()) { drawn.current = next; setFrame(next); return; }
    const previous = restartFromZero ? {} : drawn.current;
    const keys = [...new Set([...Object.keys(previous), ...Object.keys(next)])];
    let request;
    let start;
    function tick(now) {
      start ??= now;
      const progress = Math.min(1, (now - start) / (reduce ? 140 : duration));
      const state = Object.fromEntries(keys.map(key => {
        const from = previous[key] ?? (enterFromZero ? 0 : next[key] ?? 0);
        const to = next[key] ?? 0;
        return [key, from + (to - from) * ease(progress)];
      }));
      drawn.current = progress === 1 ? next : state;
      setFrame(drawn.current);
      if (progress < 1) request = requestAnimationFrame(tick);
    }
    request = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(request);
  }, [signature, duration, enterFromZero, restartFromZero, reduce]);
  return !supported() ? target : frame;
}

export function FluidNumber({ value, decimals = 0, fromZero = false, as: Tag = 'strong', className = '', ...props }) {
  const valid = typeof value === 'number' && Number.isFinite(value);
  const previous = useRef(null);
  const target = valid ? { value } : {};
  const animated = useTweenMap(target, 650, fromZero, fromZero);
  const formatter = useMemo(() => new Intl.NumberFormat('es-MX', { minimumFractionDigits: decimals, maximumFractionDigits: decimals }), [decimals]);
  const final = valid ? formatter.format(value) : '—';
  const drawnValue = animated.value ?? (fromZero ? 0 : value);
  const display = valid ? formatter.format(Math.abs(drawnValue) < .5 * 10 ** -decimals ? 0 : drawnValue) : '—';
  useEffect(() => { if (valid) previous.current = value; }, [value, valid]);
  const direction = previous.current == null || !valid ? 'none' : value > previous.current ? 'up' : value < previous.current ? 'down' : 'none';
  const Text = Tag === 'text' ? 'tspan' : 'span';
  return <Tag className={`fluid-number ${className}`} aria-label={final} data-direction={direction} {...props}><Text aria-hidden="true">{display}</Text></Tag>;
}

export function densify(points, count) {
  if (!points.length) return [];
  if (points.length === 1) return Array.from({ length: count }, () => ({ ...points[0] }));
  const extra = Math.max(0, count - points.length);
  const segments = points.length - 1;
  const result = [points[0]];
  for (let i = 0; i < segments; i++) {
    const steps = 1 + Math.floor(extra / segments) + (i < extra % segments ? 1 : 0);
    for (let j = 1; j <= steps; j++) result.push({ x: points[i].x + (points[i + 1].x - points[i].x) * j / steps, y: points[i].y + (points[i + 1].y - points[i].y) * j / steps });
  }
  return result;
}

export function useFluidLine(points) {
  const signature = JSON.stringify(points);
  const target = useRef(points); target.current = points;
  const drawn = useRef(points);
  const [frame, setFrame] = useState(points);
  const reduce = useReducedMotion();
  useLayoutEffect(() => {
    const next = target.current;
    if (!supported() || !drawn.current.length || !next.length) { drawn.current = next; setFrame(next); return; }
    const count = Math.max(120, drawn.current.length, next.length);
    const from = densify(drawn.current, count), to = densify(next, count);
    let request, start;
    function tick(now) {
      start ??= now;
      const progress = Math.min(1, (now - start) / (reduce ? 140 : 700));
      drawn.current = progress === 1 ? next : from.map((point, i) => ({ x: point.x + (to[i].x - point.x) * ease(progress), y: point.y + (to[i].y - point.y) * ease(progress) }));
      setFrame(drawn.current);
      if (progress < 1) request = requestAnimationFrame(tick);
    }
    request = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(request);
  }, [signature, reduce]);
  return !supported() ? points : frame;
}

export function useBarReorder(signature) {
  const ref = useRef(null);
  const previous = useRef(new Map());
  useLayoutEffect(() => {
    if (!ref.current) return;
    const positions = new Map();
    for (const row of ref.current.querySelectorAll('[data-bar-key]')) {
      const key = row.dataset.barKey;
      const top = row.offsetTop;
      positions.set(key, top);
      const old = previous.current.get(key);
      if (old != null && old !== top && !reduced() && supported()) {
        row.getAnimations?.().forEach(animation => animation.cancel());
        row.animate([{ transform: `translateY(${old - top}px)` }, { transform: 'translateY(0)' }], { duration: 650, easing: 'cubic-bezier(.2,.7,.2,1)' });
      }
    }
    previous.current = positions;
  }, [signature]);
  return ref;
}
