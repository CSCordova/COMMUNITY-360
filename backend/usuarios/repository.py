from backend.database.turso import conectar_turso
from datetime import date
from hashlib import sha256

PROYECCION = """
SELECT u.id_usuario,u.alias,u.fecha_ingreso,e.nombre_estatus AS estatus,
       r.nombre_rango AS rango_edad,f.nombre_especie AS especie_fursona,
       i.nombre_interes AS interes_principal,p.nombre_plataforma AS plataforma_principal,
       u.es_artista,u.mensajes_30d,u.reacciones_30d,u.eventos_asistidos,
       u.comisiones_compradas,u.sentimiento_promedio,u.ultima_actividad,u.consentimiento_datos,
       l.pais,l.estado,l.ciudad,l.zona_horaria,g.latitud,g.longitud
FROM usuarios u
JOIN cat_estatus e USING(id_estatus)
JOIN cat_rangos_edad r USING(id_rango_edad)
JOIN cat_especies_fursona f USING(id_especie)
JOIN cat_intereses i USING(id_interes)
JOIN cat_plataformas p USING(id_plataforma)
LEFT JOIN ubicaciones_usuario g ON g.id_usuario=u.id_usuario AND u.consentimiento_datos='si'
LEFT JOIN cat_localidades l ON l.id_localidad=g.id_localidad
"""
COLUMNAS = ("id_usuario alias fecha_ingreso estatus rango_edad especie_fursona interes_principal "
            "plataforma_principal es_artista mensajes_30d reacciones_30d eventos_asistidos "
            "comisiones_compradas sentimiento_promedio ultima_actividad consentimiento_datos "
            "pais estado ciudad zona_horaria latitud longitud").split()


def representar(fila):
    dato = dict(zip(COLUMNAS, fila))
    geo = {campo: dato.pop(campo) for campo in ("pais", "estado", "ciudad", "zona_horaria", "latitud", "longitud")}
    if dato["consentimiento_datos"] == "si" and geo["ciudad"]:
        dato["ubicacion"] = geo
    dato["es_artista"] = bool(dato["es_artista"])
    return dato


class UsuariosRepository:
    def listar(self, limite=25, desplazamiento=0, estatus=None):
        condicion = " WHERE e.nombre_estatus=?" if estatus else ""
        parametros = (estatus,) if estatus else ()
        with conectar_turso() as db:
            # Usar el mismo conjunto con JOIN para conteo y paginación.
            total = db.execute("SELECT COUNT(*) FROM (" + PROYECCION + condicion + ")", parametros).fetchone()[0]
            filas = db.execute(PROYECCION + condicion + " ORDER BY u.id_usuario LIMIT ? OFFSET ?",
                               (*parametros, limite, desplazamiento)).fetchall()
        return {"total": total, "limite": limite, "desplazamiento": desplazamiento,
                "items": [representar(fila) for fila in filas]}

    def obtener(self, id_usuario):
        with conectar_turso() as db:
            fila = db.execute(PROYECCION + " WHERE u.id_usuario=?", (id_usuario,)).fetchone()
        return representar(fila) if fila else None

    def consentimientos(self, ids):
        ids = sorted({valor for valor in ids if isinstance(valor, str)})
        resultado = {}
        if not ids:
            return resultado
        with conectar_turso() as db:
            for inicio in range(0, len(ids), 400):
                bloque = ids[inicio:inicio + 400]
                marcas = ",".join("?" for _ in bloque)
                filas = db.execute(f"SELECT id_usuario,consentimiento_datos FROM usuarios WHERE id_usuario IN ({marcas})", bloque).fetchall()
                resultado.update(dict(filas))
        return resultado

    def historico(self):
        with conectar_turso() as db:
            fila = db.execute("""SELECT COUNT(*),COALESCE(SUM(es_artista),0),
                COALESCE(SUM(mensajes_30d),0),COALESCE(SUM(reacciones_30d),0),
                COALESCE(SUM(eventos_asistidos),0),COALESCE(SUM(comisiones_compradas),0),
                AVG(sentimiento_promedio) FROM usuarios""").fetchone()
            resultado = dict(zip(("usuarios", "artistas", "mensajes_30d", "reacciones_30d",
                                  "eventos_asistidos", "comisiones_compradas", "sentimiento_promedio"), fila))
            for nombre, consulta in {
                "por_estatus": "SELECT e.nombre_estatus,COUNT(*) FROM usuarios u JOIN cat_estatus e USING(id_estatus) GROUP BY e.nombre_estatus ORDER BY e.nombre_estatus",
                "por_plataforma": "SELECT p.nombre_plataforma,COUNT(*) FROM usuarios u JOIN cat_plataformas p USING(id_plataforma) GROUP BY p.nombre_plataforma ORDER BY p.nombre_plataforma",
                "por_interes": "SELECT i.nombre_interes,COUNT(*) FROM usuarios u JOIN cat_intereses i USING(id_interes) GROUP BY i.nombre_interes ORDER BY i.nombre_interes",
                "por_rango_edad": "SELECT r.nombre_rango,COUNT(*) FROM usuarios u JOIN cat_rangos_edad r USING(id_rango_edad) GROUP BY r.nombre_rango ORDER BY r.nombre_rango",
                "por_especie": "SELECT f.nombre_especie,COUNT(*) FROM usuarios u JOIN cat_especies_fursona f USING(id_especie) GROUP BY f.nombre_especie ORDER BY f.nombre_especie",
            }.items():
                resultado[nombre] = [{"categoria": f[0], "total": f[1]} for f in db.execute(consulta).fetchall()]
        return {"fuente": "padron_historico_turso", "indicadores": resultado}

    def territorio_autorizado(self):
        with conectar_turso() as db:
            rows = db.execute('''SELECT u.id_usuario,l.pais,l.estado,l.ciudad,g.latitud,g.longitud
                FROM usuarios u JOIN ubicaciones_usuario g USING(id_usuario)
                JOIN cat_localidades l USING(id_localidad) WHERE u.consentimiento_datos='si' ''').fetchall()
        return [dict(zip(('id_usuario','pais','estado','ciudad','latitud','longitud'), row)) for row in rows]

    def participacion(self, estatus=None, orden='inactividad', limite=25, desplazamiento=0):
        condition = ' WHERE e.nombre_estatus=?' if estatus else ''
        params = (estatus,) if estatus else ()
        join = ' FROM usuarios u JOIN cat_estatus e USING(id_estatus)'
        order = "CASE e.nombre_estatus WHEN 'en_riesgo' THEN 0 WHEN 'inactivo' THEN 1 ELSE 2 END," if orden == 'estatus' else ''
        with conectar_turso() as db:
            corte = db.execute('SELECT MAX(ultima_actividad) FROM usuarios').fetchone()[0]
            total = db.execute('SELECT COUNT(*)' + join + condition, params).fetchone()[0]
            rows = db.execute('SELECT u.id_usuario,e.nombre_estatus,u.ultima_actividad,u.mensajes_30d' + join + condition
                              + ' ORDER BY ' + order + 'u.ultima_actividad,u.id_usuario LIMIT ? OFFSET ?',
                              (*params, limite, desplazamiento)).fetchall()
        return {'fuente': 'padron_historico_turso', 'fecha_corte': corte, 'total': total, 'limite': limite,
                'desplazamiento': desplazamiento, 'items': [
                    {'referencia': sha256(row[0].encode()).hexdigest()[:12], 'usuario': 'U***' + row[0][-3:],
                     'estatus': row[1], 'ultima_actividad': row[2], 'mensajes_30d': row[3],
                     'dias_sin_actividad': max(0, (date.fromisoformat(corte) - date.fromisoformat(row[2])).days)}
                    for row in rows]}


def obtener_usuarios_repository():
    return UsuariosRepository()
