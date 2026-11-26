"""Cambio verificado en Turso; nunca acepta contraseñas en argumentos o archivos."""
from backend.auth.accounts import cambiar_password
from backend.auth.terminal import leer_secreto
from backend.database.turso import conectar_turso


def main():
    print("COMMUNITY 360 | Cambio de contraseña y revocación de todas las sesiones")
    print("Esta operación modifica únicamente la cuenta indicada en Turso.")
    usuario = input("Usuario de la cuenta: ").strip()
    actual = leer_secreto("Contraseña actual (oculta): ")
    nueva = leer_secreto("Nueva contraseña, de 8 a 12 caracteres (oculta): ")
    if nueva != leer_secreto("Confirmar nueva contraseña (oculta): "):
        raise ValueError("Las contraseñas nuevas no coinciden.")
    with conectar_turso() as db:
        resultado = cambiar_password(db, usuario, actual, nueva)
    print("Cambio verificado: la nueva contraseña funciona y la anterior fue rechazada.")
    print("Se incrementó token_version. Todos los tokens anteriores quedaron revocados.")
    print("ID de cuenta:", resultado["id_cuenta"])


if __name__ == "__main__":
    try:
        main()
    except (ValueError, RuntimeError) as exc:
        print(str(exc) if isinstance(exc, ValueError) else "No se pudo confirmar la operación. Comprueba el acceso antes de repetir.")
        raise SystemExit(1)
    except (KeyboardInterrupt, EOFError):
        print("\nOperación cancelada.")
        raise SystemExit(1)
