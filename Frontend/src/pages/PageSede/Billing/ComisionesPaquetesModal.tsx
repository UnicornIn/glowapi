// Comisiones por sesión de paquete, agrupadas por profesional.
//
// Un paquete se factura una sola vez, pero cada sesión la puede atender un
// profesional distinto. El valor del paquete se reparte entre sus sesiones y
// quien atiende cada sesión recibe comisión sobre ese valor: se registra al
// facturar el paquete (o al finalizar la sesión, si el paquete ya estaba
// facturado). Aquí se ven las registradas y las que faltan por registrar.
import { useEffect, useState } from "react"
import { ChevronDown, ChevronRight, Loader2, Package, X } from "lucide-react"
import { formatCurrencyNoDecimals, getStoredCurrency } from "../../../lib/currency"
import { formatDateDMY } from "../../../lib/dateFormat"
import {
  ESTADO_COMISION_LABEL,
  getComisionesSesionesPaquete,
  type ComisionesSesionesReporte,
  type EstadoComisionSesion,
} from "../../../components/Quotes/clientsService"

interface Props {
  isOpen: boolean
  onClose: () => void
  desde: string
  hasta: string
  periodoLabel?: string
  /** Solo super_admin: sede a consultar (sin valor = todas) */
  sedeId?: string
}

const COLOR_ESTADO: Partial<Record<EstadoComisionSesion, string>> = {
  registrada: "text-emerald-700 bg-emerald-50",
  pagada: "text-slate-600 bg-slate-100",
  pendiente_factura: "text-amber-700 bg-amber-50",
  por_registrar: "text-blue-700 bg-blue-50",
  sin_porcentaje: "text-red-600 bg-red-50",
  factura_sin_comision: "text-red-600 bg-red-50",
}

export function ComisionesPaquetesModal({ isOpen, onClose, desde, hasta, periodoLabel, sedeId }: Props) {
  const [data, setData] = useState<ComisionesSesionesReporte | null>(null)
  const [cargando, setCargando] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [abierto, setAbierto] = useState<string | null>(null)
  const moneda = getStoredCurrency("COP")
  const dinero = (v: number) => formatCurrencyNoDecimals(v, moneda)

  useEffect(() => {
    if (!isOpen) return
    const token = localStorage.getItem("access_token") || sessionStorage.getItem("access_token")
    if (!token) {
      setError("No se encontró token de autenticación")
      return
    }
    let vigente = true
    setCargando(true)
    setError(null)
    getComisionesSesionesPaquete(token, desde, hasta, sedeId)
      .then((r) => vigente && setData(r))
      .catch((e) => vigente && setError(e?.message || "No se pudieron cargar las comisiones"))
      .finally(() => vigente && setCargando(false))
    return () => {
      vigente = false
    }
  }, [isOpen, desde, hasta, sedeId])

  if (!isOpen) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div
        className="bg-white rounded-2xl shadow-xl w-full max-w-2xl max-h-[88vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-5 py-4 flex items-start justify-between gap-3 border-b border-gray-200">
          <div>
            <div className="flex items-center gap-2 text-sm font-semibold text-gray-900">
              <Package className="h-4 w-4" /> Sesiones de paquetes por profesional
            </div>
            <p className="text-xs text-gray-500 mt-0.5">
              {periodoLabel || `${formatDateDMY(desde)} – ${formatDateDMY(hasta)}`} · sesiones realizadas en el período
            </p>
          </div>
          <button type="button" onClick={onClose} className="text-gray-400 hover:text-gray-700">
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="overflow-y-auto p-5 space-y-3">
          <p className="text-xs text-gray-500">
            Cada sesión vale lo que cuesta el paquete dividido entre sus sesiones. Quien atiende la sesión recibe su
            comisión sobre ese valor. Se registra en comisiones al facturar el paquete, o al finalizar la sesión si el
            paquete ya estaba facturado.
          </p>

          {cargando ? (
            <div className="flex justify-center py-10">
              <Loader2 className="h-5 w-5 animate-spin text-gray-400" />
            </div>
          ) : error ? (
            <div className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>
          ) : !data || data.profesionales.length === 0 ? (
            <div className="py-10 text-center text-sm text-gray-400">No hay sesiones de paquete realizadas en este período.</div>
          ) : (
            <>
              <div className="grid grid-cols-2 gap-2">
                <div className="rounded-xl border border-gray-200 px-3 py-2">
                  <div className="text-[10px] font-semibold uppercase tracking-wide text-gray-400">Sesiones</div>
                  <div className="text-lg font-bold text-gray-900">{data.total_sesiones}</div>
                </div>
                <div className="rounded-xl border border-gray-200 px-3 py-2">
                  <div className="text-[10px] font-semibold uppercase tracking-wide text-gray-400">Comisión total</div>
                  <div className="text-lg font-bold text-gray-900">{dinero(data.comision_total)}</div>
                </div>
              </div>

              {data.profesionales.map((p) => {
                const clave = p.profesional_id || p.profesional_nombre
                const expandido = abierto === clave
                return (
                  <div key={clave} className="rounded-xl border border-gray-200 overflow-hidden">
                    <button
                      type="button"
                      onClick={() => setAbierto(expandido ? null : clave)}
                      className="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-gray-50"
                    >
                      {expandido ? (
                        <ChevronDown className="h-4 w-4 text-gray-400 shrink-0" />
                      ) : (
                        <ChevronRight className="h-4 w-4 text-gray-400 shrink-0" />
                      )}
                      <div className="flex-1 min-w-0">
                        <div className="text-sm font-semibold text-gray-900 truncate">{p.profesional_nombre}</div>
                        <div className="text-xs text-gray-500">
                          {p.total_sesiones} sesión(es) · valor {dinero(p.valor_sesiones)}
                        </div>
                      </div>
                      <div className="text-right shrink-0">
                        <div className="text-sm font-bold text-gray-900">{dinero(p.comision_total)}</div>
                        <div className="text-[11px] text-gray-500">
                          {dinero(p.comision_registrada)} registrada
                          {p.comision_pendiente > 0 && ` · ${dinero(p.comision_pendiente)} pendiente`}
                        </div>
                      </div>
                    </button>

                    {expandido && (
                      <div className="border-t border-gray-100 divide-y divide-gray-100">
                        {p.sesiones.map((s) => (
                          <div key={`${s.cita_id}-${s.paquete_id}`} className="flex items-center gap-3 px-4 py-2 text-xs">
                            <div className="w-16 shrink-0 text-gray-500 tabular-nums">{formatDateDMY(s.fecha)}</div>
                            <div className="flex-1 min-w-0">
                              <div className="font-medium text-gray-800 truncate">{s.cliente_nombre || "—"}</div>
                              <div className="text-[11px] text-gray-500 truncate">
                                {s.servicio} · Sesión {s.numero_sesion ?? "?"} de {s.sesiones_totales ?? "?"}
                                {s.es_compra && " (compra)"} · {dinero(s.valor_sesion)}
                                {s.porcentaje ? ` × ${s.porcentaje}%` : ""}
                              </div>
                            </div>
                            <div className="text-right shrink-0">
                              <div className="font-semibold text-gray-900">{dinero(s.comision)}</div>
                              <span
                                className={`inline-block rounded px-1.5 py-0.5 text-[10px] font-semibold ${
                                  COLOR_ESTADO[s.estado] || "text-gray-600 bg-gray-100"
                                }`}
                              >
                                {ESTADO_COMISION_LABEL[s.estado] || s.estado}
                              </span>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )
              })}
            </>
          )}
        </div>
      </div>
    </div>
  )
}
