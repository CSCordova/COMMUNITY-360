from typing import Annotated, Literal
from fastapi import APIRouter, Depends, Query
from backend.auth.dependencies import obtener_cuenta
from backend.interacciones.routes import obtener_servicio
from backend.interacciones.schemas import FiltrosInteracciones
from backend.interacciones.service import InteraccionesService
from backend.usuarios.repository import UsuariosRepository, obtener_usuarios_repository
from backend.analitica.insights import agrupar_territorio

router = APIRouter(prefix="/api/analitica", tags=["Analítica"], dependencies=[Depends(obtener_cuenta)])


@router.get("/usuarios")
def historico_usuarios(usuarios: UsuariosRepository = Depends(obtener_usuarios_repository)):
    return usuarios.historico()


@router.get("/interacciones")
def analitica_interacciones(filtros: Annotated[FiltrosInteracciones, Query()],
                            servicio: InteraccionesService = Depends(obtener_servicio)):
    return servicio.resumen(filtros)


@router.get('/territorio')
def territorio(usuarios: UsuariosRepository = Depends(obtener_usuarios_repository),
               servicio: InteraccionesService = Depends(obtener_servicio)):
    return agrupar_territorio(usuarios.territorio_autorizado(), servicio.consultar(FiltrosInteracciones()))


@router.get('/participacion')
def participacion(estatus: Literal['activo', 'inactivo', 'en_riesgo'] | None = None,
                  orden: Literal['inactividad', 'estatus'] = 'inactividad',
                  limite: Annotated[int, Query(ge=1, le=100)] = 25,
                  desplazamiento: Annotated[int, Query(ge=0)] = 0,
                  usuarios: UsuariosRepository = Depends(obtener_usuarios_repository)):
    return usuarios.participacion(estatus, orden, limite, desplazamiento)
