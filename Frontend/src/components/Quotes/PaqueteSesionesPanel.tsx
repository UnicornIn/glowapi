// Panel de "Paquete de sesiones" dentro del detalle de una cita (agenda de
// SuperAdmin y de Sede). Muestra en qué sesión va la cita, permite abrir la
// lista completa de sesiones del paquete (pasadas y futuras) para saltar a
// cualquiera de ellas, y asociar/desasociar citas que quedaron por fuera del
// paquete (ej. se agendaron con "precio normal"). También muestra el reparto
// del valor del paquete por sesión y la comisión de quien atiende cada una.
import React, { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { toast } from "sonner";
import { Loader2, Package, X, Link2, Unlink, ChevronRight } from "lucide-react";
import { confirmAction } from "../ui/confirm-dialog";
import { Ayuda } from "../ui/ayuda";
import MigrarPaquetePorSesion from "./MigrarPaquetePorSesion";
import { formatDateDMY } from "../../lib/dateFormat";
import { formatCurrencyNoDecimals } from "../../lib/currency";
import {
  ESTADO_COMISION_LABEL,
  getSesionesPaquete,
  asociarCitaPaquete,
  desasociarCitaPaquete,
  type PaqueteCliente,
  type SesionPaquete,
  type SesionesPaqueteResponse,
} from "./clientsService";

interface Props {
  token: string;
  citaId: string;
  /** Paquete al que ya pertenece esta cita (alguna línea con paquete_id) */
  paqueteIdVinculado: string | null;
  /** Paquetes activos del cliente que aplican a algún servicio de esta cita */
  paquetesCandidatos: PaqueteCliente[];
  /** admin_sede / super_admin: puede asociar y desasociar */
  puedeGestionar: boolean;
  onAbrirCita?: (cita: any) => void;
  onCambio?: () => void;
}

const ESTADO_LABEL: Record<string, { label: string; color: string; bg: string }> = {
  consumida: { label: "Realizada", color: "#059669", bg: "#ECFDF5" },
  agendada: { label: "Agendada", color: "#2563EB", bg: "#EFF6FF" },
  no_cuenta: { label: "No cuenta", color: "#6B7280", bg: "#F3F4F6" },
};

const PaqueteSesionesPanel: React.FC<Props> = ({
  token,
  citaId,
  paqueteIdVinculado,
  paquetesCandidatos,
  puedeGestionar,
  onAbrirCita,
  onCambio,
}) => {
  const [paqueteAbierto, setPaqueteAbierto] = useState<string | null>(null);
  const [data, setData] = useState<SesionesPaqueteResponse | null>(null);
  const [cargando, setCargando] = useState(false);
  const [accionando, setAccionando] = useState<string | null>(null);

  // Solo se aplica la respuesta del último paquete pedido: al saltar rápido
  // entre citas, una respuesta vieja no debe pisar la actual.
  const ultimoPedido = useRef<string | null>(null);

  const cargar = useCallback(
    async (paqueteId: string) => {
      ultimoPedido.current = paqueteId;
      setCargando(true);
      try {
        const respuesta = await getSesionesPaquete(token, paqueteId);
        if (ultimoPedido.current === paqueteId) setData(respuesta);
      } catch (error: any) {
        if (ultimoPedido.current === paqueteId) {
          toast.error(error?.message || "No se pudieron cargar las sesiones");
          setPaqueteAbierto(null);
        }
      } finally {
        if (ultimoPedido.current === paqueteId) setCargando(false);
      }
    },
    [token],
  );

  // Al cambiar de cita (ej. "ir a otra sesión"), la lista abierta se cierra:
  // la cita nueva puede no pertenecer al paquete y no habría qué mostrar.
  useEffect(() => {
    setPaqueteAbierto(null);
  }, [citaId]);

  // Resumen compacto del paquete vinculado (sesión N de M) sin abrir la lista.
  useEffect(() => {
    if (paqueteIdVinculado) {
      void cargar(paqueteIdVinculado);
    } else {
      ultimoPedido.current = null;
      setData(null);
      setCargando(false);
    }
  }, [paqueteIdVinculado, citaId, cargar]);

  // Lista abierta sin datos de ese paquete (y nada cargando): pedirlos.
  useEffect(() => {
    if (paqueteAbierto && !cargando && data?.paquete?.paquete_id !== paqueteAbierto) {
      void cargar(paqueteAbierto);
    }
  }, [paqueteAbierto, cargando, data, cargar]);

  const abrirLista = (paqueteId: string) => {
    setPaqueteAbierto(paqueteId);
    if (data?.paquete?.paquete_id !== paqueteId) void cargar(paqueteId);
  };

  const handleAsociar = async (citaObjetivoId: string, paqueteId: string) => {
    const ok = await confirmAction({
      title: "Asociar cita al paquete",
      message:
        "La cita contará como una sesión del paquete. Si no tiene pagos propios, su servicio pasa a $0 y hereda la factura del paquete (si ya se facturó).",
      confirmLabel: "Sí, asociar",
      variant: "primary",
    });
    if (!ok) return;
    setAccionando(citaObjetivoId);
    try {
      const res = await asociarCitaPaquete(token, citaObjetivoId, paqueteId);
      toast.success(res.mensaje || "Cita asociada");
      (res.advertencias || []).forEach((a) => toast.warning(a, { duration: 10000 }));
      await cargar(paqueteId);
      onCambio?.();
    } catch (error: any) {
      toast.error(error?.message || "No se pudo asociar la cita");
    } finally {
      setAccionando(null);
    }
  };

  const handleDesasociar = async (citaObjetivoId: string, paqueteId: string) => {
    const ok = await confirmAction({
      title: "Desasociar del paquete",
      message:
        "La cita deja de contar como sesión del paquete y su servicio vuelve a su precio (queda pendiente de cobro).",
      confirmLabel: "Sí, desasociar",
      variant: "danger",
    });
    if (!ok) return;
    setAccionando(citaObjetivoId);
    try {
      const res = await desasociarCitaPaquete(token, citaObjetivoId, paqueteId);
      toast.success(res.mensaje || "Cita desasociada");
      await cargar(paqueteId);
      onCambio?.();
    } catch (error: any) {
      toast.error(error?.message || "No se pudo desasociar la cita");
    } finally {
      setAccionando(null);
    }
  };

  const resumen = data?.resumen;
  const sesionActual = data?.sesiones.find((s) => s.cita_id === citaId);
  const dinero = (v: number) => formatCurrencyNoDecimals(v, data?.paquete?.moneda || "COP");
  const textoComision = (s: SesionPaquete) => {
    const c = s.comision;
    if (!c) return null;
    if (c.estado === "no_cuenta") return null;
    return `Valor sesión ${dinero(c.valor_sesion)} · Comisión ${dinero(c.comision)}${c.porcentaje ? ` (${c.porcentaje}%)` : ""} · ${ESTADO_COMISION_LABEL[c.estado] || c.estado}`;
  };

  const renderFila = (s: SesionPaquete, tipo: "ligada" | "suelta") => {
    const est = ESTADO_LABEL[s.cuenta] || ESTADO_LABEL.agendada;
    const esActual = s.cita_id === citaId;
    const paqueteId = data?.paquete?.paquete_id || "";
    return (
      <div
        key={s.cita_id}
        className="flex items-center gap-2 rounded-xl px-3 py-2"
        style={{
          border: `1px solid ${esActual ? "#1E293B" : "#E2E8F0"}`,
          background: esActual ? "#F8FAFC" : "#fff",
        }}
      >
        <div
          className="w-9 h-9 shrink-0 rounded-lg flex items-center justify-center text-xs font-bold"
          style={{ background: tipo === "ligada" ? "#1E293B" : "#FEF3C7", color: tipo === "ligada" ? "#fff" : "#92400E" }}
        >
          {tipo === "ligada" ? (s.numero_sesion ?? "–") : "?"}
        </div>
        <button
          type="button"
          disabled={!onAbrirCita || esActual}
          onClick={() => {
            setPaqueteAbierto(null);
            onAbrirCita?.(s.cita);
          }}
          className="flex-1 min-w-0 text-left disabled:cursor-default"
        >
          <div className="text-xs font-semibold text-slate-800 truncate">
            {formatDateDMY(s.fecha)} · {s.hora_inicio}
            {esActual && <span className="ml-1 text-[10px] text-slate-500">(esta cita)</span>}
            {s.es_origen && <span className="ml-1 text-[10px] text-slate-500">(compra)</span>}
          </div>
          <div className="text-[11px] text-slate-500 truncate">
            {s.profesional_nombre || "—"} · {s.estado}
            {s.estado_factura === "facturado" && ` · Facturada ${s.numero_comprobante || ""}`}
            {tipo === "suelta" && s.valor_total > 0 && ` · ${dinero(s.valor_total)}`}
          </div>
          {tipo === "ligada" && textoComision(s) && (
            <div className="text-[11px] text-emerald-700 truncate">{textoComision(s)}</div>
          )}
        </button>
        <span
          className="text-[10px] font-semibold rounded px-1.5 py-0.5 shrink-0"
          style={{ color: est.color, background: est.bg }}
        >
          {est.label}
        </span>
        {puedeGestionar && tipo === "suelta" && (
          <button
            type="button"
            onClick={() => handleAsociar(s.cita_id, paqueteId)}
            disabled={accionando !== null}
            title="Asociar al paquete"
            className="shrink-0 p-1.5 rounded-lg text-emerald-700 hover:bg-emerald-50 disabled:opacity-50"
          >
            {accionando === s.cita_id ? <Loader2 className="w-4 h-4 animate-spin" /> : <Link2 className="w-4 h-4" />}
          </button>
        )}
        {puedeGestionar && tipo === "ligada" && !s.es_origen && (
          <button
            type="button"
            onClick={() => handleDesasociar(s.cita_id, paqueteId)}
            disabled={accionando !== null}
            title="Desasociar del paquete"
            className="shrink-0 p-1.5 rounded-lg text-red-500 hover:bg-red-50 disabled:opacity-50"
          >
            {accionando === s.cita_id ? <Loader2 className="w-4 h-4 animate-spin" /> : <Unlink className="w-4 h-4" />}
          </button>
        )}
        {onAbrirCita && !esActual && <ChevronRight className="w-4 h-4 text-slate-300 shrink-0" />}
      </div>
    );
  };

  // Nada que mostrar: la cita no es de un paquete y el cliente no tiene uno que aplique.
  if (!paqueteIdVinculado && paquetesCandidatos.length === 0) return null;

  return (
    <>
      <div className="rounded-xl p-3 space-y-2" style={{ border: "1px solid #E2E8F0", background: "#F8FAFC" }}>
        <div className="flex items-center gap-2 text-xs font-semibold text-slate-700">
          <Package className="w-4 h-4" /> Paquete de sesiones
        </div>

        {paqueteIdVinculado ? (
          <div className="flex items-center justify-between gap-2">
            <div className="text-xs text-slate-600">
              {cargando && !data ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : resumen ? (
                <>
                  <div className="font-semibold text-slate-800">
                    {data?.paquete?.nombre_servicio}
                    {sesionActual?.numero_sesion ? ` · Sesión ${sesionActual.numero_sesion} de ${resumen.sesiones_totales}` : ""}
                  </div>
                  <div>
                    {resumen.sesiones_usadas} realizadas · {resumen.sesiones_agendadas} agendadas ·{" "}
                    {resumen.sesiones_disponibles} disponibles
                    {resumen.sobrecupo > 0 && (
                      <span className="text-red-600 font-semibold"> · {resumen.sobrecupo} de más</span>
                    )}
                  </div>
                  {data?.paquete?.anticipo && (
                    <div className="text-slate-700">
                      Anticipo: {dinero(data.paquete.anticipo.disponible)} disponible de{" "}
                      {dinero(data.paquete.anticipo.total)} abonado
                      {data.paquete.anticipo.consumido > 0 &&
                        ` · ${dinero(data.paquete.anticipo.consumido)} ya facturado`}
                      <Ayuda
                        className="ml-1"
                        texto="Cada sesión se factura sola y descuenta su valor de este anticipo. Cuando se acaba, hay que registrar un pago nuevo para poder facturar."
                      />
                    </div>
                  )}
                  {sesionActual && textoComision(sesionActual) && (
                    <div className="text-emerald-700">
                      {sesionActual.comision?.profesional_nombre ? `${sesionActual.comision.profesional_nombre}: ` : ""}
                      {textoComision(sesionActual)}
                    </div>
                  )}
                  {(data?.sin_asociar.length || 0) > 0 && (
                    <div className="text-amber-700 font-medium">
                      {data?.sin_asociar.length} cita(s) del mismo servicio sin asociar
                    </div>
                  )}
                </>
              ) : null}
            </div>
            <button
              type="button"
              onClick={() => abrirLista(paqueteIdVinculado)}
              className="shrink-0 rounded-lg px-3 py-1.5 text-xs font-semibold text-white"
              style={{ background: "#1E293B" }}
            >
              Ver sesiones
            </button>
          </div>
        ) : (
          paquetesCandidatos.map((p) => (
            <div key={p.paquete_id} className="flex items-center justify-between gap-2">
              <div className="text-xs text-amber-800">
                Esta cita no está asociada al paquete de <b>{p.nombre_servicio}</b> (quedan{" "}
                {p.sesiones_disponibles ?? p.sesiones_restantes} de {p.sesiones_totales}).
              </div>
              <div className="flex gap-1 shrink-0">
                {puedeGestionar && (
                  <button
                    type="button"
                    onClick={() => handleAsociar(citaId, p.paquete_id)}
                    disabled={accionando !== null}
                    className="rounded-lg px-2.5 py-1.5 text-xs font-semibold text-emerald-700 disabled:opacity-50"
                    style={{ border: "1px solid #6EE7B7", background: "#ECFDF5" }}
                  >
                    {accionando === citaId ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : "Asociar"}
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => abrirLista(p.paquete_id)}
                  className="rounded-lg px-2.5 py-1.5 text-xs font-semibold text-slate-700"
                  style={{ border: "1px solid #E2E8F0", background: "#fff" }}
                >
                  Sesiones
                </button>
              </div>
            </div>
          ))
        )}
      </div>

      {paqueteAbierto &&
        createPortal(
          <div
            className="fixed inset-0 z-[70] flex items-center justify-center bg-black/40 p-4"
            onClick={() => setPaqueteAbierto(null)}
          >
            <div
              className="bg-white rounded-2xl shadow-xl w-full max-w-lg max-h-[85vh] flex flex-col"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="px-5 py-4 flex items-start justify-between gap-3" style={{ borderBottom: "1px solid #E2E8F0" }}>
                <div>
                  <div className="text-sm font-semibold text-slate-900">
                    {data?.paquete?.nombre_servicio || "Paquete de sesiones"}
                  </div>
                  {resumen && (
                    <div className="text-xs text-slate-500">
                      {paqueteAbierto} · {resumen.sesiones_totales} sesiones · {resumen.sesiones_usadas} realizadas ·{" "}
                      {resumen.sesiones_agendadas} agendadas · {resumen.sesiones_disponibles} disponibles
                    </div>
                  )}
                </div>
                <button type="button" onClick={() => setPaqueteAbierto(null)} className="text-slate-400 hover:text-slate-700">
                  <X className="w-5 h-5" />
                </button>
              </div>

              <div className="overflow-y-auto p-5 space-y-4">
                {cargando || data?.paquete?.paquete_id !== paqueteAbierto ? (
                  <div className="flex justify-center py-8">
                    <Loader2 className="w-5 h-5 animate-spin text-slate-400" />
                  </div>
                ) : (
                  <>
                    {resumen && resumen.sobrecupo > 0 && (
                      <div className="rounded-lg px-3 py-2 text-xs text-red-700" style={{ background: "#FEF2F2" }}>
                        Hay {resumen.sobrecupo} sesión(es) más de las que tiene el paquete. Desasocia las que no correspondan.
                      </div>
                    )}
                    {puedeGestionar && data.paquete?.modo_facturacion !== "por_sesion" && (
                      <MigrarPaquetePorSesion
                        token={token}
                        paqueteId={data.paquete.paquete_id}
                        moneda={data.paquete.moneda}
                        onMigrado={() => {
                          void cargar(data.paquete.paquete_id);
                          onCambio?.();
                        }}
                      />
                    )}

                    {(data.reparto_profesionales?.length || 0) > 0 && (
                      <div className="space-y-1.5">
                        <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                          Reparto por profesional
                        </div>
                        <p className="text-[11px] text-slate-500">
                          Cada sesión vale {dinero(data.paquete.valor_por_sesion || 0)} (valor del paquete entre{" "}
                          {resumen?.sesiones_totales} sesiones). Quien atiende la sesión recibe la comisión sobre ese valor.
                        </p>
                        <div className="rounded-xl overflow-hidden" style={{ border: "1px solid #E2E8F0" }}>
                          {data.reparto_profesionales!.map((r, i) => (
                            <div
                              key={r.profesional_id || i}
                              className="flex items-center justify-between gap-2 px-3 py-2 text-xs"
                              style={{ borderTop: i ? "1px solid #F1F5F9" : undefined }}
                            >
                              <div className="min-w-0">
                                <div className="font-semibold text-slate-800 truncate">{r.profesional_nombre}</div>
                                <div className="text-[11px] text-slate-500">
                                  {r.sesiones} sesión(es) · {r.realizadas} realizada(s) · {dinero(r.valor_sesiones)}
                                </div>
                              </div>
                              <div className="text-right shrink-0">
                                <div className="font-bold text-slate-900">{dinero(r.comision)}</div>
                                <div className="text-[10px] text-slate-500">comisión</div>
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    <div className="space-y-1.5">
                      <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Sesiones del paquete</div>
                      {data.sesiones.length === 0 ? (
                        <div className="text-xs text-slate-500">Sin citas ligadas.</div>
                      ) : (
                        data.sesiones.map((s) => renderFila(s, "ligada"))
                      )}
                    </div>

                    {data.sin_asociar.length > 0 && (
                      <div className="space-y-1.5">
                        <div className="text-[11px] font-semibold uppercase tracking-wide text-amber-700">
                          Citas del mismo servicio sin asociar
                        </div>
                        <p className="text-[11px] text-slate-500">
                          Se agendaron sin usar el paquete. Si en realidad eran sesiones del paquete, asócialas.
                        </p>
                        {data.sin_asociar.map((s) => renderFila(s, "suelta"))}
                      </div>
                    )}
                  </>
                )}
              </div>
            </div>
          </div>,
          document.body,
        )}
    </>
  );
};

export default PaqueteSesionesPanel;
