"""Ejecutar explícitamente: python -m backend.crear_tabla_auth."""
from backend.core.config import ROOT
from backend.database.turso import conectar_turso


def main():
    with conectar_turso() as db:
        db.execute((ROOT / "sql/esquema_auth.sql").read_text(encoding="utf-8"))
        cantidad = db.execute("SELECT COUNT(*) FROM cuentas_acceso").fetchone()[0]
    print("Tabla cuentas_acceso verificada. Cuentas existentes:", cantidad)


if __name__ == "__main__":
    main()
