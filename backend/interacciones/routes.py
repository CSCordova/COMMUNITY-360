from typing import Annotated
from fastapi import APIRouter, BackgroundTasks, Depends, Header, Path, Query, Response
from backend.auth.dependencies import obtener_cuenta, validar_origen
from backend.interacciones.repository import InteraccionesRepository, obtener_interacciones_repository
from backend.interacciones.schemas import CrearInteraccion, DatosInteraccion, CambiosInteraccion, ConsultaInteracciones
from backend.interacciones.service import InteraccionesService, etag
from backend.usuarios.repository import UsuariosRepository, obtener_usuarios_repository
from backend.realtime.hub import DashboardHub, obtener_hub

router = APIRouter(prefix="/api/interacciones", tags=["Interacciones"], dependencies=[Depends(obtener_cuenta)])
Identificador = Annotated[str, Path(pattern=r"^I[0-9]{7}$")]


def obtener_servicio(repo: InteraccionesRepository = Depends(obtener_interacciones_repository),
                     usuarios: UsuariosRepository = Depends(obtener_usuarios_repository)):
    return InteraccionesService(repo, usuarios)


@router.get("")
def listar_interacciones(filtros: Annotated[ConsultaInteracciones, Query()],
                         servicio: InteraccionesService = Depends(obtener_servicio)):
    datos = servicio.buscar_registros(filtros)
    return {"total": len(datos), "limite": filtros.limite, "desplazamiento": filtros.desplazamiento,
            "items": datos[filtros.desplazamiento:filtros.desplazamiento + filtros.limite]}


@router.get("/{id_interaccion}")
def consultar_interaccion(id_interaccion: Identificador, response: Response,
                          servicio: InteraccionesService = Depends(obtener_servicio)):
    registro, datos = servicio.obtener(id_interaccion)
    response.headers["ETag"] = etag(registro)
    return datos


@router.post("", status_code=201, dependencies=[Depends(validar_origen)])
def crear_interaccion(entrada: CrearInteraccion, response: Response, tareas: BackgroundTasks,
                      servicio: InteraccionesService = Depends(obtener_servicio),
                      hub: DashboardHub = Depends(obtener_hub)):
    registro = servicio.crear(entrada)
    tareas.add_task(hub.notificar, servicio, "creada", registro.datos["id_interaccion"])
    response.headers["Location"] = "/api/interacciones/" + registro.datos["id_interaccion"]
    response.headers["ETag"] = etag(registro)
    return registro.datos


@router.put("/{id_interaccion}", dependencies=[Depends(validar_origen)])
def reemplazar_interaccion(id_interaccion: Identificador, entrada: DatosInteraccion, response: Response, tareas: BackgroundTasks,
                           if_match: Annotated[str | None, Header()] = None,
                           servicio: InteraccionesService = Depends(obtener_servicio),
                           hub: DashboardHub = Depends(obtener_hub)):
    registro = servicio.actualizar(id_interaccion, entrada, version_cliente=if_match)
    tareas.add_task(hub.notificar, servicio, "modificada", id_interaccion)
    response.headers["ETag"] = etag(registro)
    return registro.datos


@router.patch("/{id_interaccion}", dependencies=[Depends(validar_origen)])
def modificar_interaccion(id_interaccion: Identificador, entrada: CambiosInteraccion, response: Response, tareas: BackgroundTasks,
                          if_match: Annotated[str | None, Header()] = None,
                          servicio: InteraccionesService = Depends(obtener_servicio),
                          hub: DashboardHub = Depends(obtener_hub)):
    registro = servicio.actualizar(id_interaccion, entrada, parcial=True, version_cliente=if_match)
    tareas.add_task(hub.notificar, servicio, "modificada", id_interaccion)
    response.headers["ETag"] = etag(registro)
    return registro.datos


@router.delete("/{id_interaccion}", status_code=204, dependencies=[Depends(validar_origen)])
def eliminar_interaccion(id_interaccion: Identificador, tareas: BackgroundTasks,
                         if_match: Annotated[str | None, Header()] = None,
                         servicio: InteraccionesService = Depends(obtener_servicio),
                         hub: DashboardHub = Depends(obtener_hub)):
    servicio.eliminar(id_interaccion, version_cliente=if_match)
    tareas.add_task(hub.notificar, servicio, "eliminada", id_interaccion)
    return Response(status_code=204)
