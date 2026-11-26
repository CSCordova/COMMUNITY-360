"""Filtros consistentes entre REST, WebSocket y las gráficas del dashboard."""
import unittest
from unittest.mock import patch
from pruebas import test_fase4 as fase4, test_fase5 as fase5


class PruebasFase6(unittest.TestCase):
    def setUp(self):
        self.entorno = fase5.PruebasFase5()
        self.entorno.setUp()
        self.client = self.entorno.client

    def tearDown(self):
        self.entorno.tearDown()

    def crear(self, **changes):
        result = self.client.post('/api/interacciones', json=fase4.ejemplo(**changes))
        self.assertEqual(result.status_code, 201)

    def test_01_filtros_combinados_y_extremos_de_fecha_utc(self):
        self.crear(timestamp='2026-11-25T00:00:00Z')
        self.crear(id_interaccion='I9000002', timestamp='2026-11-25T23:59:59.999999Z', sentimiento=-0.25, reacciones_recibidas=4)
        self.crear(id_interaccion='I9000003', timestamp='2026-11-26T00:00:00Z', canal='Discord', tema='musica')
        result = self.client.get('/api/analitica/interacciones', params={
            'inicio': '2026-11-25T00:00:00Z', 'fin': '2026-11-25T23:59:59.999999Z',
            'canal': 'Telegram', 'tipo': 'mensaje', 'tema': 'arte'}).json()
        self.assertEqual(result['total_interacciones'], 2)
        self.assertEqual(result['usuarios_participantes'], 1)
        self.assertEqual(result['sentimiento_promedio'], .125)
        self.assertEqual(result['reacciones_recibidas'], 6)
        self.assertEqual(result['opciones_filtros']['canal'], ['Discord', 'Telegram'])
        self.assertEqual(result['por_dia'], [{'fecha': '2026-11-25', 'total': 2}])
        self.assertEqual(sum(row['total'] for row in result['actividad_semanal']), 2)
        self.assertEqual(sum(row['total'] for row in result['por_tipo']), 2)

    def test_02_suscripciones_distintas_reflejan_mover_y_eliminar_registro(self):
        with self.entorno.conectar() as a, self.entorno.conectar() as b:
            a.receive_json(); b.receive_json()
            a.send_json({'tipo': 'suscribir', 'solicitud': 11, 'filtros': {'canal': 'Telegram'}})
            b.send_json({'tipo': 'suscribir', 'solicitud': 22, 'filtros': {'canal': 'Discord'}})
            self.assertEqual(a.receive_json()['solicitud'], 11)
            self.assertEqual(b.receive_json()['solicitud'], 22)
            with patch.object(self.entorno.fixture.repo, 'listar', wraps=self.entorno.fixture.repo.listar) as reads:
                self.crear()
                self.assertEqual(reads.call_count, 1)
            first, second = a.receive_json(), b.receive_json()
            self.assertEqual(first['indicadores']['total_interacciones'], 1)
            self.assertEqual(second['indicadores']['total_interacciones'], 0)
            self.assertEqual(first['solicitud'], 11)
            self.assertEqual(second['solicitud'], 22)
            self.assertEqual(self.client.patch('/api/interacciones/I9000001', json={'canal': 'Discord', 'sentimiento': -0.6}).status_code, 200)
            self.assertEqual(a.receive_json()['indicadores']['total_interacciones'], 0)
            self.assertEqual(b.receive_json()['indicadores']['sentimiento_promedio'], -0.6)
            self.assertEqual(self.client.delete('/api/interacciones/I9000001').status_code, 204)
            for ws in (a, b):
                state = ws.receive_json()['indicadores']
                self.assertEqual(state['total_interacciones'], 0)
                self.assertEqual(state['reacciones_recibidas'], 0)
                self.assertIsNone(state['sentimiento_promedio'])

    def test_03_filtros_invalidos_no_rompen_conexion_ni_consulta_anterior(self):
        with self.entorno.conectar() as ws:
            ws.receive_json()
            ws.send_json({'tipo': 'suscribir', 'solicitud': 4, 'filtros': {
                'inicio': '2026-11-26T00:00:00Z', 'fin': '2026-11-25T00:00:00Z'}})
            self.assertEqual(ws.receive_json()['tipo'], 'error_filtros')
            ws.send_json({'tipo': 'solicitar_estado'})
            original = ws.receive_json()
            self.assertEqual(original['solicitud'], 0)
            self.assertEqual(original['filtros'], {})
            ws.send_json({'tipo': 'ping'})
            self.assertEqual(ws.receive_json()['tipo'], 'pong')

    def test_04_sin_resultados_no_inventa_promedios_y_historico_permanece(self):
        before = self.client.get('/api/analitica/usuarios').json()
        self.crear()
        response = self.client.get('/api/analitica/interacciones?tema=inexistente').json()
        self.assertEqual(response['total_interacciones'], 0)
        self.assertIsNone(response['sentimiento_promedio'])
        self.assertEqual(response['por_canal'], [])
        self.assertEqual(response['opciones_filtros']['tema'], ['arte'])
        self.assertEqual(self.client.get('/api/analitica/usuarios').json(), before)

    def test_05_filtros_de_rest_y_websocket_entregan_el_mismo_resumen(self):
        self.crear()
        with self.entorno.conectar() as ws:
            ws.receive_json()
            ws.send_json({'tipo': 'suscribir', 'solicitud': 8, 'filtros': {'tema': 'arte'}})
            state = ws.receive_json()
            self.assertEqual(state['indicadores'], self.client.get('/api/analitica/interacciones?tema=arte').json())
