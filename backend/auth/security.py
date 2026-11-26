
from datetime import datetime, timedelta, timezone

import jwt
from pwdlib import PasswordHash
from pwdlib.exceptions import PwdlibError
from backend.core.config import JWT_SECRET_KEY, JWT_ALGORITHM, TOKEN_MINUTES


password_hash = PasswordHash.recommended()

def generar_hash(password: str) -> str:
    return password_hash.hash(password)


def verificar_password(password: str, hash_guardado: str) -> bool:
    try:
        return password_hash.verify(password, hash_guardado)
    except (PwdlibError, ValueError, TypeError):
        return False


def validar_password_nueva(password: str) -> None:
    if not 8 <= len(password) <= 14:
        raise ValueError("La nueva contraseña debe tener entre 8 y 14 caracteres.")


def crear_token(id_cuenta: int, token_version: int) -> str:
    ahora = datetime.now(timezone.utc)

    datos = {
        "sub": str(id_cuenta),
        "ver": token_version,
        "iat": ahora,
        "exp": ahora + timedelta(minutes=TOKEN_MINUTES)
    }

    return jwt.encode(
        datos,
        JWT_SECRET_KEY,
        algorithm=JWT_ALGORITHM
    )


def verificar_token(token: str) -> dict:
    try:
        datos = jwt.decode(
            token,
            JWT_SECRET_KEY,
            algorithms=[JWT_ALGORITHM],
            options={"require": ["sub", "ver", "iat", "exp"]}
        )

        if (
            not isinstance(datos["sub"], str)
            or not datos["sub"].isdigit()
            or not datos["sub"].isascii()
            or len(datos["sub"]) > 19
            or not 0 < int(datos["sub"]) < 2**63
            or type(datos["ver"]) is not int
            or datos["ver"] < 0
        ):
            raise ValueError("Token inválido")

        return datos

    except (jwt.InvalidTokenError, ValueError, TypeError):
        raise ValueError("Token inválido o expirado")
