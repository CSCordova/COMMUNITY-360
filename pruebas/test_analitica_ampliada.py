"""Privacidad territorial, participación histórica y comparación de periodos reales."""
import unittest
from datetime import datetime, timezone
from backend.analitica.insights import agrupar_territorio
from backend.interacciones.service import InteraccionesService
from backend.interacciones.schemas import FiltrosInteracciones
from pruebas import test_fase5 as fase5


class PruebasAgregados(unittest.TestCase):
    def usuarios(self, count=5):
        return [dict(id_usuario=f'U{i:06}', pais='México', estado='Yucatán', ciudad='Mérida', latitud=20.91234, longitud=-89.61234) for i in range(count)]

    def test_grupo_pequeno_no_publica_ubicacion_ni_conteo(self):
        self.assertEqual(agrupar_territorio(self.usuarios(4), [])['ciudades'], [])

    def test_cinco_miembros_no_bastan_para_publicar_actividad_de_una_persona(self):
        users = self.usuarios()
        result = agrupar_territorio(users, [{'id_usuario': users[0]['id_usuario']}] * 20)['ciudades'][0]
        self.assertEqual(result['miembros'], 5)
        self.assertEqual(result['latitud'], 20.9)
        self.assertEqual(result['longitud'], -89.6)
        self.assertIsNone(result['interacciones'])
        self.assertIsNone(result['participantes'])
        self.assertNotIn('id_usuario', result)

    def test_actividad_publicable_y_coordenadas_insuficientes_son_independientes(self):
        users = self.usuarios()
        users[0]['latitud'] = None
        result = agrupar_territorio(users, [{'id_usuario': u['id_usuario']} for u in users])['ciudades'][0]
        self.assertIsNone(result['latitud'])
        self.assertIsNone(result['longitud'])
        self.assertEqual(result['interacciones'], 5)
        self.assertEqual(result['participantes'], 5)

    def test_coordenadas_repetidas_no_aumentan_el_numero_de_aportantes(self):
        users = self.usuarios()
        users[0]['latitud'] = None
        result = agrupar_territorio(users + [users[1]], [])['ciudades'][0]
        self.assertIsNone(result['latitud'])
        self.assertIsNone(result['longitud'])

    def test_ciudades_homonimas_no_se_mezclan(self):
        other = [{**u, 'id_usuario': 'X' + u['id_usuario'], 'estado': 'Otro'} for u in self.usuarios()]
        self.assertEqual(len(agrupar_territorio(self.usuarios() + other, [])['ciudades']), 2)

    def test_periodos_iguales_respetan_filtros_y_promedio_ponderado(self):
        def dato(day, usuario, sentiment, channel='Telegram'):
            return dict(id_interaccion=f'I{day}{usuario}',timestamp=datetime(2026,11,day,12,tzinfo=timezone.utc),id_usuario=usuario,sentimiento=sentiment,reacciones_recibidas=2,canal=channel)
        rows = [dato(1,'U1',1),dato(2,'U1',-1),dato(2,'U2',1),dato(2,'U3',-.8,'Discord'),dato(4,'U4',.4)]
        filters = FiltrosInteracciones(inicio='2026-11-03T00:00:00Z',fin='2026-11-04T23:59:59.999999Z',canal='Telegram')
        result = InteraccionesService.comparacion_periodos(rows, filters)
        self.assertTrue(result['disponible'])
        self.assertEqual(result['dias'], 2)
        self.assertEqual(result['inicio_anterior'], '2026-11-01')
        self.assertEqual(result['fin_anterior'], '2026-11-02')
        self.assertEqual(result['indicadores']['usuarios_participantes'], 2)
        self.assertAlmostEqual(result['indicadores']['sentimiento_promedio'], 1/3)
        self.assertEqual(result['indicadores']['reacciones_recibidas'], 6)
        self.assertFalse(InteraccionesService.comparacion_periodos(rows,FiltrosInteracciones())['disponible'])
        self.assertFalse(InteraccionesService.comparacion_periodos([],filters)['disponible'])
        self.assertFalse(InteraccionesService.comparacion_periodos(rows,filters.model_copy(update={'inicio':datetime(2026,11,3,1,tzinfo=timezone.utc)}))['disponible'])


class PruebasConsultasPadron(unittest.TestCase):
    def setUp(self):
        self.env = fase5.PruebasFase5()
        self.env.setUp()
        self.client = self.env.client

    def tearDown(self):
        self.env.tearDown()

    def test_solo_geografia_con_consentimiento_y_sin_ids_en_respuesta(self):
        db = self.env.fixture.db
        # Verify the database guard, then simulate an imported legacy row to test the query guard too.
        import sqlite3
        with self.assertRaises(sqlite3.IntegrityError):
            db.execute("INSERT INTO ubicaciones_usuario VALUES ('U000002',1,20.95,-89.65)")
        db.execute('DROP TRIGGER trg_ubicacion_insert_autorizado')
        db.execute("INSERT INTO ubicaciones_usuario VALUES ('U000002',1,20.95,-89.65)")
        from backend.usuarios.repository import UsuariosRepository
        self.assertEqual([u['id_usuario'] for u in UsuariosRepository().territorio_autorizado()], ['U000001'])
        result = self.client.get('/api/analitica/territorio')
        self.assertEqual(result.status_code,200)
        self.assertEqual(result.json()['ciudades'],[])

    def test_participacion_fecha_corte_global_filtro_orden_y_paginacion(self):
        db=self.env.fixture.db
        db.execute("INSERT INTO cat_estatus VALUES (2,'en_riesgo')")
        db.execute("UPDATE usuarios SET ultima_actividad='2026-11-25' WHERE id_usuario='U000001'")
        db.execute("UPDATE usuarios SET ultima_actividad='2026-11-01',id_estatus=2 WHERE id_usuario='U000002'")
        result=self.client.get('/api/analitica/participacion?estatus=en_riesgo').json()
        self.assertEqual(result['fecha_corte'],'2026-11-25')
        self.assertEqual(result['total'],1)
        row=result['items'][0]
        self.assertEqual(row['dias_sin_actividad'],24)
        self.assertEqual(row['usuario'],'U***002')
        self.assertNotIn('id_usuario',row)
        self.assertNotIn('alias',row)
        self.assertNotIn('ubicacion',row)
        self.assertEqual(self.client.get('/api/analitica/participacion?orden=estatus&limite=1').json()['items'][0]['estatus'],'en_riesgo')
        self.assertEqual(self.client.get('/api/analitica/participacion?limite=1&desplazamiento=1').json()['items'][0]['dias_sin_actividad'],0)

    def test_endpoints_protegidos_y_parametros_validados(self):
        for query in ('estatus=inventado','orden=score','limite=0','limite=101','desplazamiento=-1'):
            self.assertEqual(self.client.get('/api/analitica/participacion?'+query).status_code,422)
        self.client.headers.clear()
        self.client.cookies.clear()
        for path in ('territorio','participacion'):
            self.assertEqual(self.client.get('/api/analitica/'+path).status_code,401)

    def test_desglose_de_especies_conserva_total_padron(self):
        data=self.client.get('/api/analitica/usuarios').json()['indicadores']
        self.assertEqual(sum(row['total'] for row in data['por_especie']),data['usuarios'])
