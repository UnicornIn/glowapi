// ════════════════════════════════════════════════════════════
// Historia Clínica — Shell común de la ficha
//
// Envuelve las secciones de cada historia (fisioterapia / piso
// pélvico) con la misma cabecera y barra de acciones, y expone el
// contrato de props que ya usan las demás fichas del protocolo de
// atención:
//   { cita, datosIniciales, onGuardar, onSubmit, onCancelar,
//     fichaId, modoEdicion }
//
// Conectado a los mismos endpoints que el resto de fichas técnicas
// (POST /create-ficha, PUT /fichas/{id}): el backend ya acepta
// cualquier tipo_ficha y datos_especificos libre, así que no hizo
// falta ningún endpoint nuevo — ver CLAUDE.md, sección de auditoría.
// ════════════════════════════════════════════════════════════

import { useEffect, useMemo, useState, type ReactNode } from "react";
import { toast } from "sonner";
import { ArrowLeft, CheckCircle, FileText, Save } from "lucide-react";

import "./historia-clinica.css";
import { useHCStore, type HCData, type HCStore } from "./HCUI";
import { getEstilistaDataFromCita, getFichaAuthToken } from "../fichaHelpers";
import { API_BASE_URL } from "../../../../../types/config";
import type { Cita } from "../../../../../types/fichas";
import type { Evolucion } from "./SeccionesComunes";

export type SeccionIndice = { id: string; numero: number; titulo: string };

/** Contrato de props compartido con el resto de fichas del protocolo. */
export interface FichaHistoriaClinicaProps {
  cita: Cita;
  datosIniciales?: HCData | null;
  onGuardar?: (datos: HCData) => void;
  onSubmit: (data: unknown) => void;
  onCancelar?: () => void;
  fichaId?: string;
  modoEdicion?: boolean;
}

interface HCShellProps extends FichaHistoriaClinicaProps {
  tipo: string;
  titulo: string;
  secciones: SeccionIndice[];
  estadoInicial: HCData;
  children: (hc: HCStore) => ReactNode;
}

const claveBorrador = (tipo: string, citaId: string) => `ficha_hc_${tipo}_${citaId}`;

/** Precarga los datos del paciente que ya conocemos por la cita. */
function conDatosDeLaCita(base: HCData, cita: Cita): HCData {
  const datos = (base.datos ?? {}) as Record<string, string>;
  return {
    ...base,
    datos: {
      ...datos,
      nombre: datos.nombre || cita.cliente?.nombre || "",
      apellido: datos.apellido || cita.cliente?.apellido || "",
      telefono: datos.telefono || cita.cliente?.telefono || "",
      fecha: datos.fecha || cita.fecha || new Date().toISOString().slice(0, 10),
    },
  };
}

/** Fecha corta en español, para el encabezado de una evolución nueva. */
function fechaEvolucionHoy(): string {
  return new Date().toLocaleDateString("es-CO", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

/**
 * Si hay texto en "evolucion_nueva.nota", lo convierte en una entrada del
 * array `evoluciones` (más reciente primero) y limpia el borrador de nota.
 * Si no hay texto, devuelve los datos tal cual.
 *
 * Por qué así y no un endpoint de "agregar evolución" aparte: PUT
 * /fichas/{id} reemplaza `datos_especificos` completo (no hace merge), así
 * que el propio frontend arma el array final antes de mandarlo. Con una
 * sola persona atendiendo por cita esto no tiene condición de carrera real;
 * si en el futuro varias personas editan la misma ficha a la vez, ahí sí
 * haría falta un endpoint dedicado con $push atómico.
 */
function conNuevaEvolucion(datos: HCData, cita: Cita, modoEdicion?: boolean): HCData {
  const notaNueva = String(
    (datos.evolucion_nueva as { nota?: string } | undefined)?.nota ?? ""
  ).trim();

  if (!notaNueva) return datos;

  const evolucionesActuales = Array.isArray(datos.evoluciones)
    ? (datos.evoluciones as Evolucion[])
    : [];

  const nuevaEntrada: Evolucion = {
    id: `evo-${Date.now()}`,
    fecha: fechaEvolucionHoy(),
    profesional: getEstilistaDataFromCita(cita).nombre,
    sesion: modoEdicion ? "Nueva sesión" : "Sesión 1 — valoración",
    nota: notaNueva,
  };

  return {
    ...datos,
    evoluciones: [nuevaEntrada, ...evolucionesActuales],
    evolucion_nueva: { nota: "" },
  };
}

export function HCShell({
  cita,
  datosIniciales,
  onGuardar,
  onSubmit,
  onCancelar,
  fichaId,
  modoEdicion,
  tipo,
  titulo,
  secciones,
  estadoInicial,
  children,
}: HCShellProps) {
  // Prioridad: ficha en edición / borrador de la cita > borrador local > vacío.
  const inicial = useMemo(() => {
    if (datosIniciales && Object.keys(datosIniciales).length > 0) {
      return conDatosDeLaCita({ ...estadoInicial, ...datosIniciales }, cita);
    }

    try {
      const guardado = localStorage.getItem(claveBorrador(tipo, cita.cita_id));
      if (guardado) {
        return conDatosDeLaCita({ ...estadoInicial, ...JSON.parse(guardado) }, cita);
      }
    } catch {
      // Borrador corrupto: se ignora y se empieza en limpio.
    }

    return conDatosDeLaCita(estadoInicial, cita);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cita.cita_id, tipo]);

  const hc = useHCStore(inicial);
  const [guardando, setGuardando] = useState(false);

  // Autoguardado en el navegador, igual que el resto de fichas.
  useEffect(() => {
    try {
      localStorage.setItem(claveBorrador(tipo, cita.cita_id), JSON.stringify(hc.data));
    } catch {
      // Sin espacio en localStorage: el borrador en memoria sigue vivo.
    }
  }, [hc.data, tipo, cita.cita_id]);

  const nombrePaciente = `${hc.get("datos.nombre")} ${hc.get("datos.apellido")}`.trim();

  const guardarBorrador = () => {
    onGuardar?.(hc.data);
    toast.success("Borrador guardado", {
      description: "Puedes continuar la historia clínica antes de finalizar el servicio.",
    });
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!nombrePaciente) {
      toast.warning("Registra al menos el nombre y el apellido del paciente");
      return;
    }

    const token = getFichaAuthToken();
    if (!token) {
      toast.error("No hay sesión activa. Vuelve a iniciar sesión e intenta de nuevo.");
      return;
    }

    const estilista = getEstilistaDataFromCita(cita);
    if (!estilista.id) {
      toast.error(
        "No se pudo identificar al profesional de la cita. Recarga la agenda e intenta de nuevo."
      );
      return;
    }

    const datosConEvolucion = conNuevaEvolucion(hc.data, cita, modoEdicion);
    const datosEspecificos = { ...datosConEvolucion, cita_id: cita.cita_id };

    setGuardando(true);
    try {
      const esEdicion = Boolean(fichaId || modoEdicion);
      const formData = new FormData();

      if (esEdicion) {
        formData.append(
          "data",
          JSON.stringify({ datos_especificos: datosEspecificos, estado: "completada" })
        );
      } else {
        const servicioId = cita.servicios?.[0]?.servicio_id || "";
        if (!servicioId) {
          throw new Error("La cita no tiene un servicio asociado, no se puede crear la ficha.");
        }

        formData.append(
          "data",
          JSON.stringify({
            cliente_id: cita.cliente?.cliente_id || "",
            sede_id: cita.sede?.sede_id || "",
            profesional_id: estilista.id,
            profesional_nombre: estilista.nombre,
            servicio_id: servicioId,
            servicio_nombre: cita.servicios?.map((s) => s.nombre).join(", ") || "",
            fecha_ficha: new Date().toISOString(),
            fecha_reserva: cita.fecha || new Date().toISOString().slice(0, 10),
            email: cita.cliente?.email || "",
            nombre: cita.cliente?.nombre || "",
            apellido: cita.cliente?.apellido || "",
            telefono: cita.cliente?.telefono || "",
            tipo_ficha: tipo,
            estado: "completada",
            datos_especificos: datosEspecificos,
          })
        );
      }

      const endpoint = esEdicion
        ? `${API_BASE_URL}scheduling/quotes/fichas/${fichaId}`
        : `${API_BASE_URL}scheduling/quotes/create-ficha`;

      const response = await fetch(endpoint, {
        method: esEdicion ? "PUT" : "POST",
        headers: { Authorization: `Bearer ${token}` },
        body: formData,
      });

      const data = await response.json().catch(() => null);

      if (!response.ok || !data?.success) {
        throw new Error(data?.detail || data?.message || `Error ${response.status} al guardar`);
      }

      // No se llama hc.cargar() aquí a propósito: el autoguardado (useEffect
      // más abajo) reescribiría el localStorage con la nueva data justo
      // después de este removeItem si el componente llegara a re-renderizar
      // antes de desmontarse. onSubmit() ya hace que el padre deje de
      // renderizar esta ficha (vuelve al listado), así que no hace falta
      // reflejar la evolución en la UI — el componente está por desaparecer.
      localStorage.removeItem(claveBorrador(tipo, cita.cita_id));

      toast.success(
        esEdicion ? "Historia clínica actualizada" : "Historia clínica creada",
        { description: `Guardada para ${nombrePaciente}.` }
      );

      onSubmit(data);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "No se pudo guardar la historia clínica");
    } finally {
      setGuardando(false);
    }
  };

  return (
    <form className="hc-root" onSubmit={handleSubmit}>
      <header className="hc-topbar">
        <div className="hc-topbar-row">
          <div>
            <h1 className="hc-title">
              <FileText size={20} strokeWidth={1.8} />
              {titulo}
            </h1>
            <p className="hc-sub">
              {nombrePaciente || "Paciente sin identificar"}
              {cita.fecha ? ` · ${cita.fecha}` : ""}
              {cita.hora_inicio ? ` ${cita.hora_inicio}` : ""}
              {modoEdicion ? " · Editando ficha existente" : ""}
            </p>
          </div>

          {onCancelar && (
            <div className="hc-topbar-actions">
              <button
                type="button"
                className="hc-btn hc-btn-sm"
                onClick={onCancelar}
                disabled={guardando}
              >
                <ArrowLeft size={13} strokeWidth={1.8} />
                Cancelar
              </button>
            </div>
          )}
        </div>
      </header>

      <div className="hc-body">
        <div className="hc-content">{children(hc)}</div>
      </div>

      <footer className="hc-footbar">
        <span className="hc-footbar-info">
          {modoEdicion ? "Editando historia clínica" : "Nueva historia clínica"} ·{" "}
          {secciones.length} secciones
        </span>
        <button
          type="button"
          className="hc-btn"
          onClick={guardarBorrador}
          disabled={guardando}
        >
          <Save size={14} strokeWidth={1.8} />
          Guardar borrador
        </button>
        <button type="submit" className="hc-btn hc-btn-primary" disabled={guardando}>
          <CheckCircle size={14} strokeWidth={1.8} />
          {guardando ? "Guardando…" : "Guardar historia clínica"}
        </button>
      </footer>
    </form>
  );
}
