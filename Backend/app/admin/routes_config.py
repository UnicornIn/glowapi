"""
Endpoints de configuración del negocio (branding, nombre, logo).

Rutas:
  GET   /public/business-config  → sin auth, para que el frontend cargue branding al inicio
  GET   /admin/business-config   → con auth, para el panel de configuración
  POST  /admin/business-config   → con auth, solo super_admin o admin (reemplazo total)
  PATCH /admin/business-config   → con auth, solo super_admin o admin (update parcial)
  POST  /admin/branding/logo     → con auth, sube el logo a S3 y actualiza logo_url
"""
import os
import uuid
import boto3
from fastapi import APIRouter, Depends, HTTPException, UploadFile, File
from pydantic import BaseModel
from typing import Optional, List
from app.database.mongo import collection_business_config, collection_locales
from app.auth.routes import get_current_user
from app.utils.branding import invalidar_cache

router_config = APIRouter(tags=["Configuración"])

# Roles autorizados para modificar la configuración del negocio
_ROLES_CONFIG = ("super_admin", "admin")

# Formatos de imagen aceptados para el logo y su content-type
_LOGO_CONTENT_TYPES = {
    "png": "image/png",
    "jpg": "image/jpeg",
    "jpeg": "image/jpeg",
    "webp": "image/webp",
    "svg": "image/svg+xml",
}


class BusinessConfig(BaseModel):
    nombre_negocio: str
    razon_social: str
    logo_url: str
    color_primario: Optional[str] = "#000000"
    email_remitente: Optional[str] = None
    footer_legal: Optional[str] = None
    email_recomendaciones: Optional[List[str]] = None   # tips en los correos al cliente
    ws_url: Optional[str] = None          # solo clientes con mensajería (WebSocket)


class BusinessConfigPatch(BaseModel):
    """Todos los campos opcionales: permite actualizar solo lo que cambia."""
    nombre_negocio: Optional[str] = None
    razon_social: Optional[str] = None
    logo_url: Optional[str] = None
    color_primario: Optional[str] = None
    email_remitente: Optional[str] = None
    footer_legal: Optional[str] = None
    email_recomendaciones: Optional[List[str]] = None
    ws_url: Optional[str] = None


@router_config.get("/public/business-config")
async def get_public_business_config():
    """Sin auth → el frontend lo llama antes del login para cargar el branding."""
    doc = await collection_business_config.find_one({}, {"_id": 0})
    return doc or {
        "nombre_negocio": "GlowUp",
        "logo_url": "",
        "color_primario": "#000000",
        "footer_legal": "© GlowUp. Todos los derechos reservados.",
        "razon_social": "",
        "ws_url": None,
    }


@router_config.get("/admin/business-config")
async def get_admin_business_config(
    current_user: dict = Depends(get_current_user)
):
    """Endpoint privado: devuelve la configuración completa al panel de admin."""
    doc = await collection_business_config.find_one({}, {"_id": 0})
    return doc or {}


@router_config.post("/admin/business-config")
async def upsert_business_config(
    data: BusinessConfig,
    current_user: dict = Depends(get_current_user)
):
    """Guarda o reemplaza la configuración completa del negocio. Solo super_admin o admin."""
    if current_user.get("rol") not in _ROLES_CONFIG:
        raise HTTPException(status_code=403, detail="Sin permisos para modificar la configuración")
    await collection_business_config.update_one(
        {},
        {"$set": data.dict()},
        upsert=True
    )
    await invalidar_cache()
    return {"ok": True}


@router_config.patch("/admin/business-config")
async def patch_business_config(
    data: BusinessConfigPatch,
    current_user: dict = Depends(get_current_user)
):
    """Actualiza solo los campos enviados (color, footer, etc.) sin reenviar todo. Solo super_admin o admin."""
    if current_user.get("rol") not in _ROLES_CONFIG:
        raise HTTPException(status_code=403, detail="Sin permisos para modificar la configuración")
    updates = data.dict(exclude_unset=True)
    if not updates:
        raise HTTPException(status_code=400, detail="No se enviaron campos para actualizar")
    await collection_business_config.update_one(
        {},
        {"$set": updates},
        upsert=True
    )
    await invalidar_cache()
    return {"ok": True, "updated": list(updates.keys())}


@router_config.post("/admin/branding/logo")
async def upload_branding_logo(
    file: UploadFile = File(...),
    current_user: dict = Depends(get_current_user)
):
    """
    Sube el logo del negocio a S3 (companies/{company_id}/branding/),
    actualiza business_config.logo_url y devuelve la URL pública.
    Conserva el formato original (no convierte a JPEG) para respetar la
    transparencia de los PNG en los encabezados de email.
    """
    if current_user.get("rol") not in _ROLES_CONFIG:
        raise HTTPException(status_code=403, detail="Sin permisos para modificar la configuración")

    # company_id se obtiene de la sede del usuario (define el prefijo en S3)
    sede = await collection_locales.find_one({"sede_id": current_user.get("sede_id")})
    company_id = (sede or {}).get("company_id")
    if not company_id:
        raise HTTPException(status_code=400, detail="La sede del usuario no tiene company_id configurado")

    bucket = os.getenv("AWS_BUCKET_NAME")
    base_url = os.getenv("AWS_PUBLIC_BASE_URL")
    if not bucket or not base_url:
        raise HTTPException(status_code=500, detail="AWS_BUCKET_NAME o AWS_PUBLIC_BASE_URL no configurados en .env")

    ext = file.filename.rsplit(".", 1)[-1].lower() if file.filename and "." in file.filename else "png"
    if ext not in _LOGO_CONTENT_TYPES:
        raise HTTPException(status_code=400, detail="Formato no soportado. Usa PNG, JPG, WEBP o SVG.")

    content = await file.read()
    key = f"companies/{company_id}/branding/logo-{uuid.uuid4().hex}.{ext}"

    s3_client = boto3.client(
        "s3",
        aws_access_key_id=os.getenv("AWS_ACCESS_KEY_ID"),
        aws_secret_access_key=os.getenv("AWS_SECRET_ACCESS_KEY"),
        region_name=os.getenv("AWS_REGION", "us-east-2"),
    )
    try:
        s3_client.put_object(
            Bucket=bucket,
            Key=key,
            Body=content,
            ContentType=_LOGO_CONTENT_TYPES[ext],
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error subiendo el logo a S3: {e}")

    logo_url = f"{base_url}/{key}"
    await collection_business_config.update_one(
        {},
        {"$set": {"logo_url": logo_url}},
        upsert=True
    )
    await invalidar_cache()
    return {"ok": True, "logo_url": logo_url}
