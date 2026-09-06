"use client"

import type React from "react"
import { useState } from "react"
import { toast } from "sonner"
import { X, Ban } from "lucide-react"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "../../../components/ui/dialog"
import { Button } from "../../../components/ui/button"
import { confirmAction } from "../../../components/ui/confirm-dialog"
import { useAuth } from "../../../components/Auth/AuthContext"
import type { Factura } from "../../../types/factura"
import { formatDateDMY } from "../../../lib/dateFormat"
import { facturaService } from "./facturas"

interface FacturaDetailModalProps {
  factura: Factura
  open: boolean
  onOpenChange: (open: boolean) => void
  // Se llama tras anular con éxito, para que la lista/resumen de facturas
  // se refresque — la factura anulada ya no debe seguir contando como
  // "facturada" en los totales.
  onAnulada?: () => void
}

export function FacturaDetailModal({ factura, open, onOpenChange, onAnulada }: FacturaDetailModalProps) {
  const formatDate = (dateString: string) => formatDateDMY(dateString, "-")
  const { user } = useAuth()
  const [anulando, setAnulando] = useState(false)
  const puedeAnular =
    (user?.role === "admin_sede" || user?.role === "super_admin") &&
    factura.estado !== "anulado" &&
    Boolean(factura.venta_id)

  const handleAnularFactura = async () => {
    if (!factura.venta_id) return

    const confirmed = await confirmAction({
      title: "Anular factura",
      message:
        "Esto anula la factura, revierte el inventario/comisiones/giftcard asociados, y devuelve la cita a 'Finalizado' para que puedas corregir el servicio o el historial de pago antes de volver a facturar. No se puede deshacer.",
      confirmLabel: "Sí, anular",
      variant: "danger",
    })
    if (!confirmed) return

    // `window.prompt` puede no estar soportado en algunos contextos (webviews
    // embebidos, ciertos navegadores móviles) y ahí lanza en vez de devolver
    // null — el motivo es opcional, así que no debe tumbar la anulación.
    let motivo: string | undefined
    try {
      motivo = window.prompt("Motivo de la anulación (opcional):") || undefined
    } catch {
      motivo = undefined
    }

    setAnulando(true)
    try {
      await facturaService.anularFactura(factura.venta_id, motivo)
      toast.success("Factura anulada correctamente")
      onOpenChange(false)
      onAnulada?.()
    } catch (error) {
      const mensaje = error instanceof Error ? error.message : "No se pudo anular la factura"
      toast.error(mensaje)
    } finally {
      setAnulando(false)
    }
  }

  const formatCurrency = (amount: number, currency: string) => {
    const safeCurrency = String(currency || "COP").toUpperCase()
    const safeAmount = Number.isFinite(amount) ? amount : 0
    const locale = safeCurrency === "USD" ? "en-US" : safeCurrency === "MXN" ? "es-MX" : "es-CO"
    return `${safeCurrency} ${Math.round(safeAmount).toLocaleString(locale)}`
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        showCloseButton={false}
        className="max-w-3xl max-h-[90vh] overflow-y-auto bg-white text-gray-900 border border-gray-200 shadow-2xl"
      >
        <div className="bg-white">
          <DialogHeader>
            <DialogTitle className="flex items-center justify-between text-2xl text-gray-900">
              Detalle de Factura
              <Button
                variant="ghost"
                size="icon"
                onClick={() => onOpenChange(false)}
                className="bg-black text-white hover:bg-black/90 hover:text-white"
              >
                <X className="h-5 w-5" />
              </Button>
            </DialogTitle>
          </DialogHeader>

          <div className="space-y-6 py-4 bg-white">
          {/* Información General */}
          <div>
            <h3 className="mb-4 text-lg font-semibold text-gray-900">Información General</h3>
            <div className="grid grid-cols-2 gap-4 rounded-lg border border-gray-200 bg-white p-4">
              <DetailRow label="Identificador" value={factura.identificador} />
              <DetailRow label="Fecha de pago" value={formatDate(factura.fecha_pago)} />
              <DetailRow label="Local" value={factura.local} />
              <DetailRow label="Moneda" value={factura.moneda} />
              <DetailRow label="Tipo de comisión" value={factura.tipo_comision} />
            </div>
          </div>

          {/* Información del Cliente */}
          <div>
            <h3 className="mb-4 text-lg font-semibold text-gray-900">Información del Cliente</h3>
            <div className="grid grid-cols-2 gap-4 rounded-lg border border-gray-200 bg-white p-4">
              <DetailRow label="ID Cliente" value={factura.cliente_id} />
              <DetailRow label="Nombre" value={factura.nombre_cliente} />
              <DetailRow label="Cédula" value={factura.cedula_cliente || "N/A"} />
              <DetailRow label="Email" value={factura.email_cliente} />
              <DetailRow label="Teléfono" value={factura.telefono_cliente} />
            </div>
          </div>

          {/* Información del Profesional */}
          <div>
            <h3 className="mb-4 text-lg font-semibold text-gray-900">Información del Profesional</h3>
            <div className="grid grid-cols-2 gap-4 rounded-lg border border-gray-200 bg-white p-4">
              <DetailRow label="ID Profesional" value={factura.profesional_id} />
              <DetailRow label="Nombre" value={factura.profesional_nombre} />
            </div>
          </div>

          {/* Información de Pago */}
          <div>
            <h3 className="mb-4 text-lg font-semibold text-gray-900">Información de Pago</h3>
            <div className="grid grid-cols-2 gap-4 rounded-lg border border-gray-200 bg-white p-4">
              <DetailRow label="Comprobante de pago" value={factura.comprobante_de_pago} />
              <DetailRow label="Número de comprobante" value={factura.numero_comprobante} />
              <DetailRow label="Fecha comprobante" value={formatDate(factura.fecha_comprobante)} />
              <DetailRow label="Método de pago" value={factura.metodo_pago} />
              <DetailRow label="Monto" value={formatCurrency(factura.monto, factura.moneda)} />
              <DetailRow label="Total" value={formatCurrency(factura.total, factura.moneda)} highlight />
              <DetailRow
                label="Vendido por"
                value={factura.vendido_por || factura.facturado_por || "Sin dato"}
              />
              <DetailRow
                label="Facturado por"
                value={factura.facturado_por || factura.vendido_por || "Sin dato"}
              />
              <DetailRow
                label="Estado"
                value={
                  <span
                    className={`inline-flex rounded-full px-3 py-1 text-xs font-medium ${
                      factura.estado === "pagado" ? "bg-green-100 text-green-800" : "bg-yellow-100 text-yellow-800"
                    }`}
                  >
                    {factura.estado}
                  </span>
                }
              />
            </div>
          </div>
          </div>

          <div className="flex justify-end gap-3 border-t border-gray-200 pt-4 bg-white">
            <Button
              variant="outline"
              onClick={() => onOpenChange(false)}
              className="border-black bg-black text-white hover:bg-black/90 hover:text-white"
            >
              Cerrar
            </Button>
            {puedeAnular && (
              <Button
                variant="outline"
                onClick={handleAnularFactura}
                disabled={anulando}
                className="border-red-300 text-red-600 hover:bg-red-50 bg-white disabled:opacity-50"
              >
                <Ban className="mr-2 h-4 w-4" />
                {anulando ? "Anulando..." : "Anular factura"}
              </Button>
            )}
            <Button className="bg-black text-white hover:bg-black/90">Imprimir factura</Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}

interface DetailRowProps {
  label: string
  value: React.ReactNode
  highlight?: boolean
}

function DetailRow({ label, value, highlight }: DetailRowProps) {
  return (
    <div>
      <p className="text-xs font-medium text-gray-500">{label}</p>
      <p className={`mt-1 text-sm ${highlight ? "text-lg font-bold text-black" : "text-gray-900"}`}>
        {value}
      </p>
    </div>
  )
}
