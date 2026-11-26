"""COMMUNITY 360 · Carga Turso + Firestore, segura y reanudable.

Sin acceso a la nube por defecto:
    python cargar_nube.py --preparar
    python cargar_nube.py --verificar
    python cargar_nube.py --cargar --confirmar CARGAR-COMMUNITY360

No realiza DELETE, DROP ni sobrescrituras. Respeta el esquema de 8 tablas.
"""
from __future__ import annotations
import argparse
import csv
from datetime import datetime, timezone
import json
import os
from pathlib import Path
import sqlite3
import sys

from etl import ROOT, OUT, SCHEMA, U_COLS, G_COLS, CATS, sha256

TABLAS = list(CATS) + ['cat_localidades','usuarios','ubicaciones_usuario']
CAMPOS_ENTEROS = {'id_estatus','id_rango_edad','id_especie','id_interes','id_plataforma','id_localidad',
                  'es_artista','mensajes_30d','reacciones_30d','eventos_asistidos','comisiones_compradas'}
CAMPOS_REALES = {'sentimiento_promedio','latitud','longitud'}
ESPERADOS = {'cat_estatus':3,'cat_rangos_edad':4,'cat_especies_fursona':12,'cat_intereses':10,
             'cat_plataformas':6,'cat_localidades':21,'usuarios':1068,'ubicaciones_usuario':897}
FIRESTORE_ESPERADOS = 207


def evaluar_salida(ruta=OUT):
    ruta=Path(ruta)
    j=ruta/'auditoria.json'
    if not j.is_file(): raise RuntimeError('No encontré auditoria.json; ejecuta python etl.py primero.')
    audit=json.loads(j.read_text(encoding='utf-8'))
    resumen=audit['resultado_local']
    if resumen['tablas_SQL']!=ESPERADOS: raise RuntimeError(f'Conteos de tablas SQL inesperados: {resumen["tablas_SQL"]}')
    if resumen['interacciones_aceptadas']!=FIRESTORE_ESPERADOS: raise RuntimeError('No hay 207 interacciones válidas.')
    if resumen['huerfanas']!=793 or resumen['usuarios_cuarentena']!=0:raise RuntimeError('La auditoría cambió. Revisar antes de cargar.')
    if resumen['fk_incorrectas']!=0 or resumen['ubicaciones_sin_consentimiento']!=0:raise RuntimeError('Falló la verificación de integridad local.')
    manifest=json.loads((ruta/'manifiesto_sha256.json').read_text(encoding='utf-8'))
    for name,hash_expected in manifest['salidas'].items():
        fichero=ruta/name
        if not fichero.is_file() or sha256(fichero)!=hash_expected:raise RuntimeError('Archivo de salida modificado: '+name)
    out_users=read_table(ruta/'usuarios.csv')
    consent={x['id_usuario']:x['consentimiento_datos'] for x in out_users}
    if len(consent)!=len(out_users):raise RuntimeError('ID de usuario repetidos.')
    geo=read_table(ruta/'ubicaciones_usuario.csv')
    if any(consent.get(g['id_usuario'])!='si' for g in geo):raise RuntimeError('Privacidad SQL incumplida.')
    docs=read_docs(ruta/'interacciones_firestore.jsonl')
    if len(docs)!=207 or len({d['id_interaccion'] for d in docs})!=207:
        raise RuntimeError('Documentos Firestore duplicados o faltantes.')
    if any(d['id_usuario'] not in consent for d in docs):raise RuntimeError('Interacciones huérfanas.')
    if any('ubicacion' in d and consent[d['id_usuario']]!='si' for d in docs):
        raise RuntimeError('Privacidad en Firestore incumplida.')
    return consent,docs


def read_table(path):
    with Path(path).open('r',encoding='utf-8-sig',newline='') as f:return list(csv.DictReader(f))


def read_docs(path):
    with Path(path).open(encoding='utf-8') as f:
        return [json.loads(line) for line in f if line.strip()]


def cargar_env():
    try:from dotenv import load_dotenv
    except ImportError as e: raise RuntimeError('Falta python-dotenv: pip install -r requirements.txt') from e
    load_dotenv(ROOT/'.env')
    required=['TURSO_DRIVER','TURSO_DATABASE_URL','TURSO_AUTH_TOKEN','FIREBASE_PROJECT_ID','FIREBASE_CREDENTIALS_PATH']
    missing=[name for name in required if not os.getenv(name) or os.getenv(name).startswith(('PEGA_','TU_'))]
    if missing:raise RuntimeError('Faltan datos en .env: '+', '.join(missing))
    driver=os.environ['TURSO_DRIVER'].strip().lower()
    url=os.environ['TURSO_DATABASE_URL'].strip()
    
    if driver != "http":
        raise RuntimeError("Configura TURSO_DRIVER=http")

    if not url.startswith(("libsql://", "turso://", "https://")):
        raise RuntimeError("URL de Turso no válida.")

    key=Path(os.environ['FIREBASE_CREDENTIALS_PATH'])
    if not key.is_absolute():key=ROOT/key
    if not key.is_file():raise RuntimeError('No encontré el JSON privado de Firebase en la ruta configurada.')
    try:project_json=json.loads(key.read_text(encoding='utf-8'))
    except (json.JSONDecodeError,OSError) as e:raise RuntimeError('La clave de Firebase no es JSON válido.') from e
    if project_json.get('project_id')!=os.environ['FIREBASE_PROJECT_ID']:
        raise RuntimeError('FIREBASE_PROJECT_ID no coincide con el proyecto del archivo de credenciales.')
    return driver,url,key


def conectar_turso(driver,url):
    from turso_http import TursoHTTP

    cn = TursoHTTP(
        url,
        os.environ["TURSO_AUTH_TOKEN"]
    )

    cn.execute("PRAGMA foreign_keys = ON")

    enabled = cn.execute(
        "PRAGMA foreign_keys"
    ).fetchone()

    if not enabled or int(enabled[0]) != 1:
        cn.close()
        raise RuntimeError(
            "No se activaron las claves foráneas."
        )


    return cn


def conectar_firebase(key):
    import firebase_admin
    from firebase_admin import credentials,firestore
    app=firebase_admin.initialize_app(credentials.Certificate(str(key)),
                                     options={'projectId':os.environ['FIREBASE_PROJECT_ID']},
                                     name='community360-etl')
    return firestore.client(app=app,database_id=os.environ.get('FIRESTORE_DATABASE_ID','(default)'))


def instrucciones_sql():
    sql=SCHEMA.read_text(encoding='utf-8')
    # sqlite3.complete_statement reconoce el cuerpo BEGIN...END de los TRIGGER.
    acc=''
    for line in sql.splitlines(keepends=True):
        acc+=line
        if sqlite3.complete_statement(acc):
            if acc.strip():yield acc.strip()
            acc=''
    if acc.strip():raise RuntimeError('Archivo esquema_turso.sql incompleto')


def columnas_correctas(conn,table,fields):
    actual=[row[1] for row in conn.execute(f'PRAGMA table_info({table})').fetchall()]
    if actual != fields: raise RuntimeError(f'La tabla remota {table} no coincide con el DER aprobado. Actual: {actual}, esperado: {fields}')


def valor_sql(col,value):
    if value is None or value=='':return None
    if col in CAMPOS_ENTEROS:return int(value)
    if col in CAMPOS_REALES:return float(value)
    return value


def cargar_sql(conn,folder=OUT):
    # Detener si existen tablas con estructura incompatible; no borrar ni sobrescribir datos.
    for stmt in instrucciones_sql():conn.execute(stmt)
    conn.commit()
    for table in TABLAS:
        p=folder/f'{table}.csv'
        with p.open(encoding='utf-8-sig',newline='') as f:
            rd=csv.DictReader(f); names=rd.fieldnames
            rows=[tuple(valor_sql(col,row[col]) for col in names) for row in rd]
        columnas_correctas(conn,table,names)
        actual={str(row[0]):tuple(row) for row in conn.execute(f'SELECT * FROM {table}').fetchall()}
        ids={str(r[0]) for r in rows}
        extras=set(actual)-ids
        if extras:raise RuntimeError(f'Tabla {table} tiene {len(extras)} claves ajenas a este ETL. No se sobrescribirá.')
        nuevos=[]
        for row in rows:
            key=str(row[0])
            if key in actual:
                if actual[key]!=row:raise RuntimeError(f'Conflicto con datos existentes en {table}, PK={key}; no sobrescribir.')
            else:nuevos.append(row)
        if nuevos:
            marks=','.join('?' for _ in names)
            sql=f'INSERT INTO {table} ({",".join(names)}) VALUES ({marks})'
            conn.executemany(sql,nuevos)
            conn.commit()
        print(f'TURSO {table}: {len(rows)} esperados; {len(nuevos)} insertados; {len(rows)-len(nuevos)} ya existían idénticos.')
    return verificar_sql(conn)


def verificar_sql(conn):
    for table,want in ESPERADOS.items():
        count=int(conn.execute(f'SELECT COUNT(*) FROM {table}').fetchone()[0])
        if count!=want:raise RuntimeError(f'Conteo Turso {table}: {count}; esperado {want}')
    privacy=int(conn.execute("SELECT COUNT(*) FROM ubicaciones_usuario l JOIN usuarios u USING (id_usuario) WHERE u.consentimiento_datos<>'si'").fetchone()[0])
    faltas=conn.execute('PRAGMA foreign_key_check').fetchall()
    if privacy!=0 or faltas:raise RuntimeError(f'Error privacidad/FK remoto: {privacy}; {len(faltas)}')
    nocons=int(conn.execute("SELECT COUNT(*) FROM usuarios WHERE consentimiento_datos='no'").fetchone()[0])
    if nocons!=171:raise RuntimeError('Conteo inesperado de usuarios sin consentimiento.')
    print(f'TURSO: 8 tablas verificadas; FK={len(faltas)}; ubicaciones prohibidas={privacy}; usuarios sin consentimiento={nocons}.')
    return {'tablas_SQL':ESPERADOS,'fk_violaciones':len(faltas),'ubicaciones_prohibidas':privacy,'usuarios_sin_consentimiento':nocons}


def canonical(x):
    # Firestore devuelve Timestamp como datetime. Normalizar para cotejar reintentos.
    if isinstance(x,datetime):return x.astimezone(timezone.utc).isoformat().replace('+00:00','Z')
    if isinstance(x,list):return [canonical(v) for v in x]
    if isinstance(x,dict):return {k:canonical(v) for k,v in x.items()}
    return x


def convertir_documento(doc):
    obj=dict(doc)
    obj['timestamp']=datetime.fromisoformat(doc['timestamp'].replace('Z','+00:00'))
    return obj


def leer_documentos_firestore(fdb):
    return {snap.id:snap.to_dict() for snap in fdb.collection('interacciones').stream()}


def cargar_firestore(fdb,docs):
    col=fdb.collection('interacciones')
    remotos=leer_documentos_firestore(fdb)
    locales={d['id_interaccion']:d for d in docs}
    extras=set(remotos)-set(locales)
    if extras:raise RuntimeError(f'Firestore tiene {len(extras)} documentos ajenos a estos CSV; no sobrescribir.')
    for docid,exist in remotos.items():
        if canonical(exist)!=canonical(convertir_documento(locales[docid])):
            raise RuntimeError(f'Documento Firestore con contenido diferente: {docid}. No sobrescribir.')
    created=0
    for doc in docs:
        docid=doc['id_interaccion']
        if docid not in remotos:
            col.document(docid).create(convertir_documento(doc))  # .create() NO sobreescribe
            created+=1
    print(f'FIRESTORE interacciones: esperados {len(docs)}; nuevos {created}; idénticos existentes {len(remotos)}.')
    return created


def verificar_firestore(fdb,consent,docs):
    actuales=leer_documentos_firestore(fdb)
    esperados={d['id_interaccion']:d for d in docs}
    if len(actuales)!=len(esperados) or set(actuales)!=set(esperados):
        raise RuntimeError(f'Firestore tiene {len(actuales)} documentos; se esperan {len(esperados)} IDs exactos.')
    violations=0
    for did,actual in actuales.items():
        if canonical(actual)!=canonical(convertir_documento(esperados[did])):
            raise RuntimeError(f'Firestore no coincide con JSONL preparado: {did}')
        if actual.get('id_usuario') not in consent:raise RuntimeError('Firestore tiene una referencia huérfana.')
        if consent[actual['id_usuario']]=='no' and 'ubicacion' in actual:
            violations+=1
    if violations:raise RuntimeError(f'Firestore viola privacidad: {violations} documentos')
    print(f'FIRESTORE: {len(actuales)} documentos correctos; sin ubicación no autorizada={violations}.')
    return {'interacciones':len(actuales),'ubicaciones_no_autorizadas':violations}


def main():
    ap=argparse.ArgumentParser(description='Subir y verificar resultados ETL en Turso + Firestore')
    choice=ap.add_mutually_exclusive_group(required=True)
    choice.add_argument('--preparar',action='store_true',help='Solo comprueba archivos LOCALES, no usa credenciales')
    choice.add_argument('--cargar',action='store_true',help='Escribe en NUBE; requiere confirmación explícita')
    choice.add_argument('--verificar',action='store_true',help='Solo lectura y verificación de NUBE')
    ap.add_argument('--confirmar',help='Para cargar: CARGAR-COMMUNITY360')
    args=ap.parse_args()
    consent,docs=evaluar_salida()
    print('VALIDACIÓN LOCAL: 8 tablas, 1068 usuarios, 897 ubicaciones, 207 documentos, 793 en cuarentena. OK.')
    if args.preparar:
        print('SIN EFECTOS EN LA NUBE. Revisa datos/depurados antes de autorizar.');return
    if args.cargar and args.confirmar!='CARGAR-COMMUNITY360':
        raise RuntimeError('Operación de escritura bloqueada. Requiere --confirmar CARGAR-COMMUNITY360.')
    driver,url,key=cargar_env()
    print('CONECTANDO a Turso (controlador:',driver,') y Firebase project:',os.environ['FIREBASE_PROJECT_ID'])
    conn=conectar_turso(driver,url)
    try:
        fdb=conectar_firebase(key)
        if args.cargar:
            print('AVISO: vas a CREAR TABLAS E INSERTAR REGISTROS en TUS servicios reales.')
            sql_result=cargar_sql(conn)
            cargar_firestore(fdb,docs)
        else:
            sql_result=verificar_sql(conn)
        firestore_result=verificar_firestore(fdb,consent,docs)
        result={'estado':'VERIFICADO_REMOTO','firebase_project_id':os.environ['FIREBASE_PROJECT_ID'],
                'firestore_database_id':os.environ.get('FIRESTORE_DATABASE_ID','(default)'),
                'turso_driver':driver, 'turso':sql_result,'firestore':firestore_result,
                'fecha_utc':datetime.now(timezone.utc).isoformat()}
        path=OUT/'verificacion_nube.json'
        path.write_text(json.dumps(result,indent=2,ensure_ascii=False)+'\n',encoding='utf-8')
        print('ÉXITO: verificación de Turso y Firestore terminada. Archivo:',path)
    finally:conn.close()

if __name__=='__main__':
    try:main()
    except Exception as exc:
        # No revelar .env ni tokens mediante traceback; imprimir error de operación solamente.
        print('ERROR:',str(exc),file=sys.stderr)
        sys.exit(1)
