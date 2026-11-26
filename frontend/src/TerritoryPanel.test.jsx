import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import TerritoryPanel from './TerritoryPanel';
import { api } from './api';
const fake=vi.hoisted(()=>{
  const map={setView:vi.fn(),remove:vi.fn(),on:vi.fn(),off:vi.fn(),getZoom:vi.fn(()=>4),fitBounds:vi.fn(),flyTo:vi.fn(),flyToBounds:vi.fn(),invalidateSize:vi.fn(),attributionControl:{setPrefix:vi.fn()}};
  map.setView.mockReturnValue(map);
  const tiles=[];
  const marker={bindTooltip:vi.fn(),addTo:vi.fn(),on:vi.fn(),openTooltip:vi.fn(),closeTooltip:vi.fn()};
  marker.bindTooltip.mockReturnValue(marker);marker.addTo.mockReturnValue(marker);
  const L={map:vi.fn(container=>{
    container.classList.add('leaflet-container','leaflet-grab','leaflet-touch-zoom');
    return map;
  }),control:{zoom:()=>({addTo:vi.fn()})},layerGroup:()=>({addTo(){return this;},clearLayers:vi.fn()}),
    tileLayer:vi.fn((url,options)=>{const tile={addTo(){return this;},on:vi.fn(),remove:vi.fn()};tiles.push(tile);return tile;}),
    marker:vi.fn(()=>marker),divIcon:value=>value,latLngBounds:value=>value};
  return {L,map,tiles,disconnect:vi.fn()};
});
vi.mock('leaflet',()=>({default:fake.L}));
vi.mock('./api',()=>({api:vi.fn()}));
vi.mock('./auth',()=>({useAuth:()=>({expire})}));
const expire=()=>{};
const cities=[{pais:'México',estado:'Yucatán',ciudad:'Mérida',miembros:10,latitud:20.9,longitud:-89.6,interacciones:20},
 {pais:'México',estado:'Otro',ciudad:'Sin punto',miembros:8,latitud:null,longitud:null,interacciones:null}];
beforeEach(()=>{
  vi.clearAllMocks();fake.tiles.length=0;
  api.mockResolvedValue({ciudades:cities,minimo_grupo:5});
  vi.stubGlobal('ResizeObserver',class {observe(){} disconnect(){fake.disconnect();}});
});
afterEach(()=>{cleanup();vi.unstubAllGlobals();});

it('acota el mapa, evita repetición del planeta y omite marcadores sin coordenadas publicables',async()=>{
  render(<TerritoryPanel active/>);
  await waitFor(()=>expect(fake.L.tileLayer).toHaveBeenCalled());
  expect(fake.L.map.mock.calls[0][1]).toMatchObject({maxBounds:[[-70,-180],[80,180]],maxBoundsViscosity:1,worldCopyJump:false});
  expect(fake.L.tileLayer.mock.calls[0][1]).toMatchObject({noWrap:true,referrerPolicy:'strict-origin-when-cross-origin'});
  expect(fake.L.marker).toHaveBeenCalledTimes(1);
  expect(fake.L.marker.mock.calls[0][0]).toEqual([20.9,-89.6]);
  expect(screen.getByRole('option',{name:'Sin punto, México · sin punto publicable'})).toBeDisabled();
  expect(screen.getByRole('button',{name:/Sin punto.*Sin ubicación publicable/})).toBeDisabled();
  await userEvent.click(screen.getByRole('button',{name:'Interacciones',exact:true}));
  expect(screen.getByText('Reservado')).toBeVisible();
});

it('conserva ciudad y enfoque al volver, cambia de capa y libera recursos al salir',async()=>{
  const view=render(<TerritoryPanel active/>);
  await waitFor(()=>expect(fake.L.tileLayer).toHaveBeenCalled());
  await userEvent.selectOptions(screen.getByRole('combobox',{name:'Ir a una ciudad'}),'México|Yucatán|Mérida');
  expect(fake.map.flyTo).toHaveBeenCalledWith([20.9,-89.6],7,expect.any(Object));
  await userEvent.click(screen.getByRole('button',{name:'Ver todas las ciudades'}));
  expect(screen.getByRole('combobox',{name:'Ir a una ciudad'})).toHaveValue('');
  expect(fake.map.flyToBounds).toHaveBeenCalled();
  await userEvent.selectOptions(screen.getByRole('combobox',{name:'Ir a una ciudad'}),'México|Yucatán|Mérida');
  const initialTile=fake.tiles[0];
  await userEvent.click(screen.getByRole('button',{name:'Satélite'}));
  expect(initialTile.remove).toHaveBeenCalled();
  view.rerender(<TerritoryPanel active={false}/>);
  expect(fake.map.remove).toHaveBeenCalled();
  expect(fake.disconnect).toHaveBeenCalled();
  view.rerender(<TerritoryPanel active/>);
  await waitFor(()=>expect(fake.L.map).toHaveBeenCalledTimes(2));
  await waitFor(()=>expect(fake.map.setView).toHaveBeenLastCalledWith([20.9,-89.6],7,{animate:false}));
  expect(screen.getByRole('combobox',{name:'Ir a una ciudad'})).toHaveValue('México|Yucatán|Mérida');
});

it('conserva las clases de Leaflet al alternar estilos y permite zoom y movimiento por gestos',async()=>{
  render(<TerritoryPanel active/>);
  await waitFor(()=>expect(fake.L.tileLayer).toHaveBeenCalled());
  const map=screen.getByRole('region',{name:'Mapa de ciudades con ubicación aproximada'});
  const user=userEvent.setup();
  for(const [label,layer] of [['Urbano','urbano'],['Calles y relieve','topografia'],['Satélite','satelite'],['Obsidiana','obsidiana']]){
    await user.click(screen.getByRole('button',{name:label,exact:true}));
    expect(map).toHaveClass('leaflet-container','leaflet-grab','leaflet-touch-zoom');
    expect(map).toHaveAttribute('data-map-layer',layer);
    expect(screen.getByRole('button',{name:label,exact:true})).toHaveAttribute('aria-pressed','true');
  }
  expect(fake.L.map).toHaveBeenCalledTimes(1);
  expect(fake.L.map.mock.calls[0][1]).toMatchObject({scrollWheelZoom:true,dragging:true,touchZoom:true});
  expect(map).toHaveAccessibleDescription(/Arrastra.*rueda.*pellizco/);
});
