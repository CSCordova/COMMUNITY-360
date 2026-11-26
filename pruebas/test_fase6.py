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

    def test_06_franja_lunes_medianoche_consistente_en_consultas_y_cambios(self):
        self.crear(timestamp='2026-11-23T00:00:00Z')
        self.crear(id_interaccion='I9000002', timestamp='2026-11-22T18:00:00-06:00')
        self.crear(id_interaccion='I9000003', timestamp='2026-11-23T01:00:00Z')
        params = {'dia_semana': 0, 'hora': 0, 'tema': 'arte'}
        result = self.client.get('/api/analitica/interacciones', params=params)
        self.assertEqual(result.status_code, 200)
        self.assertEqual(result.json()['total_interacciones'], 2)
        listed = self.client.get('/api/interacciones', params=params).json()
        self.assertEqual({row['id_interaccion'] for row in listed['items']}, {'I9000001', 'I9000002'})
        with self.entorno.conectar() as ws:
            ws.receive_json()
            ws.send_json({'tipo': 'suscribir', 'solicitud': 9, 'filtros': params})
            self.assertEqual(ws.receive_json()['indicadores'], result.json())
            self.assertEqual(self.client.patch('/api/interacciones/I9000001', json={'timestamp': '2026-11-23T01:00:00Z'}).status_code, 200)
            self.assertEqual(ws.receive_json()['indicadores']['total_interacciones'], 1)
            self.assertEqual(self.client.delete('/api/interacciones/I9000002').status_code, 204)
            self.assertEqual(ws.receive_json()['indicadores']['total_interacciones'], 0)

    def test_07_rechaza_franjas_fuera_de_rango_y_mantiene_la_conexion(self):
        for params in ({'dia_semana': -1}, {'dia_semana': 7}, {'hora': 24}, {'hora': 1.5}):
            self.assertEqual(self.client.get('/api/analitica/interacciones', params=params).status_code, 422)
            self.assertEqual(self.client.get('/api/interacciones', params=params).status_code, 422)
        with self.entorno.conectar() as ws:
            ws.receive_json()
            for request, params in enumerate(({'dia_semana': 7}, {'hora': True}), 1):
                ws.send_json({'tipo': 'suscribir', 'solicitud': request, 'filtros': params})
                self.assertEqual(ws.receive_json()['tipo'], 'error_filtros')
            ws.send_json({'tipo': 'ping'})
            self.assertEqual(ws.receive_json()['tipo'], 'pong')

    def test_08_detalles_por_tema_y_fecha_calculan_promedios_sobre_registros(self):
        self.crear(timestamp='2026-11-25T23:00:00Z', sentimiento=1, reacciones_recibidas=0)
        self.crear(id_interaccion='I9000002', timestamp='2026-11-25T23:30:00Z', sentimiento=-.5, reacciones_recibidas=4)
        self.crear(id_interaccion='I9000003', timestamp='2026-11-26T00:30:00Z', tema='musica', sentimiento=-1, reacciones_recibidas=2)
        result = self.client.get('/api/analitica/interacciones').json()
        self.assertEqual(result['analisis_temas'], [
            {'categoria': 'arte', 'total': 2, 'reacciones_recibidas': 4, 'sentimiento_promedio': .25},
            {'categoria': 'musica', 'total': 1, 'reacciones_recibidas': 2, 'sentimiento_promedio': -1}])
        self.assertEqual(result['analisis_diario'], [
            {'fecha': '2026-11-25', 'total': 2, 'reacciones_recibidas': 4, 'sentimiento_promedio': .25},
            {'fecha': '2026-11-26', 'total': 1, 'reacciones_recibidas': 2, 'sentimiento_promedio': -1}])
        weighted = sum(row['sentimiento_promedio'] * row['total'] for row in result['analisis_temas']) / result['total_interacciones']
        self.assertAlmostEqual(weighted, result['sentimiento_promedio'])
        filtered = self.client.get('/api/analitica/interacciones?tema=arte').json()
        self.assertEqual(filtered['analisis_temas'], result['analisis_temas'][:1])
        self.assertEqual(len(filtered['analisis_diario']), 1)
        empty = self.client.get('/api/analitica/interacciones?tema=inexistente').json()
        self.assertEqual(empty['analisis_temas'], [])
        self.assertEqual(empty['analisis_diario'], [])

    def test_09_nuevas_series_recalculadas_tras_cambios_y_borrado_en_vivo(self):
        self.crear(timestamp='2026-11-25T23:30:00Z', sentimiento=.5)
        with self.entorno.conectar() as ws:
            ws.receive_json()
            response = self.client.patch('/api/interacciones/I9000001', json={
                'tema': 'musica', 'timestamp': '2026-11-26T00:30:00Z', 'sentimiento': -.8, 'reacciones_recibidas': 0})
            self.assertEqual(response.status_code, 200)
            state = ws.receive_json()['indicadores']
            self.assertEqual(state['analisis_temas'], [{'categoria': 'musica', 'total': 1, 'reacciones_recibidas': 0, 'sentimiento_promedio': -.8}])
            self.assertEqual(state['analisis_diario'], [{'fecha': '2026-11-26', 'total': 1, 'reacciones_recibidas': 0, 'sentimiento_promedio': -.8}])
            self.assertEqual(self.client.delete('/api/interacciones/I9000001').status_code, 204)
            empty = ws.receive_json()['indicadores']
            self.assertEqual(empty['analisis_temas'], [])
            self.assertEqual(empty['analisis_diario'], [])

    def test_10_busqueda_acento_mayusculas_ids_y_etiquetas_antes_de_paginar(self):
        self.crear(texto='Música en comunidad', etiquetas=['Concierto'], timestamp='2026-11-23T00:00:00Z')
        self.crear(id_interaccion='I9000002', texto='Otra actividad', etiquetas=['concierto'], canal='Discord', timestamp='2026-11-24T00:00:00Z')
        for query in ('MUSICA', 'musica concierto', 'I9000001', 'U000001 Música'):
            with self.subTest(query=query):
                response = self.client.get('/api/interacciones', params={'buscar': query, 'limite': 1}).json()
                self.assertEqual(response['total'], 1)
                self.assertEqual(response['items'][0]['id_interaccion'], 'I9000001')
        both = self.client.get('/api/interacciones', params={'buscar': 'CONCIERTO', 'limite': 1, 'desplazamiento': 1}).json()
        self.assertEqual(both['total'], 2)
        self.assertEqual(both['items'][0]['id_interaccion'], 'I9000001')
        self.assertEqual(self.client.get('/api/interacciones', params={'buscar': 'concierto', 'canal': 'Telegram'}).json()['total'], 1)
        self.assertEqual(self.client.get('/api/interacciones', params={'buscar': 'sin coincidencias'}).json()['total'], 0)
        # Searching the list never changes the statistics or searches geographic content.
        self.assertEqual(self.client.get('/api/analitica/interacciones').json()['total_interacciones'], 2)
        self.assertEqual(self.client.get('/api/interacciones', params={'buscar': 'Yucatán'}).json()['total'], 0)

    def test_11_ordenes_estables_con_empates_y_validacion_de_consulta(self):
        self.crear(timestamp='2026-11-23T00:00:00Z', sentimiento=-.5, reacciones_recibidas=5)
        self.crear(id_interaccion='I9000002', timestamp='2026-11-24T00:00:00Z', sentimiento=.8, reacciones_recibidas=1)
        self.crear(id_interaccion='I9000003', timestamp='2026-11-24T00:00:00Z', sentimiento=0, reacciones_recibidas=5)
        expected = {'fecha_asc': ['I9000001', 'I9000002', 'I9000003'],
                    'fecha_desc': ['I9000003', 'I9000002', 'I9000001'],
                    'reacciones_desc': ['I9000003', 'I9000001', 'I9000002'],
                    'sentimiento_asc': ['I9000001', 'I9000003', 'I9000002'],
                    'sentimiento_desc': ['I9000002', 'I9000003', 'I9000001']}
        for order, ids in expected.items():
            with self.subTest(order=order):
                result = self.client.get('/api/interacciones', params={'orden': order}).json()
                self.assertEqual([row['id_interaccion'] for row in result['items']], ids)
        for params in ({'buscar': 'a' * 201}, {'orden': 'inventado'}, {'limite': 101}):
            self.assertEqual(self.client.get('/api/interacciones', params=params).status_code, 422)
