"""Operaciones reutilizables por las rutas y las herramientas locales."""
from backend.auth.security import generar_hash, validar_password_nueva, verificar_password


def buscar_cuenta(db, usuario):
    return db.execute(
        """SELECT id_cuenta, usuario, password_hash, activo, token_version
           FROM cuentas_acceso WHERE usuario = ?""", (usuario.strip(),)
    ).fetchone()


def cambiar_password(db, usuario, actual, nueva):
    validar_password_nueva(nueva)
    cuenta = buscar_cuenta(db, usuario)
    if not cuenta or cuenta[3] != 1 or not verificar_password(actual, cuenta[2]):
        raise ValueError("No se pudo validar la cuenta y su contraseña actual.")
    if verificar_password(nueva, cuenta[2]):
        raise ValueError("La nueva contraseña debe ser diferente de la actual.")
    nuevo_hash = generar_hash(nueva)
    # Una sentencia atómica cambia hash y versión; evita sobrescribir cambios concurrentes.
    resultado = db.execute(
        """UPDATE cuentas_acceso
           SET password_hash = ?, token_version = token_version + 1
           WHERE id_cuenta = ? AND password_hash = ? AND token_version = ? AND activo = 1
           RETURNING id_cuenta, token_version""",
        (nuevo_hash, cuenta[0], cuenta[2], cuenta[4]),
    ).fetchone()
    if not resultado:
        raise ValueError("La cuenta cambió durante la operación. Vuelve a intentarlo.")
    comprobada = buscar_cuenta(db, usuario)
    if (not comprobada or comprobada[4] != resultado[1]
            or not verificar_password(nueva, comprobada[2])
            or verificar_password(actual, comprobada[2])):
        raise RuntimeError("No se pudo comprobar el cambio. Verifica el acceso antes de repetir.")
    return {"id_cuenta": resultado[0], "token_version": resultado[1]}
