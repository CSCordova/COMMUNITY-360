"""Entrada de secretos solo en una terminal interactiva con eco deshabilitado."""
import sys
import warnings
from getpass import GetPassWarning, getpass


def leer_secreto(mensaje):
    if not sys.stdin.isatty():
        raise ValueError("Ejecuta esta herramienta directamente en tu terminal interactiva.")
    with warnings.catch_warnings():
        warnings.simplefilter("error", GetPassWarning)
        try:
            return getpass(mensaje)
        except GetPassWarning:
            raise ValueError("La terminal no permite ocultar la contraseña. Operación cancelada.") from None
