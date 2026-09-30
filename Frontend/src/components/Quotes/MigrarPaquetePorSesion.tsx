// Cambia un paquete al modo "una factura por sesión": el admin ve primero
// una vista previa de todo lo que cambiaría y recién después aplica.
//
// Por qué existe: antes el paquete se vendía como una sola venta y se
// facturaba completo. Nexa necesita facturar cada sesión a medida que la
// presta, porque si el cliente no vuelve, lo no prestado no se debe
// facturar. Este botón pasa los paquetes que ya están en curso al modo
// nuevo, sin tocar los que ya tienen factura.
import { useState } from "react";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";
import { Ayuda } from "../ui/ayuda";
import { formatDateDMY } from "../../lib/dateFormat";
import { formatCurrencyNoDecimals } from "../../lib/currency";
import { migrarPaquetePorSesion, type MigracionPorSesion } from "./clientsService";

interface Props {
  token: string;
  paqueteId: string;
  moneda?: string;
  /** Se llama al aplicar, para recargar lo que se esté mostrando */
  onMigrado?: () => void;
}

export function MigrarPaquetePorSesion({ token, paqueteId, moneda = "COP", onMigrado }: Props) {
  const [plan, setPlan] = useState<MigracionPorSesion | null>(null);
  const [cargando, setCargando] = useState(false);
  const [aplicando, setAplicando] = useState(false);
  const dinero = (v: number) => formatCurrencyNoDecimals(v, moneda);

  const verPrevia = async () => {
    setCargando(true);
    try {
      setPlan(await migrarPaquetePorSesion(token, paqueteId, false));
    } catch (error: any) {
      toast.error(error?.message || "No se pudo calcular el cambio");
    } finally {
      setCargando(false);
    }
  };

  const aplicar = async () => {
    setAplicando(true);
    try {
      const res = await migrarPaquetePorSesion(token, paqueteId, true);
      toast.success(res.mensaje || "Listo: el paquete ahora se factura por sesión");
      setPlan(null);
      onMigrado?.();
    } catch (error: any) {
      toast.error(error?.message || "No se pudo aplicar el cambio");
    } finally {
      setAplicando(false);
    }
  };

  return (
    <div className="rounded-xl p-3 text-xs" style={{ border: "1px solid #FDE68A", background: "#FFFBEB" }}>
      <div className="flex items-start justify-between gap-2">
        <div className="text-amber-900">
          <span className="font-semibold">Este paquete se factura completo, de una sola vez.</span>{" "}
          Para facturar cada sesión por aparte hay que cambiarlo.
          <Ayuda
            className="ml-1"
            texto={
              <>
                Al cambiarlo, cada sesión pasa a valer el precio del paquete dividido entre sus sesiones, y lo
                que el cliente ya pagó queda como anticipo. Cada sesión que factures descuenta del anticipo. Si
                el cliente no vuelve, lo que sobra no se factura.
              </>
            }
          />
        </div>
        {!plan && (
          <button
            type="button"
            onClick={verPrevia}
            disabled={cargando}
            className="shrink-0 rounded-lg px-2.5 py-1.5 text-xs font-semibold text-white disabled:opacity-50"
            style={{ background: "#B45309" }}
          >
            {cargando ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : "Ver cómo quedaría"}
          </button>
        )}
      </div>

      {plan && (
        <div className="mt-3 space-y-2">
          <div className="rounded-lg bg-white p-2.5" style={{ border: "1px solid #FDE68A" }}>
            <div className="flex justify-between">
              <span className="text-slate-500">
                Cada sesión valdría
                <Ayuda
                  className="ml-1"
                  texto="Es el precio del paquete dividido entre el número de sesiones. Es lo que se va a facturar cada vez."
                />
              </span>
              <span className="font-bold text-slate-900">{dinero(plan.valor_por_sesion)}</span>
            </div>
            <div className="mt-1 flex justify-between">
              <span className="text-slate-500">
                Anticipo del cliente
                <Ayuda
                  className="ml-1"
                  texto="Lo que ya pagó. Queda como saldo del paquete y cubre las sesiones a medida que las facturas."
                />
              </span>
              <span className="font-semibold text-slate-900">{dinero(plan.anticipo_total)}</span>
            </div>
            <div className="mt-1 flex justify-between">
              <span className="text-slate-500">
                Alcanza para
                <Ayuda
                  className="ml-1"
                  texto="Sesiones que quedan cubiertas con lo pagado. Después de esas, para facturar hay que registrar un pago nuevo."
                />
              </span>
              <span className="font-semibold text-slate-900">
                {plan.sesiones_cubiertas} de {plan.sesiones_totales} sesiones
              </span>
            </div>
          </div>

          <div className="rounded-lg bg-white overflow-hidden" style={{ border: "1px solid #FDE68A" }}>
            {plan.citas.map((c) => (
              <div key={c.cita_id} className="flex items-center justify-between gap-2 px-2.5 py-1.5"
                   style={{ borderTop: "1px solid #FEF3C7" }}>
                <span className="text-slate-600">
                  {formatDateDMY(c.fecha)}
                  {c.es_compra && <span className="ml-1 text-[10px] text-slate-400">(compra)</span>}
                </span>
                <span className="text-slate-900">
                  {dinero(c.precio_antes)} → <b>{dinero(c.precio_despues)}</b>
                  {c.pagos_a_anticipo > 0 && (
                    <span className="ml-1 text-[10px] text-emerald-700">
                      {dinero(c.pagos_a_anticipo)} al anticipo
                    </span>
                  )}
                </span>
              </div>
            ))}
          </div>

          {plan.avisos.length > 0 && (
            <ul className="space-y-0.5 text-[11px] text-amber-800">
              {plan.avisos.map((a, i) => (
                <li key={i}>• {a}</li>
              ))}
            </ul>
          )}

          <p className="text-[11px] text-slate-500">
            Las sesiones que ya tienen su propia factura no se tocan. Esto no cobra ni devuelve nada: solo
            cambia cómo se factura de aquí en adelante.
          </p>

          <div className="flex gap-2">
            <button
              type="button"
              onClick={aplicar}
              disabled={aplicando}
              className="rounded-lg px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-50"
              style={{ background: "#B45309" }}
            >
              {aplicando ? "Aplicando..." : "Aplicar el cambio"}
            </button>
            <button
              type="button"
              onClick={() => setPlan(null)}
              className="rounded-lg px-3 py-1.5 text-xs font-semibold text-slate-600"
              style={{ border: "1px solid #E2E8F0", background: "#fff" }}
            >
              Cancelar
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

export default MigrarPaquetePorSesion;
