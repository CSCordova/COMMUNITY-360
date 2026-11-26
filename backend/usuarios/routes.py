from typing import Annotated, Literal
from fastapi import APIRouter, Depends, HTTPException, Path, Query
from backend.auth.dependencies import obtener_cuenta
from backend.usuarios.repository import UsuariosRepository, obtener_usuarios_repository

router = APIRouter(prefix="/api/usuarios", tags=["Usuarios"], dependencies=[Depends(obtener_cuenta)])


@router.get("")
def listar_usuarios(limite: Annotated[int, Query(ge=1, le=100)] = 25,
                    desplazamiento: Annotated[int, Query(ge=0)] = 0,
                    estatus: Literal["activo", "inactivo", "en_riesgo"] | None = None,
                    repo: UsuariosRepository = Depends(obtener_usuarios_repository)):
    return repo.listar(limite, desplazamiento, estatus)


@router.get("/{id_usuario}")
def consultar_usuario(id_usuario: Annotated[str, Path(pattern=r"^U[0-9]{6}$")],
                      repo: UsuariosRepository = Depends(obtener_usuarios_repository)):
    usuario = repo.obtener(id_usuario)
    if usuario is None:
        raise HTTPException(404, "Usuario no encontrado.")
    return usuario
