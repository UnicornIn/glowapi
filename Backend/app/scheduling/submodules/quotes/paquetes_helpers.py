"""
Lógica compartida de paquetes de sesiones (compra/canje), usada tanto por
`facturar_cita_o_venta` (app.bills.routes) como por `finalizar_servicio_con_pdf`
(app.scheduling.submodules.quotes.routes_quotes) — antes vivía solo en
facturación, pero este negocio no factura, así que el paquete tiene que poder
nacer/consumirse al finalizar el servicio también. Ambos puntos de entrada
pueden llamar a `procesar_paquete_servicio` para la misma cita sin duplicar
nada (idempotente), por si algún día también llegan a facturar.
"""

import random
from datetime import datetime
from typing import Optional

from bson import ObjectId

from app.database.mongo import collection_client_packages, collection_citas


async def procesar_paquete_servicio(
    servicio_item: dict,
    cita_id: Optional[str],
    cliente_id: Optional[str],
    sede_id: str,
    moneda_sede: str,
    profesional_id: Optional[str],
    usuario_email: Optional[str],
    subtotal: float,
    origen_tipo: str = "cita",
    abono_origen: float = 0,
    historial_pagos_origen: Optional[list] = None,
) -> Optional[dict]:
    """
    Crea o redime un paquete de sesiones para esta línea de servicio.

    Devuelve:
    - None si la línea no tiene `paquete_id` ni `comprar_paquete_sesiones`
      (no hay nada que hacer).
    - {"ok": True, "paquete_id": str, "numero_sesion": int, "sesiones_totales": int}
      si se procesó (o ya estaba procesado antes — idempotente, seguro
      llamar dos veces para la misma cita). El caller debe estampar
      `paquete_id` de vuelta en la línea de la cita (además de
      `numero_sesion`) — para una compra nueva, esta es la ÚNICA forma de
      que esa cita sepa a qué paquete quedó ligada (el `comprar_paquete_
      sesiones` original no lleva el id del paquete recién creado).
    - {"ok": False, "motivo": "sin_saldo"} si se intentó redimir pero el
      paquete ya no tiene sesiones restantes suficientes.
    - {"ok": False, "motivo": "paquete_no_encontrado"} si `paquete_id` no
      corresponde a ningún paquete real.

    `abono_origen`/`historial_pagos_origen`: solo se usan cuando esta línea
    CREA un paquete nuevo (`comprar_paquete_sesiones`) — siembran el ledger
    de pago del paquete con lo que la cita origen ya tenía pagado (Fase 3),
    para no perder el abono inicial que el cliente dejó al reservarlo.
    """
    paquete_id_redimido = servicio_item.get("paquete_id")
    comprar_paquete_sesiones = servicio_item.get("comprar_paquete_sesiones")
    cantidad = int(servicio_item.get("cantidad", 1) or 1)

    if paquete_id_redimido:
        paquete = await collection_client_packages.find_one({"paquete_id": paquete_id_redimido})
        if not paquete:
            return {"ok": False, "motivo": "paquete_no_encontrado"}

        # Idempotencia: si esta cita ya consumió de este paquete antes (ej.
        # se llamó al Finalizar y de nuevo al Facturar), no volver a
        # descontar — devolver el número de sesión que ya quedó registrado.
        ya_consumido = next(
            (u for u in paquete.get("historial_uso", []) if u.get("cita_id") == cita_id),
            None,
        )
        if ya_consumido:
            return {
                "ok": True,
                "paquete_id": paquete_id_redimido,
                "numero_sesion": ya_consumido.get("numero_sesion") or paquete.get("sesiones_usadas"),
                "sesiones_totales": paquete.get("sesiones_totales"),
            }

        redencion = await collection_client_packages.update_one(
            {"paquete_id": paquete_id_redimido, "sesiones_restantes": {"$gte": cantidad}},
            {
                "$inc": {"sesiones_restantes": -cantidad, "sesiones_usadas": cantidad},
                "$push": {"historial_uso": {
                    "cita_id": cita_id,
                    "fecha": datetime.now(),
                    "profesional_id": profesional_id,
                    "sesiones": cantidad,
                }},
            },
        )
        if redencion.matched_count == 0:
            return {"ok": False, "motivo": "sin_saldo"}

        paquete_actualizado = await collection_client_packages.find_one({"paquete_id": paquete_id_redimido})
        numero_sesion = paquete_actualizado.get("sesiones_usadas")

        # Estampar numero_sesion en la entrada de historial_uso recién
        # creada — la idempotencia de arriba lo necesita para reconocerla.
        await collection_client_packages.update_one(
            {"paquete_id": paquete_id_redimido, "historial_uso.cita_id": cita_id},
            {"$set": {"historial_uso.$.numero_sesion": numero_sesion}},
        )
        return {
            "ok": True,
            "paquete_id": paquete_id_redimido,
            "numero_sesion": numero_sesion,
            "sesiones_totales": paquete_actualizado.get("sesiones_totales"),
        }

    if comprar_paquete_sesiones:
        # Idempotencia: ¿ya existe un paquete creado por esta misma cita?
        existente = await collection_client_packages.find_one({
            "cita_origen_id" if origen_tipo == "cita" else "venta_origen_id": cita_id,
            "servicio_id": servicio_item.get("servicio_id"),
        })
        if existente:
            return {
                "ok": True,
                "paquete_id": existente.get("paquete_id"),
                "numero_sesion": 1,
                "sesiones_totales": existente.get("sesiones_totales"),
            }

        sesiones_totales = int(comprar_paquete_sesiones)
        valor_por_sesion = round(subtotal / sesiones_totales, 2) if sesiones_totales else 0
        nuevo_paquete_id = f"PKG-{random.randint(10000, 99999)}"

        await collection_client_packages.insert_one({
            "paquete_id": nuevo_paquete_id,
            "cliente_id": cliente_id,
            "sede_id": sede_id,
            "servicio_id": servicio_item.get("servicio_id"),
            "nombre_servicio": servicio_item.get("nombre"),
            "sesiones_totales": sesiones_totales,
            "sesiones_usadas": 1,
            "sesiones_restantes": max(sesiones_totales - 1, 0),
            "valor_por_sesion": valor_por_sesion,
            "moneda": moneda_sede,
            "activo": True,
            "fecha_compra": datetime.now(),
            "cita_origen_id": cita_id if origen_tipo == "cita" else None,
            "venta_origen_id": cita_id if origen_tipo == "venta" else None,
            "creado_por": usuario_email,
            # Ledger de pago del paquete — se siembra con lo que la cita
            # origen ya tenía pagado (ej. el abono inicial que el cliente
            # dejó al reservar el paquete): ese dinero es del paquete, no se
            # pierde ni se cuenta dos veces. Cualquier pago posterior, desde
            # cualquier sesión de este mismo paquete, se registra acá — ver
            # app.clients_service.routes_clientes.registrar_pago_paquete.
            "abono": round(float(abono_origen or 0), 2),
            "historial_pagos": list(historial_pagos_origen or []),
            "historial_uso": [{
                "cita_id": cita_id,
                "fecha": datetime.now(),
                "profesional_id": profesional_id,
                "sesiones": 1,
                "numero_sesion": 1,
                "nota": "Primera sesión del paquete, incluida en la compra",
            }],
        })
        return {"ok": True, "paquete_id": nuevo_paquete_id, "numero_sesion": 1, "sesiones_totales": sesiones_totales}

    return None


async def revertir_paquete_servicio(
    cita_id: str,
    paquete_id_anterior: Optional[str] = None,
    comprar_paquete_sesiones_anterior: Optional[int] = None,
    servicio_id_anterior: Optional[str] = None,
    origen_tipo: str = "cita",
) -> Optional[dict]:
    """
    Deshace la redención/creación de un paquete que se había hecho antes
    para esta línea de servicio — usado al EDITAR una cita ya finalizada y
    quitar (o cambiar) la marca de paquete que tenía.

    Devuelve:
    - None si no había nada que deshacer (esta cita nunca redimió/creó ese
      paquete, o el paquete ya no existe).
    - {"ok": True} si se revirtió/eliminó correctamente.
    - {"ok": False, "motivo": "usado_por_otras_citas"} si OTRAS citas
      también consumieron de ese mismo paquete — no se puede deshacer sin
      dejarlas huérfanas. El caller debe rechazar la edición con un 400.
    """
    if paquete_id_anterior:
        paquete = await collection_client_packages.find_one({"paquete_id": paquete_id_anterior})
        if not paquete:
            return None

        historial = paquete.get("historial_uso", [])
        entrada = next((u for u in historial if u.get("cita_id") == cita_id), None)
        if not entrada:
            return None  # esta cita nunca consumió de este paquete

        if len(historial) > 1:
            return {"ok": False, "motivo": "usado_por_otras_citas"}

        cantidad = entrada.get("sesiones", 1)
        await collection_client_packages.update_one(
            {"paquete_id": paquete_id_anterior},
            {
                "$inc": {"sesiones_restantes": cantidad, "sesiones_usadas": -cantidad},
                "$pull": {"historial_uso": {"cita_id": cita_id}},
            },
        )
        return {"ok": True}

    if comprar_paquete_sesiones_anterior:
        campo_origen = "cita_origen_id" if origen_tipo == "cita" else "venta_origen_id"
        paquete = await collection_client_packages.find_one({
            campo_origen: cita_id,
            "servicio_id": servicio_id_anterior,
        })
        if not paquete:
            return None

        if paquete.get("sesiones_usadas", 0) > 1:
            return {"ok": False, "motivo": "usado_por_otras_citas"}

        await collection_client_packages.delete_one({"paquete_id": paquete["paquete_id"]})
        return {"ok": True}

    return None


async def propagar_facturacion_a_paquete(
    servicios_cita: list,
    cita_id_facturada: str,
    numero_comprobante: str,
    fecha_facturacion,
    usuario_email: Optional[str],
) -> int:
    """
    Cuando se factura una cita que es parte de un paquete de sesiones, las
    demás citas que consumieron sesiones del MISMO paquete se marcan
    también como "Facturada" — un paquete es UNA sola transacción real
    (una factura), pero cada sesión es su propia cita en la agenda. Sin
    esto, solo la cita facturada se ve verde ("Facturada") y las demás
    sesiones del mismo paquete se quedan en "Finalizado" (naranja) aunque
    el paquete completo ya esté pagado — una agenda inconsistente para algo
    que en realidad es una sola transacción.

    A propósito NO se tocan abono/saldo_pendiente/estado_pago/
    historial_pagos de esas otras citas — cada una conserva su propio
    registro de pago (normalmente $0, ya cubierto por el paquete); solo se
    refleja que quedaron cubiertas por esta factura.

    Devuelve cuántas otras citas se actualizaron.
    """
    paquete_ids = {s.get("paquete_id") for s in servicios_cita if s.get("paquete_id")}
    if not paquete_ids:
        return 0

    paquetes = await collection_client_packages.find({
        "paquete_id": {"$in": list(paquete_ids)}
    }).to_list(None)

    otras_citas_ids = {
        uso.get("cita_id")
        for paquete in paquetes
        for uso in paquete.get("historial_uso", [])
        if uso.get("cita_id") and uso.get("cita_id") != cita_id_facturada
    }

    actualizadas = 0
    for otra_cita_id in otras_citas_ids:
        try:
            resultado = await collection_citas.update_one(
                {"_id": ObjectId(otra_cita_id)},
                {"$set": {
                    "estado": "completada",
                    "estado_factura": "facturado",
                    "numero_comprobante": numero_comprobante,
                    "fecha_facturacion": fecha_facturacion,
                    "facturado_por": usuario_email,
                }}
            )
            if resultado.matched_count:
                actualizadas += 1
        except Exception:
            continue
    return actualizadas
