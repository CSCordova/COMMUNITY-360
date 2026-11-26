import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMotion } from './motion';
import { Icon } from './ui';

export default function CommandPalette({ views }) {
  const [open, setOpen] = useState(false), [query, setQuery] = useState(''), [index, setIndex] = useState(0);
  const dialog = useRef(null), input = useRef(null), trigger = useRef(null), results = useRef(null);
  const navigate = useNavigate(), transition = useMotion();
  const matches = Object.entries(views).filter(([, view]) => `${view.label} ${view.description}`.toLocaleLowerCase('es').includes(query.toLocaleLowerCase('es')));
  useEffect(() => {
    const keys = event => { if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') { event.preventDefault(); setOpen(value => !value); } };
    document.addEventListener('keydown', keys); return () => document.removeEventListener('keydown', keys);
  }, []);
  useEffect(() => {
    if (open) { setQuery(''); setIndex(0); if (dialog.current?.showModal) dialog.current.showModal(); else dialog.current?.setAttribute('open', ''); input.current?.focus(); }
    else { if (dialog.current?.close) dialog.current.close(); else dialog.current?.removeAttribute('open'); }
  }, [open]);
  useEffect(() => {
    if (open) results.current?.querySelector('.is-current')?.scrollIntoView?.({ block: 'nearest' });
  }, [open, index, query]);
  function go(id) { const view = views[id]; setOpen(false); transition(() => navigate(view.to || `/dashboard/${id}`, { state: view.state }), 'page'); }
  return <><button className="command-trigger" aria-label="Buscar secciones" ref={trigger} onClick={() => setOpen(true)}><Icon name="search"/><span>Ir a una sección</span><kbd>Ctrl K</kbd></button><dialog className="command-dialog" ref={dialog} aria-labelledby="command-title" onCancel={() => setOpen(false)} onClick={event => { if (event.target === dialog.current) setOpen(false); }} onClose={() => { setOpen(false); trigger.current?.focus({ preventScroll: true }); }}>
    <div className="command-heading"><h2 id="command-title">Encuentra tu sección</h2><button type="button" onClick={() => setOpen(false)} aria-label="Cerrar búsqueda de secciones">Esc</button></div><input ref={input} aria-label="Buscar una sección" placeholder="Prueba con mapa de calor, registros o territorio" value={query} onChange={event => { setQuery(event.target.value); setIndex(0); }} onKeyDown={event => { if (['ArrowDown','ArrowUp'].includes(event.key)) { event.preventDefault(); setIndex(value => Math.max(0, Math.min(matches.length - 1, value + (event.key === 'ArrowDown' ? 1 : -1)))); } if (event.key === 'Enter' && matches[index]) go(matches[index][0]); }}/>
    <div className="command-results" ref={results}>{matches.map(([id, view], i) => <button key={id} aria-label={`${view.label}: ${view.description}`} className={index === i ? 'is-current' : ''} onClick={() => go(id)}><Icon name={view.icon}/><span><strong>{view.label}</strong><small>{view.description}</small></span><Icon name="arrow"/></button>)}{!matches.length && <p>No encontramos una sección con ese nombre.</p>}</div><p className="command-footer">Flechas para elegir · Enter para abrir · Esc para cerrar</p>
  </dialog></>;
}
