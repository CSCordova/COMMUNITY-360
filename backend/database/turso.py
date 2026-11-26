
import os
from contextlib import contextmanager

from backend.core import config  # Carga .env una sola vez en el servidor.
from turso_http import TursoHTTP, TursoHTTPError


@contextmanager
def conectar_turso():
    url = os.getenv("TURSO_DATABASE_URL")
    token = os.getenv("TURSO_AUTH_TOKEN")

    if not url or not token:
        raise TursoHTTPError(
            "Faltan las credenciales de Turso."
        )

    conexion = TursoHTTP(url, token)

    try:
        yield conexion
    finally:
        conexion.close()
