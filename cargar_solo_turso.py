
import os
from pathlib import Path
from dotenv import load_dotenv
from turso_http import TursoHTTP
from cargar_nube import evaluar_salida, cargar_sql

load_dotenv(Path(__file__).resolve().parent / ".env")

print("COMMUNITY 360 | CARGA A TURSO")

# Validar los archivos procesados
evaluar_salida()
print("Validación local: OK")

conexion = TursoHTTP(
    os.environ["TURSO_DATABASE_URL"],
    os.environ["TURSO_AUTH_TOKEN"]
)

try:
    total = conexion.execute(
        "SELECT COUNT(*) FROM usuarios"
    ).fetchone()[0]

    print(f"Usuarios actuales en Turso: {total}")

    confirmacion = input(
        "Escribe CARGAR para insertar los datos: "
    )

    if confirmacion == "CARGAR":
        cargar_sql(conexion)
        print("Carga y verificaciones completadas.")
    else:
        print("Operación cancelada.")

finally:
    conexion.close()
