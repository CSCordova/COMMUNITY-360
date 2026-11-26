from collections import Counter
from pydantic import ValidationError
from fastapi import HTTPException
from backend.core.errors import DataServiceError, InteractionConflict, InteractionNotFound
from backend.interacciones.schemas import CrearInteraccion, DatosInteraccion


def etag(registro):
    version = registro.version.isoformat() if hasattr(registro.version, "isoformat") else str(registro.version)
    return '"' + version + '"'


def volcar(modelo):
    datos = modelo.model_dump(mode="python")
    if datos.get("ubicacion") is None:
        datos.pop("ubicacion", None)
    return datos


class InteraccionesService:
    def __init__(self, interacciones, usuarios):
        self.interacciones = interacciones
        self.usuarios = usuarios

    def _validar_usuario_y_privacidad(self, datos):
        permiso = self.usuarios.consentimientos([datos["id_usuario"]])
        if datos["id_usuario"] not in permiso:
            raise HTTPException(422, "El id_usuario no existe en el padrón de Turso.")
        if permiso[datos["id_usuario"]] != "si":
            datos.pop("ubicacion", None)
        return datos

    @staticmethod
    def _lectura(registro, consentimientos):
        try:
            datos = volcar(CrearInteraccion.model_validate(registro.datos))
        except ValidationError as exc:
            raise DataServiceError("La interacción almacenada no cumple el modelo.") from exc
        if datos["id_usuario"] not in consentimientos:
            raise DataServiceError("Existe una referencia a un usuario ausente del padrón.")
        if consentimientos[datos["id_usuario"]] != "si":
            datos.pop("ubicacion", None)
        return datos

    def obtener(self, identificador):
        registro = self.interacciones.obtener(identificador)
        if registro is None:
            raise InteractionNotFound("Interacción no encontrada.")
        permisos = self.usuarios.consentimientos([registro.datos.get("id_usuario")])
        return registro, self._lectura(registro, permisos)

    def consultar(self, filtros):
        registros = self.interacciones.listar()
        permisos = self.usuarios.consentimientos([r.datos.get("id_usuario") for r in registros])
        resultado = []
        for registro in registros:
            dato = self._lectura(registro, permisos)
            if filtros.id_usuario and dato["id_usuario"] != filtros.id_usuario:
                continue
            if filtros.tipo and dato["tipo"] != filtros.tipo:
                continue
            if filtros.canal and dato["canal"] != filtros.canal:
                continue
            if filtros.inicio and dato["timestamp"] < filtros.inicio:
                continue
            if filtros.fin and dato["timestamp"] > filtros.fin:
                continue
            resultado.append(dato)
        return sorted(resultado, key=lambda x: (x["timestamp"], x["id_interaccion"]), reverse=True)

    def crear(self, entrada):
        datos = self._validar_usuario_y_privacidad(volcar(entrada))
        return self.interacciones.crear(datos)

    def actualizar(self, identificador, entrada, parcial=False, version_cliente=None):
        registro, actual = self.obtener(identificador)
        if version_cliente is not None and version_cliente != etag(registro):
            raise InteractionConflict("La versión enviada no coincide. Consulta nuevamente la interacción.")
        if parcial:
            cambios = entrada.model_dump(exclude_unset=True, mode="python")
            # No heredar geografía de otro usuario al cambiar la autoría.
            if "id_usuario" in cambios and cambios["id_usuario"] != actual["id_usuario"]:
                actual.pop("ubicacion", None)
            if "texto" in cambios and "longitud_texto" not in cambios:
                actual.pop("longitud_texto", None)
            combinado = {**actual, **cambios}
            combinado.pop("id_interaccion", None)
            try:
                datos = volcar(DatosInteraccion.model_validate(combinado))
            except ValidationError as exc:
                # No incluir valores del documento ni de la solicitud en el error.
                raise HTTPException(422, "Los cambios no forman una interacción válida; revisa texto, tipo, fecha y longitud.") from exc
        else:
            datos = volcar(entrada)
        datos["id_interaccion"] = identificador
        self._validar_usuario_y_privacidad(datos)
        return self.interacciones.reemplazar(identificador, datos, registro.version)

    def eliminar(self, identificador, version_cliente=None):
        registro = self.interacciones.obtener(identificador)
        if registro is None:
            raise InteractionNotFound("Interacción no encontrada.")
        if version_cliente is not None and version_cliente != etag(registro):
            raise InteractionConflict("La versión enviada no coincide. Consulta nuevamente la interacción.")
        self.interacciones.eliminar(identificador, registro.version)

    def resumen(self, filtros):
        datos = self.consultar(filtros)
        total = len(datos)
        def categorias(campo):
            conteo = Counter(d[campo] for d in datos)
            return [{"categoria": k, "total": v} for k, v in sorted(conteo.items())]
        dias = Counter(d["timestamp"].date().isoformat() for d in datos)
        horas = Counter((d["timestamp"].weekday(), d["timestamp"].hour) for d in datos)
        return {
            "fuente": "interacciones_actuales_firestore", "zona_horaria": "UTC",
            "total_interacciones": total,
            "usuarios_participantes": len({d["id_usuario"] for d in datos}),
            "sentimiento_promedio": sum(d["sentimiento"] for d in datos) / total if total else None,
            "reacciones_recibidas": sum(d["reacciones_recibidas"] for d in datos),
            "por_tipo": categorias("tipo"), "por_canal": categorias("canal"), "por_tema": categorias("tema"),
            "por_dia": [{"fecha": k, "total": v} for k, v in sorted(dias.items())],
            "actividad_semanal": [{"dia_semana": dia, "hora": hora, "total": horas[(dia, hora)]}
                                   for dia in range(7) for hora in range(24)],
        }
