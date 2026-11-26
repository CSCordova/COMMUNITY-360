import { useMotion } from './motion';

export function Icon({ name, ...props }) {
  const paths = {
    lock: <><rect x="5" y="10" width="14" height="11" rx="3"/><path d="M8 10V7a4 4 0 0 1 8 0v3M12 14v3"/></>,
    user: <><circle cx="12" cy="8" r="4"/><path d="M4 21v-2a8 8 0 0 1 16 0v2"/></>,
    eye: <><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z"/><circle cx="12" cy="12" r="3"/></>,
    eyeOff: <><path d="m3 3 18 18M10.6 5.1 12 5c6.5 0 10 7 10 7a18 18 0 0 1-4 4M6 6c-2.6 2-4 6-4 6s3.5 7 10 7a12 12 0 0 0 4-.7M10 10a3 3 0 0 0 4 4"/></>,
    shield: <><path d="m12 3 8 3v6c0 5-8 9-8 9s-8-4-8-9V6Z"/><path d="m8 12 3 3 5-6"/></>,
    logout: <><path d="M9 4H4v16h5M13 8l4 4-4 4M8 12h13"/></>,
    chart: <><path d="M4 3v18h17M9 16v-5M14 16V6M19 16v-8"/></>,
    overview: <><rect x="3" y="3" width="7" height="7" rx="2"/><rect x="14" y="3" width="7" height="7" rx="2"/><rect x="3" y="14" width="7" height="7" rx="2"/><rect x="14" y="14" width="7" height="7" rx="2"/></>,
    explore: <><circle cx="12" cy="12" r="9"/><path d="m16 8-3 5-5 3 3-5Z"/></>,
    history: <><path d="M3 11a9 9 0 1 1 2 7M3 4v7h7M12 7v5l3 2"/></>,
    filter: <><path d="M4 6h16M7 12h10M10 18h4"/><circle cx="8" cy="6" r="2" fill="currentColor" stroke="none"/><circle cx="15" cy="12" r="2" fill="currentColor" stroke="none"/></>,
    arrow: <><path d="M4 12h16m-6-6 6 6-6 6"/></>,
    refresh: <><path d="M20 10a8 8 0 0 0-14-5L3 8m0-5v5h5M4 14a8 8 0 0 0 14 5l3-3m0 5v-5h-5"/></>,
    territory: <><path d="m3 6 6-3 6 3 6-3v15l-6 3-6-3-6 3ZM9 3v15m6-12v15"/></>,
    participation: <><path d="M3 12h4l3-8 4 16 3-8h4"/></>,
    search: <><circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 5 5"/></>,
    collapse: <><rect x="3" y="4" width="18" height="16" rx="3"/><path d="M9 4v16m7-12-3 4 3 4"/></>,
    more: <><circle cx="5" cy="12" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/></>,
  };
  return <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" {...props}>{paths[name]}</svg>;
}

export function Brand({ light = false }) {
  return <div className={`brand ${light ? 'brand-light' : ''}`}><span className="brand-symbol" aria-hidden="true"><svg viewBox="0 0 40 40" fill="none"><circle cx="20" cy="20" r="16"/><circle cx="20" cy="20" r="9"/><path d="M20 20 31 9M20 4v4M4 20h4M20 32v4M32 20h4"/><circle className="radar-node" cx="20" cy="20" r="2.5"/></svg></span><span>COMMUNITY <strong>360</strong></span></div>;
}

export function Loading() {
  return <main className="center-state"><Brand/><p role="status">Comprobando tu sesión…</p></main>;
}

export function ViewTabs({ label, idPrefix, tabs, selected, onChange }) {
  const transition = useMotion();
  function select(id) {
    if (id === selected) return;
    transition(() => onChange(id), 'tab', tabs.findIndex(tab => tab.id === id) < tabs.findIndex(tab => tab.id === selected) ? -1 : 1);
  }
  function keys(event) {
    const index = tabs.findIndex(tab => tab.id === selected);
    const direction = event.key === 'ArrowRight' ? 1 : event.key === 'ArrowLeft' ? -1 : 0;
    if (!direction && !['Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    const next = event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1 : (index + direction + tabs.length) % tabs.length;
    select(tabs[next].id);
    event.currentTarget.querySelectorAll('[role="tab"]')[next].focus();
  }
  return <div className="view-tabs" role="tablist" aria-label={label} onKeyDown={keys}>{tabs.map(tab => <button id={`${idPrefix}-${tab.id}`} key={tab.id} type="button" role="tab" aria-selected={selected === tab.id} aria-controls={`${idPrefix}-panel-${tab.id}`} tabIndex={selected === tab.id ? 0 : -1} onClick={() => select(tab.id)}>{tab.label}</button>)}</div>;
}
