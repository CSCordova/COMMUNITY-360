from typing import Annotated
from fastapi import APIRouter, Depends, Query
from backend.auth.dependencies import obtener_cuenta
from backend.interacciones.routes import obtener_servicio
from backend.interacciones.schemas import FiltrosInteracciones
from backend.interacciones.service import InteraccionesService
from backend.usuarios.repository import UsuariosRepository, obtener_usuarios_repository

router = APIRouter(prefix="/api/analitica", tags=["Analítica"], dependencies=[Depends(obtener_cuenta)])


@router.get("/usuarios")
def historico_usuarios(usuarios: UsuariosRepository = Depends(obtener_usuarios_repository)):
    return usuarios.historico()


@router.get("/interacciones")
def analitica_interacciones(filtros: Annotated[FiltrosInteracciones, Query()],
                            servicio: InteraccionesService = Depends(obtener_servicio)):
    return servicio.resumen(filtros)
