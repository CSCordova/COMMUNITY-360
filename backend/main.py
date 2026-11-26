from fastapi import Depends, FastAPI, Request, HTTPException, WebSocket
from fastapi.exceptions import RequestValidationError
from fastapi.responses import FileResponse, JSONResponse, RedirectResponse
from fastapi.staticfiles import StaticFiles
from backend.auth.dependencies import obtener_cuenta
from backend.auth.routes import router as auth_router
from backend.usuarios.routes import router as usuarios_router
from backend.interacciones.routes import router as interacciones_router
from backend.analitica.routes import router as analitica_router
from backend.realtime.routes import router as realtime_router
from backend.realtime.hub import DashboardHub
from backend.core.errors import DataServiceError, InteractionConflict, InteractionNotFound
from backend.core.config import ROOT
from turso_http import TursoHTTPError
from urllib.parse import quote

app = FastAPI(title="COMMUNITY 360 API", description="Backend del sistema COMMUNITY 360", version="1.0.0")
app.include_router(auth_router)
app.include_router(usuarios_router)
app.include_router(interacciones_router)
app.include_router(analitica_router)
app.include_router(realtime_router)
app.state.realtime = DashboardHub()


@app.middleware("http")
async def cabeceras_privacidad(request: Request, call_next):
    response = await call_next(request)
    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers["Referrer-Policy"] = "same-origin"
    response.headers["X-Frame-Options"] = "DENY"
    if request.url.path.startswith(("/auth", "/api", "/dashboard")):
        response.headers["Cache-Control"] = "no-store"
    return response


@app.exception_handler(TursoHTTPError)
@app.exception_handler(DataServiceError)
async def servicio_no_disponible(request, exc):
    if isinstance(request, WebSocket):
        await request.close(code=1013)
        return
    return JSONResponse(status_code=503, content={"detail": "No se pudo consultar el servicio de datos. Inténtalo de nuevo."})


@app.exception_handler(InteractionConflict)
async def conflicto_interaccion(request, exc):
    return JSONResponse(status_code=409, content={"detail": str(exc)})


@app.exception_handler(InteractionNotFound)
async def interaccion_ausente(request, exc):
    return JSONResponse(status_code=404, content={"detail": "Interacción no encontrada."})


@app.exception_handler(RequestValidationError)
async def datos_invalidos(request, exc):
    # No devolver el input original: puede contener contraseñas.
    errores = [{"loc": list(e["loc"]), "msg": e["msg"], "type": e["type"]} for e in exc.errors()]
    return JSONResponse(status_code=422, content={"detail": errores})


@app.get("/health", tags=["Sistema"])
def verificar_servidor():
    return {"estado": "activo", "servicio": "COMMUNITY 360 API", "version": "1.0.0"}


@app.get("/api/dashboard", tags=["Dashboard"])
def dashboard(cuenta: dict = Depends(obtener_cuenta)):
    return {"cuenta": {"id_cuenta": cuenta["id_cuenta"], "usuario": cuenta["usuario"]},
            "analitica_disponible": True}


FRONTEND = ROOT / "frontend/dist"
if (FRONTEND / "assets").is_dir():
    app.mount("/assets", StaticFiles(directory=FRONTEND / "assets"), name="assets")


def pagina():
    if not (FRONTEND / "index.html").is_file():
        return JSONResponse(status_code=503, content={"detail": "Compila el frontend con npm run build y reinicia el servidor."})
    return FileResponse(FRONTEND / "index.html", headers={"Cache-Control": "no-store"})


@app.get("/", include_in_schema=False)
def inicio():
    return RedirectResponse("/login", status_code=303)


@app.get("/login", include_in_schema=False)
@app.get("/acceso", include_in_schema=False)
def login_pagina():
    return pagina()


@app.get("/dashboard", include_in_schema=False)
@app.get("/dashboard/{ruta:path}", include_in_schema=False)
def dashboard_pagina(request: Request):
    # La navegación del navegador usa la cookie; comprobar antes de servir la vista.
    try:
        obtener_cuenta(request, None)
    except HTTPException as exc:
        if exc.status_code == 401:
            destino = "/login" if request.url.path == "/dashboard" else "/login?next=" + quote(request.url.path, safe="")
            return RedirectResponse(destino, status_code=303)
        raise
    return pagina()
