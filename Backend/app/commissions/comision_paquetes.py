"""
Comisión por sesión de un paquete de sesiones.

Un paquete se factura UNA sola vez (desde la cita que lo compró), pero cada
sesión es una cita propia y la puede atender un profesional distinto. El
valor del paquete se reparte entre sus sesiones (`valor_por_sesion`) y cada
sesión realizada le genera comisión al profesional que la atendió, sobre ese
valor y con su propio porcentaje.

Cuándo se registra (en `commissions`, igual que el resto de comisiones de
servicios): cuando la sesión está realizada (finalizado/completada) Y el
paquete ya está facturado. Así una sesión hecha antes de facturar se
comisiona al facturar, y una hecha después, apenas se finaliza.

- La sesión de la cita de COMPRA la comisiona la propia factura (mismo
  valor por sesión) — aquí no se toca.
- Sesión suelta que se facturó aparte antes de asociarla: ya tiene su
  comisión por esa factura — no se duplica.
- Si a una sesión ya comisionada le cambian el profesional, se quita la
  comisión al anterior y se registra al nuevo. Si esa comisión ya se le
  pagó al anterior, no se toca (no se paga dos veces).

Cada sesión comisionada guarda la marca `comision_paquete` en su cita
(idempotencia); la anulación de la factura del paquete revierte las
comisiones por `numero_comprobante` y quita esas marcas.
"""

from datetime import datetime
from typing import Optional

from bson import ObjectId

from app.database.mongo import (
    collection_citas,
    collection_commissions,
    collection_estilista,
    collection_servicios,
    collection_locales,
    collection_client_packages,
)
from app.utils.timezone import today
from app.scheduling.submodules.quotes.anticipos_paquete import MODO_POR_SESION, modo_facturacion


ESTADOS_CONSUMEN_SESION = {"finalizado", "completada"}
ESTADOS_NO_CUENTAN = {"cancelada", "no_asistio", "no asistio"}


def _estado(cita: dict) -> str:
    return str(cita.get("estado") or "").strip().lower()


def _cantidad(linea: dict) -> int:
    try:
        return max(int(linea.get("cantidad", 1) or 1), 1)
    except (TypeError, ValueError):
        return 1


def normalizar_categoria(valor: Optional[str]) -> str:
    """Normaliza nombre de categoría para comparación robusta."""
    return (valor or "").strip().lower()


def porcentaje_comision_servicio(servicio_db: dict, profesional_db: Optional[dict]) -> float:
    """
    Prioridad:
    1) comisión por servicio específico (comisiones_por_servicio[servicio_id]
       del profesional) — la más específica, gana si está configurada.
    2) comisión por categoría del estilista (comisiones_por_categoria) —
       respaldo cuando el servicio no tiene su propia comisión configurada.
    3) comisión base del profesional (`comision`), si la tiene.
    4) 0, si ninguna aplica.

    NOTA: `comision_estilista` (campo fijo en el propio documento del
    servicio) está deprecado y ya NO se usa para resolver comisión — el
    dato vive en el profesional, no en el servicio.
    """
    if not profesional_db:
        return 0.0

    servicio_id = servicio_db.get("servicio_id") or servicio_db.get("unique_id")
    comisiones_servicio = profesional_db.get("comisiones_por_servicio") or {}
    if servicio_id and isinstance(comisiones_servicio, dict) and servicio_id in comisiones_servicio:
        try:
            return float(comisiones_servicio[servicio_id])
        except (TypeError, ValueError):
            pass

    comisiones_categoria = profesional_db.get("comisiones_por_categoria") or {}
    categoria_servicio = normalizar_categoria(servicio_db.get("categoria"))

    if categoria_servicio and isinstance(comisiones_categoria, dict):
        for categoria, porcentaje in comisiones_categoria.items():
            if normalizar_categoria(categoria) == categoria_servicio:
                try:
                    return float(porcentaje)
                except (TypeError, ValueError):
                    break

    base = profesional_db.get("comision")
    if base is not None:
        try:
            return float(base)
        except (TypeError, ValueError):
            pass

    return 0.0


# ══════════════════════════════════════════════════════════════
# REGISTRO EN `commissions` (compartido con la facturación)
# ══════════════════════════════════════════════════════════════

async def registrar_comision_servicios(
    *,
    receptor_id: str,
    receptor_nombre: str,
    sede: dict,
    servicios_comision: list,
    fecha_actual: datetime,
) -> str:
    """
    Suma `servicios_comision` al documento de comisiones pendiente del
    profesional en la sede (o crea uno nuevo si el período pasa de 15 días).
    Misma lógica que usaba la facturación en línea — ahora compartida para
    que las sesiones de paquete se liquiden igual.
    """
    sede_id = sede.get("sede_id")
    moneda_sede = sede.get("moneda", "COP")
    tipo_comision = (sede.get("reglas_comision") or {"tipo": "servicios"}).get("tipo", "servicios")
    fecha_actual_str = fecha_actual.strftime("%Y-%m-%d")

    total_reg = round(sum(s["valor_comision"] for s in servicios_comision), 2)
    comision_doc_srv = await collection_commissions.find_one({
        "profesional_id": receptor_id,
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
                except Exception:
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
                except Exception:
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
            "$inc": {"total_comisiones": total_reg},
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
        return f"Comisión servicios actualizada (+{total_reg} {moneda_sede})"

    await collection_commissions.insert_one({
        "profesional_id": receptor_id,
        "profesional_nombre": receptor_nombre,
        "sede_id": sede_id,
        "sede_nombre": sede.get("nombre", ""),
        "moneda": moneda_sede,
        "tipo_comision": tipo_comision,
        "total_servicios": len(servicios_comision),
        "total_productos": 0,
        "total_comisiones": total_reg,
        "servicios_detalle": servicios_comision,
        "productos_detalle": [],
        "periodo_inicio": fecha_actual_str,
        "periodo_fin": fecha_actual_str,
        "estado": "pendiente",
        "creado_en": fecha_actual
    })
    return f"Comisión servicios creada ({total_reg} {moneda_sede})"


async def _quitar_comision_sesion(cita_id: str, paquete_id: str) -> bool:
    """
    Quita la comisión de una sesión de paquete de los documentos PENDIENTES.
    Devuelve False si esa comisión ya está en un documento pagado/liquidado
    (no se toca: ya se le pagó al profesional).
    """
    filtro_item = {"origen_id": cita_id, "paquete_id": paquete_id}
    docs = await collection_commissions.find({"servicios_detalle": {"$elemMatch": filtro_item}}).to_list(None)
    for doc in docs:
        if doc.get("estado") != "pendiente":
            return False
    for doc in docs:
        quitados = [
            s for s in doc.get("servicios_detalle", [])
            if s.get("origen_id") == cita_id and s.get("paquete_id") == paquete_id
        ]
        restar = round(sum(float(s.get("valor_comision", 0) or 0) for s in quitados), 2)
        await collection_commissions.update_one(
            {"_id": doc["_id"]},
            {
                "$pull": {"servicios_detalle": filtro_item},
                "$set": {
                    "total_comisiones": max(round(float(doc.get("total_comisiones", 0) or 0) - restar, 2), 0),
                    "ultima_actualizacion": datetime.now(),
                },
            },
        )
    return True


# ══════════════════════════════════════════════════════════════
# CÁLCULO POR SESIÓN (para mostrar y para liquidar)
# ══════════════════════════════════════════════════════════════

class _Cache:
    """Profesionales, servicios y sedes consultados una sola vez."""

    def __init__(self):
        self.profesionales, self.servicios, self.sedes = {}, {}, {}

    async def profesional(self, profesional_id):
        if not profesional_id:
            return None
        if profesional_id not in self.profesionales:
            self.profesionales[profesional_id] = await collection_estilista.find_one({"profesional_id": profesional_id})
        return self.profesionales[profesional_id]

    async def servicio(self, servicio_id):
        if not servicio_id:
            return None
        if servicio_id not in self.servicios:
            self.servicios[servicio_id] = await collection_servicios.find_one({"servicio_id": servicio_id})
        return self.servicios[servicio_id]

    async def sede(self, sede_id):
        if not sede_id:
            return None
        if sede_id not in self.sedes:
            self.sedes[sede_id] = await collection_locales.find_one({"sede_id": sede_id})
        return self.sedes[sede_id]


def _sede_comisiona_servicios(sede: Optional[dict]) -> bool:
    tipo = ((sede or {}).get("reglas_comision") or {"tipo": "servicios"}).get("tipo", "servicios")
    return tipo in ("servicios", "mixto")


async def _registradas_por_cita(cita_ids: list) -> dict:
    """{cita_id: [items de comisión de servicio con ese origen]} (con estado del documento)."""
    if not cita_ids:
        return {}
    registradas = {}
    async for doc in collection_commissions.find(
        {"servicios_detalle.origen_id": {"$in": cita_ids}},
        {"servicios_detalle": 1, "estado": 1, "profesional_id": 1, "profesional_nombre": 1},
    ):
        for item in doc.get("servicios_detalle", []):
            origen = item.get("origen_id")
            if origen in cita_ids:
                registradas.setdefault(origen, []).append({
                    **item,
                    "_estado_doc": doc.get("estado"),
                    "_profesional_id": doc.get("profesional_id"),
                    "_profesional_nombre": doc.get("profesional_nombre"),
                })
    return registradas


async def comisiones_de_sesiones(
    pares: list,
    paquete: dict,
    paquete_facturado: bool,
    cache: Optional[_Cache] = None,
    registradas: Optional[dict] = None,
) -> dict:
    """
    Reparto del paquete por sesión. `pares` = [(cita, idx_linea)].
    Devuelve {cita_id: {valor_sesion, porcentaje, comision, estado,
    profesional_id, profesional_nombre}} donde `estado` es:
      - "registrada" / "pagada": ya está en comisiones (valor real registrado)
      - "pendiente_factura": realizada, se registra al facturar el paquete
      - "agendada": aún no se realiza (valor estimado)
      - "no_cuenta": cancelada / no asistió
      - "sin_porcentaje": el profesional no tiene comisión para este servicio
      - "factura_sin_comision": cita de compra ya facturada cuya factura no
        generó comisión (ej. el porcentaje se configuró después) — revisar
    """
    cache = cache or _Cache()
    if registradas is None:
        registradas = await _registradas_por_cita([str(c["_id"]) for c, _ in pares])

    valor_por_sesion = round(float(paquete.get("valor_por_sesion", 0) or 0), 2)
    # Modo "por sesión": cada sesión tiene su propia factura, así que la
    # comisión de cada una depende de si ESA sesión ya se facturó.
    por_sesion = modo_facturacion(paquete) == MODO_POR_SESION
    sede = await cache.sede(paquete.get("sede_id"))
    comisiona = _sede_comisiona_servicios(sede)
    origen_id = str(paquete.get("cita_origen_id") or "")
    resultado = {}

    for cita, idx in pares:
        cita_id = str(cita["_id"])
        linea = (cita.get("servicios") or [])[idx] if idx is not None else {}
        servicio_id = linea.get("servicio_id") or paquete.get("servicio_id")
        valor_sesion = round(valor_por_sesion * _cantidad(linea), 2)
        profesional_id = cita.get("profesional_id")
        estado = _estado(cita)

        porcentaje = 0.0
        servicio_db = await cache.servicio(servicio_id)
        if comisiona and servicio_db:
            porcentaje = porcentaje_comision_servicio(servicio_db, await cache.profesional(profesional_id))
        comision = round(valor_sesion * porcentaje / 100, 2)

        fila = {
            "valor_sesion": valor_sesion,
            "porcentaje": porcentaje,
            "comision": comision,
            "profesional_id": profesional_id,
            "profesional_nombre": cita.get("profesional_nombre"),
        }

        items = [i for i in registradas.get(cita_id, []) if i.get("servicio_id") in (servicio_id, None)]
        if items:
            fila.update({
                "estado": "pagada" if any(i["_estado_doc"] != "pendiente" for i in items) else "registrada",
                "comision": round(sum(float(i.get("valor_comision", 0) or 0) for i in items), 2),
                "porcentaje": items[0].get("porcentaje", porcentaje),
                "profesional_id": items[0]["_profesional_id"],
                "profesional_nombre": items[0]["_profesional_nombre"] or cita.get("profesional_nombre"),
            })
        elif estado in ESTADOS_NO_CUENTAN:
            fila.update({"estado": "no_cuenta", "comision": 0})
        elif estado not in ESTADOS_CONSUMEN_SESION:
            fila["estado"] = "agendada"
        elif comision <= 0:
            fila["estado"] = "sin_porcentaje"
        elif cita_id == origen_id and paquete_facturado and not por_sesion:
            # La comisión de la cita de compra la genera su factura; si no la
            # generó, no se liquida sola (evita duplicar con la facturación).
            fila["estado"] = "factura_sin_comision"
        else:
            # Realizada y sin registrar: si el paquete ya se facturó, la
            # próxima sincronización la registra.
            facturada = (
                cita.get("estado_factura") == "facturado" if por_sesion else paquete_facturado
            )
            fila["estado"] = "por_registrar" if facturada else "pendiente_factura"
        resultado[cita_id] = fila

    return resultado


# ══════════════════════════════════════════════════════════════
# LIQUIDACIÓN (se llama al final de `sincronizar_paquete`)
# ══════════════════════════════════════════════════════════════

async def liquidar_comisiones_paquete(
    paquete: dict,
    ligadas: list,
    facturacion: Optional[dict],
    dry_run: bool = False,
    numeros: Optional[dict] = None,
) -> list:
    """
    Registra / reasigna / revierte la comisión de cada sesión del paquete
    (menos la cita de compra, que la comisiona su propia factura).
    Idempotente. Devuelve las acciones hechas (o que se harían si dry_run).
    """
    paquete_id = paquete["paquete_id"]
    origen_id = str(paquete.get("cita_origen_id") or "")
    cache = _Cache()
    sede = await cache.sede(paquete.get("sede_id"))
    if not sede or not _sede_comisiona_servicios(sede):
        return []

    acciones = []
    ids_ligadas = {str(c["_id"]) for c, _ in ligadas}

    # Sesiones que se desasociaron del paquete después de comisionarse.
    async for cita in collection_citas.find({"comision_paquete.paquete_id": paquete_id}):
        if str(cita["_id"]) in ids_ligadas:
            continue
        accion = {"cita_id": str(cita["_id"]), "accion": "revertir", "motivo": "ya no pertenece al paquete",
                  "profesional": cita["comision_paquete"].get("profesional_nombre")}
        if not dry_run:
            if await _quitar_comision_sesion(str(cita["_id"]), paquete_id):
                await collection_citas.update_one({"_id": cita["_id"]}, {"$unset": {"comision_paquete": ""}})
            else:
                accion["accion"] = "no_revertida_ya_pagada"
        acciones.append(accion)

    sesiones = [(c, i) for c, i in ligadas if str(c["_id"]) != origen_id]
    if not sesiones:
        return acciones
    registradas = await _registradas_por_cita([str(c["_id"]) for c, _ in sesiones])
    # Comisiones que la sesión tiene por su PROPIA factura (sesión suelta
    # facturada aparte) — las de este paquete se evalúan con la marca.
    propias = {
        cid: [i for i in items if i.get("paquete_id") != paquete_id]
        for cid, items in registradas.items()
    }
    propias = {cid: items for cid, items in propias.items() if items}
    calculo = await comisiones_de_sesiones(sesiones, paquete, bool(facturacion), cache, propias)
    fecha_actual = today(sede).replace(tzinfo=None)
    activo = paquete.get("activo", True)

    for cita, idx in sesiones:
        cita_id = str(cita["_id"])
        marca = cita.get("comision_paquete")
        debe_comisionar = bool(
            facturacion and activo
            and _estado(cita) in ESTADOS_CONSUMEN_SESION
            and cita.get("profesional_id")
        )

        if marca:
            vigente = (
                debe_comisionar
                and marca.get("profesional_id") == cita.get("profesional_id")
                and marca.get("numero_comprobante") == facturacion.get("numero_comprobante")
            )
            if vigente:
                continue
            accion = {
                "cita_id": cita_id,
                "fecha": str(cita.get("fecha") or "")[:10],
                "accion": "revertir",
                "motivo": "cambió el profesional" if debe_comisionar else "la sesión ya no está realizada/facturada",
                "profesional": marca.get("profesional_nombre"),
                "comision": marca.get("valor_comision"),
            }
            if not dry_run:
                if not await _quitar_comision_sesion(cita_id, paquete_id):
                    # Ya se le pagó al profesional anterior: no se le quita
                    # ni se le paga otra vez al nuevo.
                    accion["accion"] = "no_revertida_ya_pagada"
                    acciones.append(accion)
                    continue
                await collection_citas.update_one({"_id": cita["_id"]}, {"$unset": {"comision_paquete": ""}})
            acciones.append(accion)
        elif any(i.get("paquete_id") == paquete_id for i in registradas.get(cita_id, [])):
            # Registrada pero sin marca en la cita (escritura interrumpida):
            # no se duplica.
            continue

        if propias.get(cita_id):
            # Sesión que se facturó (y comisionó) por su cuenta.
            continue
        if not debe_comisionar:
            continue
        fila = calculo[cita_id]
        if fila["comision"] <= 0:
            continue

        linea = (cita.get("servicios") or [])[idx]
        servicio_db = await cache.servicio(linea.get("servicio_id") or paquete.get("servicio_id")) or {}
        numero_sesion = (numeros or {}).get(cita_id) or linea.get("numero_sesion")
        item = {
            "servicio_id": linea.get("servicio_id") or paquete.get("servicio_id"),
            "servicio_nombre": f"{linea.get('nombre') or paquete.get('nombre_servicio') or 'Servicio'} (sesión {numero_sesion or '?'} de {paquete.get('sesiones_totales')} · paquete)",
            "categoria": servicio_db.get("categoria", ""),
            "porcentaje": fila["porcentaje"],
            "valor_servicio": fila["valor_sesion"],
            "valor_comision": fila["comision"],
            "fecha": fecha_actual.strftime("%Y-%m-%d"),
            "fecha_sesion": str(cita.get("fecha") or "")[:10],
            "numero_comprobante": facturacion.get("numero_comprobante"),
            "origen_tipo": "cita",
            "origen_id": cita_id,
            "paquete_id": paquete_id,
            "numero_sesion": numero_sesion,
        }
        acciones.append({
            "cita_id": cita_id,
            "fecha": item["fecha_sesion"],
            "accion": "registrar",
            "profesional": cita.get("profesional_nombre"),
            "valor_sesion": fila["valor_sesion"],
            "porcentaje": fila["porcentaje"],
            "comision": fila["comision"],
        })
        if dry_run:
            continue
        await registrar_comision_servicios(
            receptor_id=cita["profesional_id"],
            receptor_nombre=cita.get("profesional_nombre", ""),
            sede=sede,
            servicios_comision=[item],
            fecha_actual=fecha_actual,
        )
        await collection_citas.update_one({"_id": cita["_id"]}, {"$set": {"comision_paquete": {
            "paquete_id": paquete_id,
            "numero_comprobante": facturacion.get("numero_comprobante"),
            "profesional_id": cita["profesional_id"],
            "profesional_nombre": cita.get("profesional_nombre"),
            "valor_comision": fila["comision"],
            "registrada_en": datetime.now(),
        }}})

    return acciones


# ══════════════════════════════════════════════════════════════
# REPORTE: sesiones de paquete por profesional
# ══════════════════════════════════════════════════════════════

async def reporte_sesiones_por_profesional(sede_id: Optional[str], desde: str, hasta: str) -> dict:
    """
    Sesiones de paquete REALIZADAS entre `desde` y `hasta` (fecha de la
    cita), agrupadas por el profesional que las atendió, con el valor de
    cada sesión y su comisión (registrada o estimada).
    """
    filtro = {
        "fecha": {"$gte": desde, "$lte": hasta},
        "estado": {"$in": list(ESTADOS_CONSUMEN_SESION)},
        "servicios.paquete_id": {"$nin": [None, ""]},
    }
    if sede_id:
        filtro["sede_id"] = sede_id
    citas = await collection_citas.find(filtro).to_list(None)

    paquete_ids = {s.get("paquete_id") for c in citas for s in c.get("servicios") or [] if s.get("paquete_id")}
    paquetes = {
        p["paquete_id"]: p
        async for p in collection_client_packages.find({"paquete_id": {"$in": list(paquete_ids)}})
    }
    origenes = [p.get("cita_origen_id") for p in paquetes.values() if ObjectId.is_valid(str(p.get("cita_origen_id") or ""))]
    origen_facturado = {
        str(c["_id"]) for c in await collection_citas.find(
            {"_id": {"$in": [ObjectId(str(o)) for o in origenes]}, "estado_factura": "facturado"}, {"_id": 1}
        ).to_list(None)
    }

    cache = _Cache()
    registradas = await _registradas_por_cita([str(c["_id"]) for c in citas])
    por_profesional = {}

    for cita in citas:
        for idx, linea in enumerate(cita.get("servicios") or []):
            paquete = paquetes.get(linea.get("paquete_id"))
            if not paquete:
                continue
            facturado = bool(paquete.get("facturacion")) or str(paquete.get("cita_origen_id") or "") in origen_facturado
            fila = (await comisiones_de_sesiones([(cita, idx)], paquete, facturado, cache, registradas))[str(cita["_id"])]
            clave = fila["profesional_id"] or "sin_profesional"
            grupo = por_profesional.setdefault(clave, {
                "profesional_id": fila["profesional_id"],
                "profesional_nombre": fila["profesional_nombre"] or "Sin profesional",
                "sesiones": [],
                "total_sesiones": 0,
                "valor_sesiones": 0.0,
                "comision_total": 0.0,
                "comision_registrada": 0.0,
                "comision_pendiente": 0.0,
            })
            grupo["sesiones"].append({
                "cita_id": str(cita["_id"]),
                "fecha": str(cita.get("fecha") or "")[:10],
                "hora_inicio": cita.get("hora_inicio"),
                "cliente_nombre": cita.get("cliente_nombre"),
                "paquete_id": paquete["paquete_id"],
                "servicio": linea.get("nombre") or paquete.get("nombre_servicio"),
                "numero_sesion": linea.get("numero_sesion"),
                "sesiones_totales": paquete.get("sesiones_totales"),
                "es_compra": str(cita["_id"]) == str(paquete.get("cita_origen_id") or ""),
                **fila,
            })
            grupo["total_sesiones"] += _cantidad(linea)
            grupo["valor_sesiones"] = round(grupo["valor_sesiones"] + fila["valor_sesion"], 2)
            grupo["comision_total"] = round(grupo["comision_total"] + fila["comision"], 2)
            if fila["estado"] in ("registrada", "pagada"):
                grupo["comision_registrada"] = round(grupo["comision_registrada"] + fila["comision"], 2)
            else:
                grupo["comision_pendiente"] = round(grupo["comision_pendiente"] + fila["comision"], 2)

    profesionales = sorted(por_profesional.values(), key=lambda g: -g["comision_total"])
    for g in profesionales:
        g["sesiones"].sort(key=lambda s: (s["fecha"], str(s.get("hora_inicio") or "")))
    return {
        "desde": desde,
        "hasta": hasta,
        "profesionales": profesionales,
        "total_sesiones": sum(g["total_sesiones"] for g in profesionales),
        "comision_total": round(sum(g["comision_total"] for g in profesionales), 2),
    }
