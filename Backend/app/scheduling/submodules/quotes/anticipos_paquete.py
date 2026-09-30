"""
Anticipo de un paquete de sesiones (facturación sesión por sesión).

Nexa vende paquetes que el cliente abona por adelantado (ej. $1.400.000 en
14 sesiones, abona $700.000), pero CADA sesión se factura por separado a
medida que se presta: si el cliente no vuelve, lo no prestado no se factura.

Por eso el paquete funciona como una bolsa de anticipo:

- El dinero que el cliente abona entra a `anticipos` del paquete, con su
  fecha y su método reales.
- Al facturar una sesión se toma de esa bolsa lo que vale la sesión
  (`consumir_anticipo`). Cada pedazo entra a la factura con la fecha y el
  método originales, marcado `origen: "anticipo_paquete"` — así la factura
  muestra las dos cosas: con qué pagó el cliente y que salió del anticipo.
- Si no alcanza, no se factura: primero hay que registrar el pago.

Caja cuenta cada peso UNA sola vez y en la fecha en que entró:
  - lo que sigue en la bolsa, desde el paquete (ver app/cash);
  - lo ya facturado, desde la factura que se lo llevó.
Anular la factura devuelve los pedazos a la bolsa (`devolver_anticipo`).

El anticipo que sobra (el cliente no volvió) se liquida a mano:
`liquidar_anticipo` lo pasa a saldo a favor del cliente o lo marca como
devuelto (la devolución queda además como egreso en caja). Liquidar no
cambia lo que caja ya contó: esa plata entró de verdad ese día.

Los paquetes viejos, que se facturaron completos de una sola vez, siguen
en modo "paquete" y nada de esto los toca (ver `modo_facturacion`).
"""

from datetime import datetime
from typing import Optional

from app.database.mongo import collection_client_packages, collection_citas


MODO_POR_SESION = "por_sesion"
MODO_PAQUETE = "paquete"


def modo_facturacion(paquete: Optional[dict]) -> str:
    """
    "por_sesion": cada sesión se factura sola contra el anticipo (modo nuevo).
    "paquete": una sola factura para todo el paquete (paquetes antiguos).

    Sin marca explícita se asume el modo viejo: los paquetes que ya existían
    se facturaron (o se iban a facturar) completos, y cambiarles el modo a
    mitad de camino descuadraría lo ya facturado.
    """
    return (paquete or {}).get("modo_facturacion") or MODO_PAQUETE


def _monto(valor) -> float:
    try:
        return round(float(valor or 0), 2)
    except (TypeError, ValueError):
        return 0.0


def _consumido(entrada: dict) -> float:
    return round(sum(_monto(c.get("monto")) for c in entrada.get("consumos") or []), 2)


def _liquidado(entrada: dict) -> float:
    return _monto((entrada.get("liquidacion") or {}).get("monto"))


def disponible_entrada(entrada: dict) -> float:
    """Lo que queda de un anticipo para cubrir sesiones."""
    return max(round(_monto(entrada.get("monto")) - _consumido(entrada) - _liquidado(entrada), 2), 0)


def pendiente_en_caja(entrada: dict) -> float:
    """
    Lo que de ese anticipo sigue contando en caja desde el paquete: lo que
    ya se facturó lo cuenta la factura. Una liquidación NO descuenta: esa
    plata entró igual (si se devolvió, sale como egreso, no como menos
    ingreso).
    """
    return max(round(_monto(entrada.get("monto")) - _consumido(entrada), 2), 0)


def estado_anticipo(paquete: dict) -> dict:
    """Resumen de la bolsa: total abonado, consumido en facturas, liquidado y disponible."""
    entradas = paquete.get("anticipos") or []
    total = round(sum(_monto(e.get("monto")) for e in entradas), 2)
    consumido = round(sum(_consumido(e) for e in entradas), 2)
    liquidado = round(sum(_liquidado(e) for e in entradas), 2)
    return {
        "total": total,
        "consumido": consumido,
        "liquidado": liquidado,
        "disponible": max(round(total - consumido - liquidado, 2), 0),
        "entradas": len(entradas),
    }


def _fecha_texto(valor) -> str:
    if isinstance(valor, datetime):
        return valor.strftime("%d-%m-%Y")
    return str(valor or "")[:10]


async def registrar_anticipo(
    paquete_id: str,
    *,
    monto: float,
    metodo: str,
    fecha: Optional[datetime] = None,
    registrado_por: Optional[str] = None,
    notas: Optional[str] = None,
    cita_id: Optional[str] = None,
) -> dict:
    """Agrega plata a la bolsa del paquete (abono del cliente)."""
    entrada = {
        "fecha": fecha or datetime.now(),
        "monto": _monto(monto),
        "metodo": (metodo or "efectivo").lower().strip(),
        "tipo": "anticipo_paquete",
        "registrado_por": registrado_por,
        "notas": notas,
        "cita_id": cita_id,
        "consumos": [],
    }
    await collection_client_packages.update_one(
        {"paquete_id": paquete_id}, {"$push": {"anticipos": entrada}}
    )
    return entrada


async def consumir_anticipo(
    paquete: dict,
    monto_requerido: float,
    *,
    numero_comprobante: str,
    cita_id: str,
    fecha_factura: Optional[datetime] = None,
    dry_run: bool = False,
) -> dict:
    """
    Toma de la bolsa lo que cuesta una sesión, del anticipo más viejo al más
    nuevo (y parte una entrada si hace falta).

    Devuelve {"cubierto", "faltante", "pagos"}: `pagos` son las entradas que
    van a la factura, con la fecha y el método originales del abono.
    Con `dry_run=True` no escribe: sirve para saber si alcanza.
    """
    requerido = _monto(monto_requerido)
    entradas = paquete.get("anticipos") or []
    fecha_factura = fecha_factura or datetime.now()
    pagos, consumos_por_indice, restante = [], {}, requerido

    for i, entrada in enumerate(entradas):
        if restante <= 0:
            break
        disponible = disponible_entrada(entrada)
        if disponible <= 0:
            continue
        usado = round(min(disponible, restante), 2)
        restante = round(restante - usado, 2)
        consumos_por_indice[i] = {
            "numero_comprobante": numero_comprobante,
            "cita_id": cita_id,
            "monto": usado,
            "fecha": fecha_factura,
        }
        pagos.append({
            "fecha": entrada.get("fecha"),
            "monto": usado,
            "metodo": entrada.get("metodo") or "efectivo",
            "tipo": "anticipo_paquete",
            "registrado_por": entrada.get("registrado_por"),
            # El cliente pagó con este método; la plata sale del anticipo.
            "notas": f"Anticipo del paquete {paquete.get('paquete_id')} abonado el {_fecha_texto(entrada.get('fecha'))}",
            "origen": "anticipo_paquete",
            "paquete_id": paquete.get("paquete_id"),
            "anticipo_indice": i,
            # Plata vieja que nunca entró a caja (quedó solo en el paquete):
            # sigue sin contarse al facturarse, para no cambiar días cerrados.
            **({"sin_caja": True} if entrada.get("sin_caja") else {}),
        })

    resultado = {
        "cubierto": round(requerido - restante, 2),
        "faltante": max(restante, 0),
        "pagos": pagos,
    }
    if dry_run or not consumos_por_indice:
        return resultado

    await collection_client_packages.update_one(
        {"paquete_id": paquete["paquete_id"]},
        {"$push": {f"anticipos.{i}.consumos": consumo for i, consumo in consumos_por_indice.items()}},
    )
    return resultado


async def devolver_anticipo(numero_comprobante: str) -> float:
    """
    Anular la factura de una sesión devuelve a la bolsa lo que esa factura
    se había llevado. Devuelve el monto devuelto.
    """
    if not numero_comprobante:
        return 0.0
    devuelto = 0.0
    async for paquete in collection_client_packages.find(
        {"anticipos.consumos.numero_comprobante": numero_comprobante}
    ):
        entradas = paquete.get("anticipos") or []
        for entrada in entradas:
            quedan = []
            for consumo in entrada.get("consumos") or []:
                if consumo.get("numero_comprobante") == numero_comprobante:
                    devuelto = round(devuelto + _monto(consumo.get("monto")), 2)
                else:
                    quedan.append(consumo)
            entrada["consumos"] = quedan
        await collection_client_packages.update_one(
            {"paquete_id": paquete["paquete_id"]}, {"$set": {"anticipos": entradas}}
        )
    return devuelto


async def liquidar_anticipo(
    paquete: dict,
    *,
    tipo: str,
    usuario_email: Optional[str],
    motivo: Optional[str] = None,
    monto: Optional[float] = None,
) -> dict:
    """
    Cierra el anticipo que sobró (el cliente no volvió):
    - "saldo_a_favor": queda como crédito del cliente para otro servicio.
    - "devolucion": se le devuelve la plata (quien llama registra el egreso).

    No toca lo que caja ya contó el día del abono.
    """
    if tipo not in ("saldo_a_favor", "devolucion"):
        raise ValueError("tipo debe ser 'saldo_a_favor' o 'devolucion'")

    entradas = paquete.get("anticipos") or []
    restante = _monto(monto) if monto else estado_anticipo(paquete)["disponible"]
    liquidado, detalle = 0.0, []
    for entrada in entradas:
        if restante <= 0:
            break
        disponible = disponible_entrada(entrada)
        if disponible <= 0:
            continue
        usado = round(min(disponible, restante), 2)
        restante = round(restante - usado, 2)
        liquidado = round(liquidado + usado, 2)
        previo = _liquidado(entrada)
        entrada["liquidacion"] = {
            "tipo": tipo,
            "monto": round(previo + usado, 2),
            "fecha": datetime.now(),
            "usuario": usuario_email,
            "motivo": motivo,
        }
        detalle.append({"monto": usado, "metodo": entrada.get("metodo"), "fecha": entrada.get("fecha")})

    if liquidado > 0:
        await collection_client_packages.update_one(
            {"paquete_id": paquete["paquete_id"]}, {"$set": {"anticipos": entradas}}
        )
    return {"tipo": tipo, "liquidado": liquidado, "detalle": detalle}


async def mover_pagos_cita_a_anticipo(cita: dict, paquete_id: str) -> float:
    """
    Lo que el cliente pagó en la cita que compró el paquete es el abono del
    paquete, no el pago de esa cita: se pasa a la bolsa (misma fecha y mismo
    método) y la cita queda sin pagos propios. Cada sesión, incluida esta,
    se cubre después desde la bolsa al facturarse.

    Caja no cambia: el peso deja de contarse en la cita y pasa a contarse en
    el anticipo, en la misma fecha.
    """
    pagos = [p for p in (cita.get("historial_pagos") or []) if _monto(p.get("monto")) > 0]
    if not pagos:
        return 0.0
    entradas = [{
        "fecha": p.get("fecha") or datetime.now(),
        "monto": _monto(p.get("monto")),
        "metodo": (p.get("metodo") or "efectivo").lower().strip(),
        "tipo": "anticipo_paquete",
        "registrado_por": p.get("registrado_por"),
        "notas": p.get("notas"),
        "cita_id": str(cita["_id"]),
        "consumos": [],
    } for p in pagos]
    await collection_client_packages.update_one(
        {"paquete_id": paquete_id}, {"$push": {"anticipos": {"$each": entradas}}}
    )
    await collection_citas.update_one(
        {"_id": cita["_id"]},
        {"$set": {
            "historial_pagos": [],
            "abono": 0,
            "saldo_pendiente": _monto(cita.get("valor_total")),
            "estado_pago": "pendiente",
            "pagos_en_anticipo": paquete_id,
        }},
    )
    return round(sum(e["monto"] for e in entradas), 2)


def pagos_anticipo_para_panel(paquete: dict) -> list:
    """Los anticipos como los muestra el historial de pagos del paquete."""
    filas = []
    for i, entrada in enumerate(paquete.get("anticipos") or []):
        consumos = entrada.get("consumos") or []
        liquidacion = entrada.get("liquidacion") or None
        filas.append({
            "fecha": entrada.get("fecha").isoformat() if isinstance(entrada.get("fecha"), datetime) else entrada.get("fecha"),
            "monto": _monto(entrada.get("monto")),
            "metodo": entrada.get("metodo"),
            "tipo": "anticipo_paquete",
            "registrado_por": entrada.get("registrado_por"),
            "notas": entrada.get("notas"),
            "origen": "anticipo",
            "indice": i,
            "en_caja": True,
            "consumido": _consumido(entrada),
            "disponible": disponible_entrada(entrada),
            "facturas": [
                {"numero_comprobante": c.get("numero_comprobante"), "monto": _monto(c.get("monto")), "cita_id": c.get("cita_id")}
                for c in consumos
            ],
            "liquidacion": (
                {**liquidacion, "fecha": liquidacion["fecha"].isoformat() if isinstance(liquidacion.get("fecha"), datetime) else liquidacion.get("fecha")}
                if liquidacion else None
            ),
        })
    return filas
