// ════════════════════════════════════════════════════════════
// Historia Clínica de Piso Pélvico
//
// Estructura según la hoja manuscrita + capturas del sistema actual:
//   ① Datos personales (igual a fisio)   ② Anamnesis
//   ③ Antecedentes obstétricos           ④ Antecedentes urinarios
//   ⑤ Antecedentes coloproctológicos     ⑥ Antecedentes sexuales
//   ⑦ Examen físico (abdomen)            ⑧ Evaluación cinesiológica funcional
//   ⑨ Diagnóstico funcional              ⑩ Evoluciones
// ════════════════════════════════════════════════════════════

import {
  Area,
  Checks,
  Grid,
  Grupo,
  Seccion,
  Selector,
  SiNo,
  SubBloque,
  Texto,
  type HCStore,
} from "./HCUI";
import { HCShell, type FichaHistoriaClinicaProps } from "./HCShell";
import {
  APERTURA_VULVAR,
  BRISTOL,
  CALIDAD_CHORRO,
  CANTIDAD_PERDIDAS,
  CO_CONTRACCIONES,
  DISTANCIA_ANO_VULVAR,
  FCIA_URINARIA_DIURNA,
  INCONTINENCIA_ANAL,
  LUBRICACION,
  MENOPAUSIA,
  MOMENTO_ACTIVIDAD,
  NERVIOS_SENSIBILIDAD,
  PAV_ENDURANCE,
  PAV_MOVIMIENTO,
  PAV_POTENCIA,
  PAV_PRESION,
  PAV_RELAJACION,
  PRESENCIA,
  PUNTOS_GATILLO,
  REFLEJOS,
  SENSIBILIDAD,
  SOPORTE_HORMONAL,
  TONO_MUSCULAR,
  TROFISMO,
  VULVODINIA,
} from "./hcCatalogos";
import {
  SeccionAnamnesis,
  SeccionDatosPersonales,
  SeccionEvoluciones,
  type Evolucion,
} from "./SeccionesComunes";

export const SECCIONES_PISO_PELVICO = [
  { id: "datos", numero: 1, titulo: "Datos personales" },
  { id: "anamnesis", numero: 2, titulo: "Anamnesis" },
  { id: "obstetricos", numero: 3, titulo: "Antecedentes obstétricos" },
  { id: "urinarios", numero: 4, titulo: "Antecedentes urinarios" },
  { id: "coloproctologicos", numero: 5, titulo: "Ant. coloproctológicos" },
  { id: "sexuales", numero: 6, titulo: "Antecedentes sexuales" },
  { id: "examen", numero: 7, titulo: "Examen físico" },
  { id: "cinesiologica", numero: 8, titulo: "Evaluación funcional" },
  { id: "diagnostico", numero: 9, titulo: "Diagnóstico funcional" },
  { id: "evoluciones", numero: 10, titulo: "Evoluciones" },
];

export const ESTADO_INICIAL_PISO_PELVICO = {
  tipo: "PISO_PELVICO",
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
  obstetricos: {
    embarazos: "",
    partos: "",
    cesareas: "",
    abortos: "",
    episiotomia: "",
    desgarro: "",
    menopausia: "",
    soporte_hormonal: "",
    fecha_ultima_menstruacion: "",
  },
  urinarios: {
    incontinencia_infancia: "",
    infecciones_3_meses: "",
    sensacion_masa_vaginal: "",
    tiempo_evolucion: "",
    fcia_diurna: "",
    fcia_nocturna: "",
    deseo_urgente_miccion: "",
    stop_pipi: "",
    dificultad_iniciar_miccion: "",
    sintomas_miccionales: [] as string[],
    calidad_chorro: "",
    vaciado_completo: "",
    incontinencia_urinaria: "",
    cantidad_perdidas: "",
    t_evolucion_incontinencia: "",
    circunstancias: "",
    usa_proteccion: "",
    absorbentes_dia: "",
    observaciones: "",
  },
  coloproctologicos: {
    fcia_defecatoria: "",
    bristol: "",
    estrenimiento_roma_iv: "",
    valsalva: "",
    dolor: "",
    sangrado: "",
    ardor: "",
    hemorroides: "",
    incontinencia_anal: [] as string[],
    tiempo_evolucion: "",
    soiling: "",
    observaciones: "",
  },
  sexuales: {
    dolor_sexual: "",
    inicio_penetracion: "",
    durante_relacion: "",
    despues_relacion: "",
    durante_despues_eyaculacion: "",
    vulvodinia: "",
    dispareunia: "",
    vaginismo: "",
    escapes: "",
    lubricacion: "",
    eyaculacion_prematura: "",
    disfuncion_erectil: "",
    observaciones: "",
  },
  examen_fisico: {
    abdomen: {
      dinamica_respiratoria: "",
      diafragma: "",
      tos: "",
      diastasis: "",
      cicatriz: "",
      dolor: "",
    },
  },
  cinesiologica: {
    inspeccion_estatica: { apertura_vulvar: "", distancia_ano_vulvar: "" },
    inspeccion_dinamica: {
      bulbocavernoso: "",
      isquiocavernoso: "",
      esfinter_anal_externo: "",
    },
    levantadores_contraccion: { movimiento_craneal: "", co_contracciones: [] as string[] },
    levantadores_relajacion: { movimiento_caudal: "" },
    actividad_involuntaria: {
      tos_movimiento_craneal: "",
      valsalva_movimiento_craneal: "",
      abertura_movimiento_caudal: "",
    },
    sensibilidad: {} as Record<string, string>,
    simetria_levantadores: "",
    palpacion_integridad_eae: "",
    reflejos: [] as string[],
    trofismo: { isquiocavernosos: "", bulbocavernosos: "", bulbos: "" },
    puntos_gatillo: [] as string[],
    actividad_voluntaria: {
      movimiento: "",
      presion_fuerza: "",
      potencia: "",
      endurance: "",
      relajacion: "",
      atrasado: "",
    },
    involuntaria_tos: { movimiento_craneal: "", movimiento_caudal: "" },
    involuntaria_valsalva: {
      movimiento_craneal: "",
      movimiento_caudal: "",
      relajacion_movimiento_caudal: "",
    },
  },
  diagnostico: {
    superficiales: "",
    levantadores_ano: "",
    obturadores: "",
    piriformes: "",
    sindrome_miofascial_superficial: "",
    sindrome_miofascial_profundo: "",
    conclusiones: "",
  },
  evoluciones: [] as Evolucion[],
  evolucion_nueva: { nota: "" },
};

/** Ficha completa, tal como la monta el protocolo de atención. */
export function FichaHistoriaClinicaPisoPelvico(props: FichaHistoriaClinicaProps) {
  return (
    <HCShell
      {...props}
      tipo="HISTORIA_CLINICA_PISO_PELVICO"
      titulo="Historia clínica — Piso pélvico"
      secciones={SECCIONES_PISO_PELVICO}
      estadoInicial={ESTADO_INICIAL_PISO_PELVICO}
    >
      {(hc) => <SeccionesPisoPelvico hc={hc} />}
    </HCShell>
  );
}

function SeccionesPisoPelvico({ hc }: { hc: HCStore }) {
  return (
    <>
      <SeccionDatosPersonales hc={hc} numero={1} />
      <SeccionAnamnesis hc={hc} numero={2} />

      {/* ③ Antecedentes obstétricos */}
      <Seccion id="obstetricos" numero={3} titulo="Antecedentes obstétricos">
        <Grid cols={4}>
          <Texto hc={hc} path="obstetricos.embarazos" label="Embarazos" type="number" placeholder="0" />
          <Texto hc={hc} path="obstetricos.partos" label="Partos" type="number" placeholder="0" />
          <Texto hc={hc} path="obstetricos.cesareas" label="Cesáreas" type="number" placeholder="0" />
          <Texto hc={hc} path="obstetricos.abortos" label="Abortos" type="number" placeholder="0" />

          <SiNo hc={hc} path="obstetricos.episiotomia" label="Episiotomía" />
          <SiNo hc={hc} path="obstetricos.desgarro" label="Desgarro" />
          <Selector hc={hc} path="obstetricos.menopausia" label="Menopausia" options={MENOPAUSIA} />
          <Selector
            hc={hc}
            path="obstetricos.soporte_hormonal"
            label="Soporte hormonal"
            options={SOPORTE_HORMONAL}
          />

          <Texto
            hc={hc}
            path="obstetricos.fecha_ultima_menstruacion"
            label="Fecha última menstruación"
            span="col-2"
            placeholder="Ej. 12 de agosto / hace 3 semanas"
          />
        </Grid>
      </Seccion>

      {/* ④ Antecedentes urinarios */}
      <Seccion id="urinarios" numero={4} titulo="Antecedentes urinarios">
        <Grid cols={3}>
          <SiNo
            hc={hc}
            path="urinarios.incontinencia_infancia"
            label="Incontinencia urinaria en la infancia"
          />
          <SiNo
            hc={hc}
            path="urinarios.infecciones_3_meses"
            label="Infecciones urinarias (últimos 3 meses)"
          />
          <SiNo
            hc={hc}
            path="urinarios.sensacion_masa_vaginal"
            label="Sensación de masa / peso vaginal"
          />

          <Texto
            hc={hc}
            path="urinarios.tiempo_evolucion"
            label="Tiempo de evolución"
            placeholder="Ej. 8 meses"
          />
          <Selector
            hc={hc}
            path="urinarios.fcia_diurna"
            label="Fcia urinaria diurna"
            options={FCIA_URINARIA_DIURNA}
          />
          <Texto
            hc={hc}
            path="urinarios.fcia_nocturna"
            label="Fcia urinaria nocturna"
            placeholder="Ej. 2 veces"
          />

          <SiNo
            hc={hc}
            path="urinarios.deseo_urgente_miccion"
            label="Deseo urgente de micción (OA)"
          />
          <SiNo hc={hc} path="urinarios.stop_pipi" label="Stop pipí" />
          <SiNo
            hc={hc}
            path="urinarios.dificultad_iniciar_miccion"
            label="Dificultad para iniciar la micción"
          />

          <Checks
            hc={hc}
            path="urinarios.sintomas_miccionales"
            label="Síntomas asociados"
            span="full"
            options={[
              { value: "Dolor", label: "Dolor" },
              { value: "Ardor", label: "Ardor" },
              { value: "Tenesmo", label: "Tenesmo" },
            ]}
          />

          <Selector
            hc={hc}
            path="urinarios.calidad_chorro"
            label="Calidad del chorro miccional"
            options={CALIDAD_CHORRO}
          />
          <SiNo hc={hc} path="urinarios.vaciado_completo" label="Sensación de vaciado completo" />
        </Grid>

        <SubBloque titulo="Incontinencia urinaria">
          <Grid cols={4}>
            <SiNo hc={hc} path="urinarios.incontinencia_urinaria" label="Incontinencia urinaria" />
            <Selector
              hc={hc}
              path="urinarios.cantidad_perdidas"
              label="Cantidad de pérdidas"
              options={CANTIDAD_PERDIDAS}
            />
            <Texto
              hc={hc}
              path="urinarios.t_evolucion_incontinencia"
              label="Tiempo de evolución"
              placeholder="Ej. 2 años"
            />
            <Texto
              hc={hc}
              path="urinarios.circunstancias"
              label="Circunstancias"
              placeholder="Esfuerzo, urgencia, mixta…"
            />

            <SiNo hc={hc} path="urinarios.usa_proteccion" label="Usa protección" />
            <Texto
              hc={hc}
              path="urinarios.absorbentes_dia"
              label="# absorbentes en el día"
              type="number"
              placeholder="0"
            />
            <Area
              hc={hc}
              path="urinarios.observaciones"
              label="Observaciones"
              span="col-2"
              placeholder="Observaciones del área urinaria…"
            />
          </Grid>
        </SubBloque>
      </Seccion>

      {/* ⑤ Antecedentes coloproctológicos */}
      <Seccion id="coloproctologicos" numero={5} titulo="Antecedentes coloproctológicos">
        <Grid cols={4}>
          <Texto
            hc={hc}
            path="coloproctologicos.fcia_defecatoria"
            label="Fcia defecatoria"
            placeholder="Ej. 1 vez al día"
          />
          <Selector hc={hc} path="coloproctologicos.bristol" label="Bristol" options={BRISTOL} />
          <Texto
            hc={hc}
            path="coloproctologicos.estrenimiento_roma_iv"
            label="Estreñimiento (Roma IV)"
            span="col-2"
            placeholder="Criterios que cumple…"
          />

          <SiNo hc={hc} path="coloproctologicos.valsalva" label="Valsalva" />
          <SiNo hc={hc} path="coloproctologicos.dolor" label="Dolor" />
          <SiNo hc={hc} path="coloproctologicos.sangrado" label="Sangrado" />
          <SiNo hc={hc} path="coloproctologicos.ardor" label="Ardor" />

          <SiNo hc={hc} path="coloproctologicos.hemorroides" label="Hemorroides" />
          <SiNo hc={hc} path="coloproctologicos.soiling" label="Soiling" />
          <Texto
            hc={hc}
            path="coloproctologicos.tiempo_evolucion"
            label="Tiempo de evolución"
            span="col-2"
            placeholder="Ej. 6 meses"
          />

          <Checks
            hc={hc}
            path="coloproctologicos.incontinencia_anal"
            label="Incontinencia anal"
            span="full"
            options={INCONTINENCIA_ANAL}
          />

          <Area
            hc={hc}
            path="coloproctologicos.observaciones"
            label="Observaciones"
            span="full"
            placeholder="Observaciones del área coloproctológica…"
          />
        </Grid>
      </Seccion>

      {/* ⑥ Antecedentes sexuales */}
      <Seccion id="sexuales" numero={6} titulo="Antecedentes sexuales">
        <SubBloque titulo="Dolor">
          <Grid cols={3}>
            <SiNo hc={hc} path="sexuales.dolor_sexual" label="Dolor sexual" />
            <SiNo hc={hc} path="sexuales.inicio_penetracion" label="Al inicio de la penetración" />
            <SiNo hc={hc} path="sexuales.durante_relacion" label="Durante la relación" />
            <SiNo hc={hc} path="sexuales.despues_relacion" label="Después de la relación" />
            <SiNo
              hc={hc}
              path="sexuales.durante_despues_eyaculacion"
              label="Durante / después de la eyaculación"
            />
          </Grid>
        </SubBloque>

        <SubBloque titulo="Función sexual">
          <Grid cols={3}>
            <Selector hc={hc} path="sexuales.vulvodinia" label="Vulvodinia" options={VULVODINIA} />
            <SiNo hc={hc} path="sexuales.dispareunia" label="Dispareunia" />
            <SiNo hc={hc} path="sexuales.vaginismo" label="Vaginismo" />
            <SiNo hc={hc} path="sexuales.escapes" label="Escapes" />
            <Selector
              hc={hc}
              path="sexuales.lubricacion"
              label="Lubricación"
              options={LUBRICACION}
            />
            <SiNo hc={hc} path="sexuales.eyaculacion_prematura" label="Eyaculación prematura" />
            <SiNo hc={hc} path="sexuales.disfuncion_erectil" label="Disfunción eréctil" />

            <Area
              hc={hc}
              path="sexuales.observaciones"
              label="Observaciones"
              span="full"
              placeholder="Observaciones del área sexual…"
            />
          </Grid>
        </SubBloque>
      </Seccion>

      {/* ⑦ Examen físico — Abdomen */}
      <Seccion id="examen" numero={7} titulo="Examen físico">
        <Grupo label="Abdomen">
          <Grid cols={3}>
            <Area
              hc={hc}
              path="examen_fisico.abdomen.dinamica_respiratoria"
              label="Dinámica respiratoria"
              placeholder="Patrón, expansión, uso de accesorios…"
            />
            <Area
              hc={hc}
              path="examen_fisico.abdomen.diafragma"
              label="Diafragma"
              placeholder="Movilidad, tono, restricciones…"
            />
            <Area hc={hc} path="examen_fisico.abdomen.tos" label="Tos" placeholder="Comportamiento abdominal con la tos…" />
            <Area
              hc={hc}
              path="examen_fisico.abdomen.diastasis"
              label="Diástasis"
              placeholder="Ubicación, ancho en dedos/cm, tensión de la línea alba…"
            />
            <Area
              hc={hc}
              path="examen_fisico.abdomen.cicatriz"
              label="Cicatriz"
              placeholder="Tipo, adherencias, sensibilidad…"
            />
            <Area
              hc={hc}
              path="examen_fisico.abdomen.dolor"
              label="Dolor"
              placeholder="Localización e intensidad…"
            />
          </Grid>
        </Grupo>
      </Seccion>

      {/* ⑧ Evaluación cinesiológica funcional */}
      <Seccion
        id="cinesiologica"
        numero={8}
        titulo="Evaluación cinesiológica funcional de la musculatura de piso pélvico"
      >
        <SubBloque titulo="Inspección estática">
          <Grid cols={3}>
            <Selector
              hc={hc}
              path="cinesiologica.inspeccion_estatica.apertura_vulvar"
              label="Apertura vulvar"
              options={APERTURA_VULVAR}
            />
            <Selector
              hc={hc}
              path="cinesiologica.inspeccion_estatica.distancia_ano_vulvar"
              label="Distancia ano-vulvar"
              options={DISTANCIA_ANO_VULVAR}
            />
          </Grid>
        </SubBloque>

        <SubBloque titulo="Inspección dinámica">
          <Grid cols={3}>
            <Selector
              hc={hc}
              path="cinesiologica.inspeccion_dinamica.bulbocavernoso"
              label="Bulbocavernoso"
              options={PRESENCIA}
            />
            <Selector
              hc={hc}
              path="cinesiologica.inspeccion_dinamica.isquiocavernoso"
              label="Isquiocavernoso"
              options={PRESENCIA}
            />
            <Selector
              hc={hc}
              path="cinesiologica.inspeccion_dinamica.esfinter_anal_externo"
              label="Esfínter anal externo"
              options={PRESENCIA}
            />
          </Grid>
        </SubBloque>

        <SubBloque titulo="Levantadores del ano — Contracción">
          <Grid cols={3}>
            <Selector
              hc={hc}
              path="cinesiologica.levantadores_contraccion.movimiento_craneal"
              label="Movimiento craneal"
              options={PRESENCIA}
            />
            <Checks
              hc={hc}
              path="cinesiologica.levantadores_contraccion.co_contracciones"
              label="Co-contracciones"
              span="full"
              options={CO_CONTRACCIONES}
            />
          </Grid>
        </SubBloque>

        <SubBloque titulo="Levantadores del ano — Relajación">
          <Grid cols={3}>
            <Selector
              hc={hc}
              path="cinesiologica.levantadores_relajacion.movimiento_caudal"
              label="Movimiento caudal"
              options={PRESENCIA}
            />
          </Grid>
        </SubBloque>

        <SubBloque titulo="Actividad involuntaria">
          <Grid cols={3}>
            <Selector
              hc={hc}
              path="cinesiologica.actividad_involuntaria.tos_movimiento_craneal"
              label="TOS — Movimiento craneal"
              options={MOMENTO_ACTIVIDAD}
            />
            <Selector
              hc={hc}
              path="cinesiologica.actividad_involuntaria.valsalva_movimiento_craneal"
              label="Valsalva — Movimiento craneal"
              options={MOMENTO_ACTIVIDAD}
            />
            <Selector
              hc={hc}
              path="cinesiologica.actividad_involuntaria.abertura_movimiento_caudal"
              label="Abertura — Movimiento caudal"
              options={PRESENCIA}
            />
          </Grid>
        </SubBloque>

        <SubBloque titulo="Palpación — Sensibilidad">
          <Grid cols={4}>
            {NERVIOS_SENSIBILIDAD.map((n) => (
              <Selector
                key={n.key}
                hc={hc}
                path={`cinesiologica.sensibilidad.${n.key}`}
                label={n.label}
                options={SENSIBILIDAD}
              />
            ))}
            <SiNo
              hc={hc}
              path="cinesiologica.simetria_levantadores"
              label="Simetría de los levantadores del ano"
            />
            <Texto
              hc={hc}
              path="cinesiologica.palpacion_integridad_eae"
              label="Palpación e integridad del EAE"
              span="col-2"
              placeholder="Hallazgos…"
            />
          </Grid>
        </SubBloque>

        <SubBloque titulo="Reflejos">
          <Grid cols={2}>
            <Checks
              hc={hc}
              path="cinesiologica.reflejos"
              label="Reflejos presentes"
              span="full"
              options={REFLEJOS}
            />
          </Grid>
        </SubBloque>

        <SubBloque titulo="Trofismo del clítoris / pene">
          <Grid cols={3}>
            <Selector
              hc={hc}
              path="cinesiologica.trofismo.isquiocavernosos"
              label="Musc. isquiocavernosos"
              options={TROFISMO}
            />
            <Selector
              hc={hc}
              path="cinesiologica.trofismo.bulbocavernosos"
              label="Musc. bulbocavernosos"
              options={TROFISMO}
            />
            <Selector hc={hc} path="cinesiologica.trofismo.bulbos" label="Bulbos" options={TROFISMO} />
          </Grid>
        </SubBloque>

        <SubBloque titulo="Dolor y puntos gatillo miofasciales">
          <Grid cols={2}>
            <Checks
              hc={hc}
              path="cinesiologica.puntos_gatillo"
              label="Puntos dolorosos"
              span="full"
              options={PUNTOS_GATILLO}
            />
          </Grid>
        </SubBloque>

        <SubBloque titulo="Palpación — Actividad voluntaria">
          <Grid cols={3}>
            <Selector
              hc={hc}
              path="cinesiologica.actividad_voluntaria.movimiento"
              label="Movimiento"
              options={PAV_MOVIMIENTO}
            />
            <Selector
              hc={hc}
              path="cinesiologica.actividad_voluntaria.presion_fuerza"
              label="Presión (fuerza)"
              options={PAV_PRESION}
            />
            <Selector
              hc={hc}
              path="cinesiologica.actividad_voluntaria.potencia"
              label="Potencia"
              options={PAV_POTENCIA}
            />
            <Selector
              hc={hc}
              path="cinesiologica.actividad_voluntaria.endurance"
              label="Endurance"
              options={PAV_ENDURANCE}
            />
            <Selector
              hc={hc}
              path="cinesiologica.actividad_voluntaria.relajacion"
              label="Relajación"
              options={PAV_RELAJACION}
            />
            <SiNo hc={hc} path="cinesiologica.actividad_voluntaria.atrasado" label="Atrasado" />
          </Grid>
        </SubBloque>

        <SubBloque titulo="Actividad involuntaria — TOS">
          <Grid cols={3}>
            <Selector
              hc={hc}
              path="cinesiologica.involuntaria_tos.movimiento_craneal"
              label="Movimiento craneal"
              options={MOMENTO_ACTIVIDAD}
            />
            <Selector
              hc={hc}
              path="cinesiologica.involuntaria_tos.movimiento_caudal"
              label="Movimiento caudal"
              options={PRESENCIA}
            />
          </Grid>
        </SubBloque>

        <SubBloque titulo="Actividad involuntaria — Valsalva">
          <Grid cols={3}>
            <Selector
              hc={hc}
              path="cinesiologica.involuntaria_valsalva.movimiento_craneal"
              label="Movimiento craneal"
              options={MOMENTO_ACTIVIDAD}
            />
            <Selector
              hc={hc}
              path="cinesiologica.involuntaria_valsalva.movimiento_caudal"
              label="Movimiento caudal"
              options={PRESENCIA}
            />
            <Selector
              hc={hc}
              path="cinesiologica.involuntaria_valsalva.relajacion_movimiento_caudal"
              label="Relajación — Movimiento caudal"
              options={PRESENCIA}
            />
          </Grid>
        </SubBloque>
      </Seccion>

      {/* ⑨ Diagnóstico funcional */}
      <Seccion id="diagnostico" numero={9} titulo="Diagnóstico funcional">
        <Grid cols={4}>
          <Selector
            hc={hc}
            path="diagnostico.superficiales"
            label="Superficiales"
            options={TONO_MUSCULAR}
          />
          <Selector
            hc={hc}
            path="diagnostico.levantadores_ano"
            label="Levantadores del ano"
            options={TONO_MUSCULAR}
          />
          <Selector
            hc={hc}
            path="diagnostico.obturadores"
            label="Obturadores"
            options={TONO_MUSCULAR}
          />
          <Selector
            hc={hc}
            path="diagnostico.piriformes"
            label="Piriformes"
            options={TONO_MUSCULAR}
          />

          <SiNo
            hc={hc}
            path="diagnostico.sindrome_miofascial_superficial"
            label="Síndrome miofascial superficial"
          />
          <SiNo
            hc={hc}
            path="diagnostico.sindrome_miofascial_profundo"
            label="Síndrome miofascial profundo"
          />

          <Area
            hc={hc}
            path="diagnostico.conclusiones"
            label="Conclusiones"
            span="full"
            grande
            placeholder="Diagnóstico funcional, objetivos terapéuticos y plan de intervención…"
          />
        </Grid>
      </Seccion>

      <SeccionEvoluciones hc={hc} numero={10} />
    </>
  );
}
