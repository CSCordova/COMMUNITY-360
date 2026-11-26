"""Cliente SQL sobre HTTP (Hrana) para Turso, compatible con Python 3.14.

Implementa la pequeña interfaz que usa cargar_nube.py, no es un reemplazo general
para sqlite3. No envía credenciales a consola. Sin reintentos automáticos de escritura.

Protocolo oficial: https://github.com/tursodatabase/turso/blob/main/serverless/PROTOCOL.md
"""
from __future__ import annotations

from base64 import b64decode
from dataclasses import dataclass
import math
from urllib.parse import urlsplit

import requests


class TursoHTTPError(RuntimeError):
    pass


def _encode(value):
    if value is None:
        return {'type': 'null'}
    if isinstance(value, bool):
        raise ValueError('No se admiten bool como parámetros SQL; convierte antes a 0 o 1.')
    if isinstance(value, int):
        if not -(2**63) <= value <= 2**63 - 1:
            raise ValueError('Entero fuera de rango de SQLite (64 bits).')
        return {'type': 'integer', 'value': str(value)}
    if isinstance(value, float):
        if not math.isfinite(value):
            raise ValueError('No se permiten NaN ni infinitos en SQL.')
        return {'type': 'float', 'value': value}
    if isinstance(value, str):
        return {'type': 'text', 'value': value}
    if isinstance(value, bytes):
        import base64
        return {'type': 'blob', 'base64': base64.b64encode(value).decode('ascii')}
    raise TypeError(f'Tipo SQL no compatible: {type(value).__name__}')


def _decode(value):
    typ=value['type']
    if typ=='null':return None
    if typ=='integer':return int(value['value'])
    if typ=='float':return float(value['value'])
    if typ=='text':return value['value']
    if typ=='blob':
        import base64
        v=value['base64'];v+= '='*((-len(v))%4)
        return base64.b64decode(v)
    raise TursoHTTPError('Tipo de respuesta SQL desconocido: '+str(typ))


@dataclass
class Resultado:
    rows: list
    def fetchall(self):return self.rows
    def fetchone(self):return self.rows[0] if self.rows else None


class TursoHTTP:
    def __init__(self,url:str,token:str,session=None):
        if not token.strip():raise ValueError('Falta TURSO_AUTH_TOKEN.')
        u=urlsplit(url.strip())
        if u.scheme not in ('libsql','turso','https') or not u.hostname:
            raise ValueError('TURSO_DATABASE_URL debe iniciar con libsql://, turso:// o https://.')
        if u.username or u.password or u.query or u.fragment or (u.path not in ('','/')):
            raise ValueError('La URL de Turso debe contener únicamente el host de la base, sin parámetros ni credenciales.')
        if u.port and u.port!=443:
            raise ValueError('Solo se admite HTTPS en el puerto 443.')
        version='v3' if u.scheme=='turso' else 'v2'
        self.endpoint=f'https://{u.netloc}/{version}/pipeline'
        self.session=session or requests.Session()
        self.headers={'Authorization':'Bearer '+token,'Content-Type':'application/json'}
        self.closed=False

    def _request(self,requests_list):
        if self.closed:raise TursoHTTPError('La conexión HTTP está cerrada.')
        payload={'baton':None,'requests':requests_list + [{'type':'close'}]}
        try:
            response=self.session.post(self.endpoint,headers=self.headers,json=payload,timeout=45)
        except requests.RequestException as e:
            raise TursoHTTPError('Error de conexión a Turso. No se puede confirmar si se aplicaron cambios; verifica estado remoto antes de repetir.') from e
        if response.status_code != 200:
            # No imprimimos URL/token ni cuerpo de respuesta, que puede incluir detalles sensibles.
            raise TursoHTTPError(f'Error HTTP {response.status_code} de Turso. Verifica token, URL y tipo de base.')
        try: obj=response.json()
        except ValueError as e:raise TursoHTTPError('Turso devolvió JSON inválido.') from e
        results=obj.get('results')
        if not isinstance(results,list) or len(results)!=len(payload['requests']):
            raise TursoHTTPError('Respuesta HTTP inesperada del servidor Turso.')
        for item in results:
            if item.get('type')=='error':
                err=item.get('error',{})
                raise TursoHTTPError('Turso SQL: '+str(err.get('message','sin detalle'))[:300])
        return results[:-1]

    @staticmethod
    def _stmt(sql,params=(),want_rows=True):
        return {'sql':sql,'args':[_encode(x) for x in params],'want_rows':want_rows}

    def execute(self,sql,params=()):
        stmt=self._stmt(sql,params,True)
        data=self._request([
            {'type':'execute','stmt':{'sql':'PRAGMA foreign_keys = ON','want_rows':False}},
            {'type':'execute','stmt':stmt}
        ])
        output=data[1]['response']['result']
        rows=[[ _decode(v) for v in row ] for row in output.get('rows',[])]
        return Resultado(rows)

    def executemany(self, sql, rows):
        """INSERT de varios registros, con autocommit y comprobación remota.

        Esta implementación evita BEGIN/COMMIT condicionales en Hrana batch.
        Cada bloque se inserta mediante UNA sentencia INSERT ... VALUES (...),(...)
        que es atómica en SQLite. Si una verificación falla, detenerse y comprobar
        la base antes de reintentar; cargar_sql es reanudable por clave primaria.
        """
        import re

        m = re.fullmatch(
            r"\s*(INSERT\s+INTO\s+([A-Za-z_][A-Za-z_0-9]*)\s*"
            r"\([A-Za-z_0-9,\s]+\)\s*VALUES)\s*"
            r"\(\s*(\?(?:\s*,\s*\?)*)\s*\)\s*;?\s*",
            sql,flags=re.IGNORECASE,
        )
        if m is None:
            raise TursoHTTPError(
                "executemany() solo admite INSERT INTO tabla(columnas) VALUES (?,...)."
            )

        prefijo, tabla, marcadores = m.group(1), m.group(2), m.group(3)
        n_params = marcadores.count("?")
        pendientes = list(rows)
        for i, fila in enumerate(pendientes):
            if len(fila) != n_params:
                raise ValueError(f"Fila {i}: cantidad de parámetros incorrecta.")

        if not pendientes:
            return None

        anterior = int(self.execute(f"SELECT COUNT(*) FROM {tabla}").fetchone()[0])
        for inicio in range(0, len(pendientes), 20):
            bloque = pendientes[inicio:inicio + 20]
            multi_sql = prefijo + " " + ",".join(
                "(" + marcadores + ")" for _ in bloque
            )
            valores = [valor for fila in bloque for valor in fila]
            self.execute(multi_sql, valores)
            actual = int(self.execute(f"SELECT COUNT(*) FROM {tabla}").fetchone()[0])
            if actual != anterior + len(bloque):
                raise TursoHTTPError(
                    f"Turso no confirmó la persistencia en {tabla}: "
                    f"antes={anterior}, después={actual}, esperados={len(bloque)}. "
                    "No repitas la carga sin revisar los conteos remotos."
                )
            anterior = actual
        return None

    def commit(self):
        # execute() hace autocommit de sentencias individuales; executemany
        # efectúa COMMIT dentro de su lote transaccional de forma explícita.
        return None

    def close(self):
        self.closed=True
        self.session.close()
