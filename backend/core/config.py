"""Configuración privada del servidor; nunca se exporta al frontend."""
import os
from pathlib import Path
from dotenv import load_dotenv

ROOT = Path(__file__).resolve().parents[2]
load_dotenv(ROOT / ".env")
JWT_SECRET_KEY = os.getenv("JWT_SECRET_KEY", "")
JWT_ALGORITHM = "HS256"
TOKEN_MINUTES = 30
COOKIE_NAME = "community360_session"
COOKIE_SECURE = os.getenv("SESSION_COOKIE_SECURE", "false").lower() == "true"
if len(JWT_SECRET_KEY) < 64:
    raise RuntimeError("Configura JWT_SECRET_KEY con al menos 64 caracteres en .env.")
