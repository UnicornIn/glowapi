// ════════════════════════════════════════════════════════════
// Historia Clínica — Catálogos de opciones
//
// Fuente: hojas manuscritas (Fisioterapia / Piso Pélvico) + capturas
// del sistema actual (secciones 4, 5, 6, 8 y 9).
//
// Cuando exista backend, estos catálogos deberían moverse a un
// endpoint de configuración; por ahora viven aquí para la demo.
// ════════════════════════════════════════════════════════════

export type Opcion = { value: string; label: string };

const opts = (...labels: string[]): Opcion[] =>
  labels.map((label) => ({ value: label, label }));

/* ── 1. Datos personales ─────────────────────────────────── */

export const TIPO_DOCUMENTO: Opcion[] = [
  { value: "CC", label: "CC — Cédula de ciudadanía" },
  { value: "TI", label: "TI — Tarjeta de identidad" },
  { value: "CE", label: "CE — Cédula de extranjería" },
  { value: "PA", label: "PA — Pasaporte" },
  { value: "RC", label: "RC — Registro civil" },
  { value: "PEP", label: "PEP — Permiso especial de permanencia" },
];

export const SEXO = opts("Femenino", "Masculino", "Intersexual", "Prefiere no decirlo");

/* ── 5. Examen físico (fisioterapia) ─────────────────────── */

export const SEGMENTO_CORPORAL = opts(
  "Cabeza y cuello",
  "Columna cervical",
  "Columna dorsal",
  "Columna lumbar",
  "Hombro",
  "Codo",
  "Muñeca y mano",
  "Cadera",
  "Rodilla",
  "Tobillo y pie",
  "Pelvis",
  "Abdomen",
  "Miembro superior",
  "Miembro inferior"
);

export const LATERALIDAD = opts("Derecha", "Izquierda", "Bilateral", "No aplica");

/* ── 3. Antecedentes obstétricos (piso pélvico) ──────────── */

export const MENOPAUSIA = opts("No", "Sí", "Perimenopausia", "Quirúrgica");

export const SOPORTE_HORMONAL = opts("No", "Sí — oral", "Sí — tópico", "Sí — transdérmico", "Sí — DIU hormonal");

/* ── 4. Antecedentes urinarios ───────────────────────────── */

export const FCIA_URINARIA_DIURNA = opts("< 6 veces", "6 - 8 veces", "> 8 veces");

export const CALIDAD_CHORRO = opts("Normal", "Débil", "Intermitente", "Goteo terminal", "En regadera");

export const CANTIDAD_PERDIDAS = opts("Leve", "Moderada", "Severa");

/* ── 5. Antecedentes coloproctológicos ───────────────────── */

export const BRISTOL = opts(
  "Tipo 1",
  "Tipo 2",
  "Tipo 3",
  "Tipo 4",
  "Tipo 5",
  "Tipo 6",
  "Tipo 7"
);

export const INCONTINENCIA_ANAL = opts("Sólido", "Líquido", "Gases");

/* ── 6. Antecedentes sexuales ────────────────────────────── */

export const VULVODINIA = opts("No", "Ardor", "Punzada", "Prurito", "Escozor", "Mixta");

export const LUBRICACION = opts("Normal", "Disminuida", "Ausente", "Aumentada");

/* ── 8. Evaluación cinesiológica funcional ───────────────── */

export const APERTURA_VULVAR = opts("< 0.5 cm", "0.5 - 1 cm", "1 - 2 cm", "> 2 cm");

export const DISTANCIA_ANO_VULVAR = opts("< 3 cm", "3 - 4 cm", "> 4 cm");

export const PRESENCIA = opts("Presente", "Ausente", "Disminuido");

export const CO_CONTRACCIONES = opts(
  "Respiratorias",
  "Abdominales",
  "Aductores",
  "Glúteos",
  "Ausente"
);

export const MOMENTO_ACTIVIDAD = opts("Antes", "Durante", "Después", "Ausente");

export const SENSIBILIDAD = opts("D > I", "I > D", "D = I", "Ausente");

export const NERVIOS_SENSIBILIDAD = [
  { key: "cuadriceps", label: "Cuádriceps" },
  { key: "aductores", label: "Aductores" },
  { key: "isquiotibiales", label: "Isquiotibiales" },
  { key: "pudendo", label: "Pudendo" },
  { key: "cutaneo_femoral", label: "Cutáneo femoral" },
  { key: "ilioinguinal", label: "Ilioinguinal" },
  { key: "ilio_hipogastrico", label: "Ilio hipogástrico" },
] as const;

export const REFLEJOS = opts("Isquiocavernoso", "Cutaneoanal", "Cremastérico", "Levantadores");

export const TROFISMO = opts("Aumentado", "Normal", "Disminuido");

export const PUNTOS_GATILLO = opts(
  "Superficiales",
  "Puboviscerales",
  "Puborectal",
  "Iliocx / pud",
  "Obturadores",
  "Glúteo",
  "Piriformes"
);

/* Palpación — actividad voluntaria (escalas del sistema actual) */

export const PAV_MOVIMIENTO = opts("0 - Completo", "1 - Parcial", "2 - Ausente");

export const PAV_PRESION = opts("0 - Fuerte", "1 - Moderada", "2 - Débil", "3 - Ausente");

export const PAV_POTENCIA = opts("0 - > 15 rep", "1 - 10 a 15 rep", "2 - 5 a 10 rep", "3 - < 5 rep");

export const PAV_ENDURANCE = opts("0 - > 10 seg", "1 - 6 a 10 seg", "2 - 3 a 5 seg", "3 - < 3 seg");

export const PAV_RELAJACION = opts(
  "Completa mayor rep",
  "Completa menor rep",
  "Parcial",
  "Ausente"
);

/* ── 9. Diagnóstico funcional ────────────────────────────── */

export const TONO_MUSCULAR = opts("Hiperactivo", "Normoactivo", "Hipoactivo", "No valorable");
