import { useEffect, useRef, useState } from 'react';
import { ResourceFeedback, useReadResource } from './useReadResource';
import { formatNumber } from './charts';
import { useReducedMotion } from './motion';

const worldBounds = [[-70, -180], [80, 180]];
const layers = [
  { id: 'obsidiana', label: 'Obsidiana', url: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png', attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>' },
  { id: 'urbano', label: 'Urbano', url: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png', attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>' },
  { id: 'topografia', label: 'Calles y relieve', url: 'https://services.arcgisonline.com/ArcGIS/rest/services/World_Topo_Map/MapServer/tile/{z}/{y}/{x}', attribution: 'Esri, HERE, Garmin, USGS, © OpenStreetMap contributors, GIS User Community' },
  { id: 'satelite', label: 'Satélite', url: 'https://services.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', attribution: 'Esri, Vantor, Earthstar Geographics, GIS User Community' },
];
const cityKey = row => [row.pais, row.estado, row.ciudad].join('|');

export default function TerritoryPanel({ active, revision }) {
  const resource = useReadResource('/api/analitica/territorio', active, revision);
  const [layer, setLayer] = useState('obsidiana');
  const [selected, setSelected] = useState('');
  const [measure, setMeasure] = useState('miembros');
  const [ready, setReady] = useState(false);
  const [mapError, setMapError] = useState('');
  const [mapAttempt, setMapAttempt] = useState(0);
  const [tileError, setTileError] = useState(false);
  const container = useRef(null), map = useRef(null), library = useRef(null), markers = useRef(null), initialBounds = useRef(false);
  const reduce = useReducedMotion();
  const cities = resource.data?.ciudades || [];
  const signature = JSON.stringify(cities);
  useEffect(() => {
    if (!active || !resource.data) return;
    let disposed = false;
    let resize;
    setMapError('');
    import('leaflet').then(module => {
      if (disposed) return;
      const L = module.default || module;
      library.current = L;
      map.current = L.map(container.current, { minZoom: 2, maxZoom: 12, maxBounds: worldBounds, maxBoundsViscosity: 1,
        worldCopyJump: false, scrollWheelZoom: true, dragging: true, touchZoom: true,
        wheelPxPerZoomLevel: 480, wheelDebounceTime: 100, zoomSnap: .25, zoomDelta: .5,
        zoomControl: false, zoomAnimation: !reduce, fadeAnimation: !reduce }).setView([24, -100], 4);
      map.current.attributionControl.setPrefix('<a href="https://leafletjs.com">Leaflet</a>');
      L.control.zoom({ position: 'bottomleft', zoomInTitle: 'Acercar mapa', zoomOutTitle: 'Alejar mapa' }).addTo(map.current);
      markers.current = L.layerGroup().addTo(map.current);
      resize = new ResizeObserver(() => map.current?.invalidateSize({ animate: false, pan: false }));
      resize.observe(container.current);
      initialBounds.current = false;
      setReady(true);
    }).catch(() => { if (!disposed) setMapError('No se pudo abrir el mapa. El listado territorial sigue disponible.'); });
    return () => { disposed = true; resize?.disconnect(); map.current?.remove(); map.current = null; markers.current = null; setReady(false); };
  }, [active, Boolean(resource.data), mapAttempt]);
  useEffect(() => {
    if (!ready || !map.current) return;
    const item = layers.find(item => item.id === layer);
    setTileError(false);
    const tile = library.current.tileLayer(item.url, { noWrap: true, bounds: worldBounds, maxZoom: 12,
      attribution: item.attribution, referrerPolicy: 'strict-origin-when-cross-origin' }).addTo(map.current);
    tile.on('tileerror', () => setTileError(true));
    return () => tile.remove();
  }, [ready, layer]);
  useEffect(() => {
    if (!ready || !markers.current || !map.current) return;
    const L = library.current, points = [];
    markers.current.clearLayers();
    const cityMarkers = [];
    for (const row of cities.filter(row => row.latitud != null && row.longitud != null)) {
      const point = [row.latitud, row.longitud]; points.push(point);
      const label = document.createElement('span');
      label.textContent = `${row.ciudad} · ${row.miembros} miembros${row.interacciones == null ? '' : ` · ${row.interacciones} interacciones`}`;
      const marker = L.marker(point, { title: row.ciudad, icon: L.divIcon({ className: 'city-radar', html: '<span></span>', iconSize: [22, 22], iconAnchor: [11, 11] }) })
        .bindTooltip(label, { direction: 'top', className: 'city-tooltip' }).addTo(markers.current);
      marker.on('click', () => { focusCity(cityKey(row)); marker.openTooltip(); });
      cityMarkers.push(marker);
    }
    const labels = () => cityMarkers.forEach(marker => map.current?.getZoom() >= 6 ? marker.openTooltip() : marker.closeTooltip());
    map.current.on('zoomend', labels);
    if (points.length && !initialBounds.current) {
      const city = cities.find(row => cityKey(row) === selected && row.latitud != null);
      if (city) map.current.setView([city.latitud, city.longitud], 7, { animate: false });
      else { setSelected(''); map.current.fitBounds(L.latLngBounds(points), { padding: [45, 45], maxZoom: 6, animate: false }); }
      initialBounds.current = true;
    }
    labels();
    return () => map.current?.off('zoomend', labels);
  }, [ready, signature]);
  function focusCity(key) {
    setSelected(key);
    const city = cities.find(row => cityKey(row) === key);
    if (city?.latitud != null) map.current?.flyTo([city.latitud, city.longitud], 7, { duration: reduce ? .1 : 1 });
    else if (!key) {
      const points = cities.filter(row => row.latitud != null).map(row => [row.latitud, row.longitud]);
      if (points.length && map.current) map.current.flyToBounds(library.current.latLngBounds(points), { padding: [40, 40], maxZoom: 6, duration: reduce ? .1 : 1 });
    }
  }
  const ranking = [...cities].sort((a, b) => (b[measure] ?? -1) - (a[measure] ?? -1) || a.ciudad.localeCompare(b.ciudad)).slice(0, 10);
  const max = Math.max(1, ...ranking.map(row => row[measure] || 0));
  return <section className="territory-view" aria-label="Territorio autorizado"><div className="section-toolbar"><p>Ciudades del padrón con consentimiento. Las interacciones se agrupan por la ciudad del autor en ese corte, no por su lugar de publicación. Los filtros de Explorar no se aplican aquí.</p><span className="privacy-seal">Grupos de al menos 5 miembros</span></div>
    <ResourceFeedback resource={resource}/>
    <div className="territory-layout"><div className="map-workspace"><div className="map-layers" role="group" aria-label="Estilo del mapa">{layers.map(item => <button key={item.id} type="button" aria-pressed={layer === item.id} onClick={() => setLayer(item.id)}>{item.label}</button>)}</div>
      <label className="city-jump">Ir a una ciudad<select value={selected} onChange={event => focusCity(event.target.value)}><option value="">Todas las ciudades</option>{cities.map(row => <option key={cityKey(row)} value={cityKey(row)} disabled={row.latitud == null}>{row.ciudad}, {row.pais}{row.latitud == null ? ' · sin punto publicable' : ''}</option>)}</select></label>
      {selected && <button type="button" className="chart-select-action map-reset" onClick={() => focusCity('')}>Ver todas las ciudades</button>}
      {mapError && <div className="map-note"><p role="alert">{mapError}</p><button className="secondary-button" onClick={() => setMapAttempt(value => value + 1)}>Reintentar mapa</button></div>}{active && resource.data && !ready && !mapError && <p className="map-note" role="status">Preparando el mapa…</p>}
      {/* Leaflet añade sus clases al contenedor. Cambiar className al elegir
          una capa las elimina; el estilo debe viajar en un atributo separado. */}
      <div ref={container} className="territory-map" data-map-layer={layer} role="region" aria-busy={active && !ready} aria-label="Mapa de ciudades con ubicación aproximada" aria-describedby="territory-map-instructions"/>
      {tileError && <p className="map-note" role="status">El proveedor no pudo cargar alguna imagen. Cambia de capa; los puntos y el ranking conservan sus datos.</p>}
      <p className="map-gestures" id="territory-map-instructions">Arrastra para moverte; usa la rueda o el gesto de pellizco para acercar y alejar. También puedes usar las flechas y +/− del teclado.</p>
      <p className="map-note">Puntos aproximados a 0.1°. Se necesitan al menos 5 aportantes para publicar coordenadas o actividad de un grupo. Selecciona una ciudad o un marcador para ver su grupo.</p>
    </div><aside className="territory-ranking"><h2>Concentración por ciudad</h2><p>{cities.length} ciudades cumplen el mínimo de agrupación.</p><div className="chart-measures" role="group" aria-label="Medida territorial"><button aria-pressed={measure === 'miembros'} onClick={() => setMeasure('miembros')}>Miembros</button><button aria-pressed={measure === 'interacciones'} onClick={() => setMeasure('interacciones')}>Interacciones</button></div>
      {ranking.map(row => <button className={`city-ranking-row ${selected === cityKey(row) ? 'is-selected' : ''}`} key={cityKey(row)} disabled={row.latitud == null || row.longitud == null} onClick={() => focusCity(cityKey(row))}><span>{row.ciudad}<small>{row.estado}, {row.pais}</small>{row.latitud == null && <small>Sin ubicación publicable</small>}</span><strong>{row[measure] == null ? 'Reservado' : formatNumber(row[measure])}</strong><i aria-hidden="true"><b style={{ width: `${(row[measure] || 0) / max * 100}%` }}/></i></button>)}
      {!cities.length && !resource.busy && <p>No hay grupos publicables con el mínimo de privacidad.</p>}<p className="map-note">«Reservado» indica menos de 5 participantes con actividad. No equivale a cero interacciones.</p>
    </aside></div>
  </section>;
}
