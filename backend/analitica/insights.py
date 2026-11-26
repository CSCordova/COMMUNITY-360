"""Public aggregate views; no individual geography leaves this module."""


def agrupar_territorio(usuarios, interacciones, minimo=5):
    grupos = {}
    ciudad_usuario = {}
    for usuario in usuarios:
        key = (usuario['pais'], usuario['estado'], usuario['ciudad'])
        grupo = grupos.setdefault(key, {'miembros': set(), 'coordenadas': {}, 'interacciones': 0, 'participantes': set()})
        grupo['miembros'].add(usuario['id_usuario'])
        ciudad_usuario[usuario['id_usuario']] = key
        if usuario['latitud'] is not None and usuario['longitud'] is not None:
            grupo['coordenadas'][usuario['id_usuario']] = (usuario['latitud'], usuario['longitud'])
    for dato in interacciones:
        key = ciudad_usuario.get(dato['id_usuario'])
        if key is not None:
            grupos[key]['interacciones'] += 1
            grupos[key]['participantes'].add(dato['id_usuario'])
    resultado = []
    for (pais, estado, ciudad), grupo in grupos.items():
        if len(grupo['miembros']) < minimo:
            continue
        coords = list(grupo['coordenadas'].values())
        # At least five contributors even to the approximate marker coordinate.
        lat = round(sum(p[0] for p in coords) / len(coords), 1) if len(coords) >= minimo else None
        lon = round(sum(p[1] for p in coords) / len(coords), 1) if len(coords) >= minimo else None
        actividad_publicable = len(grupo['participantes']) >= minimo
        resultado.append({'pais': pais, 'estado': estado, 'ciudad': ciudad, 'miembros': len(grupo['miembros']),
                          'latitud': lat, 'longitud': lon,
                          'interacciones': grupo['interacciones'] if actividad_publicable else None,
                          'participantes': len(grupo['participantes']) if actividad_publicable else None})
    return {'fuente': 'turso_y_firestore', 'minimo_grupo': minimo, 'precision_coordenadas': '0.1 grados',
            'ciudades': sorted(resultado, key=lambda row: (-(row['interacciones'] or 0), -row['miembros'], row['ciudad']))}
