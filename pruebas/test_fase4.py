"""Pruebas de API con SQL en memoria y repositorio documental sustituido."""
import copy
import json
import os
import sqlite3
import unittest
from contextlib import contextmanager
from datetime import datetime, timezone
from unittest.mock import MagicMock, patch

import httpx
from google.api_core.exceptions import AlreadyExists, FailedPrecondition, ServiceUnavailable

with patch.dict(os.environ, {"JWT_SECRET_KEY": "clave-exclusiva-pruebas-locales-" * 3}):
    from backend.main import app
    from backend.auth import dependencies, security
    from backend.core.config import ROOT
    from backend.core.errors import InteractionConflict, DataServiceError
    from backend.usuarios import repository as usuarios_repo
    from backend.interacciones.repository import Registro, InteraccionesRepository, obtener_interacciones_repository
    from backend.interacciones.schemas import CrearInteraccion


def ejemplo(**cambios):
    return {"id_interaccion": "I9000001", "id_usuario": "U000001",
            "timestamp": "2026-11-25T12:00:00-06:00", "canal": "Telegram", "tipo": "mensaje",
            "texto": "Hola", "tema": "arte", "sentimiento": 0.5, "idioma": "es",
            "dispositivo": "Web", "reacciones_recibidas": 2, "etiquetas": ["arte", "ARTE"],
            "ubicacion": {"pais": "México", "estado": "Yucatán", "ciudad": "Mérida"}, **cambios}


class RepositorioMemoria:
    def __init__(self):
        self.registros = {}
        self.version = 0
        self.conflicto = False

    def listar(self):
        return copy.deepcopy(list(self.registros.values()))

    def obtener(self, identificador):
        return copy.deepcopy(self.registros.get(identificador))

    def crear(self, datos):
        if datos["id_interaccion"] in self.registros:
            raise InteractionConflict("ID duplicado.")
        self.version += 1
        registro = Registro(copy.deepcopy(datos), self.version)
        self.registros[datos["id_interaccion"]] = registro
        return copy.deepcopy(registro)

    def reemplazar(self, identificador, datos, version):
        if self.conflicto or self.registros[identificador].version != version:
            raise InteractionConflict("Cambio concurrente.")
        self.version += 1
        self.registros[identificador] = Registro(copy.deepcopy(datos), self.version)
        return self.obtener(identificador)

    def eliminar(self, identificador, version):
        if self.conflicto or self.registros[identificador].version != version:
            raise InteractionConflict("Cambio concurrente.")
        del self.registros[identificador]


class PruebasFase4(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.db = sqlite3.connect(":memory:", check_same_thread=False, isolation_level=None)
        self.db.executescript((ROOT / "sql/esquema_turso.sql").read_text(encoding="utf-8"))
        self.db.executescript((ROOT / "sql/esquema_auth.sql").read_text(encoding="utf-8"))
        self.db.execute("INSERT INTO cuentas_acceso(usuario,password_hash) VALUES ('prueba','no-usado')")
        for tabla, valor in (("cat_estatus", "activo"), ("cat_rangos_edad", "adulto"),
                              ("cat_especies_fursona", "especie"), ("cat_intereses", "arte"),
                              ("cat_plataformas", "Telegram")):
            self.db.execute(f"INSERT INTO {tabla} VALUES (1,?)", (valor,))
        self.db.execute("INSERT INTO cat_localidades VALUES (1,'México','Yucatán','Mérida','America/Merida')")
        for identificador, permiso in (("U000001", "si"), ("U000002", "no")):
            self.db.execute("""INSERT INTO usuarios VALUES (?,?,'2026-01-01',1,1,1,1,1,10,5,2,1,0.5,'2026-11-01',1,?)""",
                            (identificador, identificador, permiso))
        self.db.execute("INSERT INTO ubicaciones_usuario VALUES ('U000001',1,20.9,-89.6)")

        @contextmanager
        def conectar_local():
            yield self.db

        self.patches = [patch.object(mod, "conectar_turso", conectar_local) for mod in (dependencies, usuarios_repo)]
        for p in self.patches:
            p.start()
        self.repo = RepositorioMemoria()
        self.overrides_anteriores = dict(app.dependency_overrides)
        app.dependency_overrides[obtener_interacciones_repository] = lambda: self.repo
        self.client = httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://testserver",
                                       headers={"Authorization": "Bearer " + security.crear_token(1, 0)})

    async def asyncTearDown(self):
        await self.client.aclose()
        app.dependency_overrides.clear()
        app.dependency_overrides.update(self.overrides_anteriores)
        for p in reversed(self.patches):
            p.stop()
        self.db.close()

    async def crear(self, **cambios):
        return await self.client.post("/api/interacciones", json=ejemplo(**cambios))

    async def test_01_todas_las_rutas_requieren_autenticacion(self):
        self.client.headers.clear()
        for metodo, url, cuerpo in (("GET", "/api/usuarios", None), ("GET", "/api/usuarios/U000001", None),
                                   ("GET", "/api/interacciones", None), ("GET", "/api/interacciones/I9000001", None),
                                   ("GET", "/api/analitica/usuarios", None), ("GET", "/api/analitica/interacciones", None),
                                   ("POST", "/api/interacciones", ejemplo()),
                                   ("PUT", "/api/interacciones/I9000001", {}),
                                   ("PATCH", "/api/interacciones/I9000001", {}),
                                   ("DELETE", "/api/interacciones/I9000001", None)):
            with self.subTest(metodo=metodo, url=url):
                self.assertEqual((await self.client.request(metodo, url, json=cuerpo)).status_code, 401)
        self.assertFalse(self.repo.registros)

    async def test_02_usuarios_paginados_y_privacidad(self):
        r = await self.client.get("/api/usuarios?limite=1&desplazamiento=1")
        self.assertEqual(r.status_code, 200)
        self.assertEqual(r.json()["total"], 2)
        self.assertNotIn("ubicacion", r.json()["items"][0])
        si = await self.client.get("/api/usuarios/U000001")
        self.assertEqual(si.json()["ubicacion"]["ciudad"], "Mérida")
        self.assertEqual((await self.client.get("/api/usuarios/U999999")).status_code, 404)
        self.assertEqual((await self.client.get("/api/usuarios?limite=101")).status_code, 422)
        self.assertEqual((await self.client.get("/api/usuarios/U01")).status_code, 422)

    async def test_03_crear_leer_y_normalizar(self):
        r = await self.crear()
        self.assertEqual(r.status_code, 201)
        self.assertEqual(r.headers["location"], "/api/interacciones/I9000001")
        self.assertEqual(r.json()["longitud_texto"], 4)
        self.assertEqual(r.json()["etiquetas"], ["arte"])
        self.assertEqual(datetime.fromisoformat(r.json()["timestamp"]),
                         datetime(2026, 11, 25, 18, 0, tzinfo=timezone.utc))
        leida = await self.client.get(r.headers["location"])
        self.assertEqual(leida.status_code, 200)
        self.assertEqual(leida.headers["etag"], r.headers["etag"])
        self.assertEqual(leida.headers["cache-control"], "no-store")

    async def test_04_no_sobrescribir_id_duplicado(self):
        await self.crear()
        r = await self.crear(texto="Cambio")
        self.assertEqual(r.status_code, 409)
        self.assertEqual(self.repo.registros["I9000001"].datos["texto"], "Hola")

    async def test_05_usuario_inexistente_no_se_persiste(self):
        self.assertEqual((await self.crear(id_usuario="U999999")).status_code, 422)
        self.assertFalse(self.repo.registros)

    async def test_06_sin_consentimiento_suprime_geografia_antes_de_persistir(self):
        r = await self.crear(id_usuario="U000002")
        self.assertEqual(r.status_code, 201)
        self.assertNotIn("ubicacion", r.json())
        self.assertNotIn("ubicacion", self.repo.registros["I9000001"].datos)

    async def test_07_patch_recalcula_longitud_y_preserva_otros_campos(self):
        await self.crear()
        r = await self.client.patch("/api/interacciones/I9000001", json={"texto": "Texto nuevo"})
        self.assertEqual(r.status_code, 200)
        self.assertEqual(r.json()["longitud_texto"], 11)
        self.assertEqual(r.json()["tema"], "arte")

    async def test_08_patch_autor_suprime_geografia_del_anterior(self):
        await self.crear()
        r = await self.client.patch("/api/interacciones/I9000001", json={"id_usuario": "U000002"})
        self.assertEqual(r.status_code, 200)
        self.assertNotIn("ubicacion", r.json())
        self.assertNotIn("ubicacion", self.repo.registros["I9000001"].datos)

    async def test_09_put_reemplaza_campos_y_permite_quitar_ubicacion(self):
        await self.crear()
        entrada = ejemplo(texto="Reemplazado", ubicacion=None)
        entrada.pop("id_interaccion")
        r = await self.client.put("/api/interacciones/I9000001", json=entrada)
        self.assertEqual(r.status_code, 200)
        self.assertEqual(r.json()["texto"], "Reemplazado")
        self.assertNotIn("ubicacion", self.repo.registros["I9000001"].datos)

    async def test_10_borrado_y_consulta_404(self):
        await self.crear()
        self.assertEqual((await self.client.delete("/api/interacciones/I9000001")).status_code, 204)
        self.assertEqual((await self.client.get("/api/interacciones/I9000001")).status_code, 404)
        self.assertEqual((await self.client.delete("/api/interacciones/I9000001")).status_code, 404)

    async def test_11_filtros_paginacion_y_orden(self):
        await self.crear()
        await self.crear(id_interaccion="I9000002", tipo="comentario", id_usuario="U000002")
        r = await self.client.get("/api/interacciones?limite=1")
        self.assertEqual(r.json()["total"], 2)
        self.assertEqual(r.json()["items"][0]["id_interaccion"], "I9000002")
        r = await self.client.get("/api/interacciones?tipo=mensaje&id_usuario=U000001&canal=Telegram")
        self.assertEqual(r.json()["total"], 1)
        self.assertEqual((await self.client.get("/api/interacciones?inicio=2026-11-26T00:00:00Z&fin=2026-11-25T00:00:00Z")).status_code, 422)
        self.assertEqual((await self.client.get("/api/interacciones?limite=0")).status_code, 422)

    async def test_12_rechazar_datos_invalidos_sin_escritura(self):
        for cambio in ({"timestamp": "2026-11-25T12:00:00"}, {"timestamp": 12345},
                       {"sentimiento": 1.1}, {"reacciones_recibidas": -1}, {"reacciones_recibidas": True},
                       {"tipo": "desconocido"}, {"texto": None}, {"longitud_texto": 8},
                       {"ubicacion": {"pais": "México"}}, {"campo_ajeno": "dato"}):
            with self.subTest(cambio=cambio):
                self.assertEqual((await self.crear(**cambio)).status_code, 422)
        self.assertFalse(self.repo.registros)

    async def test_13_patch_invalido_no_modifica(self):
        await self.crear()
        antes = copy.deepcopy(self.repo.registros["I9000001"].datos)
        for cambios in ({}, {"canal": None}, {"texto": None}, {"texto": "nuevo", "longitud_texto": 9},
                        {"id_usuario": "U999999"}, {"id_interaccion": "I9000003"}):
            with self.subTest(cambios=cambios):
                self.assertEqual((await self.client.patch("/api/interacciones/I9000001", json=cambios)).status_code, 422)
        self.assertEqual(antes, self.repo.registros["I9000001"].datos)

    async def test_14_etag_y_cambios_concurrentes(self):
        r = await self.crear()
        version = r.headers["etag"]
        self.assertEqual((await self.client.patch("/api/interacciones/I9000001", json={"tema": "musica"}, headers={"If-Match": version})).status_code, 200)
        self.assertEqual((await self.client.delete("/api/interacciones/I9000001", headers={"If-Match": version})).status_code, 409)
        self.repo.conflicto = True
        self.assertEqual((await self.client.patch("/api/interacciones/I9000001", json={"tema": "arte"})).status_code, 409)
        self.assertEqual((await self.client.delete("/api/interacciones/I9000001")).status_code, 409)

    async def test_15_analitica_refleja_altas_cambios_y_bajas(self):
        vacia = (await self.client.get("/api/analitica/interacciones")).json()
        self.assertEqual(vacia["total_interacciones"], 0)
        self.assertIsNone(vacia["sentimiento_promedio"])
        await self.crear()
        await self.crear(id_interaccion="I9000002", sentimiento=-0.5)
        datos = (await self.client.get("/api/analitica/interacciones")).json()
        self.assertEqual(datos["sentimiento_promedio"], 0)
        self.assertEqual(sum(h["total"] for h in datos["actividad_semanal"]), 2)
        await self.client.patch("/api/interacciones/I9000002", json={"sentimiento": 0.5})
        self.assertEqual((await self.client.get("/api/analitica/interacciones")).json()["sentimiento_promedio"], 0.5)
        await self.client.delete("/api/interacciones/I9000001")
        self.assertEqual((await self.client.get("/api/analitica/interacciones")).json()["total_interacciones"], 1)

    async def test_16_historico_no_cambia_con_nuevas_interacciones(self):
        antes = (await self.client.get("/api/analitica/usuarios")).json()
        self.assertEqual(antes["indicadores"]["usuarios"], 2)
        self.assertEqual(antes["indicadores"]["mensajes_30d"], 20)
        await self.crear()
        despues = (await self.client.get("/api/analitica/usuarios")).json()
        self.assertEqual(antes, despues)

    async def test_17_lectura_aplica_consentimiento_actual(self):
        await self.crear()
        self.db.execute("DELETE FROM ubicaciones_usuario WHERE id_usuario='U000001'")
        self.db.execute("UPDATE usuarios SET consentimiento_datos='no' WHERE id_usuario='U000001'")
        r = await self.client.get("/api/interacciones/I9000001")
        self.assertNotIn("ubicacion", r.json())
        self.assertNotIn("ubicacion", (await self.client.get("/api/interacciones")).json()["items"][0])

    async def test_18_error_firestore_sin_detalles(self):
        with patch.object(self.repo, "listar", side_effect=DataServiceError("SECRETO-DE-CONEXION")):
            r = await self.client.get("/api/interacciones")
        self.assertEqual(r.status_code, 503)
        self.assertNotIn("SECRETO-DE-CONEXION", r.text)

    async def test_19_origen_ajeno_no_puede_escribir(self):
        r = await self.client.post("/api/interacciones", json=ejemplo(), headers={"Origin": "https://ajeno.invalid"})
        self.assertEqual(r.status_code, 403)
        self.assertFalse(self.repo.registros)

    async def test_20_reaccion_importada_preserva_longitud_sin_texto(self):
        r = await self.crear(tipo="reaccion", texto=None, longitud_texto=33)
        self.assertEqual(r.status_code, 201)
        self.assertEqual((await self.client.patch("/api/interacciones/I9000001", json={"tema": "musica"})).json()["longitud_texto"], 33)


class PruebasAdaptadorFirestore(unittest.TestCase):
    def test_create_no_sobrescribe_y_no_reintenta(self):
        cliente = MagicMock()
        documento = cliente.collection.return_value.document.return_value
        documento.create.side_effect = AlreadyExists("existe")
        repo = InteraccionesRepository(cliente)
        with self.assertRaises(InteractionConflict):
            repo.crear(ejemplo())
        documento.create.assert_called_once_with(ejemplo(), timeout=20, retry=None)

    def test_actualizacion_borra_ubicacion_y_usa_precondicion(self):
        from google.cloud import firestore
        cliente = MagicMock()
        repo = InteraccionesRepository(cliente)
        dato = ejemplo()
        dato.pop("ubicacion")
        repo.reemplazar("I9000001", dato, "version-actual")
        cliente.write_option.assert_called_once_with(last_update_time="version-actual")
        llamada = cliente.collection.return_value.document.return_value.update.call_args
        self.assertIs(llamada.args[0]["ubicacion"], firestore.DELETE_FIELD)
        self.assertIsNone(llamada.kwargs["retry"])

    def test_conflicto_precondicion_y_error_servicio(self):
        cliente = MagicMock()
        documento = cliente.collection.return_value.document.return_value
        repo = InteraccionesRepository(cliente)
        documento.delete.side_effect = FailedPrecondition("conflicto")
        with self.assertRaises(InteractionConflict):
            repo.eliminar("I9000001", 1)
        documento.get.side_effect = ServiceUnavailable("datos-privados")
        with self.assertRaises(DataServiceError):
            repo.obtener("I9000001")

    def test_modelo_compatible_con_las_207_interacciones_depuradas(self):
        ruta = ROOT / "datos/depurados/interacciones_firestore.jsonl"
        datos = [json.loads(linea) for linea in ruta.read_text(encoding="utf-8").splitlines() if linea]
        self.assertEqual(len(datos), 207)
        for dato in datos:
            with self.subTest(id=dato["id_interaccion"]):
                modelo = CrearInteraccion.model_validate(dato)
                self.assertEqual(modelo.longitud_texto, dato["longitud_texto"])


if __name__ == "__main__":
    unittest.main()
