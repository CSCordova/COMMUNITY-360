"""Autenticación por HTTP/ASGI con SQLite temporal. Nunca usa cuentas cloud."""
import importlib
import os
from contextlib import contextmanager
from datetime import datetime, timedelta, timezone
from pathlib import Path
import sqlite3
import unittest
from unittest.mock import patch, MagicMock

import httpx
import jwt

# La clave ficticia se aplica solo al proceso de pruebas antes de importar la app.
with patch.dict(os.environ, {"JWT_SECRET_KEY": "clave-exclusiva-pruebas-locales-" * 3,
                             "SESSION_COOKIE_SECURE": "false"}):
    from backend.main import app
    from backend.auth import routes, dependencies, security
    from backend.auth.accounts import cambiar_password
    from backend.core.config import COOKIE_NAME, ROOT

PASSWORD = "password-inicial-solo-test"
NUEVA = "Nueva123"


class PruebasFase3(unittest.IsolatedAsyncioTestCase):
    @classmethod
    def setUpClass(cls):
        cls.hash_inicial = security.generar_hash(PASSWORD)

    async def asyncSetUp(self):
        self.db = sqlite3.connect(":memory:", check_same_thread=False, isolation_level=None)
        self.db.executescript((ROOT / "sql/esquema_auth.sql").read_text(encoding="utf-8"))
        self.db.execute("INSERT INTO cuentas_acceso(usuario,password_hash) VALUES (?,?)",
                        ("cuenta_test", self.hash_inicial))

        @contextmanager
        def conexion_local():
            yield self.db

        self.patches = [patch.object(mod, "conectar_turso", conexion_local) for mod in (routes, dependencies)]
        for p in self.patches:
            p.start()
        self.client = httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://testserver")

    async def asyncTearDown(self):
        await self.client.aclose()
        for p in reversed(self.patches):
            p.stop()
        self.db.close()

    async def login(self, password=PASSWORD, usuario="cuenta_test"):
        return await self.client.post("/auth/login", json={"usuario": usuario, "password": password})

    async def test_01_login_cookie_y_cuenta(self):
        r = await self.login(usuario="  CUENTA_TEST  ")
        self.assertEqual(r.status_code, 200)
        self.assertEqual(r.json()["expires_in"], 1800)
        self.assertIn("HttpOnly", r.headers["set-cookie"])
        self.assertIn("SameSite=strict", r.headers["set-cookie"])
        me = await self.client.get("/auth/me")
        self.assertEqual(me.json(), {"id_cuenta": 1, "usuario": "cuenta_test"})
        self.assertNotIn("password", me.text)
        self.assertEqual(me.headers["cache-control"], "no-store")

    async def test_02_acceso_sin_token(self):
        for path in ("/auth/me", "/api/dashboard"):
            with self.subTest(path=path):
                r = await self.client.get(path)
                self.assertEqual(r.status_code, 401)
                self.assertEqual(r.headers["www-authenticate"], "Bearer")

    async def test_03_password_y_cuenta_incorrectas(self):
        for password, usuario in (("incorrecta", "cuenta_test"), (PASSWORD, "no_existe")):
            with self.subTest(usuario=usuario):
                r = await self.login(password, usuario)
                self.assertEqual(r.status_code, 401)
                self.assertNotIn(COOKIE_NAME, r.cookies)

    async def test_04_token_invalido_no_recurre_a_cookie(self):
        await self.login()
        for header in ("Bearer invalido", "Basic invalido"):
            r = await self.client.get("/auth/me", headers={"Authorization": header})
            self.assertEqual(r.status_code, 401)

    async def test_05_token_expirado(self):
        ahora = datetime.now(timezone.utc)
        token = jwt.encode({"sub": "1", "ver": 0, "iat": ahora - timedelta(hours=2),
                            "exp": ahora - timedelta(hours=1)}, security.JWT_SECRET_KEY, algorithm="HS256")
        r = await self.client.get("/auth/me", headers={"Authorization": "Bearer " + token})
        self.assertEqual(r.status_code, 401)

    async def test_06_logout_revoca_cookie_y_todos_los_tokens(self):
        primero = (await self.login()).json()["access_token"]
        segundo = (await self.login()).json()["access_token"]
        r = await self.client.post("/auth/logout")
        self.assertEqual(r.status_code, 200)
        self.assertIn("Max-Age=0", r.headers["set-cookie"])
        self.assertEqual((await self.client.get("/auth/me")).status_code, 401)
        for token in (primero, segundo):
            self.assertEqual((await self.client.get("/auth/me", headers={"Authorization": "Bearer " + token})).status_code, 401)
        self.assertEqual((await self.login()).status_code, 200)

    async def test_07_cuenta_inactiva(self):
        await self.login()
        self.db.execute("UPDATE cuentas_acceso SET activo=0")
        self.assertEqual((await self.client.get("/auth/me")).status_code, 401)
        self.assertEqual((await self.login()).status_code, 401)

    async def test_08_hash_corrupto_se_rechaza(self):
        self.db.execute("UPDATE cuentas_acceso SET password_hash='hash-invalido'")
        self.assertEqual((await self.login()).status_code, 401)

    async def test_09_dashboard_protegido_y_sin_datos_simulados(self):
        await self.login()
        r = await self.client.get("/api/dashboard")
        self.assertEqual(r.status_code, 200)
        self.assertEqual(r.json()["cuenta"]["usuario"], "cuenta_test")
        self.assertTrue(r.json()["analitica_disponible"])

    async def test_10_cambio_password_revoca_sesion_y_password_anterior(self):
        token = (await self.login()).json()["access_token"]
        resultado = cambiar_password(self.db, "cuenta_test", PASSWORD, NUEVA)
        self.assertEqual(resultado["token_version"], 1)
        self.assertEqual((await self.login()).status_code, 401)
        self.assertEqual((await self.client.get("/auth/me", headers={"Authorization": "Bearer " + token})).status_code, 401)
        self.assertEqual((await self.login(password=NUEVA)).status_code, 200)

    async def test_11_cambio_invalido_no_modifica_cuenta(self):
        for longitud in (8, 12, 13, 14):
            with self.subTest(longitud_aceptada=longitud):
                security.validar_password_nueva("x" * longitud)
        for actual, nueva in (("incorrecta", NUEVA), (PASSWORD, "x" * 7), (PASSWORD, "x" * 15), (PASSWORD, PASSWORD)):
            with self.subTest(nueva=nueva):
                with self.assertRaises(ValueError):
                    cambiar_password(self.db, "cuenta_test", actual, nueva)
        self.assertEqual(self.db.execute("SELECT token_version FROM cuentas_acceso").fetchone()[0], 0)
        self.assertEqual((await self.login()).status_code, 200)

    async def test_12_validacion_no_refleja_password(self):
        password = "SECRETO-NO-REFLEJAR" * 100
        r = await self.login(password=password)
        self.assertEqual(r.status_code, 422)
        self.assertNotIn("SECRETO-NO-REFLEJAR", r.text)

    async def test_13_token_claims_manipulados(self):
        ahora = datetime.now(timezone.utc)
        base = {"sub": "1", "ver": 0, "iat": ahora, "exp": ahora + timedelta(minutes=2)}
        for cambio in ({"sub": "9" * 50}, {"sub": "0"}, {"sub": "²"}, {"ver": True}, {"ver": -1}):
            token = jwt.encode({**base, **cambio}, security.JWT_SECRET_KEY, algorithm="HS256")
            self.assertEqual((await self.client.get("/auth/me", headers={"Authorization": "Bearer " + token})).status_code, 401)
        base.pop("exp")
        token = jwt.encode(base, security.JWT_SECRET_KEY, algorithm="HS256")
        self.assertEqual((await self.client.get("/auth/me", headers={"Authorization": "Bearer " + token})).status_code, 401)

    async def test_14_fallo_cloud_es_503_sin_detalles(self):
        from turso_http import TursoHTTPError
        with patch.object(routes, "conectar_turso", side_effect=TursoHTTPError("DETALLE-PRIVADO")):
            r = await self.login()
        self.assertEqual(r.status_code, 503)
        self.assertNotIn("DETALLE-PRIVADO", r.text)

    async def test_15_origen_ajeno_rechazado(self):
        r = await self.client.post("/auth/login", headers={"Origin": "https://ajeno.invalid"},
                                   json={"usuario": "cuenta_test", "password": PASSWORD})
        self.assertEqual(r.status_code, 403)
        await self.login()
        r = await self.client.post("/auth/logout", headers={"Origin": "https://ajeno.invalid"})
        self.assertEqual(r.status_code, 403)
        r = await self.client.post("/auth/logout", headers={"Origin": "http://testserver"})
        self.assertEqual(r.status_code, 200)

    async def test_16_navegacion_dashboard_sin_sesion_redirige(self):
        r = await self.client.get("/dashboard")
        self.assertEqual(r.status_code, 303)
        self.assertEqual(r.headers["location"], "/login")

    async def test_17_token_bearer_sin_cookie(self):
        token = (await self.login()).json()["access_token"]
        self.client.cookies.clear()
        r = await self.client.get("/api/dashboard", headers={"Authorization": "Bearer " + token})
        self.assertEqual(r.status_code, 200)

    async def test_18_cuenta_eliminada(self):
        await self.login()
        self.db.execute("DELETE FROM cuentas_acceso")
        self.assertEqual((await self.client.get("/auth/me")).status_code, 401)


class PruebasHerramientas(unittest.TestCase):
    def test_conector_etl_devuelve_conexion_y_activa_fk(self):
        import cargar_nube
        conexion = MagicMock()
        conexion.execute.return_value.fetchone.return_value = [1]
        with patch("turso_http.TursoHTTP", return_value=conexion), patch.dict(os.environ, {"TURSO_AUTH_TOKEN": "ficticio"}):
            self.assertIs(cargar_nube.conectar_turso("http", "https://ejemplo.invalid"), conexion)
        conexion.execute.assert_any_call("PRAGMA foreign_keys = ON")

    def test_crear_tabla_no_escribe_al_importar(self):
        with patch("backend.database.turso.conectar_turso") as conectar:
            importlib.reload(importlib.import_module("backend.crear_tabla_auth"))
            conectar.assert_not_called()

    def test_no_leer_password_sin_terminal(self):
        from backend.auth.terminal import leer_secreto
        with patch("sys.stdin.isatty", return_value=False), patch("backend.auth.terminal.getpass") as entrada:
            with self.assertRaises(ValueError):
                leer_secreto("No debe preguntar")
            entrada.assert_not_called()


if __name__ == "__main__":
    unittest.main()
