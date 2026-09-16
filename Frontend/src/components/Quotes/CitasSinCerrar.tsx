// Aviso en la agenda: citas cuya fecha ya pasó y siguen "confirmada" /
// "pre_reservada". Hay que cerrarlas (Finalizar, No asistió o Cancelar) —
// mientras tanto, una sesión de paquete cuenta como agendada y no como
// realizada, y el día queda descuadrado.
import React, { useCallback, useEffect, useRef, useState } from "react";
import { AlertCircle, ChevronRight, Loader2 } from "lucide-react";
import { API_BASE_URL } from "../../types/config";
import { formatDateDMY } from "../../lib/dateFormat";

interface Props {
  token: string;
  sedeId?: string;
  /** Cambia cuando la agenda se recarga (ej. se cerró una cita) */
  refreshKey?: unknown;
  onAbrirCita: (cita: any) => void;
}

const CitasSinCerrar: React.FC<Props> = ({ token, sedeId, refreshKey, onAbrirCita }) => {
  const [citas, setCitas] = useState<any[]>([]);
  const [abierto, setAbierto] = useState(false);
  const [cargando, setCargando] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  const cargar = useCallback(async () => {
    if (!token) return;
    setCargando(true);
    try {
      const qs = sedeId ? `?sede_id=${encodeURIComponent(sedeId)}` : "";
      const res = await fetch(`${API_BASE_URL}scheduling/quotes/pendientes-cierre${qs}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) return;
      const data = await res.json();
      setCitas(Array.isArray(data?.citas) ? data.citas : []);
    } catch {
      // Aviso opcional: si falla no bloquea la agenda.
    } finally {
      setCargando(false);
    }
  }, [token, sedeId]);

  useEffect(() => {
    void cargar();
  }, [cargar, refreshKey]);

  useEffect(() => {
    if (!abierto) return;
    const cerrar = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setAbierto(false);
    };
    document.addEventListener("mousedown", cerrar);
    return () => document.removeEventListener("mousedown", cerrar);
  }, [abierto]);

  if (citas.length === 0) return null;

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setAbierto((v) => !v)}
        className="flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-semibold"
        style={{ background: "#FFFBEB", color: "#B45309", border: "1px solid #FDE68A" }}
        title="Citas de días anteriores que siguen abiertas"
      >
        {cargando ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <AlertCircle className="w-3.5 h-3.5" />}
        {citas.length} sin cerrar
      </button>
      {abierto && (
        <div
          className="absolute z-50 top-full mt-1 right-0 w-80 max-w-[90vw] bg-white rounded-xl shadow-xl overflow-hidden"
          style={{ border: "1px solid #E2E8F0" }}
        >
          <div className="px-3 py-2 text-[11px]" style={{ background: "#F8FAFC", color: "#64748B" }}>
            Ya pasaron y siguen abiertas. Ábrelas para Finalizar, marcar No asistió o Cancelar.
          </div>
          <div className="max-h-80 overflow-y-auto">
            {citas.map((c) => (
              <button
                key={c._id}
                type="button"
                onClick={() => {
                  setAbierto(false);
                  onAbrirCita(c);
                }}
                className="w-full flex items-center gap-2 px-3 py-2 text-left hover:bg-slate-50"
                style={{ borderTop: "1px solid #F1F5F9" }}
              >
                <div className="flex-1 min-w-0">
                  <div className="text-xs font-semibold text-slate-800 truncate">{c.cliente_nombre || "Cliente"}</div>
                  <div className="text-[11px] text-slate-500 truncate">
                    {formatDateDMY(c.fecha, "")} {c.hora_inicio} · {c.servicio_nombre || c.servicios?.[0]?.nombre || ""}
                  </div>
                </div>
                <span className="text-[10px] font-medium text-amber-700">{c.estado}</span>
                <ChevronRight className="w-3.5 h-3.5 text-slate-300" />
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};

export default CitasSinCerrar;
