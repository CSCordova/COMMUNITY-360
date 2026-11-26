"""Cliente de servidor creado bajo demanda; no necesita claves en React."""
import os
from functools import lru_cache
from pathlib import Path
from threading import Lock

import firebase_admin
from firebase_admin import credentials, firestore

from backend.core.config import ROOT
from backend.core.errors import DataServiceError

_lock = Lock()


@lru_cache(maxsize=1)
def conectar_firestore():
    try:
        project = os.environ["FIREBASE_PROJECT_ID"]
        ruta = Path(os.environ["FIREBASE_CREDENTIALS_PATH"])
        if not ruta.is_absolute():
            ruta = ROOT / ruta
        with _lock:
            try:
                app = firebase_admin.get_app("community360-api")
            except ValueError:
                credencial = credentials.Certificate(str(ruta))
                if credencial.project_id != project:
                    raise DataServiceError("Configuración de proyecto incompatible.")
                app = firebase_admin.initialize_app(credencial, {"projectId": project}, name="community360-api")
        return firestore.client(app=app, database_id=os.getenv("FIRESTORE_DATABASE_ID", "(default)"))
    except (KeyError, ValueError, OSError) as exc:
        raise DataServiceError("No se pudo configurar Firestore.") from exc
