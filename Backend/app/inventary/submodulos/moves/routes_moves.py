from fastapi import APIRouter, HTTPException, Depends, Query
from app.database.mongo import (
    collection_inventory_motions,
    collection_inventory_reports,
    collection_inventarios,
    collection_productos,
    collection_locales,
)
from app.inventary.submodulos.moves.models import Traslado
from app.auth.routes import get_current_user
from app.utils.fecha_parser import resolver_rango
from app.utils.timezone import today
from typing import Optional, List
from datetime import datetime, timedelta
from bson import ObjectId

router = APIRouter(prefix="/movimientos")


# =========================================================
# 🧩 Helper: normaliza un doc de inventory_motions al
#    formato que espera el frontend
# =========================================================
def _motion_to_mov(doc: dict) -> list:
    """
    Un documento de inventory_motions puede tener N movimientos internos.
    Retorna una lista de filas (una por producto del doc).
    """
    rows = []
    sede_id = doc.get("sede_id", "")
    fecha = doc.get("fecha")
    creado_por = doc.get("creado_por", "")

    for m in doc.get("movimientos", []):
        tipo_raw = m.get("tipo_movimiento", "")
        cantidad = abs(m.get("cantidad", 0))
        tipo = "Salida"  # venta_cita y venta_venta son siempre salidas
        motivo_map = {
            "venta_cita": "Venta (cita)",
            "venta_venta": "Venta directa",
        }
        rows.append({
            "id": f"{str(doc['_id'])}-{m.get('producto_id')}",
            "producto": m.get("nombre_producto", m.get("producto_id", "")),
            "producto_id": m.get("producto_id"),
            "tipo": tipo,
            "cantidad": cantidad,
            "saldo": m.get("stock_nuevo", 0),
            "motivo": motivo_map.get(tipo_raw, tipo_raw),
            "usuario": m.get("usuario", creado_por),
            "fecha": fecha.isoformat() if isinstance(fecha, datetime) else str(fecha),
            "sede": sede_id,
            "referencia_tipo": m.get("referencia_tipo"),
            "referencia_id": str(m.get("referencia_id", "")),
            "origen": "sistema",  # venta automática
        })
    return rows


def _report_to_mov(doc: dict) -> list:
    """
    Un documento de inventory_reports tiene N items.
    Retorna una lista de filas (una por item).
    """
    rows = []
    tipo_doc = doc.get("tipo", "")
    tipo = "Entrada" if tipo_doc == "entrada" else "Salida"
    fecha = doc.get("fecha")
    sede_id = doc.get("sede_id", "")
    motivo = doc.get("motivo", "Ajuste")

    for item in doc.get("items", []):
        cantidad = item.get("cantidad", 0)
        rows.append({
            "id": f"{str(doc['_id'])}-{item.get('producto_id')}",
            "producto": item.get("nombre_producto", item.get("producto_id", "")),
            "producto_id": item.get("producto_id"),
            "tipo": tipo,
            "cantidad": abs(cantidad),
            "saldo": item.get("stock_nuevo", 0),
            "motivo": motivo,
            "observaciones": doc.get("observaciones"),
            "usuario": doc.get("creado_por", ""),
            "fecha": fecha.isoformat() if isinstance(fecha, datetime) else str(fecha),
            "sede": sede_id,
            "referencia_tipo": tipo_doc,
            "referencia_id": str(doc.get("_id", "")),
            "origen": "manual",
        })
    return rows


# =========================================================
# 📋 GET /movimientos — lista unificada
# =========================================================
@router.get("/", response_model=dict)
async def listar_movimientos(
    sede_id: Optional[str] = Query(None),
    tipo: Optional[str] = Query(None),
    producto_id: Optional[str] = Query(None),
    dias: Optional[int] = Query(7),
    fecha_desde: Optional[str] = Query(None, description="YYYY-MM-DD o DD-MM-YYYY"),
    fecha_hasta: Optional[str] = Query(None, description="YYYY-MM-DD o DD-MM-YYYY"),
    page: int = Query(1, ge=1),
    page_size: int = Query(50, ge=1, le=50),
    current_user: dict = Depends(get_current_user),
):
    rol = current_user.get("rol")
    if rol not in ["admin_sede", "super_admin", "recepcionista", "call_center"]:
        raise HTTPException(status_code=403, detail="No autorizado")

    effective_sede = current_user.get("sede_id") if rol in ["admin_sede", "recepcionista"] else sede_id

    inicio, fin = resolver_rango(dias, fecha_desde, fecha_hasta)  # ← único cambio
    query_base: dict = {"fecha": {"$gte": inicio, "$lte": fin}}   # ← agrega $lte
    if effective_sede:
        query_base["sede_id"] = effective_sede

    # 1️⃣ inventory_motions
    query_motions = dict(query_base)
    if producto_id:
        query_motions["movimientos.producto_id"] = producto_id

    motions_docs = await collection_inventory_motions.find(query_motions).sort("fecha", -1).to_list(None)

    # 2️⃣ inventory_reports
    query_reports = dict(query_base)
    if tipo:
        query_reports["tipo"] = tipo.lower()
    if producto_id:
        query_reports["items.producto_id"] = producto_id

    reports_docs = await collection_inventory_reports.find(query_reports).sort("fecha", -1).to_list(None)

    # Aplanar
    rows: list = []
    for doc in motions_docs:
        rows.extend(_motion_to_mov(doc))
    for doc in reports_docs:
        rows.extend(_report_to_mov(doc))

    # Filtrar por tipo si viene del query (motions siempre son Salida)
    if tipo:
        rows = [r for r in rows if r["tipo"].lower() == tipo.lower()]

    if producto_id:
        rows = [r for r in rows if r["producto_id"] == producto_id]

    # Ordenar por fecha desc
    rows.sort(key=lambda r: r["fecha"], reverse=True)

    # ── Paginación ───────────────────────────────────────────────────────
    total = len(rows)
    total_pages = max(1, -(-total // page_size))  # ceil sin math
    offset = (page - 1) * page_size
    page_data = rows[offset: offset + page_size]

    return {
        "data": page_data,
        "total": total,
        "page": page,
        "page_size": page_size,
        "total_pages": total_pages,
        "tiene_siguiente": page < total_pages,
        "tiene_anterior": page > 1,
    }


# =========================================================
# 🏆 GET /movimientos/top-productos
# =========================================================
@router.get("/top-productos", response_model=List[dict])
async def top_productos(
    sede_id: Optional[str] = Query(None),
    dias: int = Query(30),
    limit: int = Query(10, le=50),
    current_user: dict = Depends(get_current_user),
):
    """
    Top productos más vendidos (por cantidad de unidades salidas).
    Considera ventas automáticas (venta_cita + venta_venta).
    """
    rol = current_user.get("rol")
    if rol not in ["admin_sede", "super_admin", "recepcionista", "call_center"]:
        raise HTTPException(status_code=403, detail="No autorizado")

    if rol in ["admin_sede", "recepcionista", "call_center"]:
        effective_sede = current_user.get("sede_id")
    else:
        effective_sede = sede_id

    fecha_desde = datetime.now() - timedelta(days=dias)

    match: dict = {"fecha": {"$gte": fecha_desde}}
    if effective_sede:
        match["sede_id"] = effective_sede

    pipeline = [
        {"$match": match},
        {"$unwind": "$movimientos"},
        {"$match": {"movimientos.tipo_movimiento": {"$in": ["venta_cita", "venta_venta"]}}},
        {
            "$group": {
                "_id": "$movimientos.producto_id",
                "nombre_producto": {"$first": "$movimientos.nombre_producto"},
                "total_vendido": {"$sum": {"$abs": "$movimientos.cantidad"}},
            }
        },
        {"$sort": {"total_vendido": -1}},
        {"$limit": limit},
    ]

    result = await collection_inventory_motions.aggregate(pipeline).to_list(None)

    # Enriquecer con stock actual si tenemos sede
    top = []
    for item in result:
        row = {
            "producto_id": item["_id"],
            "nombre_producto": item["nombre_producto"],
            "total_vendido": item["total_vendido"],
            "stock_actual": None,
        }
        if effective_sede:
            inv = await collection_inventarios.find_one(
                {"producto_id": item["_id"], "sede_id": effective_sede}
            )
            row["stock_actual"] = inv["stock_actual"] if inv else None
        top.append(row)

    return top


# =========================================================
# 💤 GET /movimientos/sin-movimiento
# =========================================================
@router.get("/sin-movimiento", response_model=List[dict])
async def productos_sin_movimiento(
    sede_id: Optional[str] = Query(None),
    dias: int = Query(30, description="Considerar sin movimiento si no tuvo ventas en N días"),
    current_user: dict = Depends(get_current_user),
):
    """
    Productos que tienen stock pero no han tenido ventas en los últimos N días.
    """
    rol = current_user.get("rol")
    if rol not in ["admin_sede", "super_admin", "recepcionista", "call_center"]:
        raise HTTPException(status_code=403, detail="No autorizado")

    if rol in ["admin_sede", "recepcionista", "call_center"]:
        effective_sede = current_user.get("sede_id")
    else:
        effective_sede = sede_id

    # 1. Productos con stock en la sede
    inv_query: dict = {"stock_actual": {"$gt": 0}}
    if effective_sede:
        inv_query["sede_id"] = effective_sede

    inventarios = await collection_inventarios.find(inv_query).to_list(None)
    productos_con_stock = {inv["producto_id"] for inv in inventarios}

    # 2. Productos que SÍ tuvieron movimiento en el período
    fecha_desde = datetime.now() - timedelta(days=dias)
    match_mov: dict = {
        "fecha": {"$gte": fecha_desde},
        "movimientos.tipo_movimiento": {"$in": ["venta_cita", "venta_venta"]},
    }
    if effective_sede:
        match_mov["sede_id"] = effective_sede

    pipeline = [
        {"$match": match_mov},
        {"$unwind": "$movimientos"},
        {"$group": {"_id": "$movimientos.producto_id"}},
    ]
    con_movimiento_docs = await collection_inventory_motions.aggregate(pipeline).to_list(None)
    con_movimiento = {d["_id"] for d in con_movimiento_docs}

    # 3. Diferencia
    sin_movimiento_ids = productos_con_stock - con_movimiento

    result = []
    for inv in inventarios:
        if inv["producto_id"] not in sin_movimiento_ids:
            continue
        producto = await collection_productos.find_one({"id": inv["producto_id"]})
        result.append({
            "producto_id": inv["producto_id"],
            "nombre_producto": producto.get("nombre") if producto else inv.get("nombre"),
            "categoria": producto.get("categoria") if producto else None,
            "stock_actual": inv["stock_actual"],
            "stock_minimo": inv.get("stock_minimo", 0),
            "sede_id": inv["sede_id"],
            "dias_sin_movimiento": dias,
        })

    return sorted(result, key=lambda x: x["stock_actual"], reverse=True)


# =========================================================
# 🔀 POST /movimientos/traslado — trasladar stock entre sedes
# =========================================================
@router.post("/traslado", response_model=dict)
async def crear_traslado(
    traslado: Traslado,
    current_user: dict = Depends(get_current_user),
):
    """
    Traslada stock de uno o varios productos de una sede a otra.

    No corre dentro de una transacción de Mongo (ningún otro endpoint de
    inventario de este proyecto la usa), pero valida TODO antes de mutar
    nada: si un item del traslado falla, no se aplica ningún cambio.

    Registra el movimiento como dos entradas normales en inventory_reports
    (una "salida" en la sede origen, una "entrada" en la sede destino),
    ligadas por un `traslado_id` compartido — así se reutiliza el listado
    y el historial que ya existen (GET /movimientos, kardex por sede) sin
    tener que enseñarles un tipo de documento nuevo.
    """
    rol = current_user.get("rol")
    if rol not in ["admin_sede", "super_admin"]:
        raise HTTPException(status_code=403, detail="No autorizado para trasladar stock")

    data = traslado.dict()

    if rol == "admin_sede":
        user_sede_id = current_user.get("sede_id")
        if not user_sede_id:
            raise HTTPException(status_code=403, detail="Usuario sin sede asignada")
        data["sede_origen"] = user_sede_id
    elif not data.get("sede_origen"):
        raise HTTPException(status_code=400, detail="Debe especificar sede_origen")

    if data["sede_origen"] == data["sede_destino"]:
        raise HTTPException(status_code=400, detail="La sede destino debe ser distinta de la sede origen")

    if not traslado.items:
        raise HTTPException(status_code=400, detail="Debe incluir al menos un producto")

    sede_origen_doc = await collection_locales.find_one({"id": data["sede_origen"]})
    if not sede_origen_doc:
        raise HTTPException(status_code=404, detail=f"Sede origen '{data['sede_origen']}' no encontrada")
    sede_destino_doc = await collection_locales.find_one({"id": data["sede_destino"]})
    if not sede_destino_doc:
        raise HTTPException(status_code=404, detail=f"Sede destino '{data['sede_destino']}' no encontrada")

    fecha_actual = today(sede_origen_doc).replace(tzinfo=None) if sede_origen_doc else datetime.now()

    # ── Pasada 1: validar todo sin mutar nada ──────────────────────────────
    plan = []
    for item in traslado.items:
        if item.cantidad <= 0:
            raise HTTPException(status_code=400, detail=f"Cantidad debe ser positiva para {item.producto_id}")

        producto = await collection_productos.find_one({"id": item.producto_id})
        if not producto:
            raise HTTPException(status_code=404, detail=f"Producto {item.producto_id} no encontrado en catálogo")

        inv_origen = await collection_inventarios.find_one(
            {"producto_id": item.producto_id, "sede_id": data["sede_origen"]}
        )
        if not inv_origen:
            raise HTTPException(
                status_code=404,
                detail=f"No existe inventario de '{producto['nombre']}' en la sede origen",
            )
        if inv_origen["stock_actual"] < item.cantidad:
            raise HTTPException(
                status_code=400,
                detail=f"Stock insuficiente de '{producto['nombre']}' en sede origen (disponible: {inv_origen['stock_actual']})",
            )

        inv_destino = await collection_inventarios.find_one(
            {"producto_id": item.producto_id, "sede_id": data["sede_destino"]}
        )

        plan.append({
            "producto_id": item.producto_id,
            "nombre_producto": producto["nombre"],
            "cantidad": item.cantidad,
            "inv_origen": inv_origen,
            "inv_destino": inv_destino,
        })

    # ── Pasada 2: aplicar los cambios ───────────────────────────────────────
    traslado_id = str(ObjectId())
    items_reporte_origen = []
    items_reporte_destino = []

    for p in plan:
        cantidad = p["cantidad"]
        inv_origen = p["inv_origen"]
        inv_destino = p["inv_destino"]

        stock_origen_anterior = inv_origen["stock_actual"]
        stock_origen_nuevo = stock_origen_anterior - cantidad
        await collection_inventarios.update_one(
            {"_id": inv_origen["_id"]},
            {"$set": {"stock_actual": stock_origen_nuevo, "fecha_ultima_actualizacion": fecha_actual}},
        )

        if inv_destino:
            stock_destino_anterior = inv_destino["stock_actual"]
            stock_destino_nuevo = stock_destino_anterior + cantidad
            await collection_inventarios.update_one(
                {"_id": inv_destino["_id"]},
                {"$set": {"stock_actual": stock_destino_nuevo, "fecha_ultima_actualizacion": fecha_actual}},
            )
        else:
            # La sede destino nunca tuvo este producto asignado — se crea el
            # registro de inventario ahí mismo (mismo stock_minimo que traía
            # en origen, como default razonable) en vez de obligar a un paso
            # manual previo de "asignar producto a la sede".
            stock_destino_anterior = 0
            stock_destino_nuevo = cantidad
            await collection_inventarios.insert_one({
                "nombre": p["nombre_producto"],
                "producto_id": p["producto_id"],
                "sede_id": data["sede_destino"],
                "stock_actual": stock_destino_nuevo,
                "stock_minimo": inv_origen.get("stock_minimo", 0),
                "comision": None,
                "fecha_creacion": fecha_actual,
                "fecha_ultima_actualizacion": fecha_actual,
                "creado_por": current_user["email"],
            })

        items_reporte_origen.append({
            "producto_id": p["producto_id"],
            "nombre_producto": p["nombre_producto"],
            "cantidad": cantidad,
            "stock_anterior": stock_origen_anterior,
            "stock_nuevo": stock_origen_nuevo,
        })
        items_reporte_destino.append({
            "producto_id": p["producto_id"],
            "nombre_producto": p["nombre_producto"],
            "cantidad": cantidad,
            "stock_anterior": stock_destino_anterior,
            "stock_nuevo": stock_destino_nuevo,
        })

        print(
            f"🔀 TRASLADO: {p['nombre_producto']} x{cantidad} — "
            f"{data['sede_origen']} ({stock_origen_anterior}→{stock_origen_nuevo}) → "
            f"{data['sede_destino']} ({stock_destino_anterior}→{stock_destino_nuevo})"
        )

    reporte_salida = {
        "tipo": "salida",
        "sede_id": data["sede_origen"],
        "motivo": f"Traslado a {sede_destino_doc.get('nombre', data['sede_destino'])}",
        "observaciones": data.get("observaciones"),
        "items": items_reporte_origen,
        "fecha": fecha_actual,
        "creado_por": current_user["email"],
        "traslado_id": traslado_id,
        "sede_relacionada": data["sede_destino"],
    }
    reporte_entrada = {
        "tipo": "entrada",
        "sede_id": data["sede_destino"],
        "motivo": f"Traslado desde {sede_origen_doc.get('nombre', data['sede_origen'])}",
        "observaciones": data.get("observaciones"),
        "items": items_reporte_destino,
        "fecha": fecha_actual,
        "creado_por": current_user["email"],
        "traslado_id": traslado_id,
        "sede_relacionada": data["sede_origen"],
    }
    await collection_inventory_reports.insert_many([reporte_salida, reporte_entrada])

    print(f"✅ EVENTO: traslado.created -> {traslado_id} ({data['sede_origen']} → {data['sede_destino']})")

    return {
        "msg": "Traslado registrado exitosamente",
        "traslado_id": traslado_id,
        "sede_origen": data["sede_origen"],
        "sede_destino": data["sede_destino"],
        "items": items_reporte_origen,
    }