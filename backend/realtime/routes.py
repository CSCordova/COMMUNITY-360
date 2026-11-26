import asyncio
import json
import time
from urllib.parse import urlsplit
import anyio
from pydantic import BaseModel, ConfigDict, Field, ValidationError

from fastapi import APIRouter, Depends, HTTPException, WebSocket, WebSocketDisconnect, WebSocketException

from backend.auth.dependencies import autenticar_token
from backend.core.config import COOKIE_NAME
from backend.interacciones.routes import obtener_servicio
from backend.interacciones.service import InteraccionesService
from backend.interacciones.schemas import FiltrosInteracciones
from backend.realtime.hub import DashboardHub, obtener_hub
from turso_http import TursoHTTPError

router = APIRouter()
INTERVALO_VALIDACION = 30


class Suscripcion(BaseModel):
    model_config = ConfigDict(extra="forbid")
    tipo: str
    solicitud: int = Field(strict=True, ge=1, le=2**31-1)
    filtros: FiltrosInteracciones


def token_y_origen(websocket):
    authorization = websocket.headers.get("authorization")
    if authorization:
        esquema, separador, token = authorization.partition(" ")
        if not separador or esquema.lower() != "bearer" or not token:
            return None
    else:
        token = websocket.cookies.get(COOKIE_NAME)
    origen = websocket.headers.get("origin")
    url = urlsplit(str(websocket.url))
    esperado = ("https" if url.scheme == "wss" else "http") + "://" + url.netloc
    # Navegadores: Origin y cookie. Postman: Bearer, sin necesidad de Origin.
    if (origen and origen != esperado) or (not authorization and not origen):
        return None
    return token


def autenticar_websocket(websocket: WebSocket):
    token = token_y_origen(websocket)
    if not token:
        raise WebSocketException(code=1008)
    try:
        cuenta = autenticar_token(token)
    except HTTPException:
        raise WebSocketException(code=4401) from None
    except TursoHTTPError:
        raise WebSocketException(code=1013) from None
    return token, cuenta


@router.websocket("/ws/dashboard")
async def dashboard_websocket(websocket: WebSocket,
                              autenticacion: tuple = Depends(autenticar_websocket),
                              servicio: InteraccionesService = Depends(obtener_servicio),
                              hub: DashboardHub = Depends(obtener_hub)):
    # FastAPI resuelve primero la autenticación y después los repositorios.
    token, cuenta = autenticacion

    await websocket.accept()
    cliente = hub.registrar(token, cuenta["id_cuenta"])

    async def enviar():
        while True:
            mensaje = await cliente.cola.get()
            if "_cerrar" in mensaje:
                await websocket.close(code=mensaje["_cerrar"])
                return
            await asyncio.wait_for(websocket.send_json(mensaje), timeout=5)

    async def recibir():
        ventana = time.monotonic()
        recibidos = 0
        while True:
            recibido = await websocket.receive()
            if recibido['type'] == 'websocket.disconnect':
                raise WebSocketDisconnect(recibido.get('code', 1000))
            texto = recibido.get('text')
            if not isinstance(texto, str):
                hub.cerrar(cliente, 1003)
                return
            if len(texto) > 2048:
                hub.cerrar(cliente, 1009)
                return
            ahora = time.monotonic()
            if ahora - ventana >= 1:
                ventana, recibidos = ahora, 0
            recibidos += 1
            if recibidos > 4:
                hub.cerrar(cliente, 1008)
                return
            try:
                mensaje = json.loads(texto)
            except ValueError:
                hub.cerrar(cliente, 1008)
                return
            if not isinstance(mensaje, dict):
                hub.cerrar(cliente, 1008)
                return
            if mensaje.get("tipo") == "ping":
                if not await hub.validar(cliente):
                    return
                hub.encolar(cliente, {"tipo": "pong"})
            elif mensaje.get("tipo") == "solicitar_estado":
                await hub.estado_inicial(cliente, servicio)
            elif mensaje.get("tipo") == "suscribir":
                try:
                    peticion = Suscripcion.model_validate(mensaje)
                except ValidationError:
                    hub.encolar(cliente, {"tipo": "error_filtros", "solicitud": mensaje.get("solicitud")
                        if type(mensaje.get("solicitud")) is int else None,
                        "mensaje": "Revisa los filtros y el orden de las fechas."})
                    continue
                await hub.estado_inicial(cliente, servicio, peticion.filtros, peticion.solicitud)
            else:
                # No se permiten operaciones de escritura por WebSocket.
                hub.cerrar(cliente, 1008)
                return

    async def vigilar_sesion():
        while True:
            await asyncio.sleep(INTERVALO_VALIDACION)
            if not await hub.validar(cliente):
                return

    envio_terminado = anyio.Event()
    try:
        async with anyio.create_task_group() as grupo:
            async def ejecutar(funcion):
                try:
                    await funcion()
                    if cliente.cerrado and funcion != enviar:
                        # Dejar que el único emisor transmita el cierre solicitado.
                        with anyio.move_on_after(2):
                            await envio_terminado.wait()
                except (WebSocketDisconnect, RuntimeError, asyncio.TimeoutError, OSError):
                    pass
                finally:
                    if funcion == enviar:
                        envio_terminado.set()
                    grupo.cancel_scope.cancel()

            for funcion in (enviar, recibir, vigilar_sesion):
                grupo.start_soon(ejecutar, funcion)
            await hub.estado_inicial(cliente, servicio)
            await anyio.sleep_forever()
    finally:
        hub.retirar(cliente)
