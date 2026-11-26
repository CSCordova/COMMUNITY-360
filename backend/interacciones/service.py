from collections import Counter
import unicodedata
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
        datos = [self._lectura(registro, permisos) for registro in registros]
        return self.filtrar(datos, filtros)

    @staticmethod
    def filtrar(datos, filtros):
        resultado = []
        for dato in datos:
            if filtros.id_usuario and dato["id_usuario"] != filtros.id_usuario:
                continue
            if filtros.tipo and dato["tipo"] != filtros.tipo:
                continue
            if filtros.canal and dato["canal"] != filtros.canal:
                continue
            if filtros.tema and dato["tema"] != filtros.tema:
                continue
            if filtros.dia_semana is not None and dato["timestamp"].weekday() != filtros.dia_semana:
                continue
            if filtros.hora is not None and dato["timestamp"].hour != filtros.hora:
                continue
            if filtros.inicio and dato["timestamp"] < filtros.inicio:
                continue
            if filtros.fin and dato["timestamp"] > filtros.fin:
                continue
            resultado.append(dato)
        return sorted(resultado, key=lambda x: (x["timestamp"], x["id_interaccion"]), reverse=True)

    def buscar_registros(self, consulta):
        datos = self.consultar(consulta)
        def normalizar(valor):
            return ''.join(c for c in unicodedata.normalize('NFKD', str(valor).casefold()) if not unicodedata.combining(c))
        terminos = normalizar(consulta.buscar).split()
        if terminos:
            def coincide(dato):
                # Search only permitted content; geographic fields never enter the index.
                contenido = ' '.join(str(dato.get(campo) or '') for campo in
                                     ('id_interaccion', 'id_usuario', 'texto', 'tema', 'canal', 'tipo'))
                contenido += ' ' + ' '.join(dato.get('etiquetas', []))
                contenido = normalizar(contenido)
                return all(termino in contenido for termino in terminos)
            datos = [dato for dato in datos if coincide(dato)]
        if consulta.orden == 'fecha_asc':
            return sorted(datos, key=lambda dato: (dato['timestamp'], dato['id_interaccion']))
        if consulta.orden != 'fecha_desc':
            campo = 'reacciones_recibidas' if consulta.orden == 'reacciones_desc' else 'sentimiento'
            # Stable chronological and ID order break ties in all numeric sorts.
            return sorted(datos, key=lambda dato: dato[campo], reverse=consulta.orden != 'sentimiento_asc')
        return datos

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
        from backend.interacciones.schemas import FiltrosInteracciones
        return self.resumen_de_datos(self.consultar(FiltrosInteracciones()), filtros)

    @staticmethod
    def comparacion_periodos(todos, filtros):
        from datetime import datetime, time, timedelta, timezone
        if not todos:
            return {"disponible": False, "motivo": "Sin datos para comparar."}
        fechas = [d["timestamp"].date() for d in todos]
        inicio = filtros.inicio.astimezone(timezone.utc).date() if filtros.inicio else min(fechas)
        fin = filtros.fin.astimezone(timezone.utc).date() if filtros.fin else max(fechas)
        # Compare only full UTC days, as used by the dashboard date controls.
        if (filtros.inicio and filtros.inicio.astimezone(timezone.utc).time() != time.min
                or filtros.fin and filtros.fin.astimezone(timezone.utc).time() != time.max):
            return {"disponible": False, "motivo": "Selecciona días UTC completos para comparar."}
        dias = (fin - inicio).days + 1
        anterior_fin = inicio - timedelta(days=1)
        anterior_inicio = inicio - timedelta(days=dias)
        if anterior_inicio < min(fechas) or fin > max(fechas):
            return {"disponible": False, "motivo": "No hay un periodo anterior completo dentro del rango disponible."}
        consulta = filtros.model_copy(update={
            "inicio": datetime.combine(anterior_inicio, time.min, timezone.utc),
            "fin": datetime.combine(anterior_fin, time.max, timezone.utc)})
        previos = InteraccionesService.filtrar(todos, consulta)
        return {"disponible": True, "dias": dias, "inicio_anterior": anterior_inicio.isoformat(),
                "fin_anterior": anterior_fin.isoformat(), "indicadores": {
                    "total_interacciones": len(previos),
                    "usuarios_participantes": len({d["id_usuario"] for d in previos}),
                    "reacciones_recibidas": sum(d["reacciones_recibidas"] for d in previos),
                    "sentimiento_promedio": sum(d["sentimiento"] for d in previos) / len(previos) if previos else None}}

    @staticmethod
    def resumen_de_datos(todos, filtros):
        datos = InteraccionesService.filtrar(todos, filtros)
        total = len(datos)
        def categorias(campo):
            conteo = Counter(d[campo] for d in datos)
            return [{"categoria": k, "total": v} for k, v in sorted(conteo.items())]
        dias = Counter(d["timestamp"].date().isoformat() for d in datos)
        horas = Counter((d["timestamp"].weekday(), d["timestamp"].hour) for d in datos)
        def detalle(campo, clave):
            grupos = {}
            for dato in datos:
                valor = dato[campo].date().isoformat() if campo == "timestamp" else dato[campo]
                grupo = grupos.setdefault(valor, {clave: valor, "total": 0, "reacciones_recibidas": 0, "suma_sentimiento": 0})
                grupo["total"] += 1
                grupo["reacciones_recibidas"] += dato["reacciones_recibidas"]
                grupo["suma_sentimiento"] += dato["sentimiento"]
            return [{clave: valor, "total": grupo["total"], "reacciones_recibidas": grupo["reacciones_recibidas"],
                     "sentimiento_promedio": grupo["suma_sentimiento"] / grupo["total"]}
                    for valor, grupo in sorted(grupos.items())]
        return {
            "fuente": "interacciones_actuales_firestore", "zona_horaria": "UTC",
            "filtros": filtros.model_dump(mode="json", exclude_none=True),
            "opciones_filtros": {campo: sorted({d[campo] for d in todos}) for campo in ("canal", "tipo", "tema")},
            "rango_datos": {"inicio": min(d["timestamp"] for d in todos).isoformat() if todos else None,
                            "fin": max(d["timestamp"] for d in todos).isoformat() if todos else None},
            "comparacion": InteraccionesService.comparacion_periodos(todos, filtros),
            "total_interacciones": total,
            "usuarios_participantes": len({d["id_usuario"] for d in datos}),
            "sentimiento_promedio": sum(d["sentimiento"] for d in datos) / total if total else None,
            "reacciones_recibidas": sum(d["reacciones_recibidas"] for d in datos),
            "por_tipo": categorias("tipo"), "por_canal": categorias("canal"), "por_tema": categorias("tema"),
            "por_dia": [{"fecha": k, "total": v} for k, v in sorted(dias.items())],
            "analisis_temas": detalle("tema", "categoria"),
            "analisis_diario": detalle("timestamp", "fecha"),
            "actividad_semanal": [{"dia_semana": dia, "hora": hora, "total": horas[(dia, hora)]}
                                   for dia in range(7) for hora in range(24)],
        }
