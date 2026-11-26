-- COMMUNITY 360 · Fase 2 · Turso/libSQL (SQLite compatible)
-- Tablas y relaciones aprobadas en Fase 1. Sin DROP ni DELETE.
-- La conexión debe activar y comprobar PRAGMA foreign_keys = ON.

CREATE TABLE IF NOT EXISTS cat_estatus (
  id_estatus INTEGER PRIMARY KEY,
  nombre_estatus TEXT NOT NULL UNIQUE
);
CREATE TABLE IF NOT EXISTS cat_rangos_edad (
  id_rango_edad INTEGER PRIMARY KEY,
  nombre_rango TEXT NOT NULL UNIQUE
);
CREATE TABLE IF NOT EXISTS cat_especies_fursona (
  id_especie INTEGER PRIMARY KEY,
  nombre_especie TEXT NOT NULL UNIQUE
);
CREATE TABLE IF NOT EXISTS cat_intereses (
  id_interes INTEGER PRIMARY KEY,
  nombre_interes TEXT NOT NULL UNIQUE
);
CREATE TABLE IF NOT EXISTS cat_plataformas (
  id_plataforma INTEGER PRIMARY KEY,
  nombre_plataforma TEXT NOT NULL UNIQUE
);
CREATE TABLE IF NOT EXISTS cat_localidades (
  id_localidad INTEGER PRIMARY KEY,
  pais TEXT NOT NULL,
  estado TEXT NOT NULL,
  ciudad TEXT NOT NULL,
  zona_horaria TEXT NOT NULL,
  UNIQUE (pais, estado, ciudad)
);
CREATE TABLE IF NOT EXISTS usuarios (
  id_usuario TEXT PRIMARY KEY,
  alias TEXT NOT NULL,
  fecha_ingreso TEXT NOT NULL,
  id_rango_edad INTEGER NOT NULL REFERENCES cat_rangos_edad(id_rango_edad) ON DELETE RESTRICT,
  id_especie INTEGER NOT NULL REFERENCES cat_especies_fursona(id_especie) ON DELETE RESTRICT,
  id_interes INTEGER NOT NULL REFERENCES cat_intereses(id_interes) ON DELETE RESTRICT,
  id_plataforma INTEGER NOT NULL REFERENCES cat_plataformas(id_plataforma) ON DELETE RESTRICT,
  es_artista INTEGER NOT NULL CHECK (typeof(es_artista)='integer' AND es_artista IN (0,1)),
  mensajes_30d INTEGER NOT NULL CHECK (typeof(mensajes_30d)='integer' AND mensajes_30d>=0),
  reacciones_30d INTEGER NOT NULL CHECK (typeof(reacciones_30d)='integer' AND reacciones_30d>=0),
  eventos_asistidos INTEGER NOT NULL CHECK (typeof(eventos_asistidos)='integer' AND eventos_asistidos>=0),
  comisiones_compradas INTEGER NOT NULL CHECK (typeof(comisiones_compradas)='integer' AND comisiones_compradas>=0),
  sentimiento_promedio REAL NOT NULL CHECK (sentimiento_promedio BETWEEN -1 AND 1),
  ultima_actividad TEXT NOT NULL,
  id_estatus INTEGER NOT NULL REFERENCES cat_estatus(id_estatus) ON DELETE RESTRICT,
  consentimiento_datos TEXT NOT NULL CHECK (consentimiento_datos IN ('si','no'))
);
CREATE TABLE IF NOT EXISTS ubicaciones_usuario (
  id_usuario TEXT PRIMARY KEY REFERENCES usuarios(id_usuario) ON DELETE CASCADE,
  id_localidad INTEGER NOT NULL REFERENCES cat_localidades(id_localidad) ON DELETE RESTRICT,
  latitud REAL CHECK (latitud IS NULL OR latitud BETWEEN -90 AND 90),
  longitud REAL CHECK (longitud IS NULL OR longitud BETWEEN -180 AND 180),
  CHECK ((latitud IS NULL AND longitud IS NULL) OR (latitud IS NOT NULL AND longitud IS NOT NULL))
);

CREATE TRIGGER IF NOT EXISTS trg_ubicacion_insert_autorizado
BEFORE INSERT ON ubicaciones_usuario
WHEN COALESCE((SELECT consentimiento_datos FROM usuarios WHERE id_usuario=NEW.id_usuario), 'no') <> 'si'
BEGIN SELECT RAISE(ABORT, 'ubicacion_sin_consentimiento'); END;
CREATE TRIGGER IF NOT EXISTS trg_ubicacion_update_autorizado
BEFORE UPDATE ON ubicaciones_usuario
WHEN COALESCE((SELECT consentimiento_datos FROM usuarios WHERE id_usuario=NEW.id_usuario), 'no') <> 'si'
BEGIN SELECT RAISE(ABORT, 'ubicacion_sin_consentimiento'); END;
CREATE TRIGGER IF NOT EXISTS trg_rechazar_revocacion_con_ubicacion
BEFORE UPDATE OF consentimiento_datos ON usuarios
WHEN NEW.consentimiento_datos = 'no' AND
     EXISTS (SELECT 1 FROM ubicaciones_usuario WHERE id_usuario=NEW.id_usuario)
BEGIN SELECT RAISE(ABORT, 'retirar_ubicacion_antes_de_revocar'); END;

CREATE INDEX IF NOT EXISTS idx_usuarios_estatus ON usuarios(id_estatus);
CREATE INDEX IF NOT EXISTS idx_usuarios_plataforma ON usuarios(id_plataforma);
CREATE INDEX IF NOT EXISTS idx_ubicaciones_localidad ON ubicaciones_usuario(id_localidad);
