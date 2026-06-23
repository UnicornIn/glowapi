from fastapi import APIRouter, HTTPException, Depends, Query
from datetime import datetime
from typing import Optional, List
from bson import ObjectId
import random
import asyncio
from datetime import timedelta
from pydantic import BaseModel, Field

from app.database.mongo import collection_giftcards
from app.giftcards.routes_giftcards import _estado_giftcard
from app.cash.utils_cash import fecha_a_datetime
from app.utils.timezone import today_str, today
from app.bills.alegra_integration import emit_invoice_to_alegra, initialize_manual_electronic_status

from app.database.mongo import (
    collection_citas,
    collection_servicios,
    collection_commissions,
    collection_clients,
    collection_locales,
    collection_invoices,
    collection_sales,
    collection_inventarios,
    collection_inventory_motions,
    collection_inventory_reports,
    collection_auth,
    collection_productos,
    collection_estilista
)
from app.auth.routes import get_current_user

from app.commissions.comision_engine import (
    resolver_config_comision, calcular_comision
)
from app.commissions.comision_context import construir_contexto, recalcular_comisiones_periodo

router = APIRouter()

# ══════════════════════════════════════════════════════════════
# MODELOS
# ══════════════════════════════════════════════════════════════
 
class AnulacionRequest(BaseModel):
    motivo: Optional[str] = None
 
 
class EditarVentaRequest(BaseModel):
    """Solo campos editables en ventas no facturadas."""
    notas: Optional[str] = None
    descuento_porcentaje: Optional[float] = None
    descuento_motivo: Optional[str] = None
    profesional_id: Optional[str] = None
    profesional_nombre: Optional[str] = None

class FacturarRequest(BaseModel):
    descuento_porcentaje: Optional[float] = 0   # ej: 10 = 10%
    descuento_motivo: Optional[str] = ""

def _normalizar_categoria(valor: Optional[str]) -> str:
    """Normaliza nombre de categoría para comparación robusta."""
    return (valor or "").strip().lower()

def obtener_porcentaje_comision_producto(
    producto_db: dict,
    vendedor_doc: Optional[dict] = None,        # estilista O usuario auth
    inventario_db: Optional[dict] = None,
) -> float:
    """
    Prioridad:
    1. comision_productos del vendedor (estilista o usuario auth)
    2. comision del inventario de esa sede
    3. comision global del producto
    4. 0
    """
    if vendedor_doc:
        comision_vendedor = vendedor_doc.get("comision_productos")
        if comision_vendedor is not None:
            try:
                return float(comision_vendedor)
            except (TypeError, ValueError):
                pass

    if inventario_db:
        comision_inv = inventario_db.get("comision")
        if comision_inv is not None:
            try:
                return float(comision_inv)
            except (TypeError, ValueError):
                pass

    try:
        return float(producto_db.get("comision", 0) or 0)
    except (TypeError, ValueError):
        return 0.0

def _obtener_porcentaje_comision_servicio(servicio_db: dict, profesional_db: Optional[dict]) -> float:
    """
    Prioridad:
    1) comisión por categoría del estilista (si existe y coincide)
    2) comisión fija del servicio (comision_estilista)
    """
    if profesional_db:
        comisiones_categoria = profesional_db.get("comisiones_por_categoria") or {}
        categoria_servicio = _normalizar_categoria(servicio_db.get("categoria"))
        print(f"🔍 categoria_servicio='{categoria_servicio}' | claves={list(comisiones_categoria.keys())}")

        if categoria_servicio and isinstance(comisiones_categoria, dict):
            for categoria, porcentaje in comisiones_categoria.items():
                if _normalizar_categoria(categoria) == categoria_servicio:
                    try:
                        return float(porcentaje)
                    except (TypeError, ValueError):
                        break

    try:
        return float(servicio_db.get("comision_estilista", 0) or 0)
    except (TypeError, ValueError):
        return 0

def _limpiar(obj):
    """Serializa ObjectId y datetime recursivamente."""
    if isinstance(obj, ObjectId):
        return str(obj)
    if isinstance(obj, datetime):
        return obj.isoformat()
    if isinstance(obj, dict):
        return {k: _limpiar(v) for k, v in obj.items()}
    if isinstance(obj, list):
        return [_limpiar(i) for i in obj]
    return obj
 
 
def _num(valor: float):
    return int(valor) if valor == int(valor) else valor

async def _revertir_inventario(
    items: list,
    sede_id: str,
    referencia_id: str,
    referencia_tipo: str,
    numero_comprobante: str,
    fecha_actual: datetime,
    email_usuario: str,
):
    """
    Suma de vuelta al inventario cada producto de la venta/factura anulada
    y registra el movimiento en inventory_reports.
    """
    movimientos = []
 
    for item in items:
        if item.get("tipo") != "producto":
            continue
 
        producto_id = item.get("producto_id")
        cantidad = item.get("cantidad", 0)
        if not producto_id or cantidad <= 0:
            continue
 
        inventario = await collection_inventarios.find_one({
            "producto_id": producto_id,
            "sede_id": sede_id,
        })
        if not inventario:
            print(f"⚠️ Sin inventario para revertir: {item.get('nombre')} ({producto_id})")
            continue
 
        stock_anterior = inventario["stock_actual"]
        nuevo_stock = stock_anterior + cantidad
 
        await collection_inventarios.update_one(
            {"_id": inventario["_id"]},
            {"$set": {
                "stock_actual": nuevo_stock,
                "fecha_ultima_actualizacion": fecha_actual,
            }},
        )
 
        movimientos.append({
            "producto_id": producto_id,
            "nombre_producto": item.get("nombre"),
            "cantidad": cantidad,           # positivo = entrada
            "tipo_movimiento": f"anulacion_{referencia_tipo}",
            "stock_anterior": stock_anterior,
            "stock_nuevo": nuevo_stock,
            "referencia_id": referencia_id,
            "referencia_tipo": referencia_tipo,
            "numero_comprobante": numero_comprobante,
            "usuario": email_usuario,
        })
        print(f"📈 Inventario revertido: {item.get('nombre')} ({stock_anterior} → {nuevo_stock})")
 
    if movimientos:
        await collection_inventory_reports.insert_one({
            "tipo": "entrada",
            "sede_id": sede_id,
            "motivo": f"anulacion_{referencia_tipo}",
            "observaciones": f"Reversión automática por anulación {referencia_tipo} {numero_comprobante}",
            "items": [
                {
                    "producto_id": m["producto_id"],
                    "nombre_producto": m["nombre_producto"],
                    "cantidad": m["cantidad"],
                    "stock_anterior": m["stock_anterior"],
                    "stock_nuevo": m["stock_nuevo"],
                }
                for m in movimientos
            ],
            "fecha": fecha_actual,
            "creado_por": email_usuario,
        })
 
    return movimientos
 
 
async def _revertir_comision(
    items: list,
    sede_id: str,
    numero_comprobante: str,
    origen_id: str,
    origen_tipo: str,
):
    """
    Elimina del registro de comisiones los ítems vinculados a este
    comprobante y recalcula el total del documento.
    Afecta tanto servicios_detalle como productos_detalle.
    """
    comisiones_afectadas = await collection_commissions.find({
        "sede_id": sede_id,
        "estado": "pendiente",
        "$or": [
            {"servicios_detalle.numero_comprobante": numero_comprobante},
            {"productos_detalle.numero_comprobante": numero_comprobante},
            {"servicios_detalle.origen_id": origen_id},
            {"productos_detalle.origen_id": origen_id},
        ],
    }).to_list(None)
 
    for comision_doc in comisiones_afectadas:
        servicios_originales = comision_doc.get("servicios_detalle", [])
        productos_originales = comision_doc.get("productos_detalle", [])
 
        servicios_filtrados = [
            s for s in servicios_originales
            if s.get("numero_comprobante") != numero_comprobante
            and s.get("origen_id") != origen_id
        ]
        productos_filtrados = [
            p for p in productos_originales
            if p.get("numero_comprobante") != numero_comprobante
            and p.get("origen_id") != origen_id
        ]
 
        monto_revertido_srv = round(sum(
            float(s.get("valor_comision", 0))
            for s in servicios_originales
            if s not in servicios_filtrados
        ), 2)
        monto_revertido_prod = round(sum(
            float(p.get("valor_comision", 0))
            for p in productos_originales
            if p not in productos_filtrados
        ), 2)
        total_revertido = round(monto_revertido_srv + monto_revertido_prod, 2)
 
        nuevo_total = max(0.0, round(
            float(comision_doc.get("total_comisiones", 0)) - total_revertido, 2
        ))
 
        await collection_commissions.update_one(
            {"_id": comision_doc["_id"]},
            {"$set": {
                "servicios_detalle": servicios_filtrados,
                "productos_detalle": productos_filtrados,
                "total_comisiones": _num(nuevo_total),
                "ultima_actualizacion": datetime.now(),
            }},
        )
        print(
            f"💸 Comisión revertida en doc {comision_doc['_id']}: "
            f"-{total_revertido} (srv:{monto_revertido_srv} | prod:{monto_revertido_prod})"
        )
 
    return len(comisiones_afectadas)
 
 
async def _liberar_giftcard_si_aplica(
    historial_pagos: list,
    numero_comprobante: str,
    referencia_id: str,
    referencia_tipo: str,
    fecha_actual: datetime,
    email_usuario: str,
):
    """
    Si en el historial de pagos hay un método 'giftcard', busca el código
    en collection_giftcards y revierte la redención (devuelve saldo).
    """
    monto_giftcard = round(sum(
        float(p.get("monto", 0))
        for p in historial_pagos
        if p.get("metodo") == "giftcard"
    ), 2)
 
    if monto_giftcard <= 0:
        return False
 
    # Buscar giftcard cuyo historial tenga una redención vinculada
    llave = "cita_id" if referencia_tipo == "cita" else "venta_id"
    gc_doc = await collection_giftcards.find_one({
        "historial": {
            "$elemMatch": {
                llave: referencia_id,
                "tipo": "redencion",
            }
        }
    })
 
    if not gc_doc:
        print(f"⚠️ No se encontró giftcard redimida para {referencia_tipo} {referencia_id}")
        return False
 
    nuevo_disponible = round(float(gc_doc.get("saldo_disponible", 0)) + monto_giftcard, 2)
    nuevo_usado = max(0.0, round(float(gc_doc.get("saldo_usado", 0)) - monto_giftcard, 2))
 
    await collection_giftcards.update_one(
        {"_id": gc_doc["_id"]},
        {
            "$set": {
                "saldo_disponible": nuevo_disponible,
                "saldo_usado": nuevo_usado,
            },
            "$push": {"historial": {
                "tipo": "reverso_anulacion",
                llave: referencia_id,
                "numero_comprobante": numero_comprobante,
                "monto": monto_giftcard,
                "fecha": fecha_actual,
                "registrado_por": email_usuario,
                "motivo": f"anulacion_{referencia_tipo}",
            }},
        },
    )
    print(f"🎁 Giftcard {gc_doc.get('codigo')}: devueltos {monto_giftcard} por anulación")
    return True
 
 
async def _ejecutar_anulacion(
    *,
    doc_sale: dict,
    doc_invoice: dict,
    sede,
    email_usuario: str,
    rol_usuario: str,
    motivo: Optional[str] = None,
) -> dict:
    """
    Núcleo de la anulación. Recibe el documento de venta y/o factura
    (pueden ser el mismo o distintos) y ejecuta:
      1. Marca sale + invoice como anulados
      2. Revierte inventario
      3. Revierte comisiones
      4. Libera giftcard si aplica
      5. Actualiza cita origen si corresponde
    Devuelve un dict con el resumen de lo que se revirtió.
    """
    sede_id = (doc_sale or doc_invoice).get("sede_id")
    fecha_actual = today(sede).replace(tzinfo=None)
    numero_comprobante = (doc_sale or doc_invoice).get("numero_comprobante", "")
    tipo_origen = (doc_sale or doc_invoice).get("tipo_origen", "")
    origen_id = (doc_sale or doc_invoice).get("origen_id", "")
 
    items = (doc_sale or doc_invoice).get("items", [])
    historial_pagos = (doc_sale or doc_invoice).get("historial_pagos", [])
 
    campos_anulacion = {
        "estado_factura": "anulado",
        "estado_pago": "anulado",
        "anulado_por": email_usuario,
        "fecha_anulacion": fecha_actual,
        "motivo_anulacion": motivo or "Sin motivo indicado",
    }
 
    # 1️⃣ Marcar documentos como anulados
    if doc_sale:
        await collection_sales.update_one(
            {"_id": doc_sale["_id"]},
            {"$set": campos_anulacion},
        )
 
    if doc_invoice:
        await collection_invoices.update_one(
            {"_id": doc_invoice["_id"]},
            {"$set": {**campos_anulacion, "estado": "anulado"}},
        )
 
    # 2️⃣ Revertir inventario
    ref_id = str(doc_sale["_id"]) if doc_sale else str(doc_invoice["_id"])
    movimientos_inv = await _revertir_inventario(
        items=items,
        sede_id=sede_id,
        referencia_id=ref_id,
        referencia_tipo=tipo_origen or "venta",
        numero_comprobante=numero_comprobante,
        fecha_actual=fecha_actual,
        email_usuario=email_usuario,
    )
 
    # 3️⃣ Revertir comisiones
    comisiones_afectadas = await _revertir_comision(
        items=items,
        sede_id=sede_id,
        numero_comprobante=numero_comprobante,
        origen_id=origen_id,
        origen_tipo=tipo_origen or "venta",
    )
 
    # 4️⃣ Liberar giftcard si aplica
    giftcard_revertida = await _liberar_giftcard_si_aplica(
        historial_pagos=historial_pagos,
        numero_comprobante=numero_comprobante,
        referencia_id=origen_id,
        referencia_tipo=tipo_origen or "venta",
        fecha_actual=fecha_actual,
        email_usuario=email_usuario,
    )
 
    # 5️⃣ Actualizar cita origen si aplica
    cita_actualizada = False
    if tipo_origen == "cita" and origen_id:
        try:
            await collection_citas.update_one(
                {"_id": ObjectId(origen_id)},
                {"$set": {
                    "estado": "cancelada",
                    "estado_pago": "anulado",
                    "estado_factura": "anulado",
                    "fecha_anulacion_factura": fecha_actual,
                    "anulado_por": email_usuario,
                }},
            )
            cita_actualizada = True
            print(f"📅 Cita {origen_id} marcada como cancelada por anulación")
        except Exception as e:
            print(f"⚠️ No se pudo actualizar cita {origen_id}: {e}")
 
    return {
        "productos_revertidos": len(movimientos_inv),
        "comisiones_afectadas": comisiones_afectadas,
        "giftcard_revertida": giftcard_revertida,
        "cita_actualizada": cita_actualizada,
    }

def generar_numero_comprobante() -> str:
    return str(random.randint(10000000, 99999999))

def generar_identificador() -> str:
    return str(random.randint(10000000, 99999999))


@router.post("/quotes/facturar/{id}")
async def facturar_cita_o_venta(
    id: str,
    tipo: str = Query("cita", regex="^(cita|venta)$"),
    body: FacturarRequest = FacturarRequest(),   # ← opcional, default sin descuento
    current_user: dict = Depends(get_current_user)
):
    print(f"🔍 Facturar invocada por {current_user.get('email')} (rol={current_user.get('rol')})")
    print(f"📋 ID: {id}, Tipo: {tipo}")

    if current_user["rol"] not in ["admin_sede", "super_admin", "recepcionista", "call_center"]:
        raise HTTPException(status_code=403, detail="No autorizado para facturar")

    # ====================================
    # 1️⃣ BUSCAR Y VALIDAR DOCUMENTO
    # ====================================
    if tipo == "cita":
        documento = await collection_citas.find_one({"_id": ObjectId(id)})
        if not documento:
            raise HTTPException(status_code=404, detail="Cita no encontrada")
        if documento.get("estado_factura") == "facturado":
            raise HTTPException(status_code=400, detail="La cita ya está facturada")
        print("✅ Cita lista para facturar")
    else:
        documento = await collection_sales.find_one({"_id": ObjectId(id)})
        if not documento:
            raise HTTPException(status_code=404, detail="Venta no encontrada")
        if documento.get("estado_factura") == "facturado":
            raise HTTPException(status_code=400, detail="Esta venta ya fue facturada")
        print("✅ Venta lista para facturar")

    # ====================================
    # 2️⃣ OBTENER DATOS BÁSICOS
    # ====================================
    cliente_id = documento.get("cliente_id")   # ⭐ FIX: .get() — puede ser None en ventas directas
    sede_id = documento["sede_id"]
    profesional_id = documento.get("profesional_id")
    profesional_nombre = documento.get("profesional_nombre", "")
    profesional_db = None
    if profesional_id:
        profesional_db = await collection_estilista.find_one({"profesional_id": profesional_id})

    sede = await collection_locales.find_one({"sede_id": sede_id})
    if not sede:
        raise HTTPException(status_code=404, detail="Sede no encontrada")

    moneda_sede = sede.get("moneda", "COP")
    reglas_comision = sede.get("reglas_comision", {"tipo": "servicios"})
    tipo_comision = reglas_comision.get("tipo", "servicios")

    print(f"💰 Moneda: {moneda_sede}, Tipo comisión: {tipo_comision}")

    # ⭐ FIX: cliente opcional (ventas de mostrador sin cliente_id)
    cliente = None
    if cliente_id:
        cliente = await collection_clients.find_one({"cliente_id": cliente_id})
        if not cliente:
            raise HTTPException(status_code=404, detail="Cliente no encontrado")

    nombre_cliente = (
        (cliente.get("nombre", "") + " " + cliente.get("apellido", "")).strip()
        if cliente else "Venta de mostrador"
    )
    cedula_cliente  = cliente.get("cedula", "")  if cliente else ""
    email_cliente   = cliente.get("correo", "")  if cliente else ""
    telefono_cliente = cliente.get("telefono", "") if cliente else ""

    # ====================================
    # 3️⃣ PREPARAR ITEMS - SERVICIOS
    # ====================================
    items = []
    total_comision_servicios = 0
    servicios_cita = []  # ⭐ FIX: inicializar siempre — ventas directas no tienen servicios

    if tipo == "cita":
        servicios_cita = documento.get("servicios", [])

    if servicios_cita:
        print(f"📋 Procesando {len(servicios_cita)} servicios (nueva estructura)")
        for servicio_item in servicios_cita:
            servicio_id = servicio_item.get("servicio_id")
            nombre = servicio_item.get("nombre", "Servicio")
            precio = servicio_item.get("precio", 0)          # precio unitario
            cantidad = int(servicio_item.get("cantidad", 1)) # ← leer cantidad real
            subtotal = servicio_item.get("subtotal", round(precio * cantidad, 2))  # ← usar subtotal guardado

            comision_servicio = 0
            servicio_db = None          # ⭐ FIX: inicializar — puede no consultarse (ej. comisión por "productos")
            comision_porcentaje = 0     # ⭐ FIX: inicializar — evita UnboundLocalError
            if tipo_comision in ["servicios", "mixto"] and profesional_id:
                servicio_db = await collection_servicios.find_one({"servicio_id": servicio_id})
                if servicio_db:
                    comision_porcentaje = _obtener_porcentaje_comision_servicio(servicio_db, profesional_db)
                    comision_servicio = round((subtotal * comision_porcentaje) / 100, 2)  # ← sobre subtotal
                    total_comision_servicios += comision_servicio

            items.append({
                "tipo": "servicio",
                "servicio_id": servicio_id,
                "nombre": nombre,
                "categoria": servicio_db.get("categoria", "") if servicio_db else "",
                "porcentaje_comision": comision_porcentaje,
                "cantidad": cantidad,           # ← cantidad real
                "precio_unitario": precio,
                "subtotal": subtotal,           # ← subtotal real
                "moneda": moneda_sede,
                "comision": comision_servicio
            })
            print(f"  ✅ {nombre}: ${precio} (comisión: ${comision_servicio})")

    elif documento.get("servicio_id"):
        # Estructura muy antigua (un solo servicio)
        print(f"📋 Procesando servicio único (estructura muy antigua)")
        servicio_id = documento["servicio_id"]
        servicio_nombre = documento.get("servicio_nombre", "")

        servicio = await collection_servicios.find_one({"servicio_id": servicio_id})
        if not servicio:
            raise HTTPException(status_code=404, detail="Servicio no encontrado")

        # ⭐ PRIORIDAD DE PRECIO:
        # 1. precio_personalizado explícito
        # 2. valor_total de la cita (citas migradas/antiguas) ← NUEVO
        # 3. precio del servicio en BD (fallback)
        precio_personalizado = documento.get("precio_fue_personalizado", False)
        precio_custom = documento.get("precio_personalizado", 0)

        if precio_personalizado and precio_custom > 0:
            precio_servicio = precio_custom
            print(f"  💰 Precio personalizado: {precio_servicio}")
        elif documento.get("valor_total", 0) > 0:
            precio_servicio = documento["valor_total"]   # ← usa lo que se cobró realmente
            print(f"  💰 Precio desde valor_total (estructura migrada): {precio_servicio}")
        else:
            precios_servicio = servicio.get("precios", {})
            if moneda_sede not in precios_servicio:
                raise HTTPException(status_code=400, detail=f"El servicio no tiene precio en {moneda_sede}")
            precio_servicio = precios_servicio[moneda_sede]

        comision_servicio = 0
        if tipo_comision in ["servicios", "mixto"] and profesional_id:
            comision_porcentaje = servicio.get("comision_estilista", 0)
            comision_servicio = round((precio_servicio * comision_porcentaje) / 100, 2)
            total_comision_servicios = comision_servicio

        items.append({
            "tipo": "servicio",
            "servicio_id": servicio_id,
            "nombre": servicio_nombre,
            "cantidad": 1,
            "precio_unitario": precio_servicio,
            "subtotal": precio_servicio,
            "moneda": moneda_sede,
            "comision": comision_servicio
        })

    # ====================================
    # 4️⃣ PREPARAR ITEMS - PRODUCTOS
    # ====================================
    total_comision_productos = 0
    unidades_producto_factura = 0
    recalculo_escalonado_productos = None
    periodo_productos_inicio_str = None
    periodo_productos_fin_str = None

    if tipo == "cita":
        productos_lista = documento.get("productos", [])
    else:
        productos_lista = []
        for item in documento.get("items", []):
            if item.get("tipo") == "producto":
                productos_lista.append({
                    "producto_id": item["producto_id"],
                    "nombre": item["nombre"],
                    "cantidad": item["cantidad"],
                    "precio_unitario": item["precio_unitario"],
                    "subtotal": item["subtotal"],
                    "comision_ya_calculada": item.get("comision", None),  # ← preservar
                    "comision_tipo": item.get("comision_tipo"),
                    "comision_porcentaje": item.get("comision_porcentaje"),
                    "agregado_por_rol": item.get("agregado_por_rol", ""),
                    "agregado_por_email": item.get("agregado_por_email", ""),
                })

    for producto in productos_lista:
        producto_id = producto.get("producto_id")
        precio_producto = producto.get("precio_unitario", 0)
        cantidad = producto.get("cantidad", 1)
        subtotal_producto = producto.get("subtotal", precio_producto * cantidad)

        comision_producto = 0
        comision_tipo_aplicado = producto.get("comision_tipo")
        comision_valor_aplicado = producto.get("comision_porcentaje", 0)
        agregado_por_rol = producto.get("agregado_por_rol", "")
        agregado_por_email = producto.get("agregado_por_email", "")
        comision_ya_calculada = producto.get("comision_ya_calculada")

        if comision_ya_calculada is not None:
            # Venta directa ya comisionada — respetar el valor guardado
            comision_producto = float(comision_ya_calculada)
            total_comision_productos += comision_producto

        elif tipo_comision in ["productos", "mixto"]:
            producto_db_item = await collection_productos.find_one({"id": producto_id})
            if producto_db_item:
                inventario_db = await collection_inventarios.find_one({
                    "producto_id": producto_id,
                    "sede_id": sede_id
                })

                ROLES_PRODUCTO_PROPIO = {"recepcionista", "call_center", "admin_sede"}

                # Resolver quién es el vendedor (misma prioridad de antes)
                if agregado_por_rol in ROLES_PRODUCTO_PROPIO and agregado_por_email:
                    vendedor_doc = await collection_auth.find_one(
                        {"correo_electronico": agregado_por_email}
                    )
                    vendedor_profesional_id = str(vendedor_doc["_id"]) if vendedor_doc else None
                elif profesional_id:
                    vendedor_doc = profesional_db
                    vendedor_profesional_id = profesional_id
                else:
                    vendedor_doc = None
                    vendedor_profesional_id = None

                # ── Nuevo engine ──────────────────────────────────────
                config = resolver_config_comision(producto_db_item, vendedor_doc, inventario_db, sede)

                ctx = await construir_contexto(
                    profesional_id=vendedor_profesional_id,
                    sede_id=sede_id,
                    cantidad_actual=cantidad,
                    moneda_sede=moneda_sede,
                    vendedor_nombre=(vendedor_doc or {}).get("nombre") or profesional_nombre,
                )
                ctx.cantidad_acumulada_periodo += unidades_producto_factura
                periodo_productos_inicio_str = ctx.inicio_periodo.strftime("%Y-%m-%d")
                periodo_productos_fin_str = ctx.fin_periodo.strftime("%Y-%m-%d")

                resultado = calcular_comision(config, subtotal_producto, ctx)
                comision_producto = resultado.valor
                comision_tipo_aplicado = config.tipo

                if config.tipo in ("porcentaje", "fijo", "por_unidad"):
                    comision_valor_aplicado = config.valor
                elif config.tipo == "escalonado" and resultado.nivel_nuevo:
                    comision_valor_aplicado = resultado.nivel_nuevo.valor
                    comision_tipo_aplicado = resultado.nivel_nuevo.tipo
                elif config.tipo == "escalonado":
                    total_escalonado = ctx.cantidad_acumulada_periodo + ctx.cantidad_actual
                    tramo_activo = next(
                        (t for t in sorted(config.tramos, key=lambda t: t.desde)
                        if total_escalonado >= t.desde and (t.hasta is None or total_escalonado <= t.hasta)),
                        None
                    )
                    if tramo_activo:
                        comision_valor_aplicado = tramo_activo.valor
                        comision_tipo_aplicado = tramo_activo.tipo

                if config.tipo == "escalonado" and comision_valor_aplicado and vendedor_profesional_id:
                    recalculo_escalonado_productos = {
                        "profesional_id": vendedor_profesional_id,
                        "nuevo_porcentaje": comision_valor_aplicado,
                        "nuevo_tipo": comision_tipo_aplicado,
                        "inicio_periodo": ctx.inicio_periodo,
                        "fin_periodo": ctx.fin_periodo,
                    }
                    await recalcular_comisiones_periodo(
                        profesional_id=vendedor_profesional_id,
                        sede_id=sede_id,
                        nuevo_porcentaje=comision_valor_aplicado,
                        nuevo_tipo=comision_tipo_aplicado,
                        inicio_periodo=ctx.inicio_periodo,
                        fin_periodo=ctx.fin_periodo,
                    )
                # ─────────────────────────────────────────────────────

                total_comision_productos += comision_producto
                unidades_producto_factura += cantidad

        items.append({
            "tipo": "producto",
            "producto_id": producto_id,
            "nombre": producto.get("nombre"),
            "cantidad": cantidad,
            "precio_unitario": precio_producto,
            "subtotal": subtotal_producto,
            "moneda": moneda_sede,
            "comision": comision_producto,
            "comision_tipo": comision_tipo_aplicado,
            "comision_porcentaje": comision_valor_aplicado,
        })
        print(f"  🛍️ {producto.get('nombre')}: ${subtotal_producto} (comisión: ${comision_producto})")

    # ====================================
    # 5️⃣ CALCULAR TOTALES
    # ====================================
    total_productos_servicios = round(sum(item["subtotal"] for item in items), 2)
    costo_domicilio = round(float(documento.get("domicilio", 0) or 0), 2)

    # ⭐ DESCUENTO OPCIONAL
    descuento_porcentaje = round(float(body.descuento_porcentaje or 0), 2)
    descuento_porcentaje = max(0.0, min(descuento_porcentaje, 100.0))  # clamp 0-100
    descuento_valor = round((total_productos_servicios * descuento_porcentaje) / 100, 2)
    descuento_motivo = (body.descuento_motivo or "").strip() or None

    total_final = round(total_productos_servicios - descuento_valor + costo_domicilio, 2)
    valor_comision_total = round(total_comision_servicios + total_comision_productos, 2)

    print(f"💰 Total: ${total_final} {moneda_sede} | Descuento: {descuento_porcentaje}% (-${descuento_valor}) | Comisión: ${valor_comision_total}")

    # ====================================
    # 6️⃣ GENERAR NÚMEROS ÚNICOS
    # ====================================
    numero_comprobante = generar_numero_comprobante()
    identificador = generar_identificador()
    fecha_actual = today(sede).replace(tzinfo=None)

    # ⭐ fecha_pago: para citas = fecha en que ocurrió la cita (no cuando se facturó)
    #               para ventas directas = fecha_actual (como siempre)
    if tipo == "cita":
        try:
            fecha_pago = datetime.strptime(documento["fecha"], "%Y-%m-%d")
        except (KeyError, ValueError):
            # fallback defensivo: si la cita no tiene fecha válida, usar fecha actual
            fecha_pago = fecha_actual
    else:
        fecha_pago = fecha_actual

    # ====================================
    # 7️⃣ HISTORIAL Y DESGLOSE DE PAGOS
    # ====================================
    historial_pagos = documento.get("historial_pagos", [])
    if not historial_pagos:
        raise ValueError("No se puede facturar sin historial de pagos")

    desglose_pagos = {}
    total_pagado = 0.0
    for pago in historial_pagos:
        metodo = pago.get("metodo")
        monto = float(pago.get("monto", 0))
        if not metodo or monto <= 0:
            continue
        desglose_pagos[metodo] = round(desglose_pagos.get(metodo, 0) + monto, 2)
        total_pagado += monto

    desglose_pagos["total"] = round(total_pagado, 2)

    if round(total_pagado, 2) < round(total_final, 2):
        raise ValueError(
            f"Pago insuficiente: pagado={total_pagado}, total_factura={total_final}"
        )

    # ====================================
    # 8️⃣ CREAR/ACTUALIZAR VENTA EN SALES
    # ====================================
    if tipo == "cita":
        venta = {
            "identificador": identificador,
            "tipo_origen": "cita",
            "origen_id": id,
            "fecha_pago": fecha_pago,
            "local": sede.get("nombre"),
            "sede_id": sede_id,
            "moneda": moneda_sede,
            "tipo_comision": tipo_comision,
            "cliente_id": cliente_id,
            "nombre_cliente": nombre_cliente,
            "cedula_cliente": cedula_cliente,
            "email_cliente": email_cliente,
            "telefono_cliente": telefono_cliente,
            "items": items,
            "historial_pagos": historial_pagos,
            "desglose_pagos": desglose_pagos,
            "profesional_id": profesional_id,
            "profesional_nombre": profesional_nombre,
            "descuento_porcentaje": descuento_porcentaje,  # ⭐
            "descuento_valor": descuento_valor,             # ⭐
            "descuento_motivo": descuento_motivo,           # ⭐
            "total": total_final,
            "numero_comprobante": numero_comprobante,
            "facturado_por": current_user.get("email")
        }
        result_sale = await collection_sales.insert_one(venta)
        venta_id = str(result_sale.inserted_id)
        print(f"✅ Venta creada en sales: {venta_id}")
    else:
        await collection_sales.update_one(
            {"_id": ObjectId(id)},
            {"$set": {
                "numero_comprobante": numero_comprobante,
                "identificador": identificador,
                "facturado_por": current_user.get("email"),
                "fecha_facturacion": fecha_actual,
                "items": items,
                "estado_factura": "facturado",
                "estado_pago": "pagado",
                "saldo_pendiente": 0,
            }}
        )
        venta_id = id
        print(f"✅ Venta actualizada en sales: {venta_id}")

    # ====================================
    # 9️⃣ ACTUALIZAR CITA ORIGINAL
    # ====================================
    if tipo == "cita":
        await collection_citas.update_one(
            {"_id": ObjectId(id)},
            {"$set": {
                "estado": "completada",
                "estado_pago": "pagado",
                "saldo_pendiente": 0,
                "abono": total_final,
                "fecha_facturacion": fecha_actual,
                "numero_comprobante": numero_comprobante,
                "facturado_por": current_user.get("email"),
                "estado_factura": "facturado"
            }}
        )
        print("✅ Cita actualizada")

    # ====================================
    # 🔟 CREAR FACTURA EN INVOICES
    # ====================================
    factura = {
        "identificador": identificador,
        "tipo_origen": tipo,
        "origen_id": id,
        "fecha_pago": fecha_pago,
        "local": sede.get("nombre"),
        "sede_id": sede_id,
        "moneda": moneda_sede,
        "tipo_comision": tipo_comision,
        "cliente_id": cliente_id,
        "nombre_cliente": nombre_cliente,
        "cedula_cliente": cedula_cliente,
        "email_cliente": email_cliente,
        "telefono_cliente": telefono_cliente,
        "descuento_porcentaje": descuento_porcentaje,   # ⭐
        "descuento_valor": descuento_valor,              # ⭐
        "descuento_motivo": descuento_motivo,            # ⭐
        "total": total_final,
        "comprobante_de_pago": "Factura",
        "numero_comprobante": numero_comprobante,
        "fecha_comprobante": fecha_actual,
        "items": items,
        "profesional_id": profesional_id,
        "profesional_nombre": profesional_nombre,
        "historial_pagos": historial_pagos,
        "desglose_pagos": desglose_pagos,
        "facturado_por": current_user.get("email"),
        "estado": "pagado"
    }
    insert_result = await collection_invoices.insert_one(factura)
    invoice_mongo_id = insert_result.inserted_id
    print("✅ Factura creada")

    # ====================================
    # 1️⃣0️⃣.1️⃣ INTEGRACIÓN FACTURA ELECTRÓNICA (ALEGRA)
    # ====================================
    await initialize_manual_electronic_status(invoice_mongo_id, sede_id)
    print("🧾 Factura electrónica: marcada como pendiente de emisión manual")

    # ====================================
    # 1️⃣1️⃣ MOVIMIENTOS DE INVENTARIO
    # ====================================
    movimientos_inventario = []

    for item in items:
        if item["tipo"] == "producto":
            producto_id = item["producto_id"]
            cantidad = item["cantidad"]

            inventario = await collection_inventarios.find_one({
                "producto_id": producto_id,
                "sede_id": sede_id
            })
            if not inventario:
                print(f"⚠️ No existe inventario para {item['nombre']}")
                continue

            stock_anterior = inventario["stock_actual"]
            nuevo_stock = stock_anterior - cantidad

            await collection_inventarios.update_one(
                {"_id": inventario["_id"]},
                {"$set": {
                    "stock_actual": nuevo_stock,
                    "fecha_ultima_actualizacion": fecha_actual
                }}
            )

            movimientos_inventario.append({
                "producto_id": producto_id,
                "nombre_producto": item["nombre"],
                "cantidad": -cantidad,
                "tipo_movimiento": f"venta_{tipo}",
                "stock_anterior": stock_anterior,
                "stock_nuevo": nuevo_stock,
                "referencia_id": venta_id,
                "referencia_tipo": tipo,
                "numero_comprobante": numero_comprobante,
                "cliente_id": cliente_id,
                "profesional_id": profesional_id,
                "usuario": current_user.get("email")
            })
            print(f"📉 Inventario: {item['nombre']} ({stock_anterior} → {nuevo_stock})")

    if movimientos_inventario:
        await collection_inventory_motions.insert_one({
            "sede_id": sede_id,
            "fecha": fecha_actual,
            "movimientos": movimientos_inventario,
            "creado_por": current_user.get("email")
        })
        print(f"✅ Movimientos registrados: {len(movimientos_inventario)} productos")

    # ====================================
    # 1️⃣2️⃣ COMISIONES DEL ESTILISTA
    # ====================================
    comision_msg = "No aplica comisión para esta sede"

    # ─── Si es venta directa ya comisionada, no duplicar ───────────
    if tipo == "venta" and documento.get("comision_registrada"):
        comision_msg = "Comisión ya registrada al crear la venta directa"

    else:
        # ─── Determinar receptor de la comisión ────────────────────
        ROLES_PRODUCTO_PROPIO = {"recepcionista", "call_center", "admin_sede"}
        fecha_actual_str = fecha_actual.strftime("%Y-%m-%d")

        # ─── Construir listas de comisiones ────────────────────────────
        servicios_comision = [
            {
                "servicio_id": item["servicio_id"],
                "servicio_nombre": item["nombre"],
                "categoria": item.get("categoria", ""),
                "porcentaje": item.get("porcentaje_comision", 0),
                "valor_servicio": item["precio_unitario"],
                "valor_comision": round(item["comision"], 2),
                "fecha": fecha_actual.strftime("%Y-%m-%d"),
                "numero_comprobante": numero_comprobante,
                "origen_tipo": tipo,
                "origen_id": id
            }
            for item in items
            if item["tipo"] == "servicio" and item.get("comision", 0) > 0
        ]

        productos_comision = [
            {
                "producto_id": item["producto_id"],
                "producto_nombre": item["nombre"],
                "cantidad": item["cantidad"],
                "valor_producto": item["subtotal"],
                "valor_comision": round(item["comision"], 2),
                "valor_comision_productos": round(item["comision"], 2),
                "comision_tipo": item.get("comision_tipo"),
                "comision_valor_aplicado": item.get("comision_porcentaje", 0),
                "fecha": fecha_actual.strftime("%Y-%m-%d"),
                "numero_comprobante": numero_comprobante,
                "origen_tipo": tipo,
                "origen_id": id
            }
            for item in items
            if item["tipo"] == "producto" and item.get("comision", 0) > 0
        ]

        # ─── Determinar receptor de SERVICIOS (siempre el profesional) ─
        receptor_servicios_id = profesional_id
        receptor_servicios_nombre = profesional_nombre

        # ─── Determinar receptor de PRODUCTOS ──────────────────────────
        # Para citas: el que agregó el producto (si es rol no-estilista)
        # Para ventas sin profesional: el vendedor por facturado_por
        receptor_productos_id = profesional_id
        receptor_productos_nombre = profesional_nombre

        if tipo == "cita" and productos_comision:
            primer_producto_no_estilista = next(
                (p for p in documento.get("productos", [])
                if p.get("agregado_por_rol") in ROLES_PRODUCTO_PROPIO),
                None
            )
            if primer_producto_no_estilista:
                email_agregador = primer_producto_no_estilista.get("agregado_por_email", "")
                if email_agregador:
                    auth_agregador = await collection_auth.find_one(
                        {"correo_electronico": email_agregador}
                    )
                    if auth_agregador:
                        receptor_productos_id = str(auth_agregador["_id"])
                        receptor_productos_nombre = auth_agregador.get("nombre", email_agregador)

        elif tipo == "venta" and not profesional_id:
            facturado_por_email = documento.get("facturado_por", "")
            if facturado_por_email:
                auth_doc = await collection_auth.find_one(
                    {"correo_electronico": facturado_por_email}
                )
                if auth_doc and auth_doc.get("rol") in ("recepcionista", "call_center", "admin_sede"):
                    receptor_productos_id = str(auth_doc["_id"])
                    receptor_productos_nombre = auth_doc.get("nombre", facturado_por_email)

        # ─── Registrar comisión de SERVICIOS ───────────────────────────
        if servicios_comision and receptor_servicios_id:
            total_comision_servicios_reg = round(
                sum(s["valor_comision"] for s in servicios_comision), 2
            )
            comision_doc_srv = await collection_commissions.find_one({
                "profesional_id": receptor_servicios_id,
                "sede_id": sede_id,
                "estado": "pendiente"
            })

            crear_nuevo_srv = False
            if comision_doc_srv:
                existentes = comision_doc_srv.get("servicios_detalle", [])
                if existentes and "periodo_inicio" not in comision_doc_srv:
                    fechas_m = []
                    for s in existentes:
                        try:
                            fechas_m.append(datetime.strptime(s["fecha"], "%Y-%m-%d"))
                        except:
                            continue
                    if fechas_m:
                        await collection_commissions.update_one(
                            {"_id": comision_doc_srv["_id"]},
                            {"$set": {
                                "periodo_inicio": min(fechas_m).strftime("%Y-%m-%d"),
                                "periodo_fin": max(fechas_m).strftime("%Y-%m-%d")
                            }}
                        )
                if existentes:
                    fechas = []
                    for s in existentes:
                        try:
                            fechas.append(datetime.strptime(s["fecha"], "%Y-%m-%d"))
                        except:
                            continue
                    if fechas:
                        fi = min(min(fechas), fecha_actual)
                        ff = max(max(fechas), fecha_actual)
                        if (ff - fi).days + 1 > 15:
                            crear_nuevo_srv = True
                            await collection_commissions.update_one(
                                {"_id": comision_doc_srv["_id"]},
                                {"$set": {
                                    "periodo_inicio": min(fechas).strftime("%Y-%m-%d"),
                                    "periodo_fin": max(fechas).strftime("%Y-%m-%d")
                                }}
                            )

            if comision_doc_srv and not crear_nuevo_srv:
                ops = {
                    "$inc": {"total_comisiones": total_comision_servicios_reg},
                    "$set": {"estado": "pendiente", "periodo_fin": fecha_actual_str}
                }
                if "servicios_detalle" not in comision_doc_srv:
                    ops["$set"]["servicios_detalle"] = servicios_comision
                else:
                    ops["$push"] = {"servicios_detalle": {"$each": servicios_comision}}
                if "periodo_inicio" not in comision_doc_srv:
                    ops["$set"]["periodo_inicio"] = fecha_actual_str
                await collection_commissions.update_one({"_id": comision_doc_srv["_id"]}, ops)
                doc_act = await collection_commissions.find_one({"_id": comision_doc_srv["_id"]})
                if doc_act:
                    await collection_commissions.update_one(
                        {"_id": doc_act["_id"]},
                        {"$set": {"total_comisiones": round(doc_act.get("total_comisiones", 0), 2)}}
                    )
                comision_msg = f"Comisión servicios actualizada (+{total_comision_servicios_reg} {moneda_sede})"
            else:
                await collection_commissions.insert_one({
                    "profesional_id": receptor_servicios_id,
                    "profesional_nombre": receptor_servicios_nombre,
                    "sede_id": sede_id,
                    "sede_nombre": sede.get("nombre", ""),
                    "moneda": moneda_sede,
                    "tipo_comision": tipo_comision,
                    "total_servicios": len(servicios_comision),
                    "total_productos": 0,
                    "total_comisiones": total_comision_servicios_reg,
                    "servicios_detalle": servicios_comision,
                    "productos_detalle": [],
                    "periodo_inicio": fecha_actual_str,
                    "periodo_fin": fecha_actual_str,
                    "estado": "pendiente",
                    "creado_en": fecha_actual
                })
                comision_msg = f"Comisión servicios creada ({total_comision_servicios_reg} {moneda_sede})"

        # ─── Registrar comisión de PRODUCTOS ───────────────────────────
        if productos_comision and receptor_productos_id:
            total_comision_productos_reg = round(
                sum(p["valor_comision"] for p in productos_comision), 2
            )
            comision_doc_prod = await collection_commissions.find_one({
                "profesional_id": receptor_productos_id,
                "sede_id": sede_id,
                "estado": "pendiente",
                "periodo_inicio": periodo_productos_inicio_str or fecha_actual_str,
            })

            crear_nuevo_prod = False
            if comision_doc_prod:
                existentes = comision_doc_prod.get("servicios_detalle", [])
                if existentes:
                    fechas = []
                    for s in existentes:
                        try:
                            fechas.append(datetime.strptime(s["fecha"], "%Y-%m-%d"))
                        except:
                            continue
                    if fechas:
                        fi = min(min(fechas), fecha_actual)
                        ff = max(max(fechas), fecha_actual)
                        if (ff - fi).days + 1 > 15:
                            crear_nuevo_prod = True
                            await collection_commissions.update_one(
                                {"_id": comision_doc_prod["_id"]},
                                {"$set": {
                                    "periodo_inicio": min(fechas).strftime("%Y-%m-%d"),
                                    "periodo_fin": max(fechas).strftime("%Y-%m-%d")
                                }}
                            )

            if comision_doc_prod and not crear_nuevo_prod:
                ops = {
                    "$inc": {"total_comisiones": total_comision_productos_reg},
                    "$set": {"estado": "pendiente", "periodo_fin": periodo_productos_fin_str or fecha_actual_str}
                }
                if "productos_detalle" not in comision_doc_prod:
                    ops["$set"]["productos_detalle"] = productos_comision
                else:
                    if "$push" not in ops:
                        ops["$push"] = {}
                    ops["$push"]["productos_detalle"] = {"$each": productos_comision}
                if "periodo_inicio" not in comision_doc_prod:
                    ops["$set"]["periodo_inicio"] = periodo_productos_inicio_str or fecha_actual_str
                await collection_commissions.update_one({"_id": comision_doc_prod["_id"]}, ops)
                doc_act = await collection_commissions.find_one({"_id": comision_doc_prod["_id"]})
                if doc_act:
                    await collection_commissions.update_one(
                        {"_id": doc_act["_id"]},
                        {"$set": {"total_comisiones": round(doc_act.get("total_comisiones", 0), 2)}}
                    )
                comision_msg += f" | Comisión productos actualizada (+{total_comision_productos_reg} {moneda_sede})"
            else:
                await collection_commissions.insert_one({
                    "profesional_id": receptor_productos_id,
                    "profesional_nombre": receptor_productos_nombre,
                    "sede_id": sede_id,
                    "sede_nombre": sede.get("nombre", ""),
                    "moneda": moneda_sede,
                    "tipo_comision": tipo_comision,
                    "total_servicios": 0,
                    "total_productos": len(productos_comision),
                    "total_comisiones": total_comision_productos_reg,
                    "servicios_detalle": [],
                    "productos_detalle": productos_comision,
                    "periodo_inicio": periodo_productos_inicio_str or fecha_actual_str,
                    "periodo_fin": periodo_productos_fin_str or fecha_actual_str,
                    "estado": "pendiente",
                    "creado_en": fecha_actual
                })
                comision_msg += f" | Comisión productos creada ({total_comision_productos_reg} {moneda_sede})"

            if recalculo_escalonado_productos:
                await recalcular_comisiones_periodo(
                    sede_id=sede_id,
                    **recalculo_escalonado_productos,
                )

        if comision_msg == "No aplica comisión para esta sede" and (servicios_comision or productos_comision):
            comision_msg = "Sin receptor válido para registrar comisión"

    # ====================================
    # ⭐ INTEGRACIÓN GIFTCARD
    # ====================================
    codigo_giftcard = documento.get("codigo_giftcard")

    if codigo_giftcard:
        try:
            gc_doc = await collection_giftcards.find_one({"codigo": codigo_giftcard})
            if gc_doc:
                monto_giftcard = round(sum(
                    float(p.get("monto", 0))
                    for p in historial_pagos
                    if p.get("metodo") == "giftcard"
                ), 2)

                if monto_giftcard > 0:
                    historial_gc = gc_doc.get("historial", [])
                    llave_id = "cita_id" if tipo == "cita" else "venta_id"

                    ya_redimida = any(
                        m.get(llave_id) == id and m.get("tipo") == "redencion"
                        for m in historial_gc
                    )

                    if not ya_redimida:
                        monto_total_reservado = round(sum(
                            float(m.get("monto", 0))
                            for m in historial_gc
                            if m.get(llave_id) == id and m.get("tipo") == "reserva"
                        ), 2)

                        diferencia = round(monto_total_reservado - monto_giftcard, 2)
                        nuevo_reservado_gc = max(
                            0.0,
                            round(float(gc_doc.get("saldo_reservado", 0)) - monto_total_reservado, 2)
                        )
                        nuevo_disponible_gc = float(gc_doc.get("saldo_disponible", 0))
                        if diferencia > 0:
                            nuevo_disponible_gc = round(nuevo_disponible_gc + diferencia, 2)
                        nuevo_usado_gc = round(float(gc_doc.get("saldo_usado", 0)) + monto_giftcard, 2)

                        update_gc = {
                            "$set": {
                                "saldo_disponible": nuevo_disponible_gc,
                                "saldo_reservado": nuevo_reservado_gc,
                                "saldo_usado": nuevo_usado_gc,
                            },
                            "$push": {"historial": {
                                "tipo": "redencion",
                                llave_id: id,
                                "numero_comprobante": numero_comprobante,
                                "monto": monto_giftcard,
                                "fecha": fecha_actual,
                                "registrado_por": current_user.get("email"),
                            }}
                        }
                        if not gc_doc.get("fecha_primer_uso"):
                            update_gc["$set"]["fecha_primer_uso"] = fecha_actual

                        await collection_giftcards.update_one({"codigo": codigo_giftcard}, update_gc)

                        doc_gc_actualizado = await collection_giftcards.find_one({"codigo": codigo_giftcard})
                        nuevo_estado_gc = _estado_giftcard(doc_gc_actualizado)
                        await collection_giftcards.update_one(
                            {"codigo": codigo_giftcard},
                            {"$set": {"estado": nuevo_estado_gc}}
                        )
                        print(f"🎁 Giftcard {codigo_giftcard} redimida ({tipo}): {monto_giftcard} {moneda_sede}")

        except Exception as e:
            print(f"⚠️ ERROR al redimir giftcard {codigo_giftcard}: {e}")
            import traceback
            traceback.print_exc()

    # ====================================
    # RESPUESTA FINAL
    # ====================================
    return {
        "success": True,
        "message": f"{tipo.capitalize()} facturada correctamente",
        "comision_mensaje": comision_msg,
        "tipo_facturado": tipo,
        "numero_comprobante": numero_comprobante,
        "identificador": identificador,
        "total": total_final,
        "moneda": moneda_sede,
        "items": items,
        "detalles": {
            "servicios": sum(item["subtotal"] for item in items if item["tipo"] == "servicio"),
            "productos": sum(item["subtotal"] for item in items if item["tipo"] == "producto"),
            "descuento_porcentaje": descuento_porcentaje,  # ⭐
            "descuento_valor": descuento_valor,             # ⭐
            "descuento_motivo": descuento_motivo,           # ⭐
            "comision_servicios": total_comision_servicios,
            "comision_productos": total_comision_productos,
            "comision_total": valor_comision_total,
            "total": total_final,
            "moneda": moneda_sede
        },
        "factura_electronica": {
            "auto_emitida": False,
            "mensaje": "Pendiente de emisión manual en ventas facturadas",
            "provider": "alegra"
        },
        "invoice_id": str(invoice_mongo_id)
    }


@router.post("/invoices/{invoice_id}/electronic/emit")
async def emitir_factura_electronica(
    invoice_id: str,
    current_user: dict = Depends(get_current_user)
):
    """
    Emite manualmente una factura interna como factura electrónica vía Alegra.
    """
    if current_user["rol"] not in ["admin_sede", "super_admin"]:
        raise HTTPException(status_code=403, detail="No autorizado")

    result = await emit_invoice_to_alegra(invoice_id, requested_by=current_user.get("email", "manual"))

    return {
        "success": True,
        "message": "Factura enviada a Alegra",
        "electronic_invoice": result,
    }


@router.post("/sales/{sale_id}/electronic/emit")
async def emitir_factura_electronica_desde_venta(
    sale_id: str,
    current_user: dict = Depends(get_current_user)
):
    """
    Emite factura electrónica usando el id de venta facturada.
    """
    if current_user["rol"] not in ["admin_sede", "super_admin"]:
        raise HTTPException(status_code=403, detail="No autorizado")

    try:
        sale_mongo_id = ObjectId(sale_id)
    except Exception as exc:
        raise HTTPException(status_code=400, detail="sale_id inválido") from exc

    venta = await collection_sales.find_one({"_id": sale_mongo_id})
    if not venta:
        raise HTTPException(status_code=404, detail="Venta no encontrada")

    numero_comprobante = venta.get("numero_comprobante")
    sede_id = venta.get("sede_id")
    if not numero_comprobante:
        raise HTTPException(status_code=422, detail="La venta no tiene numero_comprobante")

    invoice = await collection_invoices.find_one(
        {"numero_comprobante": numero_comprobante, "sede_id": sede_id}
    )
    if not invoice:
        raise HTTPException(status_code=404, detail="Factura interna asociada no encontrada")

    result = await emit_invoice_to_alegra(str(invoice["_id"]), requested_by=current_user.get("email", "manual"))

    return {
        "success": True,
        "message": "Factura enviada a Alegra",
        "invoice_id": str(invoice["_id"]),
        "electronic_invoice": result,
    }


@router.get("/invoices/{invoice_id}/electronic/status")
async def estado_factura_electronica(
    invoice_id: str,
    current_user: dict = Depends(get_current_user)
):
    """
    Consulta el estado de integración electrónica guardado en la factura interna.
    """
    if current_user["rol"] not in ["admin_sede", "super_admin"]:
        raise HTTPException(status_code=403, detail="No autorizado")

    try:
        mongo_id = ObjectId(invoice_id)
    except Exception as exc:
        raise HTTPException(status_code=400, detail="invoice_id inválido") from exc

    factura = await collection_invoices.find_one({"_id": mongo_id})
    if not factura:
        raise HTTPException(status_code=404, detail="Factura no encontrada")

    return {
        "success": True,
        "invoice_id": invoice_id,
        "electronic_invoice": factura.get("electronic_invoice", {}),
    }


@router.get("/sales/{sale_id}/electronic/status")
async def estado_factura_electronica_desde_venta(
    sale_id: str,
    current_user: dict = Depends(get_current_user)
):
    """
    Consulta estado electrónico usando el id de venta facturada.
    """
    if current_user["rol"] not in ["admin_sede", "super_admin"]:
        raise HTTPException(status_code=403, detail="No autorizado")

    try:
        sale_mongo_id = ObjectId(sale_id)
    except Exception as exc:
        raise HTTPException(status_code=400, detail="sale_id inválido") from exc

    venta = await collection_sales.find_one({"_id": sale_mongo_id})
    if not venta:
        raise HTTPException(status_code=404, detail="Venta no encontrada")

    numero_comprobante = venta.get("numero_comprobante")
    sede_id = venta.get("sede_id")
    if not numero_comprobante:
        raise HTTPException(status_code=422, detail="La venta no tiene numero_comprobante")

    factura = await collection_invoices.find_one(
        {"numero_comprobante": numero_comprobante, "sede_id": sede_id}
    )
    if not factura:
        raise HTTPException(status_code=404, detail="Factura interna asociada no encontrada")

    return {
        "success": True,
        "sale_id": sale_id,
        "invoice_id": str(factura["_id"]),
        "electronic_invoice": factura.get("electronic_invoice", {}),
    }

# ============================================================
# 📄 Obtener facturas
# ============================================================
@router.get("/invoices/{cliente_id}")
async def obtener_facturas_cliente(cliente_id: str, current_user: dict = Depends(get_current_user)):
    facturas = await collection_invoices.find({"cliente_id": cliente_id}).sort("fecha_pago", -1).to_list(None)
    for factura in facturas:
        factura["_id"] = str(factura["_id"])
    return {"success": True, "total": len(facturas), "facturas": facturas}


# ============================================================
# 🔹 Obtener ventas con paginación y filtros
# ============================================================
@router.get("/sales/{sede_id}")
async def obtener_ventas_sede(
    sede_id: str,
    page: int = Query(1, ge=1),
    limit: int = Query(50, ge=1, le=200),
    fecha_desde: Optional[str] = Query(None, regex=r"^\d{2}-\d{2}-\d{4}$|^\d{4}-\d{2}-\d{2}$"),
    fecha_hasta: Optional[str] = Query(None, regex=r"^\d{2}-\d{2}-\d{4}$|^\d{4}-\d{2}-\d{2}$"),
    profesional_id: Optional[str] = Query(None),
    search: Optional[str] = Query(None),
    sort_order: str = Query("desc", regex=r"^(asc|desc)$"),
    current_user: dict = Depends(get_current_user)
):
    if current_user["rol"] not in ["admin_sede", "super_admin","recepcionista", "estilista", "call_center"]:
        raise HTTPException(status_code=403, detail="No autorizado")

    try:
        filtros: dict = {
            "sede_id": sede_id,
            # Excluir anuladas explícitamente
            "estado_factura": {"$ne": "anulado"},
            "estado_pago": {"$ne": "anulado"},
        }

        sede = await collection_locales.find_one({"sede_id": sede_id})
        if not sede:
            raise HTTPException(status_code=404, detail="Sede no encontrada")

        if fecha_desde or fecha_hasta:
            filtros["fecha_pago"] = {}
            if fecha_desde:
                filtros["fecha_pago"]["$gte"] = fecha_a_datetime(fecha_desde)
            if fecha_hasta:
                fecha_fin = fecha_a_datetime(fecha_hasta).replace(hour=23, minute=59, second=59)
                filtros["fecha_pago"]["$lte"] = fecha_fin
        elif not profesional_id and not search:
            fecha_fin = today(sede).replace(tzinfo=None)
            filtros["fecha_pago"] = {"$gte": fecha_fin - timedelta(days=7), "$lte": fecha_fin}

        condiciones_or = []
        if profesional_id:
            condiciones_or.extend([{"profesional_id": profesional_id}, {"items.profesional_id": profesional_id}])
        if search:
            condiciones_or.extend([
                {"nombre_cliente": {"$regex": search, "$options": "i"}},
                {"cedula_cliente": {"$regex": search, "$options": "i"}},
                {"email_cliente": {"$regex": search, "$options": "i"}},
                {"telefono_cliente": {"$regex": search, "$options": "i"}}
            ])

        if condiciones_or:
            if profesional_id and not search:
                filtros["$or"] = condiciones_or
            elif search and not profesional_id:
                filtros["$or"] = condiciones_or
            else:
                filtros["$and"] = [
                    {"$or": [{"profesional_id": profesional_id}, {"items.profesional_id": profesional_id}]},
                    {"$or": [
                        {"nombre_cliente": {"$regex": search, "$options": "i"}},
                        {"cedula_cliente": {"$regex": search, "$options": "i"}},
                        {"email_cliente": {"$regex": search, "$options": "i"}},
                        {"telefono_cliente": {"$regex": search, "$options": "i"}}
                    ]}
                ]

        try:
            total_ventas = await asyncio.wait_for(collection_sales.count_documents(filtros), timeout=10.0)
        except asyncio.TimeoutError:
            total_ventas = -1

        skip = (page - 1) * limit
        total_pages = (total_ventas + limit - 1) // limit if total_ventas > 0 else 0

        projection = {
            "_id": 1, "identificador": 1, "fecha_pago": 1, "moneda": 1, "local": 1,
            "sede_id": 1, "cliente_id": 1, "nombre_cliente": 1, "cedula_cliente": 1,
            "email_cliente": 1, "telefono_cliente": 1, "items": 1, "desglose_pagos": 1,
            "facturado_por": 1, "numero_comprobante": 1, "tipo_comision": 1,
            "profesional_id": 1, "profesional_nombre": 1, "vendido_por": 1, "historial_pagos": 1
        }

        ventas = await collection_sales.find(filtros, projection)\
            .sort("fecha_pago", -1).skip(skip).limit(limit).to_list(limit)

        def limpiar_objectids(obj):
            if isinstance(obj, ObjectId): return str(obj)
            elif isinstance(obj, dict): return {k: limpiar_objectids(v) for k, v in obj.items()}
            elif isinstance(obj, list): return [limpiar_objectids(i) for i in obj]
            elif isinstance(obj, datetime): return obj.isoformat()
            return obj

        ventas = [limpiar_objectids(v) for v in ventas]

        return {
            "success": True,
            "pagination": {
                "page": page, "limit": limit, "total": total_ventas, "total_pages": total_pages,
                "has_next": skip + limit < total_ventas if total_ventas > 0 else False,
                "has_prev": page > 1, "showing": len(ventas),
                "from": skip + 1 if ventas else 0, "to": skip + len(ventas)
            },
            "filters_applied": {"sede_id": sede_id, "fecha_desde": fecha_desde, "fecha_hasta": fecha_hasta, "profesional_id": profesional_id, "search": search},
            "ventas": ventas
        }

    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error al obtener ventas: {str(e)}")


# ============================================================
# 🔹 Detalle de una venta
# ============================================================
@router.get("/sales/{sede_id}/{venta_id}")
async def obtener_detalle_venta(sede_id: str, venta_id: str, current_user: dict = Depends(get_current_user)):
    if current_user["rol"] not in ["admin_sede", "super_admin", "recepcionista", "estilista", "call_center"]:
        raise HTTPException(status_code=403, detail="No autorizado")

    try:
        def limpiar_objectids(obj):
            if isinstance(obj, ObjectId): return str(obj)
            elif isinstance(obj, dict): return {k: limpiar_objectids(v) for k, v in obj.items()}
            elif isinstance(obj, list): return [limpiar_objectids(i) for i in obj]
            elif isinstance(obj, datetime): return obj.isoformat()
            return obj

        venta = await collection_sales.find_one({"_id": ObjectId(venta_id), "sede_id": sede_id})
        if not venta:
            raise HTTPException(status_code=404, detail="Venta no encontrada")

        return {"success": True, "venta": limpiar_objectids(venta)}

    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error al obtener detalle: {str(e)}")

# ══════════════════════════════════════════════════════════════
# SALES — EDITAR (solo ventas no facturadas)
# ══════════════════════════════════════════════════════════════
 
@router.patch("/sales/{venta_id}")
async def editar_venta(
    venta_id: str,
    body: EditarVentaRequest,
    current_user: dict = Depends(get_current_user),
):
    """
    Edita campos básicos de una venta que aún no ha sido facturada:
    notas, descuento, profesional asignado.
    No permite editar ventas ya facturadas ni anuladas.
    """
    if current_user["rol"] not in ["admin_sede", "super_admin", "recepcionista", "call_center"]:
        raise HTTPException(status_code=403, detail="No autorizado")
 
    try:
        mongo_id = ObjectId(venta_id)
    except Exception:
        raise HTTPException(status_code=400, detail="venta_id inválido")
 
    venta = await collection_sales.find_one({"_id": mongo_id})
    if not venta:
        raise HTTPException(status_code=404, detail="Venta no encontrada")

    if venta.get("estado_factura") == "anulado":
        raise HTTPException(status_code=400, detail="No se puede editar una venta anulada")
 
    campos: dict = {}
 
    if body.notas is not None:
        campos["notas"] = body.notas
 
    if body.descuento_porcentaje is not None:
        porcentaje = max(0.0, min(float(body.descuento_porcentaje), 100.0))
        items = venta.get("items", [])
        subtotal_bruto = round(sum(i.get("subtotal", 0) for i in items), 2)
        descuento_valor = round((subtotal_bruto * porcentaje) / 100, 2)
        costo_domicilio = round(float(venta.get("domicilio", 0) or 0), 2)
        nuevo_total = round(subtotal_bruto - descuento_valor + costo_domicilio, 2)
 
        # Recalcular saldo pendiente respetando lo ya pagado
        total_pagado = round(sum(
            float(p.get("monto", 0)) for p in venta.get("historial_pagos", [])
        ), 2)
        nuevo_saldo = max(0.0, round(nuevo_total - total_pagado, 2))
        nuevo_estado_pago = "pagado" if nuevo_saldo <= 0 else ("abonado" if total_pagado > 0 else "pendiente")
 
        campos["descuento_porcentaje"] = porcentaje
        campos["descuento_valor"] = descuento_valor
        campos["descuento_motivo"] = (body.descuento_motivo or "").strip() or None
        campos["total"] = nuevo_total
        campos["saldo_pendiente"] = _num(nuevo_saldo)
        campos["estado_pago"] = nuevo_estado_pago
 
    if body.profesional_id is not None:
        campos["profesional_id"] = body.profesional_id
    if body.profesional_nombre is not None:
        campos["profesional_nombre"] = body.profesional_nombre
 
    if not campos:
        raise HTTPException(status_code=400, detail="No hay campos válidos para actualizar")
 
    sede = await collection_locales.find_one({"sede_id": venta.get("sede_id")})
    campos["ultima_actualizacion"] = today(sede).replace(tzinfo=None) if sede else datetime.now()
    campos["editado_por"] = current_user.get("email")
 
    await collection_sales.update_one({"_id": mongo_id}, {"$set": campos})
    venta_actualizada = await collection_sales.find_one({"_id": mongo_id})
 
    return {
        "success": True,
        "message": "Venta actualizada correctamente",
        "campos_actualizados": list(campos.keys()),
        "venta": _limpiar(venta_actualizada),
    }

# ══════════════════════════════════════════════════════════════
# INVOICES — ANULAR
# ══════════════════════════════════════════════════════════════
 
@router.delete("/{invoice_id}/anular")
async def anular_factura(
    invoice_id: str,
    body: AnulacionRequest = AnulacionRequest(),
    current_user: dict = Depends(get_current_user),
):
    """
    Anula una factura y revierte todo lo generado:
    - Marca invoice + sale asociada como 'anulado'
    - Devuelve stock al inventario
    - Elimina los ítems de comisiones (recalcula total)
    - Libera saldo de giftcard si aplica
    - Actualiza cita origen si tipo_origen = 'cita'
 
    Solo admin_sede y super_admin pueden anular.
    """
    if current_user["rol"] not in ["admin_sede", "super_admin"]:
        raise HTTPException(status_code=403, detail="Solo administradores pueden anular facturas")
 
    try:
        mongo_id = ObjectId(invoice_id)
    except Exception:
        raise HTTPException(status_code=400, detail="invoice_id inválido")
 
    doc_invoice = await collection_invoices.find_one({"_id": mongo_id})
    if not doc_invoice:
        raise HTTPException(status_code=404, detail="Factura no encontrada")
 
    if doc_invoice.get("estado") == "anulado":
        raise HTTPException(status_code=400, detail="Esta factura ya está anulada")
 
    # Buscar venta asociada por numero_comprobante
    doc_sale = None
    numero_comprobante = doc_invoice.get("numero_comprobante")
    if numero_comprobante:
        doc_sale = await collection_sales.find_one({
            "numero_comprobante": numero_comprobante,
            "sede_id": doc_invoice.get("sede_id"),
        })
 
    sede = await collection_locales.find_one({"sede_id": doc_invoice.get("sede_id")})
    if not sede:
        raise HTTPException(status_code=404, detail="Sede no encontrada")
 
    resumen = await _ejecutar_anulacion(
        doc_sale=doc_sale,
        doc_invoice=doc_invoice,
        sede=sede,
        email_usuario=current_user.get("email"),
        rol_usuario=current_user.get("rol"),
        motivo=body.motivo,
    )
 
    return {
        "success": True,
        "message": "Factura anulada correctamente",
        "invoice_id": invoice_id,
        "venta_anulada": str(doc_sale["_id"]) if doc_sale else None,
        "numero_comprobante": numero_comprobante,
        "motivo": body.motivo,
        "reversiones": resumen,
    }
 