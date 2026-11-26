import { useEffect, useState } from 'react';
import { api } from './api';
import { useAuth } from './auth';

export function useReadResource(path, active, revision) {
  const { expire } = useAuth();
  const [state, setState] = useState({ data: null, busy: false, error: '', path: null });
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    if (!active) return;
    const controller = new AbortController();
    let current = true;
    setState(previous => ({ ...previous, busy: true, error: '' }));
    api(path, { signal: controller.signal }).then(data => {
      if (current) setState({ data, busy: false, error: '', path });
    }).catch(error => {
      if (!current || controller.signal.aborted) return;
      if (error.status === 401) expire();
      else setState(previous => ({ ...previous, busy: false, error: error.message }));
    });
    return () => { current = false; controller.abort(); };
  }, [path, active, revision, retry, expire]);
  const data = state.path === path ? state.data : null;
  return { ...state, data, busy: state.busy || Boolean(active && !data && !state.error), refresh: () => setRetry(value => value + 1) };
}

export function ResourceFeedback({ resource }) {
  return <>{resource.busy && (resource.data
    ? <p className="resource-refresh-note" role="status">Actualizando datos. Se mantiene la última lectura.</p>
    : <div className="resource-skeleton" role="status" aria-label="Consultando datos"><i/><i/><i/></div>)}{resource.error && <div className="dashboard-error"><p role="alert">{resource.error}</p><button type="button" className="secondary-button" onClick={resource.refresh}>Reintentar consulta</button></div>}</>;
}
