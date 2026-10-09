// Factura de una vez todas las sesiones ya realizadas que el anticipo del
// cliente alcanza a cubrir.
//
// Por qué existe: la comisión del profesional se registra con la factura de
// cada sesión. Si el admin no entra sesión por sesión, el profesional no ve
// su comisión aunque el cliente ya haya pagado por adelantado. Con esto, un
// clic deja al día todo lo que el anticipo cubre.
import { useState } from "react";
import { toast } from "sonner";
import { Loader2, Receipt } from "lucide-react";
import { Ayuda } from "../ui/ayuda";
import { formatDateDMY } from "../../lib/dateFormat";
import { formatCurrencyNoDecimals } from "../../lib/currency";
import { facturarSesionesCubiertas, type FacturarCubiertas } from "./clientsService";

interface Props {
  token: string;
  paqueteId: string;
  moneda?: string;
  /** Se llama al terminar, para recargar lo que se esté mostrando */
  onFacturado?: () => void;
}

export function FacturarSesionesCubiertas({ token, paqueteId, moneda = "COP", onFacturado }: Props) {
  const [plan, setPlan] = useState<FacturarCubiertas | null>(null);
  const [cargando, setCargando] = useState(false);
  const [facturando, setFacturando] = useState(false);
  const dinero = (v: number) => formatCurrencyNoDecimals(v, moneda);

  const verPrevia = async () => {
    setCargando(true);
    try {
      const res = await facturarSesionesCubiertas(token, paqueteId, false);
      setPlan(res);
      if (res.sesiones.length === 0) {
        toast.info(
          res.sin_cubrir.length > 0
            ? "El anticipo no alcanza para ninguna sesión pendiente. Registra el pago primero."
            : "No hay sesiones realizadas pendientes de facturar.",
        );
      }
    } catch (error: any) {
      toast.error(error?.message || "No se pudo calcular");
    } finally {
      setCargando(false);
    }
  };

  const facturar = async () => {
    setFacturando(true);
    try {
      const res = await facturarSesionesCubiertas(token, paqueteId, true);
      toast.success(res.mensaje || "Sesiones facturadas");
      (res.errores || []).forEach((e) =>
        toast.warning(`${formatDateDMY(e.fecha)}: ${e.error}`, { duration: 10000 }),
      );
      setPlan(null);
      onFacturado?.();
    } catch (error: any) {
      toast.error(error?.message || "No se pudieron facturar las sesiones");
    } finally {
      setFacturando(false);
    }
  };

  return (
    <div className="rounded-xl p-3 text-xs" style={{ border: "1px solid #BBF7D0", background: "#F0FDF4" }}>
      <div className="flex items-start justify-between gap-2">
        <div className="text-emerald-900">
          <span className="font-semibold">Facturar las sesiones que cubre el anticipo.</span> Cada sesión queda
          con su factura y su comisión.
          <Ayuda
            className="ml-1"
            texto="La comisión del profesional se registra con la factura de cada sesión. Esto factura de una vez todas las sesiones ya realizadas que el anticipo del cliente alcanza a pagar, de la más vieja a la más nueva."
          />
        </div>
        {!plan && (
          <button
            type="button"
            onClick={verPrevia}
            disabled={cargando}
            className="shrink-0 inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-semibold text-white disabled:opacity-50"
            style={{ background: "#047857" }}
          >
            {cargando ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Receipt className="h-3.5 w-3.5" />}
            Ver qué se factura
          </button>
        )}
      </div>

      {plan && (
        <div className="mt-3 space-y-2">
          {plan.sesiones.length > 0 ? (
            <>
              <div className="rounded-lg bg-white overflow-hidden" style={{ border: "1px solid #BBF7D0" }}>
                {plan.sesiones.map((s) => (
                  <div
                    key={s.cita_id}
                    className="flex items-center justify-between gap-2 px-2.5 py-1.5"
                    style={{ borderTop: "1px solid #DCFCE7" }}
                  >
                    <span className="text-slate-600">
                      {formatDateDMY(s.fecha)} · sesión {s.numero_sesion ?? "–"}
                      {s.profesional && <span className="text-slate-400"> · {s.profesional}</span>}
                    </span>
                    <span className="font-semibold text-slate-900">{dinero(s.valor)}</span>
                  </div>
                ))}
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500">
                  Total
                  <Ayuda className="ml-1" texto="Sale del anticipo que el cliente ya pagó: no se le cobra nada ahora." />
                </span>
                <span className="font-bold text-slate-900">{dinero(plan.total_a_facturar)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500">Anticipo que quedaría</span>
                <span className="font-semibold text-slate-900">{dinero(plan.anticipo_despues)}</span>
              </div>
            </>
          ) : (
            <p className="text-slate-600">No hay sesiones realizadas que el anticipo alcance a cubrir.</p>
          )}

          {plan.sin_cubrir.length > 0 && (
            <p className="text-[11px] text-amber-800">
              {plan.sin_cubrir.length} sesión(es) realizadas quedan sin facturar porque el anticipo no alcanza.
              Registra el pago y vuelve a intentar.
            </p>
          )}

          <div className="flex gap-2">
            {plan.sesiones.length > 0 && (
              <button
                type="button"
                onClick={facturar}
                disabled={facturando}
                className="rounded-lg px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-50"
                style={{ background: "#047857" }}
              >
                {facturando ? "Facturando..." : `Facturar ${plan.sesiones.length} sesión(es)`}
              </button>
            )}
            <button
              type="button"
              onClick={() => setPlan(null)}
              className="rounded-lg px-3 py-1.5 text-xs font-semibold text-slate-600"
              style={{ border: "1px solid #E2E8F0", background: "#fff" }}
            >
              Cerrar
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

export default FacturarSesionesCubiertas;
