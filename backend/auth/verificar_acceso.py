"""Prueba HTTP contra tu servidor local y la cuenta real, sin imprimir secretos."""
import argparse
from urllib.parse import urlsplit
import requests
from backend.auth.terminal import leer_secreto


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--url", default="http://127.0.0.1:8000")
    args = parser.parse_args()
    url = args.url.rstrip("/")
    parsed = urlsplit(url)
    if (parsed.scheme not in ("http", "https") or parsed.hostname not in ("127.0.0.1", "localhost", "::1")
            or parsed.username or parsed.password or parsed.path or parsed.query or parsed.fragment):
        raise ValueError("Utiliza únicamente la dirección de tu servidor local, sin rutas ni credenciales.")
    print("COMMUNITY 360 | Verificación HTTP real")
    print("Al finalizar, esta prueba cerrará todas las sesiones de la cuenta indicada.")
    usuario = input("Usuario: ").strip()
    password = leer_secreto("Contraseña actual (oculta): ")

    def comprobar(response, esperado, nombre):
        print(f"{nombre}: HTTP {response.status_code} (esperado {esperado})")
        if response.status_code != esperado:
            raise ValueError("La verificación se detuvo. No se imprimieron credenciales ni respuestas privadas.")

    with requests.Session() as client:
        client.trust_env = False
        def get(path, **kwargs):
            return client.get(url + path, timeout=15, allow_redirects=False, **kwargs)
        comprobar(get("/health"), 200, "Servidor")
        comprobar(get("/auth/me"), 401, "Acceso sin sesión")
        comprobar(get("/api/dashboard"), 401, "Dashboard sin sesión")
        login = client.post(url + "/auth/login", json={"usuario": usuario, "password": password},
                            timeout=60, allow_redirects=False)
        comprobar(login, 200, "Login contra la cuenta cloud")
        token = login.json()["access_token"]
        comprobar(get("/auth/me"), 200, "Cuenta mediante cookie")
        comprobar(get("/api/dashboard"), 200, "Dashboard autorizado")
        logout = client.post(url + "/auth/logout", timeout=60, allow_redirects=False)
        comprobar(logout, 200, "Cierre de todas las sesiones")
        comprobar(get("/auth/me"), 401, "Cookie retirada")
        comprobar(get("/auth/me", headers={"Authorization": "Bearer " + token}), 401, "JWT anterior revocado")
    print("VERIFICACIÓN COMPLETA. Puedes volver a iniciar sesión en el navegador.")


if __name__ == "__main__":
    try:
        main()
    except (ValueError, KeyError, requests.RequestException):
        print("No se completó la verificación. Comprueba el servidor y tus datos de acceso.")
        raise SystemExit(1)
    except (KeyboardInterrupt, EOFError):
        print("\nOperación cancelada.")
        raise SystemExit(1)
