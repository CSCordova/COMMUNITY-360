
import os
from dotenv import load_dotenv
from turso_http import TursoHTTP
from cargar_nube import instrucciones_sql

load_dotenv()

conexion = TursoHTTP(
    os.environ["TURSO_DATABASE_URL"],
    os.environ["TURSO_AUTH_TOKEN"]
)

try:
    print("Creando estructura de COMMUNITY 360...")

    for sentencia in instrucciones_sql():
        conexion.execute(sentencia)

    tablas = conexion.execute("""
        SELECT name
        FROM sqlite_master
        WHERE type = 'table'
        AND name NOT LIKE 'sqlite_%'
        ORDER BY name
    """).fetchall()

    print("\nTABLAS CREADAS:")
    for tabla in tablas:
        print("-", tabla[0])

    print(f"\nTotal: {len(tablas)} tablas")

finally:
    conexion.close()
