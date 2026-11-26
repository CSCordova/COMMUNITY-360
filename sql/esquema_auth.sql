-- Tabla adicional de acceso. No modifica las ocho tablas del padrón.
CREATE TABLE IF NOT EXISTS cuentas_acceso (
    id_cuenta INTEGER PRIMARY KEY AUTOINCREMENT,
    usuario TEXT NOT NULL COLLATE NOCASE UNIQUE,
    password_hash TEXT NOT NULL,
    activo INTEGER NOT NULL DEFAULT 1 CHECK (activo IN (0, 1)),
    token_version INTEGER NOT NULL DEFAULT 0 CHECK (token_version >= 0),
    creado_en TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
