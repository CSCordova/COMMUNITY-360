class DataServiceError(RuntimeError):
    """Fallo de datos cuya respuesta pública no incluye credenciales ni consultas."""


class InteractionConflict(RuntimeError):
    pass


class InteractionNotFound(RuntimeError):
    pass
