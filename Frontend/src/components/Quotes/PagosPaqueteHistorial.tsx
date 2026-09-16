// Historial de pagos de un paquete de sesiones (pestaña "Pagos" de cualquier
// cita del paquete). Cada pago muestra cuándo se pagó, cuánto y en qué
// sesión se recibió — este negocio cobra una parte al comprar el paquete y
// el resto a mitad de las sesiones. Los pagos viven en las citas (caja los
// ve ahí); los que quedaron guardados solo en el paquete, de antes de
// unificar, se marcan para pasarlos a una sesión o descartarlos si eran
// duplicados.
import React, { useState } from "react";
import { toast } from "sonner";
import { AlertTriangle, ChevronRight, Loader2 } from "lucide-react";
import { confirmAction } from "../ui/confirm-dialog";
import { formatDateDMY } from "../../lib/dateFormat";
import { PAYMENT_METHOD_OPTIONS } from "../../lib/payment-methods";
import { formatMontoInput, parseMontoInput } from "../../lib/money-input";
import {
  corregirPagoPaquete,
  descartarPagoPaquete,
  getPaquetePorId,
  moverPagoPaqueteASesion,
  type PagoConsolidadoPaquete,
  type PaqueteCliente,
} from "./clientsService";

interface Props {
  token: string;
  paquete: PaqueteCliente;
  citaActualId: string;
  puedeGestionar: boolean;
  formatMonto: (valor: number) => string;
  moneda?: string;
  onPaqueteActualizado: (paquete: PaqueteCliente) => void;
  onCorregirPagoCita: (
    citaId: string,
    indice: number,
    cambios: { metodo?: string; monto?: number },
  ) => Promise<unknown>;
  onAbrirCita?: (citaId: string) => void;
}

const TIPO_LABEL: Record<string, string> = {
  abono_inicial: "Abono inicial",
  pago_adicional: "Pago adicional",
  pago_completo: "Pago completo",
  saldo_migrado: "Saldo registrado en el paquete",
};

const PagosPaqueteHistorial: React.FC<Props> = ({
  token,
  paquete,
  citaActualId,
  puedeGestionar,
  formatMonto,
  moneda = "COP",
  onPaqueteActualizado,
  onCorregirPagoCita,
  onAbrirCita,
}) => {
  const [editando, setEditando] = useState<string | null>(null);
  const [metodo, setMetodo] = useState("");
  const [monto, setMonto] = useState("");
  const [descartando, setDescartando] = useState<number | null>(null);
  const [motivo, setMotivo] = useState("");
  const [trabajando, setTrabajando] = useState(false);

  const pagos = paquete.pagos || [];
  const sinCaja = pagos.filter((p) => p.origen === "paquete");
  const claveDe = (p: PagoConsolidadoPaquete) => `${p.origen}:${p.cita_id || ""}:${p.indice}`;

  const recargar = async (actualizado?: PaqueteCliente | null) => {
    const paqueteNuevo = actualizado || (await getPaquetePorId(token, paquete.paquete_id));
    if (paqueteNuevo) onPaqueteActualizado(paqueteNuevo);
  };

  const guardarCorreccion = async (p: PagoConsolidadoPaquete) => {
    const montoNumero = parseMontoInput(monto, moneda);
    if (!montoNumero || montoNumero <= 0) {
      toast.error("El monto debe ser mayor a 0");
      return;
    }
    const cambios: { metodo?: string; monto?: number } = {};
    if (metodo && metodo !== p.metodo) cambios.metodo = metodo;
    if (montoNumero !== Number(p.monto)) cambios.monto = montoNumero;
    if (Object.keys(cambios).length === 0) {
      setEditando(null);
      return;
    }
    setTrabajando(true);
    try {
      if (p.origen === "cita" && p.cita_id) {
        await onCorregirPagoCita(p.cita_id, p.indice, cambios);
        await recargar();
      } else {
        await recargar(await corregirPagoPaquete(token, paquete.paquete_id, p.indice, cambios));
      }
      toast.success("Pago corregido");
      setEditando(null);
    } catch (error: any) {
      toast.error(error?.message || "No se pudo corregir el pago");
    } finally {
      setTrabajando(false);
    }
  };

  const pasarAEstaSesion = async (p: PagoConsolidadoPaquete) => {
    const ok = await confirmAction({
      title: "Pasar pago a esta sesión",
      message: `El pago de ${formatMonto(p.monto)} del ${formatDateDMY(p.fecha, "")} quedará guardado en esta cita y aparecerá en caja con esa fecha. El total pagado del paquete no cambia.`,
      confirmLabel: "Sí, pasar",
      variant: "primary",
    });
    if (!ok) return;
    setTrabajando(true);
    try {
      await recargar(await moverPagoPaqueteASesion(token, paquete.paquete_id, p.indice, citaActualId));
      toast.success("Pago pasado a esta sesión");
    } catch (error: any) {
      toast.error(error?.message || "No se pudo pasar el pago");
    } finally {
      setTrabajando(false);
    }
  };

  const confirmarDescarte = async (p: PagoConsolidadoPaquete) => {
    if (motivo.trim().length < 3) {
      toast.error("Escribe el motivo (ej. 'duplicado del pago de la sesión 3')");
      return;
    }
    setTrabajando(true);
    try {
      await recargar(await descartarPagoPaquete(token, paquete.paquete_id, p.indice, motivo.trim()));
      toast.success("Pago descartado");
      setDescartando(null);
      setMotivo("");
    } catch (error: any) {
      toast.error(error?.message || "No se pudo descartar el pago");
    } finally {
      setTrabajando(false);
    }
  };

  if (pagos.length === 0) {
    return (
      <div className="rounded-xl py-8 text-center text-xs" style={{ background: "#F8FAFC", color: "#94A3B8" }}>
        Este paquete no tiene pagos registrados
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {sinCaja.length > 0 && (
        <div className="rounded-xl p-3 text-xs flex gap-2" style={{ background: "#FFFBEB", color: "#92400E" }}>
          <AlertTriangle className="w-4 h-4 shrink-0" />
          <span>
            {sinCaja.length} pago(s) quedaron guardados solo en el paquete y no aparecen en caja. Si el dinero se
            recibió, pásalo a la sesión donde se pagó; si ya estaba registrado en otra sesión, descártalo como duplicado.
          </span>
        </div>
      )}

      {pagos.map((p) => {
        const clave = claveDe(p);
        const esEstaCita = p.cita_id === citaActualId;
        const metodoLower = String(p.metodo || "").toLowerCase();
        const corregible =
          metodoLower !== "giftcard" && metodoLower !== "saldo_a_favor" && !(p.origen === "cita" && p.cita_facturada);
        return (
          <div
            key={clave}
            className="rounded-xl p-3"
            style={{
              background: p.origen === "paquete" ? "#FFFBEB" : "#F8FAFC",
              border: esEstaCita ? "1px solid #CBD5E1" : "1px solid transparent",
            }}
          >
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <p className="text-xs font-semibold" style={{ color: "#1E293B" }}>
                  {formatDateDMY(p.fecha, "")} · {TIPO_LABEL[p.tipo] || p.tipo || "Pago"}
                </p>
                <p className="text-[10px]" style={{ color: "#64748B" }}>
                  {p.metodo}
                  {p.registrado_por ? ` · ${p.registrado_por}` : ""}
                </p>
                {p.origen === "cita" ? (
                  <button
                    type="button"
                    disabled={!onAbrirCita || esEstaCita || !p.cita_id}
                    onClick={() => p.cita_id && onAbrirCita?.(p.cita_id)}
                    className="mt-0.5 inline-flex items-center gap-0.5 text-[10px] font-medium disabled:cursor-default"
                    style={{ color: "#3B82F6" }}
                  >
                    {p.es_origen ? "Compra del paquete" : `Sesión ${p.numero_sesion ?? "–"}`} · cita del{" "}
                    {formatDateDMY(p.fecha_cita || "", "")}
                    {esEstaCita ? " (esta cita)" : ""}
                    {onAbrirCita && !esEstaCita && <ChevronRight className="w-3 h-3" />}
                  </button>
                ) : (
                  <p className="mt-0.5 text-[10px] font-semibold" style={{ color: "#B45309" }}>
                    Solo en el paquete · no aparece en caja
                  </p>
                )}
                {p.notas && <p className="text-[10px] italic" style={{ color: "#94A3B8" }}>{p.notas}</p>}
              </div>
              <p className="text-xs font-bold shrink-0" style={{ color: "#1E293B" }}>
                {formatMonto(p.monto)}
              </p>
            </div>

            <div className="mt-1.5 flex flex-wrap gap-3 text-[10px]">
              {corregible && editando !== clave && (
                <button
                  type="button"
                  className="underline"
                  style={{ color: "#3B82F6" }}
                  onClick={() => {
                    setEditando(clave);
                    setMetodo(p.metodo || "efectivo");
                    setMonto(String(p.monto ?? ""));
                  }}
                >
                  Corregir
                </button>
              )}
              {p.origen === "cita" && p.cita_facturada && (
                <span style={{ color: "#94A3B8" }}>(cita facturada, no se puede corregir)</span>
              )}
              {p.origen === "paquete" && puedeGestionar && (
                <>
                  <button type="button" className="underline" style={{ color: "#059669" }} disabled={trabajando} onClick={() => pasarAEstaSesion(p)}>
                    Pasar a esta sesión
                  </button>
                  <button
                    type="button"
                    className="underline"
                    style={{ color: "#EF4444" }}
                    disabled={trabajando}
                    onClick={() => {
                      setDescartando(p.indice);
                      setMotivo("");
                    }}
                  >
                    Es duplicado
                  </button>
                </>
              )}
            </div>

            {editando === clave && (
              <div className="mt-2 flex items-center gap-2 flex-wrap">
                <select
                  value={metodo}
                  onChange={(e) => setMetodo(e.target.value)}
                  className="text-xs rounded-md px-2 py-1"
                  style={{ border: "1px solid #E2E8F0" }}
                >
                  {PAYMENT_METHOD_OPTIONS.filter((m) => m.id !== "giftcard").map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.label}
                    </option>
                  ))}
                </select>
                <input
                  type="text"
                  inputMode="decimal"
                  value={formatMontoInput(monto, moneda)}
                  onChange={(e) => setMonto(e.target.value)}
                  className="text-xs rounded-md px-2 py-1 w-24"
                  style={{ border: "1px solid #E2E8F0" }}
                />
                <button
                  type="button"
                  disabled={trabajando}
                  onClick={() => guardarCorreccion(p)}
                  className="text-xs font-semibold px-2 py-1 rounded-md text-white disabled:opacity-50"
                  style={{ background: "#1E293B" }}
                >
                  {trabajando ? <Loader2 className="w-3 h-3 animate-spin" /> : "Guardar"}
                </button>
                <button type="button" onClick={() => setEditando(null)} className="text-xs px-2 py-1" style={{ color: "#64748B" }}>
                  Cancelar
                </button>
              </div>
            )}

            {p.origen === "paquete" && descartando === p.indice && (
              <div className="mt-2 flex items-center gap-2 flex-wrap">
                <input
                  value={motivo}
                  onChange={(e) => setMotivo(e.target.value)}
                  placeholder="Motivo (ej. duplicado del pago de la sesión 3)"
                  className="text-xs rounded-md px-2 py-1 flex-1 min-w-[10rem]"
                  style={{ border: "1px solid #E2E8F0" }}
                />
                <button
                  type="button"
                  disabled={trabajando}
                  onClick={() => confirmarDescarte(p)}
                  className="text-xs font-semibold px-2 py-1 rounded-md text-white disabled:opacity-50"
                  style={{ background: "#EF4444" }}
                >
                  Descartar
                </button>
                <button type="button" onClick={() => setDescartando(null)} className="text-xs px-2 py-1" style={{ color: "#64748B" }}>
                  Cancelar
                </button>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
};

export default PagosPaqueteHistorial;
