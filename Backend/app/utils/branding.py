"""
Helper de branding para GlowUp.
Lee la configuración del negocio desde MongoDB con caché en memoria por proceso.
Cada proceso uvicorn (= cada cliente) tiene su propio caché aislado.
"""
from app.database.mongo import collection_business_config

_cache: dict = {}


async def get_config() -> dict:
    """
    Retorna el documento business_config de la BD.
    En el primer acceso lo lee de MongoDB y lo cachea en memoria.
    El caché persiste hasta que se llame invalidar_cache() o se reinicie el proceso.
    """
    if _cache:
        return _cache
    doc = await collection_business_config.find_one({})
    if doc:
        _cache.update(doc)
    return _cache


async def invalidar_cache() -> None:
    """Limpia el caché de configuración. Llamar después de actualizar business_config."""
    _cache.clear()


# ── Helpers de presentación para los emails ─────────────────────────────────
# Recomendaciones genéricas (sin marca ni rubro) si el negocio no definió las suyas.
_RECOMENDACIONES_DEFAULT = [
    "Llega unos minutos antes de tu cita.",
    "Avísanos con anticipación si necesitas cancelar o reagendar.",
]


def color_acento(config: dict) -> str:
    """Color de marca para los emails. Cae a un neutro legible si no está definido."""
    return (config or {}).get("color_primario") or "#111111"


def recomendaciones_items(config: dict) -> list:
    """
    Lista de recomendaciones a mostrar en los emails.
    - Si el negocio definió email_recomendaciones → usa esas.
    - Si no está definido → usa unas genéricas (sin rubro).
    - Si está definido como lista vacía [] → no muestra recomendaciones.
    """
    cfg = config or {}
    items = cfg.get("email_recomendaciones")
    if items is None:
        return list(_RECOMENDACIONES_DEFAULT)
    return list(items)


def recomendaciones_html(config: dict, li_style: str = "") -> str:
    """Devuelve los <li> de recomendaciones ya armados (vacío si no hay)."""
    estilo = f' style="{li_style}"' if li_style else ""
    return "".join(f"<li{estilo}>{item}</li>" for item in recomendaciones_items(config))
