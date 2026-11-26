import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from './api';

export function useRealtime(expire) {
  const [state, setState] = useState({ data: null, status: 'conectando', event: null, warning: '' });
  const subscription = useRef({ filters: {}, request: 0, socket: null });
  const applyFilters = useCallback(filters => {
    const current = subscription.current;
    current.filters = filters; current.request += 1;
    setState(previous => ({ ...previous, data: null, event: null, warning: '', status: 'filtrando' }));
    if (current.socket?.readyState === WebSocket.OPEN) current.socket.send(JSON.stringify({ tipo: 'suscribir', filtros: filters, solicitud: current.request }));
  }, []);
  useEffect(() => {
    let active = true, socket, reconnect, heartbeat, retryData;
    let attempt = 0, server, revision = -1, lastReceived = 0;
    const update = value => { if (active) setState(previous => ({ ...previous, ...value })); };
    function connect() {
      if (!active) return;
      update({ status: attempt ? 'reconectando' : 'conectando' });
      const current = new WebSocket(`${location.protocol === 'https:' ? 'wss:' : 'ws:'}//${location.host}/ws/dashboard`);
      socket = current;
      subscription.current.socket = current;
      current.onopen = () => {
        lastReceived = Date.now();
        if (subscription.current.request) current.send(JSON.stringify({ tipo: 'suscribir', filtros: subscription.current.filters, solicitud: subscription.current.request }));
        heartbeat = setInterval(() => {
          if (Date.now() - lastReceived > 70000) current.close();
          else if (current.readyState === WebSocket.OPEN) current.send(JSON.stringify({ tipo: 'ping' }));
        }, 25000);
      };
      current.onmessage = event => {
        if (!active || socket !== current) return;
        let message;
        try { message = JSON.parse(event.data); } catch { return; }
        lastReceived = Date.now();
        if (message.tipo === 'pong') return;
        if ((message.solicitud ?? 0) !== subscription.current.request) return;
        if (message.tipo === 'error_filtros') {
          update({ status: 'sincronizando', warning: 'No se pudieron aplicar los filtros. Revisa las fechas y vuelve a intentarlo.' });
          return;
        }
        if (message.tipo === 'error_datos') {
          update({ status: 'sincronizando', warning: 'No se pudo actualizar la actividad. Conservamos la última lectura mientras reintentamos.' });
          clearTimeout(retryData);
          retryData = setTimeout(() => {
            if (active && current.readyState === WebSocket.OPEN) current.send(JSON.stringify({ tipo: 'solicitar_estado' }));
          }, 10000);
          return;
        }
        if (!['estado_inicial', 'interacciones_actualizadas'].includes(message.tipo) || !message.indicadores) return;
        if (server === message.servidor && message.revision < revision) return;
        server = message.servidor; revision = message.revision; attempt = 0;
        clearTimeout(retryData);
        update({ data: message.indicadores, options: message.indicadores.opciones_filtros || {}, status: 'conectado', warning: '',
          event: { operation: message.operacion, id: message.id_interaccion, date: message.fecha } });
      };
      current.onerror = () => { /* onclose comprueba la sesión y reintenta. */ };
      current.onclose = async event => {
        clearInterval(heartbeat); clearTimeout(retryData);
        if (!active || socket !== current) return;
        if (event.code === 4401) { expire(); return; }
        update({ status: 'reconectando' });
        try { await api('/auth/me'); }
        catch (error) { if (error.status === 401) { if (active) expire(); return; } }
        if (!active) return;
        const delay = Math.min(30000, 1000 * 2 ** Math.min(attempt++, 5)) + Math.random() * 300;
        reconnect = setTimeout(connect, delay);
      };
    }
    connect();
    return () => {
      active = false;
      clearTimeout(reconnect); clearTimeout(retryData); clearInterval(heartbeat);
      if (socket) { socket.onclose = null; socket.onmessage = null; socket.onopen = null; socket.onerror = null; socket.close(); }
      subscription.current.socket = null;
    };
  }, [expire]);
  return { ...state, applyFilters };
}
