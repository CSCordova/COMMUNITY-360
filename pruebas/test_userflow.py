"""Cambio de contraseña web y rutas profundas sin alterar cuentas reales."""
import unittest
from pruebas import test_fase5 as fase5
from backend.auth.security import generar_hash, verificar_password
from starlette.websockets import WebSocketDisconnect


class PruebasUserflow(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.hash_inicial = generar_hash('Anterior123')

    def setUp(self):
        self.env = fase5.PruebasFase5()
        self.env.setUp()
        self.env.fixture.db.execute('UPDATE cuentas_acceso SET password_hash=?', (self.hash_inicial,))
        self.client = self.env.client

    def tearDown(self):
        self.env.tearDown()

    def payload(self, **changes):
        return {'password_actual': 'Anterior123', 'password_nueva': 'Nueva1234', 'confirmacion': 'Nueva1234', **changes}

    def test_01_cambio_web_revoca_tokens_y_conexion_y_admite_nuevo_login(self):
        with self.env.conectar() as ws:
            ws.receive_json()
            response = self.client.post('/auth/password', json=self.payload())
            self.assertEqual(response.status_code, 200)
            self.assertIn('Max-Age=0', response.headers['set-cookie'])
            self.assertNotIn('Nueva1234', response.text)
            with self.assertRaises(WebSocketDisconnect) as error:
                ws.receive_json()
            self.assertEqual(error.exception.code, 4401)
        self.assertEqual(self.client.get('/auth/me').status_code, 401)
        self.client.headers.pop('Authorization')
        self.assertEqual(self.client.post('/auth/login', json={'usuario': 'prueba', 'password': 'Anterior123'}).status_code, 401)
        self.assertEqual(self.client.post('/auth/login', json={'usuario': 'prueba', 'password': 'Nueva1234'}).status_code, 200)

    def test_02_datos_invalidos_no_modifican_password_y_no_reflejan_secretos(self):
        for changes, status in (({'password_actual': 'Incorrecta'}, 400),
                                ({'password_nueva': 'Corta', 'confirmacion': 'Corta'}, 422),
                                ({'confirmacion': 'Diferente123'}, 422),
                                ({'password_nueva': 'x' * 15, 'confirmacion': 'x' * 15}, 422),
                                ({'password_nueva': 'Anterior123', 'confirmacion': 'Anterior123'}, 400),
                                ({'usuario': 'otra-cuenta'}, 422)):
            with self.subTest(campos=list(changes)):
                response = self.client.post('/auth/password', json=self.payload(**changes))
                self.assertEqual(response.status_code, status)
                for secret in ('Anterior123', 'Nueva1234', 'Diferente123', 'Incorrecta'):
                    self.assertNotIn(secret, response.text)
                row = self.env.fixture.db.execute('SELECT password_hash,token_version FROM cuentas_acceso').fetchone()
                self.assertTrue(verificar_password('Anterior123', row[0]))
                self.assertEqual(row[1], 0)

    def test_03_cambio_exige_sesion_y_origen_permitido(self):
        self.assertEqual(self.client.post('/auth/password', json=self.payload(), headers={'Origin': 'https://otro.invalid'}).status_code, 403)
        self.client.headers.clear()
        self.assertEqual(self.client.post('/auth/password', json=self.payload()).status_code, 401)

    def test_04_rutas_de_vistas_protegidas_y_ayuda_publica(self):
        self.client.cookies.set(fase5.COOKIE_NAME, self.env.token)
        for path in ('/dashboard/resumen', '/dashboard/explorar', '/dashboard/historico', '/dashboard/cuenta'):
            self.assertEqual(self.client.get(path).status_code, 200)
        self.client.cookies.clear()
        self.client.headers.clear()
        response = self.client.get('/dashboard/historico', follow_redirects=False)
        self.assertEqual(response.status_code, 303)
        self.assertEqual(response.headers['location'], '/login?next=%2Fdashboard%2Fhistorico')
        self.assertEqual(self.client.get('/acceso').status_code, 200)
