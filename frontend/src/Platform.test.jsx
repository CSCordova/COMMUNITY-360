import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, renderHook, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, useLocation } from 'react-router-dom';
import CommandPalette from './CommandPalette';
import DemographyPanel from './DemographyPanel';
import ParticipationPanel from './ParticipationPanel';
import { ResourceFeedback, useReadResource } from './useReadResource';
import { LiveEventFeed, useEventLog } from './LiveEvents';
import { api } from './api';
const { expire } = vi.hoisted(() => ({ expire: vi.fn() }));
vi.mock('./auth', () => ({ useAuth: () => ({ expire }) }));
vi.mock('./api', () => ({ api: vi.fn() }));
beforeEach(() => { api.mockReset(); expire.mockReset(); });
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

it('abre la búsqueda con Ctrl K y navega a la coincidencia con Enter', async () => {
  function Position() { return <output>{useLocation().pathname}</output>; }
  render(<MemoryRouter><CommandPalette views={{ territorio: { label:'Territorio',description:'Ciudades autorizadas',icon:'territory' }, resumen:{ label:'Resumen',description:'Actividad',icon:'overview' } }}/><Position/></MemoryRouter>);
  fireEvent.keyDown(document, { key:'k',ctrlKey:true });
  const input=screen.getByRole('textbox',{name:'Buscar una sección'});
  expect(input).toHaveFocus();
  await userEvent.type(input,'Ciudades');
  expect(screen.getByRole('button',{name:/Territorio.*Ciudades/})).toBeVisible();
  fireEvent.keyDown(input,{key:'Enter'});
  expect(screen.getByRole('status')).toHaveTextContent('/dashboard/territorio');
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
});

it('cambia la dimensión demográfica y conserva los conteos y porcentajes reales', async () => {
  const data={indicadores:{usuarios:10,artistas:2,mensajes_30d:20,por_rango_edad:[{categoria:'Adulto',total:8},{categoria:'Joven',total:2}],por_especie:[{categoria:'Lobo',total:6},{categoria:'Zorro',total:4}]}};
  render(<DemographyPanel history={data} refresh={vi.fn()}/>);
  expect(screen.getByRole('img',{name:'Distribución del padrón: Grupos de edad'})).toBeVisible();
  await userEvent.click(screen.getByRole('tab',{name:'Categorías / especies'}));
  expect(screen.getByRole('img',{name:'Distribución del padrón: Categorías / especies'})).toBeVisible();
  expect(screen.getByRole('tabpanel')).toHaveTextContent('60.0%');
  expect(screen.getByRole('tabpanel')).toHaveTextContent('10 miembros distribuidos en 2 categorías');
});

it('consulta participación solo al entrar, filtra en el servidor y pagina sin IDs completos', async () => {
  api.mockResolvedValue({total:21,fecha_corte:'2026-11-25',items:[{referencia:'123abc',usuario:'U***001',estatus:'en_riesgo',ultima_actividad:'2026-11-01',dias_sin_actividad:24,mensajes_30d:2}]});
  const {rerender}=render(<ParticipationPanel active={false}/>);
  expect(api).not.toHaveBeenCalled();
  rerender(<ParticipationPanel active/>);
  expect(await screen.findByText('U***001')).toBeVisible();
  expect(api.mock.calls[0][0]).toContain('estatus=en_riesgo');
  await userEvent.click(screen.getByRole('button',{name:'Siguiente'}));
  await waitFor(()=>expect(api.mock.calls.at(-1)[0]).toContain('desplazamiento=20'));
  await userEvent.selectOptions(screen.getByRole('combobox',{name:'Estado de participación'}),'activo');
  await waitFor(()=>expect(api.mock.calls.at(-1)[0]).toContain('estatus=activo'));
  expect(api.mock.calls.at(-1)[0]).toContain('desplazamiento=0');
  expect(screen.queryByText('U000001')).not.toBeInTheDocument();
});

it('descarta una respuesta que llega después de abandonar la vista', async () => {
  let resolve;
  api.mockReturnValue(new Promise(done=>{resolve=done;}));
  const {result,rerender}=renderHook(({active})=>useReadResource('/test',active),{initialProps:{active:true}});
  rerender({active:false});
  await act(async()=>{resolve({dato:'obsoleto'});});
  expect(result.current.data).toBeNull();
  expect(api.mock.calls[0][1].signal.aborted).toBe(true);
});

it('revoca el acceso al recibir 401 en una vista nueva', async()=>{
  api.mockRejectedValue(Object.assign(new Error('Sesión vencida'),{status:401}));
  renderHook(()=>useReadResource('/test',true));
  await waitFor(()=>expect(expire).toHaveBeenCalledOnce());
});

it('conserva la lectura y evita esqueletos grandes al actualizar una vista ya cargada', async()=>{
  let complete;
  api.mockResolvedValueOnce({total:21}).mockImplementationOnce(()=>new Promise(resolve=>{complete=resolve;}));
  function View(){
    const resource=useReadResource('/test',true);
    return <><ResourceFeedback resource={resource}/>{resource.data && <p>{resource.data.total} ciudades</p>}<button onClick={resource.refresh}>Actualizar vista</button></>;
  }
  render(<View/>);
  expect(await screen.findByText('21 ciudades')).toBeVisible();
  await userEvent.click(screen.getByRole('button',{name:'Actualizar vista'}));
  expect(screen.getByRole('status')).toHaveTextContent('Actualizando datos. Se mantiene la última lectura.');
  expect(screen.getByText('21 ciudades')).toBeVisible();
  expect(screen.queryByLabelText('Consultando datos')).not.toBeInTheDocument();
  await act(async()=>complete({total:22}));
  expect(await screen.findByText('22 ciudades')).toBeVisible();
  expect(screen.queryByRole('status')).not.toBeInTheDocument();
});

it('el feed conserva solo eventos confirmados y enmascara identificadores', async()=>{
  const {result,rerender}=renderHook(({event})=>useEventLog(event),{initialProps:{event:{date:'2026-11-26T00:00:00Z'}}});
  expect(result.current).toEqual([]);
  const event={operation:'creada',id:'I9000001',date:'2026-11-26T00:00:00Z'};
  rerender({event});
  expect(result.current).toHaveLength(1);
  rerender({event:{...event}});
  expect(result.current).toHaveLength(1);
  render(<LiveEventFeed events={result.current}/>);
  expect(screen.getByText('I***001')).toBeVisible();
  expect(screen.queryByText('I9000001')).not.toBeInTheDocument();
});
