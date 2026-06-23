# ============================================================
# routes_finanzas_movimientos.py — REFACTORIZADO
#
# CAMBIOS RESPECTO A LA VERSIÓN ANTERIOR:
#   - Eliminada dependencia de collection_finance_movements
#   - Egresos (ambas cajas) → cash_expenses  (campo `caja` discrimina)
#   - Ingresos caja mayor  → cash_incomes
#   - Traslados            → cash_expenses  (tipo="traslado", afecta_pl=False)
#   - GET /resumen         → usa calcular_resumen_dia (caja menor) +
#                            queries directos filtrados por caja (caja mayor)
#
# La lógica de caja menor (ingresos por ventas/citas, saldo corrido, etc.)
# ya está 100% cubierta por accounting_logic.py / routes_cash.py.
# Este router solo gestiona los movimientos manuales de caja mayor
# y los egresos manuales de caja menor que no pasan por el POS.
# ============================================================

from datetime import datetime
from typing import Literal, Optional

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel, Field

from app.auth.routes import get_current_user
from app.database.mongo import db, collection_locales as locales, collection_sales as sales_col
from app.cash.accounting_logic import calcular_resumen_dia, _normalizar_metodo, _buscar_apertura
from app.cash.utils_cash import generar_egreso_id, generar_ingreso_id

router = APIRouter(prefix="/finanzas/movimientos", tags=["Finanzas - Movimientos"])

# ── Colecciones ───────────────────────────────────────────────────────────────
cash_expenses = db["cash_expenses"]
cash_incomes  = db["cash_ingresos"]
cash_closures = db["cash_closures"]

# ── Literals / tipos ─────────────────────────────────────────────────────────
CategoriaEgresoMayor = Literal[
    "arriendo", "nomina", "comisiones", "servicios_publicos", "impuestos",
    "proveedor", "insumos", "marketing", "mantenimiento", "transporte",
    "software", "seguros", "honorarios", "otro",
]
MetodoPago    = Literal["transferencia", "debito_automatico", "tarjeta_corporativa",
                        "cheque", "efectivo", "pse"]
CajaTipo      = Literal["caja_menor", "caja_mayor"]

# Mapeo de categoría de caja menor → tipo estándar de cash_expenses
_CATEGORIA_MENOR_A_TIPO = {
    "almuerzos"      : "gasto_operativo",
    "domicilios"     : "gasto_operativo",
    "propinas"       : "otro",
    "gasto_operativo": "gasto_operativo",
    "otro"           : "otro",
}


# ── Modelos de request ────────────────────────────────────────────────────────

class MovimientoBase(BaseModel):
    sede_id      : str
    fecha        : str = Field(..., description="YYYY-MM-DD")
    concepto     : str = Field(..., min_length=3, max_length=200)
    monto        : float = Field(..., gt=0)
    observaciones: Optional[str] = Field(None, max_length=1000)


class EgresoCajaMayorRequest(MovimientoBase):
    categoria        : CategoriaEgresoMayor
    metodo_pago      : MetodoPago
    referencia_factura: Optional[str] = Field(None, max_length=80)


class IngresoCajaMayorRequest(MovimientoBase):
    categoria        : Literal["devolucion_proveedor", "intereses",
                                "ingreso_extraordinario", "otro"]
    metodo_pago      : MetodoPago
    referencia_factura: Optional[str] = Field(None, max_length=80)


class EgresoCajaMenorRequest(MovimientoBase):
    categoria  : Literal["almuerzos", "domicilios", "propinas",
                          "gasto_operativo", "otro"]
    metodo_pago: Literal["efectivo", "transferencia", "pse"] = "efectivo"


class TrasladoCajasRequest(BaseModel):
    sede_id     : str
    fecha       : str
    concepto    : str = Field(..., min_length=3, max_length=200)
    monto       : float = Field(..., gt=0)
    caja_origen : CajaTipo
    caja_destino: CajaTipo
    observaciones: Optional[str] = Field(None, max_length=1000)


# ── Helpers ───────────────────────────────────────────────────────────────────

def _check_admin(current_user: dict) -> None:
    if current_user.get("rol") not in {"admin_sede", "admin_franquicia", "super_admin"}:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Solo administradores pueden registrar movimientos.",
        )


def _parse_fecha(fecha: str) -> str:
    try:
        return datetime.strptime(fecha, "%Y-%m-%d").strftime("%Y-%m-%d")
    except ValueError as exc:
        raise HTTPException(
            status_code=422, detail="fecha debe tener formato YYYY-MM-DD"
        ) from exc


def _auditoria(current_user: dict) -> dict:
    return {
        "registrado_por"      : current_user.get("email"),
        "registrado_por_nombre": current_user.get("nombre"),
        "registrado_por_rol"  : current_user.get("rol"),
        "creado_en"           : datetime.utcnow(),
        "actualizado_en"      : datetime.utcnow(),
    }


async def _insertar(collection, doc: dict) -> dict:
    result    = await collection.insert_one(doc)
    doc["_id"] = str(result.inserted_id)
    return doc


# ── Endpoints de escritura ────────────────────────────────────────────────────

@router.post("/egreso-caja-mayor", status_code=201)
async def registrar_egreso_caja_mayor(
    payload     : EgresoCajaMayorRequest,
    current_user: dict = Depends(get_current_user),
):
    """
    Registra un egreso manual de caja mayor (nómina, arriendo, proveedores…).
    Se almacena en cash_expenses con caja='caja_mayor' para que el resumen
    financiero lo distinga de los egresos operativos de caja menor.
    """
    _check_admin(current_user)
    fecha = _parse_fecha(payload.fecha)

    doc = {
        "egreso_id"          : generar_egreso_id(),
        "sede_id"            : payload.sede_id,
        "fecha"              : fecha,
        "tipo"               : "gasto_operativo",   # tipo estándar de cash_expenses
        "categoria"          : payload.categoria,   # categoría específica de caja mayor
        "concepto"           : payload.concepto,
        "descripcion"        : payload.observaciones,
        "monto"              : payload.monto,
        "moneda"             : "COP",
        "metodo_pago"        : payload.metodo_pago,
        "referencia_factura" : payload.referencia_factura,
        # ── Clasificación contable ──
        "caja"               : "caja_mayor",
        "origen"             : "manual_caja_mayor",
        "tipo_movimiento"    : "egreso",
        "afecta_pl"          : True,
        **_auditoria(current_user),
    }
    return await _insertar(cash_expenses, doc)


@router.post("/ingreso-caja-mayor", status_code=201)
async def registrar_ingreso_caja_mayor(
    payload     : IngresoCajaMayorRequest,
    current_user: dict = Depends(get_current_user),
):
    """
    Registra un ingreso manual de caja mayor (devolución de proveedor,
    intereses, ingresos extraordinarios…).
    Se almacena en cash_incomes con caja='caja_mayor'.
    """
    _check_admin(current_user)
    fecha = _parse_fecha(payload.fecha)

    doc = {
        "ingreso_id"         : generar_ingreso_id(),
        "sede_id"            : payload.sede_id,
        "fecha"              : fecha,
        "categoria"          : payload.categoria,
        "motivo"             : payload.concepto,
        "descripcion"        : payload.observaciones,
        "monto"              : payload.monto,
        "moneda"             : "COP",
        "metodo_pago"        : payload.metodo_pago,
        "referencia_factura" : payload.referencia_factura,
        # ── Clasificación contable ──
        "caja"               : "caja_mayor",
        "origen"             : "manual_caja_mayor",
        "tipo_movimiento"    : "ingreso",
        "afecta_pl"          : True,
        **_auditoria(current_user),
    }
    return await _insertar(cash_incomes, doc)


@router.post("/egreso-caja-menor", status_code=201)
async def registrar_egreso_caja_menor(
    payload     : EgresoCajaMenorRequest,
    current_user: dict = Depends(get_current_user),
):
    """
    Registra un egreso manual de caja menor (almuerzos, propinas, domicilios…).
    Usa la misma colección cash_expenses que routes_cash.py, con caja='caja_menor'
    para mantener coherencia con el cierre de caja diario existente.
    """
    _check_admin(current_user)
    fecha    = _parse_fecha(payload.fecha)
    tipo_std = _CATEGORIA_MENOR_A_TIPO.get(payload.categoria, "otro")

    doc = {
        "egreso_id"      : generar_egreso_id(),
        "sede_id"        : payload.sede_id,
        "fecha"          : fecha,
        "tipo"           : tipo_std,
        "categoria"      : payload.categoria,
        "concepto"       : payload.concepto,
        "descripcion"    : payload.observaciones,
        "monto"          : payload.monto,
        "moneda"         : "COP",
        "metodo_pago"    : payload.metodo_pago,
        # ── Clasificación contable ──
        "caja"           : "caja_menor",
        "origen"         : "manual_caja_menor",
        "tipo_movimiento": "egreso",
        "afecta_pl"      : True,
        **_auditoria(current_user),
    }
    return await _insertar(cash_expenses, doc)


@router.post("/traslado", status_code=201)
async def registrar_traslado(
    payload     : TrasladoCajasRequest,
    current_user: dict = Depends(get_current_user),
):
    """
    Registra un traslado entre caja menor y caja mayor.
    Se guarda como un documento único en cash_expenses con
    tipo='traslado' y afecta_pl=False para excluirlo del P&L.
    caja_origen y caja_destino quedan como campos explícitos.
    """
    _check_admin(current_user)

    if payload.caja_origen == payload.caja_destino:
        raise HTTPException(
            status_code=422,
            detail="caja_origen y caja_destino no pueden ser iguales.",
        )

    fecha = _parse_fecha(payload.fecha)

    doc = {
        "egreso_id"      : generar_egreso_id(),
        "sede_id"        : payload.sede_id,
        "fecha"          : fecha,
        "tipo"           : "traslado",
        "concepto"       : payload.concepto,
        "descripcion"    : payload.observaciones,
        "monto"          : payload.monto,
        "moneda"         : "COP",
        "metodo_pago"    : "efectivo",
        "caja_origen"    : payload.caja_origen,
        "caja_destino"   : payload.caja_destino,
        # ── Clasificación contable ──
        "caja"           : payload.caja_origen,
        "origen"         : "manual_caja_mayor",
        "tipo_movimiento": "traslado",
        "afecta_pl"      : False,
        **_auditoria(current_user),
    }
    return await _insertar(cash_expenses, doc)


# ── Resumen financiero ────────────────────────────────────────────────────────

@router.get("/resumen")
async def resumen_financiero(
    sede_id     : str,
    fecha_inicio: str = Query(..., description="YYYY-MM-DD"),
    fecha_fin   : str = Query(..., description="YYYY-MM-DD"),
    current_user: dict = Depends(get_current_user),
):
    """
    Resumen financiero consolidado para un rango de fechas.

    Estructura de respuesta:
    ┌─ pl            → P&L solo con movimientos que afectan resultados
    │                   (no incluye traslados)
    ├─ caja_menor    → calculado por accounting_logic (ventas + egresos manuales)
    │                   para cada día del rango y luego agregado
    ├─ caja_mayor    → suma de ingresos/egresos con caja='caja_mayor'
    │                   registrados en este router
    └─ traslados     → resumen de traslados internos entre cajas
    """
    fecha_inicio = _parse_fecha(fecha_inicio)
    fecha_fin    = _parse_fecha(fecha_fin)

    filtro_rango = {"sede_id": sede_id, "fecha": {"$gte": fecha_inicio, "$lte": fecha_fin}}

    # ── Caja mayor: ingresos manuales ────────────────────────────────────────
    docs_ingresos_mayor = await cash_incomes.find({
        **filtro_rango,
        "caja"     : "caja_mayor",
        "eliminado": {"$ne": True},
    }).to_list(5000)

    # ── TODOS los egresos del rango (vivos y migrados, ambas cajas) ───────────
    # No filtramos por el campo `caja` porque muchos documentos no lo tienen
    # (egresos del cierre diario y migrados). En su lugar clasificamos por
    # MÉTODO DE PAGO: efectivo → caja menor, cualquier otro → caja mayor.
    # Excluimos traslados (no afectan P&L) y los docs migrados de
    # ingreso/movimiento de efectivo (solo queremos categoria=EGRESO de migrado).
    docs_egresos = await cash_expenses.find({
        **filtro_rango,
        "eliminado"      : {"$ne": True},
        "tipo_movimiento": {"$ne": "traslado"},
        "tipo"           : {"$ne": "traslado"},
        "categoria"      : {"$nin": ["INGRESO", "EFECTIVO", "ingreso", "efectivo"]},
    }).to_list(10000)

    # ── Traslados ─────────────────────────────────────────────────────────────
    docs_traslados = await cash_expenses.find({
        **filtro_rango,
        "tipo_movimiento": "traslado",
    }).to_list(1000)

    # ── Caja menor: ingresos reales via accounting_logic ─────────────────────
    # Iteramos día a día para usar la lógica contable existente correctamente.
    # Para rangos grandes el frontend debería usar reporte-periodo de routes_cash.
    from datetime import timedelta

    ingresos_efectivo_menor = 0.0
    total_vendido_menor     = 0.0

    inicio_dt = datetime.strptime(fecha_inicio, "%Y-%m-%d")
    fin_dt    = datetime.strptime(fecha_fin,    "%Y-%m-%d")
    dias      = (fin_dt - inicio_dt).days + 1

    # Balance corrido del efectivo físico, robusto a apertura diaria o base que rueda:
    #   • día CON apertura  → resetea el saldo a su efectivo_inicial.
    #   • día SIN apertura   → rueda el saldo del día anterior.
    saldo_fisico_run = None

    for offset in range(dias):
        fecha_dia = (inicio_dt + timedelta(days=offset)).strftime("%Y-%m-%d")
        try:
            apertura_dia = await _buscar_apertura(sede_id, fecha_dia)
            resumen_dia  = await calcular_resumen_dia(sede_id, fecha_dia)

            ing_ef_dia = float(resumen_dia.get("ingresos_efectivo", {}).get("total", 0) or 0)
            egr_ef_dia = float(resumen_dia.get("egresos", {}).get("total_efectivo", 0) or 0)

            ingresos_efectivo_menor += ing_ef_dia
            total_vendido_menor     += float(resumen_dia.get("total_vendido", 0) or 0)

            if apertura_dia is not None:
                opening = float(apertura_dia.get("efectivo_inicial", 0) or 0)
            elif saldo_fisico_run is not None:
                opening = saldo_fisico_run
            else:
                opening = float(resumen_dia.get("efectivo_inicial", 0) or 0)

            saldo_fisico_run = opening + ing_ef_dia - egr_ef_dia
        except Exception:
            # Si falla un día (sin apertura, sede no encontrada, etc.) continúa
            pass

    # ── Clasificación de egresos por método de pago ──────────────────────────
    total_egresos_menor = 0.0   # egresos en efectivo  → caja menor
    total_egresos_mayor = 0.0   # egresos no-efectivo  → caja mayor
    egresos_mayor_por_categoria: dict = {}

    for d in docs_egresos:
        monto  = float(d.get("monto", 0) or 0)
        metodo = _normalizar_metodo(
            d.get("metodo_pago") or d.get("medio_de_pago") or "efectivo"
        )
        if metodo == "efectivo":
            total_egresos_menor += monto
        else:
            total_egresos_mayor += monto
            # Categoría legible para el desglose de caja mayor
            cat = d.get("categoria")
            if not cat or str(cat).upper() == "EGRESO":
                cat = d.get("tipo") or "otro"
            egresos_mayor_por_categoria[cat] = (
                egresos_mayor_por_categoria.get(cat, 0) + monto
            )

    # ── Totales ───────────────────────────────────────────────────────────────
    # Ingresos manuales de caja mayor (solo informativo para el P&L).
    total_ingresos_mayor = sum(d.get("monto", 0) for d in docs_ingresos_mayor)

    # Ingresos NO efectivo (tarjeta, transferencia, link, addi…) → entran a la
    # caja mayor (el banco). total_vendido_menor incluye TODOS los métodos, así
    # que el resto sobre el efectivo es exactamente lo que va a caja mayor.
    ingresos_no_efectivo = max(total_vendido_menor - ingresos_efectivo_menor, 0.0)

    # P&L: total_vendido_menor YA incluye los ingresos manuales (menor y mayor),
    # porque accounting_logic suma cash_ingresos sin filtrar por caja. No se
    # vuelve a sumar total_ingresos_mayor (evita doble conteo).
    pl_ingresos = total_vendido_menor
    pl_egresos  = total_egresos_menor + total_egresos_mayor

    # Saldo de cada caja
    #   menor = efectivo:   ingresos efectivo − egresos efectivo
    #   mayor = banco:      ingresos no-efectivo − egresos no-efectivo
    # Con esto: consolidado (menor + mayor) == utilidad del P&L.
    saldo_caja_menor = ingresos_efectivo_menor - total_egresos_menor
    saldo_caja_mayor = ingresos_no_efectivo    - total_egresos_mayor

    total_menor_a_mayor = sum(
        d.get("monto", 0) for d in docs_traslados if d.get("caja_origen") == "caja_menor"
    )
    total_mayor_a_menor = sum(
        d.get("monto", 0) for d in docs_traslados if d.get("caja_origen") == "caja_mayor"
    )

    egresos_mayor_por_categoria = {
        k: round(v, 2) for k, v in egresos_mayor_por_categoria.items()
    }

    # ── Saldo físico de efectivo (caja menor) ────────────────────────────────
    # saldo_neto    = ingresos − egresos efectivo del rango (flujo) → alimenta el consolidado.
    # efectivo_inicial = apertura del primer día (informativo).
    # saldo_fisico  = balance corrido día a día (arriba), respetando aperturas diarias.
    #                 Es el efectivo real en el cajón al cierre del rango (para arqueo).
    apertura_ini = await _buscar_apertura(sede_id, fecha_inicio)
    efectivo_inicial_menor = float((apertura_ini or {}).get("efectivo_inicial", 0) or 0)
    saldo_fisico_efectivo = saldo_fisico_run if saldo_fisico_run is not None else 0.0

    # ── Reconciliación devengado ↔ caja ──────────────────────────────────────
    # ingresos_cobrado  = plata efectivamente recibida (= total_vendido, base caja).
    # ingresos_facturado = ventas del período. Se calcula EXACTAMENTE igual que el
    #   dashboard de ventas (sales_dashboard.py): suma de `desglose_pagos.total`
    #   por fecha_pago + sede, para que "Ingresos Ventas" del Estado de Resultados
    #   COINCIDA con el dashboard. (No usar `total` ni max(): el dashboard usa el pagado.)
    # anticipos_no_facturados = cobrado − facturado.
    fin_dt_fac = fin_dt.replace(hour=23, minute=59, second=59)
    docs_facturas = await sales_col.find({
        "sede_id"   : sede_id,
        "fecha_pago": {"$gte": inicio_dt, "$lte": fin_dt_fac},
    }).to_list(None)

    ingresos_facturado = sum(
        float((d.get("desglose_pagos") or {}).get("total", 0) or 0)
        for d in docs_facturas
    )

    ingresos_cobrado        = total_vendido_menor
    anticipos_no_facturados = max(round(ingresos_cobrado - ingresos_facturado, 2), 0.0)
    utilidad_facturado      = ingresos_facturado - pl_egresos

    return {
        "pl": {
            "ingresos"                   : round(pl_ingresos, 2),
            "ingresos_manuales_mayor"    : round(total_ingresos_mayor, 2),
            "egresos"                    : round(pl_egresos,  2),
            "egresos_menor_total"        : round(total_egresos_menor, 2),
            "egresos_mayor_total"        : round(total_egresos_mayor, 2),
            "egresos_mayor_por_categoria": egresos_mayor_por_categoria,
            "utilidad"                   : round(pl_ingresos - pl_egresos, 2),
            # ── Reconciliación devengado ↔ caja ──
            "ingresos_cobrado"           : round(ingresos_cobrado, 2),
            "ingresos_facturado"         : round(ingresos_facturado, 2),
            "anticipos_no_facturados"    : round(anticipos_no_facturados, 2),
            "utilidad_facturado"         : round(utilidad_facturado, 2),
            "aclaracion": "Utilidad sobre lo facturado (devengado); las cajas/consolidado son base "
                          "caja (cobrado). La diferencia son anticipos cobrados no facturados. "
                          "Egresos en efectivo = caja menor; el resto = caja mayor. "
                          "Los traslados internos no impactan el P&L.",
        },
        "caja_menor": {
            "ingresos_efectivo"    : round(ingresos_efectivo_menor, 2),
            "total_vendido"        : round(total_vendido_menor,     2),
            "egresos_manuales"     : round(total_egresos_menor,     2),
            "saldo_neto_efectivo"  : round(saldo_caja_menor,        2),
            "efectivo_inicial"     : round(efectivo_inicial_menor,  2),
            "saldo_fisico_efectivo": round(saldo_fisico_efectivo,   2),
            "aclaracion"           : "saldo_neto = ingresos − egresos del rango (flujo, alimenta el consolidado). "
                                     "saldo_fisico = balance corrido respetando aperturas diarias "
                                     "(efectivo real en caja, cuadra con el Excel).",
        },
        "caja_mayor": {
            "ingresos"        : round(ingresos_no_efectivo, 2),
            "ingresos_manuales": round(total_ingresos_mayor, 2),
            "egresos"         : round(total_egresos_mayor,  2),
            "saldo"           : round(saldo_caja_mayor,     2),
        },
        "consolidado": round(saldo_caja_mayor + saldo_caja_menor, 2),
        "traslados": {
            "menor_a_mayor": round(total_menor_a_mayor, 2),
            "mayor_a_menor": round(total_mayor_a_menor, 2),
            "cantidad"     : len(docs_traslados),
        },
    }