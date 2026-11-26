from datetime import datetime, timezone
from typing import Annotated, Literal
from pydantic import (AwareDatetime, BaseModel, ConfigDict, Field, StringConstraints,
                      field_validator, model_validator)

IdUsuario = Annotated[str, StringConstraints(pattern=r"^U[0-9]{6}$")]
IdInteraccion = Annotated[str, StringConstraints(pattern=r"^I[0-9]{7}$")]
TextoCorto = Annotated[str, StringConstraints(strict=True, strip_whitespace=True, min_length=1, max_length=100)]
Tipo = Literal["mensaje", "comentario", "reaccion", "respuesta_encuesta", "rsvp_evento"]
Contador = Annotated[int, Field(strict=True, ge=0, le=2**31-1)]
Sentimiento = Annotated[float, Field(strict=True, ge=-1, le=1, allow_inf_nan=False)]


class Ubicacion(BaseModel):
    model_config = ConfigDict(extra="forbid")
    pais: TextoCorto
    estado: TextoCorto
    ciudad: TextoCorto


class DatosInteraccion(BaseModel):
    model_config = ConfigDict(extra="forbid")
    id_usuario: IdUsuario
    timestamp: AwareDatetime
    canal: TextoCorto
    tipo: Tipo
    texto: Annotated[str, Field(strict=True, max_length=10000)] | None = None
    tema: TextoCorto
    sentimiento: Sentimiento
    idioma: TextoCorto
    dispositivo: TextoCorto
    longitud_texto: Contador | None = None
    reacciones_recibidas: Contador = 0
    etiquetas: list[TextoCorto] = Field(default_factory=list, max_length=50)
    ubicacion: Ubicacion | None = None

    @field_validator("timestamp", mode="before")
    @classmethod
    def timestamp_iso(cls, valor):
        if not isinstance(valor, (str, datetime)):
            raise ValueError("El timestamp debe ser una fecha ISO 8601 con zona horaria.")
        return valor

    @field_validator("timestamp")
    @classmethod
    def timestamp_utc(cls, valor):
        return valor.astimezone(timezone.utc)

    @field_validator("etiquetas")
    @classmethod
    def etiquetas_unicas(cls, valores):
        vistas = set()
        resultado = []
        for valor in valores:
            if valor.casefold() not in vistas:
                resultado.append(valor)
                vistas.add(valor.casefold())
        return resultado

    @model_validator(mode="after")
    def validar_texto(self):
        if self.texto is None:
            if self.tipo != "reaccion":
                raise ValueError("El texto es obligatorio salvo en una reacción.")
            # El ETL conserva longitudes originales de reacciones sin texto.
            if self.longitud_texto is None:
                self.longitud_texto = 0
        else:
            if not self.texto.strip() and self.tipo != "reaccion":
                raise ValueError("El texto no puede quedar vacío.")
            if self.longitud_texto is not None and self.longitud_texto != len(self.texto):
                raise ValueError("longitud_texto no coincide con el texto.")
            self.longitud_texto = len(self.texto)
        return self


class CrearInteraccion(DatosInteraccion):
    id_interaccion: IdInteraccion


class CambiosInteraccion(BaseModel):
    model_config = ConfigDict(extra="forbid")
    id_usuario: IdUsuario | None = None
    timestamp: AwareDatetime | None = None
    canal: TextoCorto | None = None
    tipo: Tipo | None = None
    texto: Annotated[str, Field(strict=True, max_length=10000)] | None = None
    tema: TextoCorto | None = None
    sentimiento: Sentimiento | None = None
    idioma: TextoCorto | None = None
    dispositivo: TextoCorto | None = None
    longitud_texto: Contador | None = None
    reacciones_recibidas: Contador | None = None
    etiquetas: list[TextoCorto] | None = Field(default=None, max_length=50)
    ubicacion: Ubicacion | None = None

    @model_validator(mode="after")
    def cambios_validos(self):
        if not self.model_fields_set:
            raise ValueError("Envía al menos un campo para modificar.")
        for campo in self.model_fields_set - {"texto", "ubicacion"}:
            if getattr(self, campo) is None:
                raise ValueError("Solo texto y ubicación admiten null en una modificación.")
        return self


class FiltrosInteracciones(BaseModel):
    model_config = ConfigDict(extra="forbid")
    id_usuario: IdUsuario | None = None
    tipo: Tipo | None = None
    canal: TextoCorto | None = None
    inicio: AwareDatetime | None = None
    fin: AwareDatetime | None = None

    @model_validator(mode="after")
    def fechas_ordenadas(self):
        if self.inicio and self.fin and self.inicio > self.fin:
            raise ValueError("inicio debe ser anterior o igual a fin.")
        return self


class ConsultaInteracciones(FiltrosInteracciones):
    limite: Annotated[int, Field(ge=1, le=100)] = 25
    desplazamiento: Annotated[int, Field(ge=0)] = 0
