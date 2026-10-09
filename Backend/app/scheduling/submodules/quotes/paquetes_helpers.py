"""
Lógica compartida de paquetes de sesiones (compra/canje), usada por
facturación (app.bills.routes), finalizar/editar/cancelar/eliminar citas
(app.scheduling.submodules.quotes.routes_quotes) y el perfil del cliente
(app.clients_service.routes_clientes).

FUENTE DE VERDAD: las citas. Una cita pertenece a un paquete si alguna de
sus líneas de servicio tiene `paquete_id` (o si es la cita que lo compró,
`cita_origen_id`). `sincronizar_paquete` recalcula TODO lo derivado a partir
de esas citas — sesiones usadas/agendadas/restantes, `historial_uso` y el
`numero_sesion` de cada cita (en orden cronológico por fecha+hora, no por el
orden en que se fueron finalizando).

Antes, cada punto de entrada hacía `$inc`/`$push` incrementales sobre el
documento del paquete — cualquier camino que no los llamara (cancelar,
eliminar, "no asistió", cambiar la marca de paquete en una cita no
finalizada, facturar después de finalizar...) dejaba el conteo desfasado de
las citas reales, y los números de sesión quedaban en el orden de
finalización. Ahora cualquier cambio en una cita ligada termina llamando a
`sincronizar_paquete` y el documento se rehace completo — es idempotente,
seguro llamarlo cuantas veces haga falta.

Reglas de conteo:
- Consume sesión: cita en estado "finalizado" o "completada".
- Agendada (reserva cupo, no consume): cualquier otro estado activo
  (pre_reservada, confirmada, pendiente...).
- No cuenta: "cancelada" / "no_asistio" — la cita puede quedar con el
  `paquete_id` (historial), pero no gasta ni reserva sesión.
"""

import random
from datetime import datetime
from typing import Optional, Iterable

from bson import ObjectId

from app.database.mongo import collection_client_packages, collection_citas
from app.commissions.comision_paquetes import liquidar_comisiones_paquete
from app.scheduling.submodules.quotes.anticipos_paquete import (
    MODO_POR_SESION,
    MODO_PAQUETE,
    modo_facturacion,
    estado_anticipo,
    pagos_anticipo_para_panel,
    mover_pagos_cita_a_anticipo,
)


ESTADOS_CONSUMEN_SESION = {"finalizado", "completada"}
ESTADOS_NO_CUENTAN = {"cancelada", "no_asistio", "no asistio"}


def estado_cita(cita: dict) -> str:
    return str(cita.get("estado") or "").strip().lower()


def _cantidad(linea: dict) -> int:
    try:
        return max(int(linea.get("cantidad", 1) or 1), 1)
    except (TypeError, ValueError):
        return 1


def _ajuste_sesiones(paquete: dict) -> int:
    """
    Sesiones descontadas (positivo) o devueltas (negativo) a mano con
    `ajustar_paquete`, aparte de las citas. Paquetes anteriores a este
    campo solo tienen las entradas `ajuste_manual` del historial — se
    reconstruye desde ahí.
    """
    if "ajuste_sesiones" in paquete:
        return int(paquete.get("ajuste_sesiones") or 0)
    return sum(
        int(u.get("sesiones_restantes_antes") or 0) - int(u.get("sesiones_restantes_despues") or 0)
        for u in paquete.get("historial_uso", [])
        if u.get("ajuste_manual")
    )


def _linea_del_paquete(cita: dict, paquete: dict) -> Optional[int]:
    """Índice de la línea de servicio de `cita` que pertenece a `paquete`."""
    servicios = cita.get("servicios") or []
    paquete_id = paquete.get("paquete_id")
    idx = next((i for i, s in enumerate(servicios) if s.get("paquete_id") == paquete_id), None)
    if idx is not None:
        return idx
    # Cita que compró el paquete antes de que se estampara `paquete_id` en
    # su línea (datos viejos) — se reconoce por el servicio.
    if str(cita.get("_id")) == str(paquete.get("cita_origen_id") or ""):
        return next(
            (i for i, s in enumerate(servicios)
             if s.get("servicio_id") == paquete.get("servicio_id") and not s.get("paquete_id")),
            None,
        )
    return None


def _clave_cronologica(cita: dict):
    return (
        str(cita.get("fecha") or "")[:10],
        str(cita.get("hora_inicio") or ""),
        str(cita.get("fecha_creacion") or ""),
        str(cita.get("_id")),
    )


async def citas_ligadas_paquete(paquete: dict) -> list:
    """[(cita, idx_linea)] de todas las citas del paquete, en orden cronológico."""
    condiciones = [{"servicios.paquete_id": paquete["paquete_id"]}]
    origen = paquete.get("cita_origen_id")
    if origen and ObjectId.is_valid(str(origen)):
        condiciones.append({"_id": ObjectId(str(origen))})

    citas = await collection_citas.find({"$or": condiciones}).to_list(None)
    ligadas = []
    for cita in citas:
        idx = _linea_del_paquete(cita, paquete)
        if idx is not None:
            ligadas.append((cita, idx))
    ligadas.sort(key=lambda t: _clave_cronologica(t[0]))
    return ligadas


def _facturacion_del_paquete(paquete: dict, ligadas: list) -> Optional[dict]:
    """
    Factura que cubre el paquete completo (si se facturó). Se guarda en el
    paquete al facturar (`propagar_facturacion_a_paquete`); para paquetes
    facturados antes de existir ese campo se deduce de la cita origen.
    """
    if paquete.get("facturacion"):
        return paquete["facturacion"]
    origen = str(paquete.get("cita_origen_id") or "")
    for cita, _ in ligadas:
        if str(cita["_id"]) == origen and cita.get("estado_factura") == "facturado" and cita.get("numero_comprobante"):
            return {
                "numero_comprobante": cita.get("numero_comprobante"),
                "fecha_facturacion": cita.get("fecha_facturacion"),
                "facturado_por": cita.get("facturado_por"),
                "cita_id": origen,
            }
    return None


def _serializar_pago(pago: dict) -> dict:
    return {k: (v.isoformat() if isinstance(v, datetime) else v) for k, v in pago.items()}


def _pagos_en_citas(ligadas: list) -> float:
    return round(sum(
        float(p.get("monto", 0) or 0)
        for cita, _ in ligadas
        for p in cita.get("historial_pagos") or []
    ), 2)


def _migrar_pagos_legacy(paquete: dict, ligadas: list) -> dict:
    """
    Antes los pagos del paquete se guardaban en el propio paquete, donde
    caja no los ve — y en la práctica el admin volvía a registrar ese mismo
    dinero en alguna cita. Ahora el dinero vive SIEMPRE en las citas y el
    paquete solo suma. Al migrar, del ledger viejo solo se conserva la
    diferencia que NO aparece en ninguna cita (pago real que solo quedó en
    el paquete): queda en `historial_pagos` marcado como "sin cita" para que
    el admin lo pase a una sesión o lo descarte si era un duplicado.
    """
    legacy = list(paquete.get("historial_pagos") or [])
    abono_legacy = round(float(paquete.get("abono") or sum(float(p.get("monto", 0) or 0) for p in legacy)), 2)
    excedente = round(abono_legacy - _pagos_en_citas(ligadas), 2)

    pagos_sin_cita = []
    if excedente > 0 and legacy:
        firmas_citas = [
            (round(float(p.get("monto", 0) or 0), 2), p.get("metodo"))
            for cita, _ in ligadas for p in cita.get("historial_pagos") or []
        ]
        no_explicados = []
        for p in legacy:
            firma = (round(float(p.get("monto", 0) or 0), 2), p.get("metodo"))
            if firma in firmas_citas:
                firmas_citas.remove(firma)
            else:
                no_explicados.append(p)
        if round(sum(float(p.get("monto", 0) or 0) for p in no_explicados), 2) == excedente:
            pagos_sin_cita = [{**p, "sin_cita": True} for p in no_explicados]
        else:
            ultimo = legacy[-1]
            pagos_sin_cita = [{
                "fecha": ultimo.get("fecha") or datetime.now(),
                "monto": excedente,
                "metodo": ultimo.get("metodo") or "otros",
                "tipo": "saldo_migrado",
                "registrado_por": ultimo.get("registrado_por"),
                "notas": "Diferencia registrada solo en el paquete antes de unificar los pagos en las sesiones",
                "sin_cita": True,
            }]

    return {
        "historial_pagos": pagos_sin_cita,
        "historial_pagos_legacy": legacy,
        "pagos_migrados": True,
    }


async def pagos_consolidados_paquete(paquete: dict, ligadas: Optional[list] = None) -> dict:
    """
    Todos los pagos del paquete en orden de fecha: los registrados en cada
    sesión (visibles en caja) + los que quedaron solo en el paquete
    (`sin_cita`, no visibles en caja). Cada pago dice de qué sesión viene.
    """
    if ligadas is None:
        ligadas = await citas_ligadas_paquete(paquete)
    pagos = []
    for cita, idx in ligadas:
        linea = (cita.get("servicios") or [])[idx]
        for i, p in enumerate(cita.get("historial_pagos") or []):
            pagos.append({
                **_serializar_pago(p),
                "origen": "cita",
                "indice": i,
                "cita_id": str(cita["_id"]),
                "fecha_cita": str(cita.get("fecha") or "")[:10],
                "hora_cita": cita.get("hora_inicio"),
                "numero_sesion": linea.get("numero_sesion"),
                "es_origen": str(cita["_id"]) == str(paquete.get("cita_origen_id") or ""),
                "estado_cita": cita.get("estado"),
                "cita_facturada": cita.get("estado_factura") == "facturado",
                "en_caja": True,
            })
    if modo_facturacion(paquete) == MODO_POR_SESION:
        # Modo "por sesión": el dinero vive en la bolsa de anticipo, no en
        # las citas. Cada entrada dice cuánto se llevó ya alguna factura.
        for fila in pagos_anticipo_para_panel(paquete):
            pagos.append({
                **fila,
                "en_caja": not fila.get("sin_caja", False),
                "cita_facturada": fila["disponible"] <= 0 and bool(fila["facturas"]),
            })
    elif paquete.get("pagos_migrados"):
        for i, p in enumerate(paquete.get("historial_pagos") or []):
            pagos.append({**_serializar_pago(p), "origen": "paquete", "indice": i, "en_caja": False})
    pagos.sort(key=lambda p: str(p.get("fecha") or ""))
    return {"abono": round(sum(float(p.get("monto", 0) or 0) for p in pagos), 2), "pagos": pagos}


async def sincronizar_paquete(paquete_id: Optional[str], dry_run: bool = False) -> Optional[dict]:
    """
    Recalcula el paquete completo desde sus citas (ver docstring del módulo)
    y corrige `numero_sesion` en cada cita ligada. Devuelve un resumen:
    {paquete_id, sesiones_totales, sesiones_usadas, sesiones_agendadas,
     sesiones_restantes, sesiones_disponibles, sobrecupo, abono, activo,
     numeros: {cita_id: n}}
    o None si el paquete no existe.

    `dry_run=True`: no escribe nada; el resumen trae además `cambios_citas`
    y `cambios_paquete` con lo que se modificaría.
    """
    if not paquete_id:
        return None
    paquete = await collection_client_packages.find_one({"paquete_id": paquete_id})
    if not paquete:
        return None

    historial = paquete.get("historial_uso", []) or []
    ajustes = [u for u in historial if u.get("ajuste_manual")]
    venta_origen = paquete.get("venta_origen_id")
    # Paquete vendido por venta directa (sin cita): su primera sesión vive
    # solo en el historial, no hay cita que la represente.
    entradas_venta = [
        u for u in historial
        if not u.get("ajuste_manual") and venta_origen and u.get("cita_id") == venta_origen
    ]
    previas = {u.get("cita_id"): u for u in historial if u.get("cita_id") and not u.get("ajuste_manual")}

    ligadas = await citas_ligadas_paquete(paquete)

    # Modo "por sesión": toda la plata del paquete vive en la bolsa. Un pago
    # registrado en una sesión (ej. desde la agenda) se recoge acá, si no el
    # abono quedaba atrapado en esa cita y el paquete mostraba "cobrado $0".
    # No se tocan las citas ya facturadas (su plata es de su factura) ni las
    # canceladas (su abono puede estar camino al saldo a favor).
    if modo_facturacion(paquete) == MODO_POR_SESION:
        recogidos = 0.0
        for cita, _ in ligadas:
            if cita.get("estado_factura") == "facturado" or estado_cita(cita) in ESTADOS_NO_CUENTAN:
                continue
            if not [p for p in (cita.get("historial_pagos") or []) if float(p.get("monto", 0) or 0) > 0]:
                continue
            if dry_run:
                recogidos += round(sum(float(p.get("monto", 0) or 0) for p in cita["historial_pagos"]), 2)
                continue
            recogidos += await mover_pagos_cita_a_anticipo(cita, paquete_id)
        if recogidos:
            if not dry_run:
                paquete = await collection_client_packages.find_one({"paquete_id": paquete_id})
                ligadas = await citas_ligadas_paquete(paquete)
            print(f"💰 Paquete {paquete_id}: {recogidos} pasaron de las sesiones al anticipo")

    facturacion = _facturacion_del_paquete(paquete, ligadas)

    usadas = sum(int(u.get("sesiones", 1) or 1) for u in entradas_venta)
    agendadas = 0
    numero = usadas + 1
    nuevo_historial = list(entradas_venta)
    numeros = {}
    cambios_citas = []

    for cita, idx in ligadas:
        cita_id = str(cita["_id"])
        servicios = cita.get("servicios") or []
        linea = servicios[idx]
        cantidad = _cantidad(linea)
        estado = estado_cita(cita)
        set_cita = {}

        if linea.get("paquete_id") != paquete_id:
            set_cita[f"servicios.{idx}.paquete_id"] = paquete_id

        if estado in ESTADOS_NO_CUENTAN:
            if linea.get("numero_sesion") is not None:
                set_cita[f"servicios.{idx}.numero_sesion"] = None
        else:
            if linea.get("numero_sesion") != numero:
                set_cita[f"servicios.{idx}.numero_sesion"] = numero
            numeros[cita_id] = numero

            if estado in ESTADOS_CONSUMEN_SESION:
                usadas += cantidad
                previa = previas.get(cita_id) or {}
                entrada = {
                    "cita_id": cita_id,
                    "fecha": previa.get("fecha") or cita.get("fecha_finalizacion") or datetime.now(),
                    "fecha_cita": str(cita.get("fecha") or "")[:10],
                    "profesional_id": cita.get("profesional_id"),
                    "sesiones": cantidad,
                    "numero_sesion": numero,
                }
                if previa.get("nota"):
                    entrada["nota"] = previa["nota"]
                nuevo_historial.append(entrada)

                # Sesión consumida después de que el paquete ya se facturó:
                # queda cubierta por esa misma factura (si la cita no tiene
                # pagos propios que requieran su propia factura).
                sin_pagos_propios = float(cita.get("abono", 0) or 0) <= 0 and float(cita.get("valor_total", 0) or 0) <= 0
                if facturacion and cita.get("estado_factura") != "facturado" and sin_pagos_propios:
                    set_cita.update({
                        "estado": "completada",
                        "estado_factura": "facturado",
                        "numero_comprobante": facturacion.get("numero_comprobante"),
                        "fecha_facturacion": facturacion.get("fecha_facturacion"),
                        "facturado_por": facturacion.get("facturado_por"),
                    })
            else:
                agendadas += cantidad
            numero += cantidad

        if set_cita:
            cambios_citas.append({
                "cita_id": cita_id,
                "fecha": str(cita.get("fecha") or "")[:10],
                "cambios": {k: _serializar_pago({"v": v})["v"] for k, v in set_cita.items()},
            })
            if not dry_run:
                await collection_citas.update_one({"_id": cita["_id"]}, {"$set": set_cita})

    por_sesion = modo_facturacion(paquete) == MODO_POR_SESION
    totales = int(paquete.get("sesiones_totales", 0) or 0)
    ajuste = _ajuste_sesiones(paquete)
    restantes_reales = totales - usadas - ajuste
    disponibles = restantes_reales - agendadas

    # Activo mientras la cita que lo compró siga en pie: si se canceló, se
    # marcó "no asistió" o se eliminó, el paquete no llegó a venderse.
    activo = paquete.get("activo", True)
    origen = paquete.get("cita_origen_id")
    if origen:
        cita_origen = next((c for c, _ in ligadas if str(c["_id"]) == str(origen)), None)
        activo = bool(cita_origen) and estado_cita(cita_origen) not in ESTADOS_NO_CUENTAN

    set_paquete = {
        "sesiones_usadas": usadas,
        "sesiones_agendadas": agendadas,
        "sesiones_restantes": max(restantes_reales, 0),
        "sesiones_disponibles": max(disponibles, 0),
        "sobrecupo": max(-disponibles, 0),
        "ajuste_sesiones": ajuste,
        "activo": activo,
        "historial_uso": nuevo_historial + ajustes,
    }
    if por_sesion:
        # La bolsa manda: el abonado del paquete es lo que entró como
        # anticipo, no la suma de pagos de las sesiones (cada sesión se
        # cubre desde la bolsa al facturarse).
        anticipo = estado_anticipo(paquete)
        set_paquete.update({
            "anticipo_total": anticipo["total"],
            "anticipo_consumido": anticipo["consumido"],
            "anticipo_liquidado": anticipo["liquidado"],
            "anticipo_disponible": anticipo["disponible"],
        })
    if not por_sesion and not paquete.get("pagos_migrados"):
        set_paquete.update(_migrar_pagos_legacy(paquete, ligadas))
    paquete_para_pagos = {**paquete, **set_paquete}
    set_paquete["abono"] = (
        set_paquete["anticipo_total"] if por_sesion
        else (await pagos_consolidados_paquete(paquete_para_pagos, ligadas))["abono"]
    )

    cambios_paquete = {
        k: {"antes": _serializar_pago({"v": paquete.get(k)})["v"], "despues": _serializar_pago({"v": v})["v"]}
        for k, v in set_paquete.items()
        if k not in ("historial_uso", "historial_pagos_legacy") and paquete.get(k) != v
    }
    if not dry_run:
        await collection_client_packages.update_one(
            {"paquete_id": paquete_id},
            {"$set": {**set_paquete, "ultima_sincronizacion": datetime.now()}},
        )

    resumen = {
        "paquete_id": paquete_id,
        "sesiones_totales": totales,
        **{k: v for k, v in set_paquete.items() if k not in ("historial_uso", "historial_pagos", "historial_pagos_legacy", "pagos_migrados")},
        "numeros": numeros,
    }

    # Comisión de cada sesión para el profesional que la atendió (se
    # registra cuando la sesión está realizada y el paquete facturado).
    # En modo "por sesión" no hace falta: cada sesión tiene su propia
    # factura, que ya liquida su comisión.
    if not por_sesion:
        try:
            ligadas_actuales = ligadas if dry_run else await citas_ligadas_paquete(paquete)
            comisiones = await liquidar_comisiones_paquete(
                {**paquete, **set_paquete}, ligadas_actuales, facturacion, dry_run=dry_run, numeros=numeros,
            )
            if comisiones:
                resumen["comisiones"] = comisiones
        except Exception as e:
            print(f"⚠️ No se pudieron liquidar comisiones del paquete {paquete_id}: {e}")

    if dry_run:
        resumen["cambios_citas"] = cambios_citas
        resumen["cambios_paquete"] = cambios_paquete
    return resumen


def paquete_ids_de_servicios(*listas_servicios: Iterable[dict]) -> set:
    return {
        s.get("paquete_id")
        for servicios in listas_servicios
        for s in (servicios or [])
        if isinstance(s, dict) and s.get("paquete_id")
    }


async def sincronizar_paquetes(paquete_ids: Iterable[Optional[str]]) -> dict:
    """Sincroniza varios paquetes; nunca lanza (no debe tumbar la operación principal)."""
    resultados = {}
    for pid in {p for p in paquete_ids if p}:
        try:
            resultados[pid] = await sincronizar_paquete(pid)
        except Exception as e:  # pragma: no cover - defensivo
            print(f"⚠️ No se pudo sincronizar el paquete {pid}: {e}")
    return resultados


async def disponibilidad_paquete(paquete: dict, excluir_cita_id: Optional[str] = None) -> int:
    """
    Sesiones que todavía se pueden asignar a una cita nueva (descontando las
    usadas, las ya agendadas y los ajustes manuales). `excluir_cita_id`: no
    contar esa cita (al re-asignar la misma cita no debe ocupar su propio cupo).
    """
    usadas_o_agendadas = sum(
        int(u.get("sesiones", 1) or 1)
        for u in paquete.get("historial_uso", []) or []
        if not u.get("ajuste_manual")
        and paquete.get("venta_origen_id")
        and u.get("cita_id") == paquete.get("venta_origen_id")
    )
    for cita, idx in await citas_ligadas_paquete(paquete):
        if str(cita["_id"]) == str(excluir_cita_id or ""):
            continue
        if estado_cita(cita) in ESTADOS_NO_CUENTAN:
            continue
        usadas_o_agendadas += _cantidad(cita["servicios"][idx])
    totales = int(paquete.get("sesiones_totales", 0) or 0)
    return totales - usadas_o_agendadas - _ajuste_sesiones(paquete)


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
    valor_paquete: Optional[float] = None,
) -> Optional[dict]:
    """
    Crea (compra) o liga (canje) un paquete de sesiones para esta línea.

    Devuelve:
    - None si la línea no tiene `paquete_id` ni `comprar_paquete_sesiones`.
    - {"ok": True, "paquete_id", "numero_sesion", "sesiones_totales"} — el
      caller debe estampar `paquete_id` en la línea de la cita (para una
      compra nueva es la única forma de saber a qué paquete quedó ligada).
    - {"ok": False, "motivo": "sin_saldo" | "paquete_no_encontrado"}.

    Para citas, el conteo real lo hace `sincronizar_paquete` en cuanto la
    línea queda guardada con `paquete_id` — el caller debe llamarlo después
    de persistir la cita.
    """
    paquete_id_redimido = servicio_item.get("paquete_id")
    comprar_paquete_sesiones = servicio_item.get("comprar_paquete_sesiones")
    cantidad = _cantidad(servicio_item)

    if paquete_id_redimido:
        paquete = await collection_client_packages.find_one({"paquete_id": paquete_id_redimido})
        if not paquete:
            return {"ok": False, "motivo": "paquete_no_encontrado"}

        if origen_tipo == "cita":
            if await disponibilidad_paquete(paquete, excluir_cita_id=cita_id) < cantidad:
                return {"ok": False, "motivo": "sin_saldo"}
            resumen = await sincronizar_paquete(paquete_id_redimido) or {}
            return {
                "ok": True,
                "paquete_id": paquete_id_redimido,
                "numero_sesion": (resumen.get("numeros") or {}).get(str(cita_id)),
                "sesiones_totales": paquete.get("sesiones_totales"),
            }

        # Venta directa que canjea una sesión (sin cita que la represente).
        ya = next((u for u in paquete.get("historial_uso", []) if u.get("cita_id") == cita_id), None)
        if not ya:
            redencion = await collection_client_packages.update_one(
                {"paquete_id": paquete_id_redimido, "sesiones_restantes": {"$gte": cantidad}},
                {
                    "$inc": {"sesiones_restantes": -cantidad, "sesiones_usadas": cantidad},
                    "$push": {"historial_uso": {
                        "cita_id": cita_id, "fecha": datetime.now(),
                        "profesional_id": profesional_id, "sesiones": cantidad,
                    }},
                },
            )
            if redencion.matched_count == 0:
                return {"ok": False, "motivo": "sin_saldo"}
        return {"ok": True, "paquete_id": paquete_id_redimido, "numero_sesion": None,
                "sesiones_totales": paquete.get("sesiones_totales")}

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
        # En modo "por sesión" la línea de la cita vale UNA sesión, así que el
        # precio del paquete completo viene aparte (`valor_paquete`).
        valor_paquete_total = round(float(subtotal if valor_paquete is None else valor_paquete), 2)
        valor_por_sesion = round(valor_paquete_total / sesiones_totales, 2) if sesiones_totales else 0
        nuevo_paquete_id = f"PKG-{random.randint(10000, 99999)}"
        while await collection_client_packages.find_one({"paquete_id": nuevo_paquete_id}):
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
            "sesiones_agendadas": 0,
            "ajuste_sesiones": 0,
            "valor_por_sesion": valor_por_sesion,
            "valor_paquete": valor_paquete_total,
            # Cada sesión se factura sola contra el anticipo (ver
            # anticipos_paquete.py). Los paquetes viejos siguen en modo
            # "paquete": una sola factura por todo.
            "modo_facturacion": MODO_POR_SESION,
            "anticipos": [],
            "moneda": moneda_sede,
            "activo": True,
            "fecha_compra": datetime.now(),
            "cita_origen_id": cita_id if origen_tipo == "cita" else None,
            "venta_origen_id": cita_id if origen_tipo == "venta" else None,
            "creado_por": usuario_email,
            # El dinero del paquete vive en las citas (caja lo lee de ahí):
            # `abono` lo recalcula sincronizar_paquete sumando los pagos de
            # todas sus sesiones. `historial_pagos` del paquete queda solo
            # para pagos antiguos que nunca se registraron en una cita.
            "abono": round(float(abono_origen or 0), 2),
            "historial_pagos": [],
            "pagos_migrados": True,
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


async def revertir_compra_paquete(cita_id: str, servicio_id: str, origen_tipo: str = "cita") -> Optional[dict]:
    """
    Deshace la CREACIÓN de un paquete hecha por esta cita (al editarla y
    quitar la compra). Quitar un canje no necesita esto — basta con quitar
    `paquete_id` de la línea y sincronizar.

    - None si esta cita no había creado ningún paquete.
    - {"ok": True} si se eliminó.
    - {"ok": False, "motivo": "usado_por_otras_citas"} si otras citas
      activas ya están ligadas a ese paquete.
    """
    campo_origen = "cita_origen_id" if origen_tipo == "cita" else "venta_origen_id"
    paquete = await collection_client_packages.find_one({campo_origen: cita_id, "servicio_id": servicio_id})
    if not paquete:
        return None

    otras = [
        c for c, _ in await citas_ligadas_paquete(paquete)
        if str(c["_id"]) != str(cita_id) and estado_cita(c) not in ESTADOS_NO_CUENTAN
    ]
    if otras:
        return {"ok": False, "motivo": "usado_por_otras_citas"}

    await collection_client_packages.delete_one({"paquete_id": paquete["paquete_id"]})
    return {"ok": True}


async def propagar_facturacion_a_paquete(
    servicios_cita: list,
    cita_id_facturada: str,
    numero_comprobante: str,
    fecha_facturacion,
    usuario_email: Optional[str],
) -> int:
    """
    Un paquete es UNA transacción (una factura) pero cada sesión es su propia
    cita. Al facturar una cita del paquete se guarda la factura en el
    paquete (`facturacion`) y `sincronizar_paquete` marca como "Facturada"
    las sesiones consumidas sin pagos propios — también las que se
    finalicen DESPUÉS (antes solo se marcaban las que ya existían en ese
    momento, y las siguientes quedaban en "Finalizado").

    No toca abono/saldo/historial_pagos de las otras citas.
    Devuelve cuántos paquetes se actualizaron.
    """
    paquete_ids = set()
    for pid in paquete_ids_de_servicios(servicios_cita):
        paquete = await collection_client_packages.find_one({"paquete_id": pid})
        # Modo "por sesión": cada sesión tiene su propia factura, no se
        # hereda la de otra.
        if paquete and modo_facturacion(paquete) == MODO_POR_SESION:
            continue
        paquete_ids.add(pid)
    for pid in paquete_ids:
        await collection_client_packages.update_one(
            {"paquete_id": pid, "facturacion": {"$exists": False}},
            {"$set": {"facturacion": {
                "numero_comprobante": numero_comprobante,
                "fecha_facturacion": fecha_facturacion,
                "facturado_por": usuario_email,
                "cita_id": cita_id_facturada,
            }}},
        )
    await sincronizar_paquetes(paquete_ids)
    return len(paquete_ids)


async def contexto_facturacion_paquete(cita: dict) -> Optional[dict]:
    """
    Cómo se factura una cita que pertenece a un paquete. Un paquete es UNA
    venta: se factura una sola vez, desde la cita que lo COMPRÓ, con todo lo
    pagado en cualquiera de sus sesiones.

    - None: la cita no es de ningún paquete (factura normal).
    - {"rol": "sesion", ...}: sesión del paquete — no se factura sola.
    - {"rol": "compra", ...}: cita de compra — trae los pagos a incluir
      (`pagos`), las sesiones cuyos pagos entran en esta factura
      (`citas_con_pagos`), lo ya facturado aparte en sesiones sueltas
      (`ya_facturado`) y cuántos pagos siguen sin sesión (`pagos_sin_cita`).
    """
    cita_id = str(cita.get("_id"))
    for idx, linea in enumerate(cita.get("servicios") or []):
        paquete_id = linea.get("paquete_id")
        if not paquete_id:
            continue
        paquete = await collection_client_packages.find_one({"paquete_id": paquete_id})
        if not paquete:
            continue

        if modo_facturacion(paquete) == MODO_POR_SESION:
            # Cada sesión se factura sola por su valor, pagada con el
            # anticipo del paquete (ver anticipos_paquete.py).
            return {
                "rol": "sesion_independiente",
                "paquete_id": paquete_id,
                "indice_linea": idx,
                "paquete": paquete,
                "valor_por_sesion": round(float(paquete.get("valor_por_sesion", 0) or 0), 2),
            }

        origen_id = str(paquete.get("cita_origen_id") or "")
        if cita_id != origen_id:
            cita_origen = None
            if ObjectId.is_valid(origen_id):
                cita_origen = await collection_citas.find_one({"_id": ObjectId(origen_id)}, {"fecha": 1, "estado_factura": 1})
            return {
                "rol": "sesion",
                "paquete_id": paquete_id,
                "cita_origen_id": origen_id or None,
                "paquete_facturado": bool(paquete.get("facturacion")) or (cita_origen or {}).get("estado_factura") == "facturado",
                "mensaje": (
                    f"Esta cita es la sesión {linea.get('numero_sesion') or ''} del paquete "
                    f"'{paquete.get('nombre_servicio')}'. No se factura sola: el paquete se factura "
                    f"una sola vez desde la cita de compra ({(cita_origen or {}).get('fecha', 'sin fecha')})."
                ),
            }

        await sincronizar_paquete(paquete_id)
        paquete = await collection_client_packages.find_one({"paquete_id": paquete_id})
        pagos, citas_con_pagos, ya_facturado = [], [], []
        for c, _ in await citas_ligadas_paquete(paquete):
            cid = str(c["_id"])
            if cid != origen_id and c.get("estado_factura") == "facturado":
                # Sesión suelta que se facturó por su cuenta antes de asociarla:
                # esa plata ya está en otra factura, se descuenta del paquete.
                if float(c.get("valor_total", 0) or 0) > 0:
                    ya_facturado.append({
                        "cita_id": cid,
                        "numero_comprobante": c.get("numero_comprobante"),
                        "valor": round(float(c.get("valor_total", 0) or 0), 2),
                    })
                continue
            historial = [p for p in c.get("historial_pagos") or [] if float(p.get("monto", 0) or 0) > 0]
            pagos.extend(historial)
            if cid != origen_id and historial:
                citas_con_pagos.append(c)
        pagos.sort(key=lambda p: str(p.get("fecha") or ""))
        return {
            "rol": "compra",
            "paquete_id": paquete_id,
            "indice_linea": idx,
            "pagos": pagos,
            "citas_con_pagos": citas_con_pagos,
            "ya_facturado": ya_facturado,
            "pagos_sin_cita": len(paquete.get("historial_pagos") or []) if paquete.get("pagos_migrados") else 0,
        }

    # La cita que compró el paquete puede haber perdido el `paquete_id` de su
    # línea (datos viejos): se reconoce por el paquete que originó.
    paquete = await collection_client_packages.find_one({"cita_origen_id": cita_id})
    if paquete and modo_facturacion(paquete) == MODO_POR_SESION:
        idx = _linea_del_paquete(cita, paquete)
        if idx is not None:
            return {
                "rol": "sesion_independiente",
                "paquete_id": paquete["paquete_id"],
                "indice_linea": idx,
                "paquete": paquete,
                "valor_por_sesion": round(float(paquete.get("valor_por_sesion", 0) or 0), 2),
            }
    return None
