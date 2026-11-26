from fastapi import Depends, HTTPException, Request
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from backend.auth.security import verificar_token
from backend.core.config import COOKIE_NAME
from backend.database.turso import conectar_turso

seguridad = HTTPBearer(auto_error=False)


def error_credenciales():
    return HTTPException(401, "Credenciales inválidas o sesión vencida.",
                         headers={"WWW-Authenticate": "Bearer"})


def validar_origen(request: Request):
    # SPA y API comparten origen, también detrás del proxy de Vite.
    # Postman puede omitir Origin; los navegadores lo envían en POST.
    origen = request.headers.get("origin")
    if origen and origen != str(request.base_url).rstrip("/"):
        raise HTTPException(403, "Origen no permitido.")


def obtener_cuenta(request: Request,
                   credenciales: HTTPAuthorizationCredentials | None = Depends(seguridad)):
    token = credenciales.credentials if credenciales else request.cookies.get(COOKIE_NAME)
    if request.headers.get("authorization") and credenciales is None:
        raise error_credenciales()
    if not token:
        raise error_credenciales()
    return autenticar_token(token)


def autenticar_token(token: str):
    """La misma validación de firma, expiración y revocación para HTTP y WebSocket."""
    try:
        payload = verificar_token(token)
    except ValueError:
        raise error_credenciales() from None
    with conectar_turso() as db:
        cuenta = db.execute(
            """SELECT id_cuenta, usuario, activo, token_version
               FROM cuentas_acceso WHERE id_cuenta = ?""", (int(payload["sub"]),)
        ).fetchone()
    if not cuenta or cuenta[2] != 1 or cuenta[3] != payload["ver"]:
        raise error_credenciales()
    return {"id_cuenta": cuenta[0], "usuario": cuenta[1], "token_version": cuenta[3]}
