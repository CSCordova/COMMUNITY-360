from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Response
from pydantic import BaseModel, ConfigDict, Field, SecretStr, field_validator, model_validator
from backend.auth.accounts import buscar_cuenta, cambiar_password
from backend.auth.dependencies import error_credenciales, obtener_cuenta, validar_origen
from backend.auth.security import crear_token, generar_hash, verificar_password
from backend.core.config import COOKIE_NAME, COOKIE_SECURE, TOKEN_MINUTES
from backend.database.turso import conectar_turso
from backend.realtime.hub import DashboardHub, obtener_hub

router = APIRouter(prefix="/auth", tags=["Autenticación"])
HASH_FICTICIO = generar_hash("cuenta-inexistente-solo-comparacion")


class LoginRequest(BaseModel):
    usuario: str = Field(min_length=4, max_length=32)
    password: SecretStr = Field(min_length=1, max_length=1024)

    @field_validator("usuario", mode="before")
    @classmethod
    def normalizar_usuario(cls, valor):
        return valor.strip() if isinstance(valor, str) else valor


class CambioPasswordRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    password_actual: SecretStr = Field(min_length=1, max_length=1024)
    password_nueva: SecretStr = Field(min_length=8, max_length=14)
    confirmacion: SecretStr = Field(min_length=8, max_length=14)

    @model_validator(mode="after")
    def confirmar(self):
        if self.password_nueva.get_secret_value() != self.confirmacion.get_secret_value():
            raise ValueError("Las contraseñas nuevas no coinciden.")
        return self


@router.post("/login", dependencies=[Depends(validar_origen)])
def login(datos: LoginRequest, response: Response):
    with conectar_turso() as db:
        cuenta = buscar_cuenta(db, datos.usuario)
    valido = verificar_password(datos.password.get_secret_value(), cuenta[2] if cuenta else HASH_FICTICIO)
    if not cuenta or cuenta[3] != 1 or not valido:
        raise error_credenciales()
    token = crear_token(cuenta[0], cuenta[4])
    response.set_cookie(COOKIE_NAME, token, max_age=TOKEN_MINUTES * 60,
                        httponly=True, secure=COOKIE_SECURE, samesite="strict", path="/")
    return {"access_token": token, "token_type": "bearer", "expires_in": TOKEN_MINUTES * 60}


@router.get("/me")
def mi_cuenta(cuenta: dict = Depends(obtener_cuenta)):
    return {"id_cuenta": cuenta["id_cuenta"], "usuario": cuenta["usuario"]}


@router.post("/password", dependencies=[Depends(validar_origen)])
def cambiar_password_web(datos: CambioPasswordRequest, response: Response, tareas: BackgroundTasks,
                         cuenta: dict = Depends(obtener_cuenta), hub: DashboardHub = Depends(obtener_hub)):
    try:
        with conectar_turso() as db:
            cambiar_password(db, cuenta["usuario"], datos.password_actual.get_secret_value(),
                             datos.password_nueva.get_secret_value())
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from None
    tareas.add_task(hub.cerrar_cuenta, cuenta["id_cuenta"])
    response.delete_cookie(COOKIE_NAME, path="/", httponly=True, secure=COOKIE_SECURE, samesite="strict")
    return {"mensaje": "Contraseña actualizada. Inicia sesión nuevamente."}


@router.post("/logout", dependencies=[Depends(validar_origen)])
def logout(response: Response, tareas: BackgroundTasks, cuenta: dict = Depends(obtener_cuenta),
           hub: DashboardHub = Depends(obtener_hub)):
    with conectar_turso() as db:
        db.execute("UPDATE cuentas_acceso SET token_version = token_version + 1 WHERE id_cuenta = ?",
                   (cuenta["id_cuenta"],))
    tareas.add_task(hub.cerrar_cuenta, cuenta["id_cuenta"])
    response.delete_cookie(COOKIE_NAME, path="/", httponly=True, secure=COOKIE_SECURE, samesite="strict")
    return {"mensaje": "Sesiones de la cuenta cerradas correctamente."}
