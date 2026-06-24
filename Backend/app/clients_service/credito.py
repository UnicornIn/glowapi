"""
Saldo a favor del cliente (crédito interno).

Vehículo para trasladar abonos de citas canceladas de forma dinámica:
- Al cancelar una cita con abono en efectivo/transferencia, el monto se acredita
  como saldo a favor del cliente (ver cancelar_cita).
- El saldo se aplica como método de pago "saldo_a_favor" en una nueva cita
  (ver registrar_pago).

Fuente de verdad del saldo: campo `saldo_a_favor` en el doc del cliente (se mueve
siempre con $inc atómico). Cada movimiento queda auditado en `credit_movements`.
"""
from datetime import datetime
from typing import Optional
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from pymongo import ReturnDocument

from app.database.mongo import collection_clients, collection_credit_movements
from app.auth.routes import get_current_user

router = APIRouter(prefix="/clientes", tags=["Saldo a favor"])

_ROLES_AJUSTE = ("super_admin", "admin_sede", "admin_franquicia")


# ── Helpers reutilizables ───────────────────────────────────────────────────
async def acreditar_saldo(
    cliente_id: str, monto: float, tipo: str, registrado_por: str,
    cita_id: Optional[str] = None, notas: Optional[str] = None
) -> Optional[float]:
    """Suma `monto` al saldo del cliente y registra el movimiento. Devuelve el saldo nuevo."""
    monto = round(float(monto or 0), 2)
    if monto <= 0:
        return None
    cliente = await collection_clients.find_one_and_update(
        {"cliente_id": cliente_id},
        {"$inc": {"saldo_a_favor": monto}},
        return_document=ReturnDocument.AFTER,
    )
    if not cliente:
        return None
    nuevo_saldo = round(float(cliente.get("saldo_a_favor", 0) or 0), 2)
    await collection_credit_movements.insert_one({
        "cliente_id": cliente_id, "tipo": tipo, "signo": "+", "monto": monto,
        "saldo_despues": nuevo_saldo, "cita_id": cita_id, "notas": notas,
        "fecha": datetime.now(), "registrado_por": registrado_por,
    })
    return nuevo_saldo


async def consumir_saldo(
    cliente_id: str, monto: float, tipo: str, registrado_por: str,
    cita_id: Optional[str] = None, notas: Optional[str] = None
) -> float:
    """
    Consume hasta `monto` del saldo disponible (consumo parcial permitido).
    Devuelve el monto realmente consumido (0 si no había saldo).
    """
    monto = round(float(monto or 0), 2)
    if monto <= 0:
        return 0.0
    cliente = await collection_clients.find_one({"cliente_id": cliente_id})
    if not cliente:
        raise HTTPException(status_code=404, detail="Cliente no encontrado")
    disponible = round(float(cliente.get("saldo_a_favor", 0) or 0), 2)
    consumido = round(min(monto, disponible), 2)
    if consumido <= 0:
        return 0.0
    # $gte evita saldo negativo ante concurrencia
    actualizado = await collection_clients.find_one_and_update(
        {"cliente_id": cliente_id, "saldo_a_favor": {"$gte": consumido}},
        {"$inc": {"saldo_a_favor": -consumido}},
        return_document=ReturnDocument.AFTER,
    )
    if not actualizado:
        return 0.0
    nuevo_saldo = round(float(actualizado.get("saldo_a_favor", 0) or 0), 2)
    await collection_credit_movements.insert_one({
        "cliente_id": cliente_id, "tipo": tipo, "signo": "-", "monto": consumido,
        "saldo_despues": nuevo_saldo, "cita_id": cita_id, "notas": notas,
        "fecha": datetime.now(), "registrado_por": registrado_por,
    })
    return consumido


# ── Endpoints ───────────────────────────────────────────────────────────────
@router.get("/{cliente_id}/saldo")
async def obtener_saldo(cliente_id: str, current_user: dict = Depends(get_current_user)):
    cliente = await collection_clients.find_one({"cliente_id": cliente_id}, {"_id": 0, "saldo_a_favor": 1})
    if not cliente:
        raise HTTPException(status_code=404, detail="Cliente no encontrado")
    historial = await (
        collection_credit_movements
        .find({"cliente_id": cliente_id}, {"_id": 0})
        .sort("fecha", -1)
        .to_list(50)
    )
    return {
        "cliente_id": cliente_id,
        "saldo_a_favor": round(float(cliente.get("saldo_a_favor", 0) or 0), 2),
        "historial": historial,
    }


class AjusteSaldo(BaseModel):
    monto: float                      # positivo acredita, negativo descuenta
    notas: Optional[str] = None


@router.post("/{cliente_id}/saldo/ajuste")
async def ajustar_saldo(
    cliente_id: str, data: AjusteSaldo, current_user: dict = Depends(get_current_user)
):
    """Ajuste manual de saldo (admin). Para correcciones/cortesías."""
    if current_user.get("rol") not in _ROLES_AJUSTE:
        raise HTTPException(status_code=403, detail="Sin permisos para ajustar saldo")
    if data.monto == 0:
        raise HTTPException(status_code=400, detail="El monto no puede ser 0")

    if data.monto > 0:
        nuevo = await acreditar_saldo(
            cliente_id, data.monto, "ajuste_manual", current_user.get("email"), notas=data.notas
        )
        if nuevo is None:
            raise HTTPException(status_code=404, detail="Cliente no encontrado")
        return {"ok": True, "saldo_a_favor": nuevo}

    consumido = await consumir_saldo(
        cliente_id, -data.monto, "ajuste_manual", current_user.get("email"), notas=data.notas
    )
    if consumido < round(-data.monto, 2):
        raise HTTPException(status_code=400, detail="Saldo insuficiente para el descuento")
    cliente = await collection_clients.find_one({"cliente_id": cliente_id}, {"_id": 0, "saldo_a_favor": 1})
    return {"ok": True, "saldo_a_favor": round(float(cliente.get("saldo_a_favor", 0) or 0), 2)}
