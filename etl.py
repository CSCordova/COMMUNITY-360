"""COMMUNITY 360: ETL reproducible LOCAL de Fase 2.

Uso: python etl.py
Requiere: Python 3.11+, tzdata en Windows para validar zonas horarias.
No se conecta a Turso ni a Firebase. No modifica los archivos originales.
"""
from __future__ import annotations
import argparse
import csv
from collections import Counter, defaultdict
from datetime import datetime, timezone
import hashlib
import json
import math
from pathlib import Path
import re
import sqlite3
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

ROOT = Path(__file__).resolve().parent
U_FILE = ROOT / 'datos/originales/comunidad_virtual_usuarios.csv'
I_FILE = ROOT / 'datos/originales/comunidad_virtual_interacciones_1000.csv'
OUT = ROOT / 'datos/depurados'
SCHEMA = ROOT / 'sql/esquema_turso.sql'
U_FIELDS = ['id_usuario','alias','fecha_ingreso','pais','estado','ciudad','latitud','longitud','zona_horaria',
 'rango_edad','especie_fursona','interes_principal','plataforma_principal','es_artista','mensajes_30d',
 'reacciones_30d','eventos_asistidos','comisiones_compradas','sentimiento_promedio','ultima_actividad',
 'estatus','consentimiento_datos']
I_FIELDS = ['id_interaccion','id_usuario','timestamp','canal','tipo','texto','tema','sentimiento','idioma',
 'pais','estado','ciudad','dispositivo','longitud_texto','reacciones_recibidas','etiquetas']
CATS = {
 'cat_estatus': ('estatus', 'id_estatus','nombre_estatus'),
 'cat_rangos_edad': ('rango_edad','id_rango_edad','nombre_rango'),
 'cat_especies_fursona': ('especie_fursona','id_especie','nombre_especie'),
 'cat_intereses': ('interes_principal','id_interes','nombre_interes'),
 'cat_plataformas': ('plataforma_principal','id_plataforma','nombre_plataforma'),
}
U_COLS = ['id_usuario','alias','fecha_ingreso','id_rango_edad','id_especie','id_interes','id_plataforma',
 'es_artista','mensajes_30d','reacciones_30d','eventos_asistidos','comisiones_compradas',
 'sentimiento_promedio','ultima_actividad','id_estatus','consentimiento_datos']
G_COLS = ['id_usuario','id_localidad','latitud','longitud']
I_COLS = ['id_interaccion','id_usuario','timestamp','canal','tipo','texto','tema','sentimiento','idioma',
 'pais','estado','ciudad','dispositivo','longitud_texto','reacciones_recibidas','etiquetas']
GEO_U = ['pais','estado','ciudad','latitud','longitud','zona_horaria']
GEO_I = ['pais','estado','ciudad']
INT_COLS = ['es_artista','mensajes_30d','reacciones_30d','eventos_asistidos','comisiones_compradas']
TIPOS = {'mensaje','comentario','reaccion','respuesta_encuesta','rsvp_evento'}


def sha256(path: Path):
    h=hashlib.sha256()
    with path.open('rb') as file:
        for b in iter(lambda: file.read(65536), b''): h.update(b)
    return h.hexdigest()


def norm(s):
    if s is None: return None
    s=str(s).strip()
    return None if not s or s.casefold() in {'null','none','nan','n/a'} else s


def read_csv(path: Path, required: list[str]):
    with path.open('r',encoding='utf-8-sig',newline='') as f:
        rd=csv.DictReader(f)
        if rd.fieldnames != required:
            raise ValueError(f'Columnas inesperadas en {path.name}: {rd.fieldnames}')
        return [dict({k:norm(v) for k,v in r.items()}, _linea=i) for i,r in enumerate(rd, start=2)]


def strict_int(value, name):
    if value is None or not re.fullmatch(r'[+-]?\d+',str(value)):
        raise ValueError(name+':entero_invalido')
    number=int(value)
    if not -(2**63)<=number<2**63:
        raise ValueError(name+':fuera_de_rango_SQLite')
    return number


def strict_float(value,name,lo=None,hi=None):
    if value is None: raise ValueError(name+':numero_faltante')
    try: number=float(value)
    except (TypeError,ValueError): raise ValueError(name+':numero_invalido') from None
    if not math.isfinite(number): raise ValueError(name+':no_finito')
    if lo is not None and number<lo or hi is not None and number>hi:
        raise ValueError(name+':fuera_de_rango')
    return number


def fecha(v):
    if not v: raise ValueError('fecha_obligatoria_vacia')
    try:return datetime.strptime(v,'%d/%m/%Y').date().isoformat()
    except ValueError: raise ValueError('fecha_invalida') from None


def utc(v):
    if not v: raise ValueError('timestamp_vacio')
    try:dt=datetime.fromisoformat(v.replace('Z','+00:00'))
    except ValueError: raise ValueError('timestamp_invalido') from None
    if dt.tzinfo is None: raise ValueError('timestamp_sin_zona_horaria')
    return dt.astimezone(timezone.utc).isoformat().replace('+00:00','Z')


def eliminar_duplicados(records, key, reject, stats, nombre):
    """Mismo ID + contenidos idénticos: conservar primera; contenidos distintos: aislar todos."""
    groups=defaultdict(list)
    for r in records: groups[(r.get(key) or '').upper()].append(r)
    out=[]
    for value, group in groups.items():
        distinct={json.dumps({k:v for k,v in r.items() if k!='_linea'},ensure_ascii=False,sort_keys=True) for r in group}
        if len(distinct)>1:
            for r in group: reject.append({'linea':r['_linea'],key:r.get(key),'motivo':'id_repetido_con_datos_distintos'})
            stats[nombre+'_id_conflictivo']+=len(group)
        else:
            first=group[0].copy();first[key]=value;out.append(first)
            for r in group[1:]: reject.append({'linea':r['_linea'],key:r.get(key),'motivo':'registro_duplicado_identico'})
            stats[nombre+'_id_duplicado']+=max(0,len(group)-1)
    return out


def export_csv(path, fieldnames, rows):
    with path.open('w',encoding='utf-8-sig',newline='') as f:
        w=csv.DictWriter(f,fieldnames=fieldnames,extrasaction='ignore')
        w.writeheader();w.writerows(rows)


def generar_bd_local(folder):
    dest=folder/'comprobacion_local.sqlite'
    if dest.exists(): dest.unlink()  # SOLO la copia local regenerada; nunca una base remota.
    cn=sqlite3.connect(dest)
    try:
        cn.execute('PRAGMA foreign_keys = ON')
        if cn.execute('PRAGMA foreign_keys').fetchone()[0]!=1:raise RuntimeError('FK no habilitadas')
        cn.executescript(SCHEMA.read_text(encoding='utf-8'))
        tablas=list(CATS)+['cat_localidades','usuarios','ubicaciones_usuario']
        for table in tablas:
            with (folder/f'{table}.csv').open(encoding='utf-8-sig',newline='') as f:
                rd=csv.DictReader(f)
                names=rd.fieldnames
                if not names:raise ValueError(table+' sin encabezados')
                for row in rd:
                    vals=[]
                    for col in names:
                        v=row[col]
                        if v=='':vals.append(None)
                        elif col in {'id_estatus','id_rango_edad','id_especie','id_interes','id_plataforma','id_localidad','es_artista','mensajes_30d','reacciones_30d','eventos_asistidos','comisiones_compradas'}:vals.append(int(v))
                        elif col in {'sentimiento_promedio','latitud','longitud'}: vals.append(float(v))
                        else: vals.append(v)
                    marks=','.join('?' for _ in names)
                    cn.execute(f'INSERT INTO {table} ({",".join(names)}) VALUES ({marks})',vals)
        cn.commit()
        count_fk=len(cn.execute('PRAGMA foreign_key_check').fetchall())
        count_geo=cn.execute("SELECT COUNT(*) FROM ubicaciones_usuario l JOIN usuarios u USING(id_usuario) WHERE u.consentimiento_datos <> 'si'").fetchone()[0]
        if count_fk or count_geo: raise AssertionError(f'FK={count_fk}; geo={count_geo}')
        counts={t:cn.execute(f'SELECT COUNT(*) FROM {t}').fetchone()[0] for t in tablas}
        return counts,count_fk,count_geo
    finally:cn.close()


def run(input_users=U_FILE,input_inter=I_FILE,output=OUT):
    output.mkdir(parents=True,exist_ok=True)
    print('COMMUNITY 360 | ETL LOCAL | sin conexiones cloud')
    orig_u=read_csv(input_users,U_FIELDS); orig_i=read_csv(input_inter,I_FIELDS)
    stats=Counter()
    rejected_u=[];rejected_i=[]
    print('[1/8] Identificar duplicados y alias repetidos')
    u=eliminar_duplicados(orig_u,'id_usuario',rejected_u,stats,'usuarios')
    i=eliminar_duplicados(orig_i,'id_interaccion',rejected_i,stats,'interacciones')
    aliases=Counter((r.get('alias') or '').casefold() for r in u)
    stats['alias_repetidos_adicionales']=sum(n-1 for n in aliases.values() if n>1)
    # Alias NO es UNIQUE en Fase 1: se reportan coincidencias, no se borran perfiles distintos.
    print('[2/8] Medir nulos sin asumir que todos son errores')
    stats['usuarios_latitud_nula']=sum(r['latitud'] is None for r in orig_u)
    stats['usuarios_longitud_nula']=sum(r['longitud'] is None for r in orig_u)
    stats['interacciones_texto_nulo']=sum(r['texto'] is None for r in orig_i)
    stats['interacciones_etiquetas_nulas']=sum(r['etiquetas'] is None for r in orig_i)
    stats['interacciones_pais_nulo']=sum(r['pais'] is None for r in orig_i)
    print('[3/8 y 4/8] Estandarizar fechas, categorías y validar tipos')
    cleaned=[]
    for r in u:
        try:
            idu=r['id_usuario']
            if idu is None or not re.fullmatch(r'U\d{6}',idu):raise ValueError('id_usuario_invalido')
            if not r['alias']:raise ValueError('alias_vacio')
            d={k:r.get(k) for k in U_FIELDS}
            d['fecha_ingreso']=fecha(r['fecha_ingreso'])
            d['ultima_actividad']=fecha(r['ultima_actividad'])
            d['estatus']=(r['estatus'] or '').lower()
            d['consentimiento_datos']=(r['consentimiento_datos'] or '').lower()
            if d['estatus'] not in {'activo','inactivo','en_riesgo'}:raise ValueError('estatus_invalido')
            if d['consentimiento_datos'] not in {'si','no'}:raise ValueError('consentimiento_invalido')
            for name in ('rango_edad','especie_fursona','interes_principal','plataforma_principal'):
                if not d[name]:raise ValueError(name+':categoria_vacia')
            for name in INT_COLS:
                d[name]=strict_int(r[name],name)
                if name=='es_artista' and d[name] not in (0,1):raise ValueError('es_artista_invalido')
                if name!='es_artista' and d[name]<0:raise ValueError(name+':negativo')
            d['sentimiento_promedio']=strict_float(r['sentimiento_promedio'],'sentimiento_promedio',-1,1)
            if d['consentimiento_datos']=='no':
                stats['usuarios_sin_consentimiento']+=1
                stats['celdas_geograficas_suprimidas']+=sum(d[k] is not None for k in GEO_U)
                for k in GEO_U:d[k]=None
            else:
                if any(not d[k] for k in ('pais','estado','ciudad','zona_horaria')):
                    raise ValueError('localidad_incompleta')
                try:ZoneInfo(d['zona_horaria'])
                except ZoneInfoNotFoundError:raise ValueError('zona_horaria_invalida') from None
                if (d['latitud'] is None)!=(d['longitud'] is None):
                    raise ValueError('coordenadas_incompletas')
                if d['latitud'] is not None:
                    d['latitud']=strict_float(d['latitud'],'latitud',-90,90)
                    d['longitud']=strict_float(d['longitud'],'longitud',-180,180)
            cleaned.append(d)
        except (ValueError,TypeError) as ex:
            rejected_u.append({'linea':r['_linea'],'id_usuario':r.get('id_usuario'),'motivo':str(ex)})

    print('[5/8] Construir catálogos y validar integridad referencial')
    cats={};catlookup={}
    for tab,(source,idname,valname) in CATS.items():
        values=sorted({r[source] for r in cleaned},key=lambda x:x.casefold())
        cats[tab]=[{idname:n,valname:v} for n,v in enumerate(values,1)]
        catlookup[tab]={v:n for n,v in enumerate(values,1)}
    allowed=[r for r in cleaned if r['consentimiento_datos']=='si']
    locations=sorted({(r['pais'],r['estado'],r['ciudad'],r['zona_horaria']) for r in allowed})
    byplace={}
    for loc in locations:
        if loc[:3] in byplace and byplace[loc[:3]]!=loc[3]:
            raise ValueError('Localidad contradictoria: misma región con dos zonas horarias')
        byplace[loc[:3]]=loc[3]
    loc_rows=[dict(id_localidad=n,pais=p,estado=e,ciudad=c,zona_horaria=z) for n,(p,e,c,z) in enumerate(locations,1)]
    loc_ids={v:n for n,v in enumerate(locations,1)}
    userrows=[];georows=[]
    for r in cleaned:
        row={'id_usuario':r['id_usuario'],'alias':r['alias'],'fecha_ingreso':r['fecha_ingreso']}
        for cat,(src,idname,_) in CATS.items():row[idname]=catlookup[cat][r[src]]
        for col in U_COLS:
            if col not in row:row[col]=r[col]
        userrows.append(row)
        if r['consentimiento_datos']=='si':
            georows.append(dict(id_usuario=r['id_usuario'],id_localidad=loc_ids[tuple(r[k] for k in ('pais','estado','ciudad','zona_horaria'))],
                                latitud=r['latitud'],longitud=r['longitud']))
    users={r['id_usuario']:r for r in cleaned}
    validrows=[];documents=[]
    for r in i:
        try:
            idi=r['id_interaccion']
            if idi is None or not re.fullmatch(r'I\d{7}',idi):raise ValueError('id_interaccion_invalido')
            if r.get('id_usuario') not in users:raise ValueError('usuario_no_existe_en_padron')
            if any(r.get(k) is None for k in ('canal','tipo','tema','idioma','dispositivo')):
                raise ValueError('atributo_obligatorio_vacio')
            tipo=r['tipo'].lower()
            if tipo not in TIPOS: raise ValueError('tipo_interaccion_invalido')
            sent=strict_float(r['sentimiento'],'sentimiento',-1,1)
            n_reac=strict_int(r['reacciones_recibidas'],'reacciones_recibidas')
            n_largo=strict_int(r['longitud_texto'],'longitud_texto')
            if n_reac<0 or n_largo<0:raise ValueError('contador_negativo')
            text=r['texto']
            if text is None and tipo!='reaccion':raise ValueError('texto_requerido')
            if text is not None and len(text)!=n_largo:raise ValueError('longitud_texto_inconsistente')
            if text is None and n_largo!=0:stats['reacciones_sin_texto_con_longitud_informada']+=1
            # No modificar n_largo de reacciones sin texto: el significado no está confirmado.
            labels=[];seen=set()
            for part in (r['etiquetas'] or '').split('|'):
                lab=part.strip()
                if lab and lab.casefold() not in seen:labels.append(lab);seen.add(lab.casefold())
            obj={'id_interaccion':idi,'id_usuario':r['id_usuario'],'timestamp':utc(r['timestamp']),
                 'canal':r['canal'],'tipo':tipo,'texto':text,'tema':r['tema'],'sentimiento':sent,
                 'idioma':r['idioma'],'dispositivo':r['dispositivo'],
                 'longitud_texto':n_largo,'reacciones_recibidas':n_reac,'etiquetas':labels}
            cons=users[r['id_usuario']]['consentimiento_datos']
            if cons=='si' and all(r[k] for k in GEO_I):obj['ubicacion']={k:r[k] for k in GEO_I}
            if cons=='no':stats['interacciones_sin_consentimiento']+=1
            documents.append(obj)
            flat={**obj,'pais':None,'estado':None,'ciudad':None,'etiquetas':json.dumps(labels,ensure_ascii=False)}
            if 'ubicacion' in obj:flat.update(obj['ubicacion'])
            validrows.append(flat)
        except (ValueError,TypeError) as ex:
            rejected_i.append({'linea':r['_linea'],'id_interaccion':r.get('id_interaccion'),
                               'id_usuario':r.get('id_usuario'),'motivo':str(ex)})
    print('[6/8] Verificar privacidad: no escribir ubicación sin consentimiento')
    for doc in documents:
        if users[doc['id_usuario']]['consentimiento_datos']=='no' and 'ubicacion' in doc:
            raise AssertionError('Privacidad incumplida')

    print('[7/8] Exportar ocho tablas SQL, CSV/JSONL de interacciones y cuarentenas')
    for tab,rows in cats.items():
        _,idc,nc=CATS[tab];export_csv(output/f'{tab}.csv',[idc,nc],rows)
    export_csv(output/'cat_localidades.csv',['id_localidad','pais','estado','ciudad','zona_horaria'],loc_rows)
    export_csv(output/'usuarios.csv',U_COLS,userrows)
    export_csv(output/'ubicaciones_usuario.csv',G_COLS,georows)
    export_csv(output/'interacciones_validas.csv',I_COLS,validrows)
    with (output/'interacciones_firestore.jsonl').open('w',encoding='utf-8') as f:
        for doc in documents:f.write(json.dumps(doc,ensure_ascii=False)+'\n')
    export_csv(output/'usuarios_rechazados.csv',['linea','id_usuario','motivo'],rejected_u)
    export_csv(output/'interacciones_cuarentena.csv',['linea','id_interaccion','id_usuario','motivo'],rejected_i)
    print('[8/8] Comprobación SQLite local; carga cloud separada en cargar_nube.py')
    counts,fks,private=generar_bd_local(output)
    audit={'csv_originales':{'usuarios':len(orig_u),'interacciones':len(orig_i)},
           'resultado_local':{'usuarios_aceptados':len(userrows),'usuarios_cuarentena':len(rejected_u),
           'interacciones_aceptadas':len(documents),'interacciones_cuarentena':len(rejected_i),
           'huerfanas':sum(r['motivo']=='usuario_no_existe_en_padron' for r in rejected_i),
           'ubicaciones_autorizadas':len(georows),'localidades':len(loc_rows),
           'fk_incorrectas':fks,'ubicaciones_sin_consentimiento':private,'tablas_SQL':counts},
           'observaciones':dict(stats),'nube':'NO_EJECUTADA'}
    (output/'auditoria.json').write_text(json.dumps(audit,indent=2,ensure_ascii=False)+'\n',encoding='utf-8')
    manifest={'origen':{p.name:sha256(p) for p in (input_users,input_inter)},
              'salidas':{p.name:sha256(p) for p in sorted(output.glob('*.csv'))}}
    (output/'manifiesto_sha256.json').write_text(json.dumps(manifest,indent=2,ensure_ascii=False)+'\n',encoding='utf-8')
    brief='\n'.join(['COMMUNITY 360 - EJECUCIÓN LOCAL']+[f'{k}: {v}' for k,v in audit['resultado_local'].items() if k!='tablas_SQL']+
          ['CARGA REMOTA: NO EJECUTADA'])+'\n'
    (output/'ejecucion.log').write_text(brief,encoding='utf-8')
    print(brief)
    return audit

if __name__=='__main__':
    parser=argparse.ArgumentParser(description='ETL local COMMUNITY 360')
    parser.add_argument('--usuarios',type=Path,default=U_FILE)
    parser.add_argument('--interacciones',type=Path,default=I_FILE)
    parser.add_argument('--salida',type=Path,default=OUT)
    args=parser.parse_args()
    run(args.usuarios,args.interacciones,args.salida)
