"""
Registro dinámico de tipos de ficha (Fase 1 — fichas dinámicas).

Permite que cada negocio defina sus propios tipos de ficha (campos + categorías de
foto) desde la BD, sin tocar código por cada tipo nuevo. El frontend consume
GET /ficha-templates para renderizar los formularios automáticamente.

Es retrocompatible: si un tipo_ficha no tiene template, create-ficha sigue
funcionando igual (tipo_ficha libre + datos_especificos flexible).
"""
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from typing import List, Optional
from datetime import datetime
from app.database.mongo import collection_ficha_templates
from app.auth.routes import get_current_user

router = APIRouter(tags=["Ficha Templates"])

_ROLES_EDIT = ("super_admin", "admin", "admin_sede")


class CampoFicha(BaseModel):
    key: str
    label: Optional[str] = None
    tipo: str = "text"                       # text | textarea | select | number | checkbox
    opciones: Optional[List[str]] = None     # para tipo "select"
    requerido: bool = False


class FichaTemplate(BaseModel):
    tipo_ficha: str                          # clave única, ej: "FICHA_ESTILIZADO"
    label: str                               # nombre visible, ej: "Ficha de Estilizado"
    activo: bool = True
    estricto: bool = False                   # si True → create-ficha valida campos requeridos/opciones
    categorias_foto: List[str] = ["antes", "despues"]   # dinámico, ya no hardcodeado
    campos: List[CampoFicha] = []


# ── Lectura (para que el frontend renderice los formularios) ─────────────────
@router.get("/ficha-templates")
async def listar_templates(
    solo_activos: bool = True,
    current_user: dict = Depends(get_current_user)
):
    filtro = {"activo": True} if solo_activos else {}
    docs = await collection_ficha_templates.find(filtro, {"_id": 0}).to_list(None)
    return {"total": len(docs), "templates": docs}


@router.get("/ficha-templates/{tipo_ficha}")
async def obtener_template(
    tipo_ficha: str,
    current_user: dict = Depends(get_current_user)
):
    doc = await collection_ficha_templates.find_one({"tipo_ficha": tipo_ficha}, {"_id": 0})
    if not doc:
        raise HTTPException(status_code=404, detail=f"No existe template para {tipo_ficha}")
    return doc


# ── Escritura (admin self-service: crear tipos nuevos sin deploy) ────────────
@router.post("/admin/ficha-templates")
async def upsert_template(
    data: FichaTemplate,
    current_user: dict = Depends(get_current_user)
):
    if current_user.get("rol") not in _ROLES_EDIT:
        raise HTTPException(status_code=403, detail="Sin permisos para gestionar tipos de ficha")
    doc = data.dict()
    doc["updated_at"] = datetime.now()
    doc["updated_by"] = current_user.get("email")
    await collection_ficha_templates.update_one(
        {"tipo_ficha": data.tipo_ficha},
        {"$set": doc, "$setOnInsert": {"created_at": datetime.now()}},
        upsert=True
    )
    return {"ok": True, "tipo_ficha": data.tipo_ficha}


@router.delete("/admin/ficha-templates/{tipo_ficha}")
async def desactivar_template(
    tipo_ficha: str,
    current_user: dict = Depends(get_current_user)
):
    """Soft delete: marca el tipo como inactivo (no borra histórico de fichas)."""
    if current_user.get("rol") not in _ROLES_EDIT:
        raise HTTPException(status_code=403, detail="Sin permisos para gestionar tipos de ficha")
    result = await collection_ficha_templates.update_one(
        {"tipo_ficha": tipo_ficha},
        {"$set": {"activo": False, "updated_at": datetime.now()}}
    )
    if result.matched_count == 0:
        raise HTTPException(status_code=404, detail=f"No existe template para {tipo_ficha}")
    return {"ok": True, "tipo_ficha": tipo_ficha, "activo": False}
