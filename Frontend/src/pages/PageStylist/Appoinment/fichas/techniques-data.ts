export type VarLevel = "A" | "M" | "B";
export type CellValue = "ideal" | "ok" | "none";
export type VarName = "oleo" | "porosidad" | "grosor" | "permeabilidad";

export interface Technique {
  full: string;
  steps: string[];
  oleo: Record<VarLevel, CellValue>;
  porosidad: Record<VarLevel, CellValue>;
  grosor: Record<VarLevel, CellValue>;
  permeabilidad: Record<VarLevel, CellValue>;
}

export const TECHNIQUES: Record<string, Technique> = {
  ASA: {
    full: "Acondicionador · Shampoo · Acondicionador",
    steps: [
      "Acondicionador de medios a puntas",
      "Shampoo en cuero cabelludo (2 veces)",
      "Enjuagar y repetir acondicionador",
    ],
    oleo: { A: "ideal", M: "ideal", B: "ok" },
    porosidad: { A: "ideal", M: "ok", B: "ideal" },
    grosor: { A: "ok", M: "ok", B: "ok" },
    permeabilidad: { A: "ok", M: "ok", B: "ok" },
  },
  MNSA: {
    full: "Mascarilla · Normal · Shampoo · Acondicionador",
    steps: [
      "Mascarilla pre-lavado en medios y puntas",
      "Shampoo normal en cuero cabelludo",
      "Acondicionador de cierre",
    ],
    oleo: { A: "ideal", M: "ideal", B: "ok" },
    porosidad: { A: "ok", M: "ideal", B: "ideal" },
    grosor: { A: "ideal", M: "ideal", B: "ok" },
    permeabilidad: { A: "ok", M: "ok", B: "ok" },
  },
  ASMN: {
    full: "Acondicionador · Shampoo · Mascarilla · Normal",
    steps: [
      "Acondicionador de medios a puntas para preparar la hebra",
      "Shampoo en cuero cabelludo, 2 pasadas",
      "Mascarilla con tiempo de pose según porosidad",
      "Enjuague con agua fría para sellar cutícula",
    ],
    oleo: { A: "ideal", M: "ideal", B: "ok" },
    porosidad: { A: "ok", M: "ideal", B: "ideal" },
    grosor: { A: "ideal", M: "ideal", B: "ok" },
    permeabilidad: { A: "ok", M: "ok", B: "ok" },
  },
  MHSA: {
    full: "Mascarilla · Hidratante · Shampoo · Acondicionador",
    steps: [
      "Mascarilla hidratante profunda antes del lavado",
      "Shampoo suave en cuero cabelludo",
      "Acondicionador de cierre en medios y puntas",
    ],
    oleo: { A: "ideal", M: "ideal", B: "ok" },
    porosidad: { A: "ideal", M: "ideal", B: "ok" },
    grosor: { A: "ideal", M: "ideal", B: "ok" },
    permeabilidad: { A: "ok", M: "ok", B: "ok" },
  },
  ASMH: {
    full: "Acondicionador · Shampoo · Mascarilla · Hidratante",
    steps: [
      "Acondicionador hidratante de medios a puntas",
      "Shampoo suave en cuero cabelludo",
      "Mascarilla hidratante profunda con pose extendida",
      "Enjuague abundante con agua fría",
    ],
    oleo: { A: "ideal", M: "ideal", B: "ok" },
    porosidad: { A: "ideal", M: "ideal", B: "ok" },
    grosor: { A: "ok", M: "ideal", B: "ideal" },
    permeabilidad: { A: "ok", M: "ok", B: "ok" },
  },
  COPOO: {
    full: "Conditioner Only / Co-wash profundo",
    steps: [
      "Solo acondicionador, sin shampoo",
      "Masajear cuero cabelludo suavemente con el acondicionador",
      "Enjuague parcial preservando hidratación",
    ],
    oleo: { A: "ok", M: "ideal", B: "ideal" },
    porosidad: { A: "ideal", M: "ok", B: "ideal" },
    grosor: { A: "ok", M: "ok", B: "ok" },
    permeabilidad: { A: "ok", M: "ok", B: "ok" },
  },
  MNPOO: {
    full: "Mascarilla · Normal · Co-wash",
    steps: [
      "Mascarilla pre-lavado nutritiva",
      "Co-wash suave (acondicionador como shampoo)",
      "Sin enjuague completo para preservar nutrición",
    ],
    oleo: { A: "ok", M: "ideal", B: "ideal" },
    porosidad: { A: "ok", M: "ideal", B: "ideal" },
    grosor: { A: "ok", M: "ok", B: "ok" },
    permeabilidad: { A: "ok", M: "ok", B: "ok" },
  },
  MHPOO: {
    full: "Mascarilla · Hidratante · Co-wash",
    steps: [
      "Mascarilla hidratante de larga duración",
      "Co-wash con acondicionador hidratante",
      "Enjuague mínimo para sellar hidratación",
    ],
    oleo: { A: "ok", M: "ideal", B: "ideal" },
    porosidad: { A: "ideal", M: "ideal", B: "ok" },
    grosor: { A: "ok", M: "ok", B: "ok" },
    permeabilidad: { A: "ok", M: "ok", B: "ok" },
  },
};

export const TECHNIQUE_NAMES = Object.keys(TECHNIQUES);

export const VAR_LIST: { key: VarName; label: string; icon: string }[] = [
  { key: "oleo", label: "Óleo", icon: "💧" },
  { key: "porosidad", label: "Porosidad", icon: "🕳" },
  { key: "grosor", label: "Grosor", icon: "〰️" },
  { key: "permeabilidad", label: "Permeabilidad", icon: "🌊" },
];

export const LEVEL_LABELS: Record<VarLevel, [string, string]> = {
  A: ["Alto", "Alta"],
  M: ["Medio", "Media"],
  B: ["Bajo", "Baja"],
};

// 0 = masculine, 1 = feminine
export const VAR_GENDER: Record<VarName, 0 | 1> = {
  oleo: 0,
  porosidad: 1,
  grosor: 0,
  permeabilidad: 1,
};

export function scoreTechnique(
  name: string,
  selections: Record<VarName, VarLevel | null>,
): number {
  const t = TECHNIQUES[name];
  let score = 0;
  for (const v of Object.keys(selections) as VarName[]) {
    const level = selections[v];
    if (!level) continue;
    const cell = t[v][level];
    if (cell === "ideal") score += 2;
    else if (cell === "ok") score += 1;
  }
  return score;
}

export function findBestTechnique(
  selections: Record<VarName, VarLevel | null>,
): string | null {
  let best: string | null = null;
  let bestScore = -1;
  for (const name of TECHNIQUE_NAMES) {
    const s = scoreTechnique(name, selections);
    if (s > bestScore) {
      bestScore = s;
      best = name;
    }
  }
  return best;
}
