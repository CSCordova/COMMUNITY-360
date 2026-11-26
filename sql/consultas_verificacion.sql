-- EJECUTAR EN TURSO DESPUÉS DE LA CARGA; SÓLO LECTURA.
SELECT COUNT(*) AS usuarios FROM usuarios;  -- 1068 esperados
SELECT COUNT(*) AS ubicaciones FROM ubicaciones_usuario; -- 897 esperados
SELECT COUNT(*) AS sin_consentimiento FROM usuarios WHERE consentimiento_datos='no'; -- 171
SELECT COUNT(*) AS ubicaciones_prohibidas
FROM ubicaciones_usuario l JOIN usuarios u USING (id_usuario)
WHERE u.consentimiento_datos = 'no'; -- 0
SELECT COUNT(*) AS localidades FROM cat_localidades; -- 21
SELECT COUNT(*) AS total_tablas FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'; -- 8 de padrón; 9 cuando existe cuentas_acceso
PRAGMA foreign_key_check; -- ninguna fila
