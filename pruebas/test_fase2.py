"""Pruebas locales sin necesidad de acceder a internet ni a bases de datos cloud."""
import csv
import json
from pathlib import Path
import sqlite3
import tempfile
import unittest
import sys

sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
import etl
import cargar_nube

class PruebasFase2(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.temp=tempfile.TemporaryDirectory()
        cls.folder=Path(cls.temp.name)/'output'
        cls.audit=etl.run(output=cls.folder)
        cls.cons,cls.docs=cargar_nube.evaluar_salida(cls.folder)

    @classmethod
    def tearDownClass(cls): cls.temp.cleanup()

    def test_01_usuarios(self):
        self.assertEqual(self.audit['resultado_local']['usuarios_aceptados'],1068)

    def test_02_interacciones(self):
        self.assertEqual(self.audit['resultado_local']['interacciones_aceptadas'],207)

    def test_03_cuarentena(self):
        self.assertEqual(self.audit['resultado_local']['huerfanas'],793)
        quarant=cargar_nube.read_table(self.folder/'interacciones_cuarentena.csv')
        self.assertEqual(len(quarant),793)
        self.assertNotIn('ciudad',quarant[0])

    def test_04_catalogos(self):
        self.assertEqual(self.audit['resultado_local']['tablas_SQL'],cargar_nube.ESPERADOS)

    def test_05_geografia_usuarios(self):
        self.assertEqual(list(self.cons.values()).count('no'),171)
        self.assertEqual(self.audit['resultado_local']['ubicaciones_sin_consentimiento'],0)

    def test_06_geografia_interacciones(self):
        self.assertTrue(all('ubicacion' not in d for d in self.docs if self.cons[d['id_usuario']]=='no'))

    def test_07_fks(self):
        cn=sqlite3.connect(self.folder/'comprobacion_local.sqlite')
        try:self.assertEqual(cn.execute('PRAGMA foreign_key_check').fetchall(),[])
        finally:cn.close()

    def test_08_rechazar_ubicacion_sin_permiso(self):
        cn=sqlite3.connect(self.folder/'comprobacion_local.sqlite')
        cn.execute('PRAGMA foreign_keys=ON')
        try:
            uid=cn.execute("SELECT id_usuario FROM usuarios WHERE consentimiento_datos='no' LIMIT 1").fetchone()[0]
            with self.assertRaises(sqlite3.IntegrityError):
                cn.execute('INSERT INTO ubicaciones_usuario(id_usuario,id_localidad) VALUES (?,1)',(uid,))
        finally:
            cn.rollback();cn.close()

    def test_09_no_revocar_permiso_con_ubicacion(self):
        cn=sqlite3.connect(self.folder/'comprobacion_local.sqlite')
        cn.execute('PRAGMA foreign_keys=ON')
        try:
            uid=cn.execute('SELECT id_usuario FROM ubicaciones_usuario LIMIT 1').fetchone()[0]
            with self.assertRaises(sqlite3.IntegrityError):
                cn.execute("UPDATE usuarios SET consentimiento_datos='no' WHERE id_usuario=?",(uid,))
        finally:
            cn.rollback();cn.close()

    def test_10_int_entero_invalido(self):
        for value in ('1.5','1e3','nan',None):
            with self.subTest(value=value):
                with self.assertRaises(ValueError):etl.strict_int(value,'test')

    def test_11_reales_inseguros(self):
        for value in ('nan','inf','-inf','3.0'):
            with self.subTest(value=value):
                with self.assertRaises(ValueError):etl.strict_float(value,'test',-1,1)

    def test_12_fecha_invalida(self):
        self.assertEqual(etl.fecha('21/04/2026'),'2026-04-21')
        with self.assertRaises(ValueError):etl.fecha('31/02/2026')

    def test_13_timestamp_zona(self):
        self.assertEqual(etl.utc('2026-10-30T12:00:00-06:00'),'2026-10-30T18:00:00Z')
        with self.assertRaises(ValueError):etl.utc('2026-10-30T12:00:00')

    def test_14_reaccion_con_longitud_original(self):
        reactions=[d for d in self.docs if d['tipo']=='reaccion' and d['texto'] is None]
        self.assertTrue(reactions)
        self.assertTrue(all(d['longitud_texto']>0 for d in reactions))

    def test_15_etiquetas_lista(self):
        self.assertTrue(all(isinstance(d['etiquetas'],list) for d in self.docs))
        self.assertTrue(all(len(x['etiquetas'])==len(set(v.casefold() for v in x['etiquetas'])) for x in self.docs))

    def test_16_alias_no_es_unico(self):
        dup=[dict(id_usuario='U000001',alias='mismo',_linea=2),dict(id_usuario='U000002',alias='mismo',_linea=3)]
        rej=[];stats=__import__('collections').Counter()
        clean=etl.eliminar_duplicados(dup,'id_usuario',rej,stats,'usuarios')
        self.assertEqual(len(clean),2)
        self.assertFalse(rej)

    def test_17_duplicate_identico(self):
        dupe=[dict(id_usuario='U000001',alias='A',_linea=2),dict(id_usuario='U000001',alias='A',_linea=3)]
        rej=[];stats=__import__('collections').Counter()
        clean=etl.eliminar_duplicados(dupe,'id_usuario',rej,stats,'usuarios')
        self.assertEqual(len(clean),1)
        self.assertEqual(len(rej),1)

    def test_18_id_en_conflicto(self):
        dupe=[dict(id_usuario='U000001',alias='A',_linea=2),dict(id_usuario='U000001',alias='B',_linea=3)]
        rej=[];stats=__import__('collections').Counter()
        clean=etl.eliminar_duplicados(dupe,'id_usuario',rej,stats,'usuarios')
        self.assertEqual(len(clean),0)
        self.assertEqual(len(rej),2)

    def test_19_ejecucion_reproducible(self):
        before=json.loads((self.folder/'manifiesto_sha256.json').read_text())['salidas']
        etl.run(output=self.folder)
        after=json.loads((self.folder/'manifiesto_sha256.json').read_text())['salidas']
        self.assertEqual(before,after)

    def test_20_ddl_completo(self):
        ddls=list(cargar_nube.instrucciones_sql())
        self.assertGreaterEqual(len(ddls),14)
        self.assertTrue(any('CREATE TRIGGER' in d for d in ddls))
        self.assertEqual(len([d for d in ddls if 'CREATE TABLE' in d]),8)

    def test_21_fire_canonic_timestamp(self):
        from datetime import datetime,timezone
        self.assertEqual(cargar_nube.canonical(datetime(2026,1,2,3,tzinfo=timezone.utc)),
                         '2026-01-02T03:00:00Z')

if __name__=='__main__':unittest.main()
