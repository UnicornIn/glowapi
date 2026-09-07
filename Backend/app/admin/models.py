from pydantic import BaseModel, EmailStr, Field, validator
from typing import Optional, List, Dict
from datetime import datetime
from collections import OrderedDict

# =====================================================
# 🏢 MODELO: Local (Sede)
# =====================================================
class Local(BaseModel):
    nombre: str
    direccion: str
    informacion_adicional: Optional[str] = None
    zona_horaria: str
    pais: Optional[str] = None
    moneda: str = Field(..., description="Código de moneda: COP, USD, MXN")
    reglas_comision: Optional[Dict[str, str]] = Field(
        default={"tipo": "servicios"},
        description="Reglas de comisión: {'tipo': 'servicios' | 'productos' | 'mixto'}"
    )
    telefono: Optional[str] = None
    email: Optional[EmailStr] = None
    
    @validator('moneda')
    def validar_moneda(cls, v):
        monedas_validas = ['COP', 'USD', 'MXN', 'EUR', 'PEN', 'ARS']
        if v and v.upper() not in monedas_validas:
            raise ValueError(f'Moneda debe ser: {", ".join(monedas_validas)}')
        return v.upper() if v else v
    
    @validator('reglas_comision')
    def validar_reglas_comision(cls, v):
        if v and 'tipo' in v:
            tipos_validos = ['servicios', 'productos', 'mixto']
            if v['tipo'] not in tipos_validos:
                raise ValueError(f"Tipo de comisión debe ser: {', '.join(tipos_validos)}")
        return v


# =====================================================
# 💇‍♀️ MODELO: Profesional / Estilista
# =====================================================
class Profesional(BaseModel):
    nombre: str
    email: EmailStr
    sede_id: str
    especialidades: bool = Field(default=True)
    telefono: Optional[str] = None
    servicios_no_presta: Optional[List[str]] = Field(default=[])
    sedes_permitidas: Optional[List[str]] = Field(default=[])
    activo: bool = True
    comision_productos: Optional[float] = None
    comisiones_por_categoria: Optional[Dict[str, float]] = Field(
        default=None,
        description="Mapa de comisiones por categoría. Ej: {'Peluquería': 35, 'Color': 45}"
    )
    comisiones_por_servicio: Optional[Dict[str, float]] = Field(
        default=None,
        description="Mapa de comisiones por servicio específico, clave=servicio_id. "
                     "Mismo modelo que comisiones_por_categoria pero más específico: "
                     "gana sobre la comisión por categoría cuando ambas aplican. "
                     "Ej: {'SV-43903': 40, 'SV-51201': 30}"
    )
    # Opcional: al crear, la ruta exige que venga (ver routes_profesionales.py);
    # al editar, ausente/vacío significa "no tocar la contraseña actual" — no
    # se debe reinterpretar un valor vacío como "resetear a algo por defecto".
    password: Optional[str] = None

    @validator('comisiones_por_categoria')
    def validar_comisiones_por_categoria(cls, v):
        if v is None:
            return v

        for categoria, porcentaje in v.items():
            if not isinstance(categoria, str) or not categoria.strip():
                raise ValueError('Cada categoría debe ser un texto no vacío')
            if porcentaje < 0 or porcentaje > 100:
                raise ValueError(f'Comisión de "{categoria}" debe estar entre 0 y 100')

        return v

    @validator('comisiones_por_servicio')
    def validar_comisiones_por_servicio(cls, v):
        if v is None:
            return v

        for servicio_id, porcentaje in v.items():
            if not isinstance(servicio_id, str) or not servicio_id.strip():
                raise ValueError('Cada servicio_id debe ser un texto no vacío')
            if porcentaje < 0 or porcentaje > 100:
                raise ValueError(f'Comisión del servicio "{servicio_id}" debe estar entre 0 y 100')

        return v


# ============================================
# 💅 MODELO: ServicioAdmin (con ejemplo ordenado)
# ============================================
class ServicioAdmin(BaseModel):
    # Datos principales
    nombre: str = Field(..., description="Nombre del servicio")
    duracion_minutos: int = Field(..., description="Duración en minutos")
    precios: Dict[str, float] = Field(..., description="Precios por moneda",
        example={"COP": 50000, "USD": 12.5, "MXN": 250})
    comision_estilista: Optional[float] = Field(None, description="Porcentaje de comisión del estilista")
    categoria: Optional[str] = Field(None, description="Categoría del servicio")
    requiere_producto: bool = Field(default=False, description="Indica si requiere producto")
    activo: bool = Field(default=True, description="Indica si el servicio está activo")
    requiere_ficha: bool = Field(default=False, description="Indica si requiere ficha de cliente")

    # Paquetes de sesiones prepagas del propio servicio (ej. "Terapia
    # individual piso pélvico" puede venderse suelta, o en un paquete de 5
    # por 750.000, o de 10 por 1.450.000). A propósito NO es un servicio
    # aparte — un servicio con paquetes sigue siendo el mismo servicio que se
    # agenda siempre; los paquetes solo son opciones de precio/cantidad sobre
    # él (se decidió así tras que la primera versión, con el paquete como un
    # "servicio" distinto apuntando a otro, generaba tarjetas duplicadas y
    # confusas en la lista de Servicios).
    paquetes_sesiones: Optional[List["PaqueteSesionesOpcion"]] = Field(
        None, description="Opciones de paquete de sesiones prepagas para este servicio"
    )

    # IDs relacionales
    sede_id: Optional[str] = Field(None, description="ID de la sede")

    # Auditoría
    creado_por: Optional[str] = Field(None, description="Usuario que creó el servicio")
    created_at: Optional[datetime] = Field(None, description="Fecha de creación")
    updated_at: Optional[datetime] = Field(None, description="Fecha de última actualización")

    # ===========================
    # Validaciones
    # ===========================
    @validator('precios')
    def validar_precios(cls, v):
        if not v:
            raise ValueError('Debe incluir al menos un precio')
        for moneda, precio in v.items():
            if precio <= 0:
                raise ValueError(f'Precio en {moneda} debe ser mayor a 0')
        return v

    @validator('comision_estilista')
    def validar_comision(cls, v):
        if v is not None and (v < 0 or v > 100):
            raise ValueError('Comisión debe estar entre 0 y 100')
        return v

    @validator('paquetes_sesiones')
    def validar_paquetes_sesiones(cls, v):
        if v is None:
            return v
        vistos = set()
        for opcion in v:
            if opcion.sesiones in vistos:
                raise ValueError(f'Ya hay un paquete de {opcion.sesiones} sesiones — no puede repetirse')
            vistos.add(opcion.sesiones)
        return v


class PaqueteSesionesOpcion(BaseModel):
    sesiones: int = Field(..., ge=2, description="Cantidad de sesiones que incluye este paquete (2 o más)")
    precio: float = Field(..., gt=0, description="Precio total del paquete completo, en la moneda de la sede")

    @validator('precio')
    def validar_precio_paquete(cls, v):
        if v <= 0:
            raise ValueError('El precio del paquete debe ser mayor a 0')
        return v


ServicioAdmin.update_forward_refs()

class Franquicia(BaseModel):
    nombre: str
    pais: Optional[str] = None
    descripcion: Optional[str] = None


class FranquiciaUpdate(BaseModel):
    nombre: Optional[str] = None
    pais: Optional[str] = None
    descripcion: Optional[str] = None


class AsignarSede(BaseModel):
    sede_id: str