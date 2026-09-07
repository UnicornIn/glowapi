// ════════════════════════════════════════════════════════════
// Historia Clínica — Secciones compartidas
//
// La hoja de Piso Pélvico indica "① igual a la de fisio" para
// Datos Personales, y repite la misma Anamnesis. Se comparten
// desde aquí para que ambas fichas no se desincronicen.
// ════════════════════════════════════════════════════════════

import { useEffect } from "react";
import { Area, Grid, Grupo, Seccion, Selector, Texto, type HCStore } from "./HCUI";
import { SEXO, TIPO_DOCUMENTO } from "./hcCatalogos";

export type Evolucion = {
  id: string;
  fecha: string;
  profesional: string;
  sesion: string;
  nota: string;
};

/** Calcula la edad en años cumplidos a partir de una fecha ISO (yyyy-mm-dd). */
export function calcularEdad(fechaNacimiento: string): string {
  if (!fechaNacimiento) return "";
  const nacimiento = new Date(`${fechaNacimiento}T00:00:00`);
  if (Number.isNaN(nacimiento.getTime())) return "";

  const hoy = new Date();
  let edad = hoy.getFullYear() - nacimiento.getFullYear();
  const mes = hoy.getMonth() - nacimiento.getMonth();
  if (mes < 0 || (mes === 0 && hoy.getDate() < nacimiento.getDate())) edad -= 1;

  return edad >= 0 && edad < 130 ? String(edad) : "";
}

/* ── ① Datos personales ─────────────────────────────────── */

export function SeccionDatosPersonales({ hc, numero = 1 }: { hc: HCStore; numero?: number }) {
  const fechaNacimiento = hc.get("datos.fecha_nacimiento");

  // La edad se deriva de la fecha de nacimiento, pero el campo queda
  // editable por si el paciente solo aporta la edad.
  useEffect(() => {
    const edad = calcularEdad(fechaNacimiento);
    if (edad) hc.set("datos.edad", edad);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fechaNacimiento]);

  return (
    <Seccion id="datos" numero={numero} titulo="Datos personales">
      <Grid cols={4}>
        <Texto hc={hc} path="datos.fecha" label="Fecha de la historia" type="date" />
        <Selector
          hc={hc}
          path="datos.tipo_documento"
          label="Tipo de documento"
          options={TIPO_DOCUMENTO}
        />
        <Texto
          hc={hc}
          path="datos.documento"
          label="Número de documento"
          placeholder="Ej. 1.020.345.678"
        />
        <Texto hc={hc} path="datos.telefono" label="Teléfono" type="tel" placeholder="Ej. 300 000 0000" />

        <Texto hc={hc} path="datos.nombre" label="Nombre" placeholder="Nombres" />
        <Texto hc={hc} path="datos.apellido" label="Apellido" placeholder="Apellidos" />
        <Texto hc={hc} path="datos.fecha_nacimiento" label="Fecha de nacimiento" type="date" />
        <Texto
          hc={hc}
          path="datos.edad"
          label="Edad"
          type="number"
          placeholder="Años"
          hint={fechaNacimiento ? "Calculada automáticamente" : undefined}
        />

        <Selector hc={hc} path="datos.sexo" label="Sexo" options={SEXO} />
        <Texto
          hc={hc}
          path="datos.direccion"
          label="Dirección"
          span="col-2"
          placeholder="Dirección de residencia"
        />
      </Grid>
    </Seccion>
  );
}

/* ── ② Anamnesis ────────────────────────────────────────── */

export function SeccionAnamnesis({ hc, numero = 2 }: { hc: HCStore; numero?: number }) {
  return (
    <Seccion id="anamnesis" numero={numero} titulo="Anamnesis">
      <Grupo label="Antecedentes">
        <Grid cols={2}>
          <Area
            hc={hc}
            path="anamnesis.personales"
            label="Personales"
            placeholder="Patológicos, traumáticos, alérgicos, familiares…"
          />
          <Area
            hc={hc}
            path="anamnesis.farmacologicos"
            label="Farmacológicos"
            placeholder="Medicamentos actuales, dosis y adherencia…"
          />
          <Area
            hc={hc}
            path="anamnesis.quirurgicos"
            label="Quirúrgicos / cirugías"
            placeholder="Cirugías previas y fechas aproximadas…"
          />
          <Area
            hc={hc}
            path="anamnesis.estilo_vida"
            label="Estilo de vida"
            placeholder="Actividad física, ocupación, sueño, hábitos, hidratación…"
          />
        </Grid>
      </Grupo>
    </Seccion>
  );
}

/* ── ⑥ Evoluciones ──────────────────────────────────────── */

export function SeccionEvoluciones({ hc, numero }: { hc: HCStore; numero: number }) {
  // Se lee directo de hc.data (no como prop externa) para que quede
  // imposible de desconectar por error: en cuanto el backend/el envío
  // agregan una entrada al array, aparece aquí sin cablear nada más.
  const evolucionesRaw = hc.data.evoluciones;
  const evoluciones: Evolucion[] = Array.isArray(evolucionesRaw)
    ? (evolucionesRaw as Evolucion[])
    : [];

  return (
    <Seccion
      id="evoluciones"
      numero={numero}
      titulo="Evoluciones"
      nota="Se actualizan en cada cita"
    >
      <div className="hc-evo">
        {evoluciones.length === 0 ? (
          <div className="hc-evo-empty">
            Aún no hay evoluciones registradas para este paciente.
          </div>
        ) : (
          evoluciones.map((evo) => (
            <article className="hc-evo-entry" key={evo.id}>
              <header className="hc-evo-head">
                <span className="hc-evo-date">{evo.fecha}</span>
                <span className="hc-evo-prof">{evo.profesional}</span>
                <span className="hc-evo-sesion">{evo.sesion}</span>
              </header>
              <p className="hc-evo-body">{evo.nota}</p>
            </article>
          ))
        )}
      </div>

      <Grid cols={2}>
        <Area
          hc={hc}
          path="evolucion_nueva.nota"
          label="Nueva evolución (sesión de hoy)"
          span="full"
          grande
          placeholder="Intervención realizada, respuesta del paciente, cambios en la sintomatología, plan para la próxima sesión…"
        />
      </Grid>

      <div className="hc-note">
        Cada cita agrega una entrada nueva a este historial sin sobrescribir las
        anteriores. Las secciones ① a ⑤ se mantienen como línea base y solo se
        editan cuando cambia algo relevante del paciente.
      </div>
    </Seccion>
  );
}
