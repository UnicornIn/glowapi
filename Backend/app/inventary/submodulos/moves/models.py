from typing import List, Optional
from pydantic import BaseModel, validator


class ItemTraslado(BaseModel):
    producto_id: str
    cantidad: int


class Traslado(BaseModel):
    sede_origen: Optional[str] = None
    sede_destino: str
    items: List[ItemTraslado]
    observaciones: Optional[str] = None

    @validator("sede_destino")
    def destino_distinto_de_origen(cls, v, values):
        origen = values.get("sede_origen")
        if origen and v == origen:
            raise ValueError("La sede destino debe ser distinta de la sede origen")
        return v
