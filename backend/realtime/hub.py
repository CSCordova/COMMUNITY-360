"""Publicación en un único proceso (el servicio Free usa un worker).

Las métricas se calculan una vez por publicación y se distribuyen a todos los
clientes. Para varios procesos/instancias se necesitaría un bus compartido.
"""
import asyncio
import logging
from dataclasses import dataclass, field
from datetime import datetime, timezone
from uuid import uuid4

from fastapi import HTTPException
from starlette.concurrency import run_in_threadpool
from starlette.requests import HTTPConnection

from backend.auth.dependencies import autenticar_token
from backend.interacciones.schemas import FiltrosInteracciones
from turso_http import TursoHTTPError

logger = logging.getLogger(__name__)


@dataclass(eq=False)
class Suscriptor:
    token: str = field(repr=False)
    id_cuenta: int
    cola: asyncio.Queue = field(default_factory=lambda: asyncio.Queue(maxsize=8))
    cerrado: bool = False
    filtros: FiltrosInteracciones = field(default_factory=FiltrosInteracciones)
    solicitud: int = 0


class DashboardHub:
    def __init__(self):
        self.clientes = set()
        self.revision = 0
        self.servidor = uuid4().hex
        self._lock = None

    def _candado(self):
        if self._lock is None:
            self._lock = asyncio.Lock()
        return self._lock

    def registrar(self, token, id_cuenta):
        cliente = Suscriptor(token, id_cuenta)
        self.clientes.add(cliente)
        return cliente

    def retirar(self, cliente):
        self.clientes.discard(cliente)
        cliente.cerrado = True

    def cerrar(self, cliente, codigo):
        self.retirar(cliente)
        while not cliente.cola.empty():
            cliente.cola.get_nowait()
        cliente.cola.put_nowait({"_cerrar": codigo})

    def encolar(self, cliente, mensaje):
        if cliente.cerrado:
            return
        try:
            cliente.cola.put_nowait(mensaje)
        except asyncio.QueueFull:
            # Un cliente lento reconecta y recibe un estado completo, sin acumular datos.
            self.cerrar(cliente, 1013)

    async def validar(self, cliente):
        if cliente.cerrado:
            return False
        try:
            await run_in_threadpool(autenticar_token, cliente.token)
            return True
        except HTTPException:
            self.cerrar(cliente, 4401)
        except TursoHTTPError:
            self.cerrar(cliente, 1013)
        return False

    async def cerrar_cuenta(self, id_cuenta):
        for cliente in list(self.clientes):
            if cliente.id_cuenta == id_cuenta:
                self.cerrar(cliente, 4401)

    def _mensaje(self, tipo, datos=None, operacion=None, identificador=None):
        mensaje = {"tipo": tipo, "servidor": self.servidor, "revision": self.revision,
                   "fecha": datetime.now(timezone.utc).isoformat()}
        if datos is not None:
            mensaje["indicadores"] = datos
        if operacion:
            mensaje["operacion"] = operacion
            mensaje["id_interaccion"] = identificador
        return mensaje

    @staticmethod
    def _para_cliente(mensaje, cliente):
        return {**mensaje, "solicitud": cliente.solicitud,
                "filtros": cliente.filtros.model_dump(mode="json", exclude_none=True)}

    async def estado_inicial(self, cliente, servicio, filtros=None, solicitud=None):
        async with self._candado():
            if not await self.validar(cliente):
                return
            if filtros is not None:
                cliente.filtros = filtros
                cliente.solicitud = solicitud
            try:
                datos = await run_in_threadpool(servicio.resumen, cliente.filtros)
                self.encolar(cliente, self._para_cliente(self._mensaje("estado_inicial", datos), cliente))
            except Exception as exc:
                logger.warning("No se pudo preparar el estado WebSocket (%s).", type(exc).__name__)
                self.encolar(cliente, self._para_cliente(self._mensaje("error_datos"), cliente))

    async def notificar(self, servicio, operacion, identificador):
        # Se llama como tarea posterior a una escritura confirmada, nunca ante 4xx.
        if not self.clientes:
            self.revision += 1
            return
        async with self._candado():
            self.revision += 1
            clientes = list(self.clientes)
            try:
                # Una sola lectura cloud por escritura; reutilizar los datos para
                # las distintas suscripciones, sin consultar Firestore por cliente.
                todos = await run_in_threadpool(servicio.consultar, FiltrosInteracciones())
                resumenes = {}
                for cliente in clientes:
                    clave = cliente.filtros.model_dump_json()
                    if clave not in resumenes:
                        resumenes[clave] = await run_in_threadpool(servicio.resumen_de_datos, todos, cliente.filtros)
                mensajes = {clave: self._mensaje("interacciones_actualizadas", datos, operacion, identificador)
                            for clave, datos in resumenes.items()}
            except Exception as exc:
                # La escritura ya está confirmada: un fallo de notificación no debe
                # transformar su respuesta en error ni provocar que se repita.
                logger.warning("No se pudo actualizar el resumen WebSocket (%s).", type(exc).__name__)
                mensajes = None
            for cliente in clientes:
                if await self.validar(cliente):
                    mensaje = mensajes[cliente.filtros.model_dump_json()] if mensajes is not None else self._mensaje("error_datos")
                    self.encolar(cliente, self._para_cliente(mensaje, cliente))


def obtener_hub(conexion: HTTPConnection) -> DashboardHub:
    return conexion.app.state.realtime
