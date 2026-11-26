from dataclasses import dataclass
from google.api_core.exceptions import AlreadyExists, FailedPrecondition, GoogleAPICallError, NotFound
from google.auth.exceptions import GoogleAuthError
from google.cloud import firestore
from backend.core.errors import DataServiceError, InteractionConflict, InteractionNotFound
from backend.database.firestore import conectar_firestore


@dataclass
class Registro:
    datos: dict
    version: object


class InteraccionesRepository:
    def __init__(self, cliente):
        self.cliente = cliente
        self.coleccion = cliente.collection("interacciones")

    @staticmethod
    def _registro(snapshot):
        datos = snapshot.to_dict()
        if not datos or datos.get("id_interaccion") != snapshot.id:
            raise DataServiceError("Documento de interacción inconsistente.")
        return Registro(datos, snapshot.update_time)

    def listar(self):
        try:
            # Volumen académico inicial: 207 documentos. Una lectura completa permite
            # filtros combinados sin crear índices compuestos y agregados consistentes.
            return [self._registro(s) for s in self.coleccion.stream(timeout=20, retry=None)]
        except (GoogleAPICallError, GoogleAuthError) as exc:
            raise DataServiceError("No se pudieron leer las interacciones.") from exc

    def obtener(self, identificador):
        try:
            snapshot = self.coleccion.document(identificador).get(timeout=20, retry=None)
            return self._registro(snapshot) if snapshot.exists else None
        except (GoogleAPICallError, GoogleAuthError) as exc:
            raise DataServiceError("No se pudo leer la interacción.") from exc

    def crear(self, datos):
        try:
            resultado = self.coleccion.document(datos["id_interaccion"]).create(datos, timeout=20, retry=None)
            return Registro(datos, resultado.update_time)
        except AlreadyExists as exc:
            raise InteractionConflict("Ya existe una interacción con ese identificador.") from exc
        except (GoogleAPICallError, GoogleAuthError) as exc:
            raise DataServiceError("No se pudo confirmar la creación. Consulta el ID antes de repetir.") from exc

    def reemplazar(self, identificador, datos, version):
        actualizacion = dict(datos)
        if "ubicacion" not in actualizacion:
            actualizacion["ubicacion"] = firestore.DELETE_FIELD
        try:
            resultado = self.coleccion.document(identificador).update(
                actualizacion, option=self.cliente.write_option(last_update_time=version), timeout=20, retry=None)
            return Registro(datos, resultado.update_time)
        except (FailedPrecondition, NotFound) as exc:
            raise InteractionConflict("La interacción cambió. Consúltala de nuevo antes de modificarla.") from exc
        except (GoogleAPICallError, GoogleAuthError) as exc:
            raise DataServiceError("No se pudo confirmar la modificación. Consulta el ID antes de repetir.") from exc

    def eliminar(self, identificador, version):
        try:
            self.coleccion.document(identificador).delete(
                option=self.cliente.write_option(last_update_time=version), timeout=20, retry=None)
        except (FailedPrecondition, NotFound) as exc:
            raise InteractionConflict("La interacción cambió. Consúltala de nuevo antes de eliminarla.") from exc
        except (GoogleAPICallError, GoogleAuthError) as exc:
            raise DataServiceError("No se pudo confirmar la eliminación. Consulta el ID antes de repetir.") from exc


def obtener_interacciones_repository():
    return InteraccionesRepository(conectar_firestore())
