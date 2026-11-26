"""HTTP + WebSocket reales en ASGI; SQL temporal y Firestore sustituido."""
import asyncio
import json
import unittest
from unittest.mock import patch

from fastapi.testclient import TestClient
from starlette.websockets import WebSocketDisconnect

from pruebas import test_fase4 as fase4
from backend.main import app
from backend.auth import dependencies, routes, security
from backend.core.config import COOKIE_NAME
from backend.core.errors import DataServiceError
from backend.interacciones.service import InteraccionesService
from backend.interacciones.repository import obtener_interacciones_repository
from backend.realtime.hub import DashboardHub


class PruebasFase5(unittest.TestCase):
    def setUp(self):
        self.fixture = fase4.PruebasFase4()
        asyncio.run(self.fixture.asyncSetUp())
        self.anterior = app.state.realtime
        app.state.realtime = DashboardHub()
        self.patches = [patch.object(routes, 'conectar_turso', dependencies.conectar_turso),
                        patch('requests.sessions.Session.request', side_effect=AssertionError('Red externa prohibida en QA'))]
        for mock in self.patches:
            mock.start()
        self.token = security.crear_token(1, 0)
        self.client = TestClient(app, headers={'Authorization': 'Bearer ' + self.token})
        self.client.__enter__()

    def tearDown(self):
        self.client.__exit__(None, None, None)
        app.state.realtime = self.anterior
        for mock in reversed(self.patches):
            mock.stop()
        asyncio.run(self.fixture.asyncTearDown())

    def conectar(self, **kwargs):
        return self.client.websocket_connect('/ws/dashboard', **kwargs)

    def test_01_rechaza_anonimo_y_token_por_query(self):
        for path in ('/ws/dashboard', '/ws/dashboard?token=' + self.token):
            with self.subTest(path=path.split('?')[0]):
                with self.assertRaises(WebSocketDisconnect) as error:
                    with self.client.websocket_connect(path, headers={'Authorization': ''}):
                        pass
                self.assertEqual(error.exception.code, 1008)

    def test_02_rechaza_origen_ajeno_y_token_invalido(self):
        for headers, code in (({'Origin': 'https://otro-sitio.invalid'}, 1008),
                              ({'Authorization': 'Bearer invalido'}, 4401),
                              ({'Authorization': 'Basic invalido'}, 1008)):
            with self.subTest(headers=list(headers)):
                with self.assertRaises(WebSocketDisconnect) as error:
                    with self.conectar(headers=headers):
                        pass
                self.assertEqual(error.exception.code, code)

    def test_03_cookie_exige_origen_y_entrega_estado(self):
        self.client.headers.pop('Authorization')
        self.client.cookies.set(COOKIE_NAME, self.token)
        with self.assertRaises(WebSocketDisconnect):
            with self.conectar():
                pass
        with self.conectar(headers={'Origin': 'http://testserver'}) as ws:
            initial = ws.receive_json()
            self.assertEqual(initial['tipo'], 'estado_inicial')
            self.assertEqual(initial['indicadores']['total_interacciones'], 0)
            self.assertIsNone(initial['indicadores']['sentimiento_promedio'])

    def test_04_post_put_delete_actualizan_sin_recargar(self):
        with self.conectar() as ws:
            initial = ws.receive_json()
            created = self.client.post('/api/interacciones', json=fase4.ejemplo())
            self.assertEqual(created.status_code, 201)
            message = ws.receive_json()
            self.assertEqual(message['operacion'], 'creada')
            self.assertGreater(message['revision'], initial['revision'])
            self.assertEqual(message['indicadores']['total_interacciones'], 1)
            self.assertEqual(message['indicadores']['sentimiento_promedio'], 0.5)
            self.assertEqual(message['indicadores']['reacciones_recibidas'], 2)
            payload = fase4.ejemplo(sentimiento=-0.75, reacciones_recibidas=7)
            payload.pop('id_interaccion')
            self.assertEqual(self.client.put('/api/interacciones/I9000001', json=payload).status_code, 200)
            message = ws.receive_json()
            self.assertEqual(message['operacion'], 'modificada')
            self.assertEqual(message['indicadores']['total_interacciones'], 1)
            self.assertEqual(message['indicadores']['sentimiento_promedio'], -0.75)
            self.assertEqual(message['indicadores']['reacciones_recibidas'], 7)
            self.assertEqual(self.client.delete('/api/interacciones/I9000001').status_code, 204)
            message = ws.receive_json()
            self.assertEqual(message['operacion'], 'eliminada')
            self.assertEqual(message['indicadores']['total_interacciones'], 0)
            self.assertEqual(message['indicadores']['usuarios_participantes'], 0)
            self.assertEqual(message['indicadores']['reacciones_recibidas'], 0)
            self.assertIsNone(message['indicadores']['sentimiento_promedio'])

    def test_05_publica_patch_a_todos_y_reconexion_recupera_estado(self):
        self.client.post('/api/interacciones', json=fase4.ejemplo())
        with self.conectar() as first, self.conectar() as second:
            first.receive_json(); second.receive_json()
            self.assertEqual(self.client.patch('/api/interacciones/I9000001', json={'texto': 'Cambio'}).status_code, 200)
            self.assertEqual(first.receive_json(), second.receive_json())
        with self.conectar() as ws:
            self.assertEqual(ws.receive_json()['indicadores']['total_interacciones'], 1)

    def test_06_error_de_escritura_no_publica_y_ws_es_bidireccional(self):
        with self.conectar() as ws:
            initial = ws.receive_json()
            self.assertEqual(self.client.post('/api/interacciones', json=fase4.ejemplo(id_usuario='U999999')).status_code, 422)
            self.assertEqual(app.state.realtime.revision, initial['revision'])
            ws.send_json({'tipo': 'solicitar_estado'})
            self.assertEqual(ws.receive_json()['indicadores']['total_interacciones'], 0)

    def test_07_logout_revoca_conexion_abierta(self):
        with self.conectar() as ws:
            ws.receive_json()
            self.assertEqual(self.client.post('/auth/logout').status_code, 200)
            with self.assertRaises(WebSocketDisconnect) as error:
                ws.receive_json()
            self.assertEqual(error.exception.code, 4401)

    def test_08_token_revocado_cierra_antes_de_contestar(self):
        with self.conectar() as ws:
            ws.receive_json()
            self.fixture.db.execute('UPDATE cuentas_acceso SET token_version=token_version+1')
            ws.send_json({'tipo': 'ping'})
            with self.assertRaises(WebSocketDisconnect) as error:
                ws.receive_json()
            self.assertEqual(error.exception.code, 4401)

    def test_09_fallo_de_resumen_no_invalida_escritura_confirmada(self):
        with self.conectar() as ws:
            ws.receive_json()
            with patch.object(InteraccionesService, 'resumen', side_effect=DataServiceError('falla controlada')):
                response = self.client.post('/api/interacciones', json=fase4.ejemplo())
                self.assertEqual(response.status_code, 201)
                self.assertEqual(ws.receive_json()['tipo'], 'error_datos')
            self.assertIn('I9000001', self.fixture.repo.registros)
            ws.send_json({'tipo': 'solicitar_estado'})
            self.assertEqual(ws.receive_json()['indicadores']['total_interacciones'], 1)

    def test_10_no_transmite_texto_geografia_ni_credenciales(self):
        self.client.post('/api/interacciones', json=fase4.ejemplo(texto='TEXTO-PRIVADO-123'))
        with self.conectar() as ws:
            payload = json.dumps(ws.receive_json(), ensure_ascii=False)
            for private in ('TEXTO-PRIVADO-123', 'Mérida', 'ubicacion', 'password', self.token):
                self.assertNotIn(private, payload)

    def test_11_ws_rechaza_escritura_mensaje_grande_y_json_invalido(self):
        for message, code in (('{', 1008), ('x' * 2049, 1009), ('{"tipo":"crear"}', 1008)):
            with self.subTest(code=code), self.conectar() as ws:
                ws.receive_json()
                ws.send_text(message)
                with self.assertRaises(WebSocketDisconnect) as error:
                    ws.receive_json()
                self.assertEqual(error.exception.code, code)
        self.assertFalse(self.fixture.repo.registros)

    def test_12_cola_limitada_cierra_cliente_lento(self):
        hub = DashboardHub()
        client = hub.registrar(self.token, 1)
        for number in range(9):
            hub.encolar(client, {'numero': number})
        self.assertTrue(client.cerrado)
        self.assertNotIn(client, hub.clientes)
        self.assertEqual(client.cola.qsize(), 1)
        self.assertEqual(client.cola.get_nowait(), {'_cerrar': 1013})

    def test_13_autentica_antes_de_inicializar_datos_y_maneja_fallo(self):
        def falla():
            raise DataServiceError('Configuración privada que no debe publicarse')
        app.dependency_overrides[obtener_interacciones_repository] = falla
        for token, code in (('', 1008), ('Bearer ' + self.token, 1013)):
            with self.subTest(code=code), self.assertRaises(WebSocketDisconnect) as error:
                with self.conectar(headers={'Authorization': token}):
                    pass
            self.assertEqual(error.exception.code, code)

    def test_14_revalida_sesion_sin_mensajes_del_cliente(self):
        with patch('backend.realtime.routes.INTERVALO_VALIDACION', 0.02), self.conectar() as ws:
            ws.receive_json()
            self.fixture.db.execute('UPDATE cuentas_acceso SET activo=0')
            with self.assertRaises(WebSocketDisconnect) as error:
                ws.receive_json()
            self.assertEqual(error.exception.code, 4401)
