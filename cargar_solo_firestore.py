
from cargar_nube import (
    evaluar_salida,
    cargar_env,
    conectar_firebase,
    cargar_firestore,
    verificar_firestore
)

print("COMMUNITY 360 | CARGA A FIRESTORE")

# Comprobar los archivos generados por el ETL
consentimientos, documentos = evaluar_salida()

print("Validacion local: OK")
print(f"Interacciones validas: {len(documentos)}")

# Preparar conexion a Firestore
_, _, credenciales = cargar_env()
db = conectar_firebase(credenciales)

print("Firebase conectado: community-360")

confirmacion = input(
    "Escribe CARGAR para insertar las interacciones: "
)

if confirmacion == "CARGAR":
    cargar_firestore(db, documentos)

    resultado = verificar_firestore(
        db, consentimientos, documentos
    )

    print("\nCARGA Y VERIFICACION COMPLETADAS")
    print("Interacciones:", resultado["interacciones"])
    print(
        "Ubicaciones no autorizadas:",
        resultado["ubicaciones_no_autorizadas"]
    )
else:
    print("Operacion cancelada.")
