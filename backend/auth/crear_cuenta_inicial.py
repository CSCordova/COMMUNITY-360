
from backend.auth.terminal import leer_secreto

from backend.database.turso import conectar_turso
from backend.auth.security import generar_hash, validar_password_nueva


def main():
    print("COMMUNITY 360 - Crear cuenta inicial")

    usuario = input("Nombre de usuario: ").strip()

    if not 4 <= len(usuario) <= 32:
        print("El usuario debe tener entre 4 y 32 caracteres.")
        return

    password = leer_secreto("Contraseña, de 8 a 12 caracteres (oculta): ")
    confirmar = leer_secreto("Confirmar contraseña (oculta): ")

    try:
        validar_password_nueva(password)
    except ValueError as exc:
        print(str(exc))
        return

    if password != confirmar:
        print("Las contraseñas no coinciden.")
        return

    with conectar_turso() as db:
        existente = db.execute(
            """
            SELECT id_cuenta
            FROM cuentas_acceso
            WHERE usuario = ?
            """,
            (usuario,)
        ).fetchone()

        if existente:
            print("Este usuario ya existe.")
            return

        hash_seguro = generar_hash(password)

        db.execute(
            """
            INSERT INTO cuentas_acceso
            (usuario, password_hash, activo)
            VALUES (?, ?, 1)
            """,
            (usuario, hash_seguro)
        )

        cuenta = db.execute(
            """
            SELECT id_cuenta, usuario, activo
            FROM cuentas_acceso
            WHERE usuario = ?
            """,
            (usuario,)
        ).fetchone()

        if not cuenta:
            raise RuntimeError(
                "No se pudo verificar la cuenta en Turso."
            )

        print("\nCUENTA CREADA CORRECTAMENTE")
        print("ID:", cuenta[0])
        print("Usuario:", cuenta[1])
        print("Activo:", cuenta[2])


if __name__ == "__main__":
    main()
