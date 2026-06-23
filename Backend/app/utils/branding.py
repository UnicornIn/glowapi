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
