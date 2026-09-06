// ════════════════════════════════════════════════════════════
// Historia Clínica de Fisioterapia
//
// Estructura y orden según la hoja manuscrita (numeración circulada):
//   ① Datos personales   ② Anamnesis        ③ Motivo de consulta
//   ④ Enfermedad actual  ⑤ Examen físico    ⑥ Evoluciones
// ════════════════════════════════════════════════════════════

import { Area, Escala, Grid, Seccion, Selector, SiNo, type HCStore } from "./HCUI";
import { HCShell, type FichaHistoriaClinicaProps } from "./HCShell";
import { LATERALIDAD, SEGMENTO_CORPORAL } from "./hcCatalogos";
import {
  SeccionAnamnesis,
  SeccionDatosPersonales,
  SeccionEvoluciones,
  type Evolucion,
} from "./SeccionesComunes";

export const SECCIONES_FISIO = [
  { id: "datos", numero: 1, titulo: "Datos personales" },
  { id: "anamnesis", numero: 2, titulo: "Anamnesis" },
  { id: "motivo", numero: 3, titulo: "Motivo de consulta" },
  { id: "enfermedad", numero: 4, titulo: "Enfermedad actual" },
  { id: "examen", numero: 5, titulo: "Examen físico" },
  { id: "evoluciones", numero: 6, titulo: "Evoluciones" },
];

export const ESTADO_INICIAL_FISIO = {
  tipo: "FISIOTERAPIA",
  datos: {
    fecha: new Date().toISOString().slice(0, 10),
    tipo_documento: "",
    documento: "",
    nombre: "",
    apellido: "",
    fecha_nacimiento: "",
    edad: "",
    sexo: "",
    telefono: "",
    direccion: "",
  },
  anamnesis: {
    personales: "",
    farmacologicos: "",
    quirurgicos: "",
    estilo_vida: "",
  },
  motivo_consulta: "",
  enfermedad_actual: "",
  examen_fisico: {
    segmento: "",
    lateralidad: "",
    dolor: "",
    inflamacion: "",
    fovea: "",
    movilidad: "",
    fuerza: "",
    semiologia: "",
  },
  evoluciones: [] as Evolucion[],
  evolucion_nueva: { nota: "" },
};

/** Ficha completa, tal como la monta el protocolo de atención. */
export function FichaHistoriaClinicaFisioterapia(props: FichaHistoriaClinicaProps) {
  return (
    <HCShell
      {...props}
      tipo="HISTORIA_CLINICA_FISIOTERAPIA"
      titulo="Historia clínica — Fisioterapia"
      secciones={SECCIONES_FISIO}
      estadoInicial={ESTADO_INICIAL_FISIO}
    >
      {(hc) => <SeccionesFisioterapia hc={hc} />}
    </HCShell>
  );
}

function SeccionesFisioterapia({ hc }: { hc: HCStore }) {
  return (
    <>
      <SeccionDatosPersonales hc={hc} numero={1} />
      <SeccionAnamnesis hc={hc} numero={2} />

      {/* ③ Motivo de consulta */}
      <Seccion id="motivo" numero={3} titulo="Motivo de consulta">
        <Grid cols={2}>
          <Area
            hc={hc}
            path="motivo_consulta"
            label="¿Por qué consulta el paciente?"
            span="full"
            grande
            placeholder="Relato del paciente en sus propias palabras…"
          />
        </Grid>
      </Seccion>

      {/* ④ Enfermedad actual */}
      <Seccion id="enfermedad" numero={4} titulo="Enfermedad actual">
        <Grid cols={2}>
          <Area
            hc={hc}
            path="enfermedad_actual"
            label="Historia de la enfermedad actual"
            span="full"
            grande
            placeholder="Inicio, evolución, factores que agravan o alivian, tratamientos previos, estudios realizados…"
          />
        </Grid>
      </Seccion>

      {/* ⑤ Examen físico */}
      <Seccion id="examen" numero={5} titulo="Examen físico">
        <Grid cols={2}>
          <Selector
            hc={hc}
            path="examen_fisico.segmento"
            label="Segmento"
            options={SEGMENTO_CORPORAL}
          />
          <Selector
            hc={hc}
            path="examen_fisico.lateralidad"
            label="Lateralidad"
            options={LATERALIDAD}
          />
        </Grid>

        <Grid cols={2}>
          <Escala
            hc={hc}
            path="examen_fisico.dolor"
            label="Dolor (EVA)"
            span="full"
            min={1}
            max={10}
            leyendaMin="1 leve"
            leyendaMax="10 máximo"
          />
        </Grid>

        <Grid cols={2}>
          <SiNo hc={hc} path="examen_fisico.inflamacion" label="Inflamación" />
          <SiNo hc={hc} path="examen_fisico.fovea" label="Fóvea" />
          <Escala
            hc={hc}
            path="examen_fisico.movilidad"
            label="Movilidad"
            min={1}
            max={5}
            leyendaMin="1 mínima"
            leyendaMax="5 completa"
          />
          <Escala
            hc={hc}
            path="examen_fisico.fuerza"
            label="Fuerza"
            min={1}
            max={5}
            leyendaMin="1 mínima"
            leyendaMax="5 normal"
          />
        </Grid>

        <Grid cols={2}>
          <Area
            hc={hc}
            path="examen_fisico.semiologia"
            label="Semiología"
            span="full"
            grande
            placeholder="Inspección, palpación, pruebas semiológicas y hallazgos…"
          />
        </Grid>
      </Seccion>

      <SeccionEvoluciones hc={hc} numero={6} />
    </>
  );
}
