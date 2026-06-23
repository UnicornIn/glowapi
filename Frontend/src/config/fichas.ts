// Catálogo de fichas técnicas del tenant.
//
// `id` es el identificador ESTABLE que espera el backend (tipo_ficha) — NO
// cambiarlo por cliente; identifica la estructura de campos y los endpoints.
// `titulo` y `descripcion` son los textos visibles: cada cliente debe
// personalizarlos (los valores por defecto son los del cliente original,
// Rizos Felices, para no romper su instalación).
// `enabled: false` oculta la ficha de los menús/listados sin eliminar su
// código ni afectar fichas ya creadas con ese tipo.
export interface FichaConfig {
  id: string;
  titulo: string;
  descripcion: string;
  enabled: boolean;
}

export const fichas: FichaConfig[] = [
  {
    id: "DIAGNOSTICO_RIZOTIPO",
    titulo: "Diagnóstico Rizotipo",
    descripcion: "Análisis del tipo de cabello y diagnóstico completo",
    enabled: true,
  },
  {
    id: "COLOR",
    titulo: "Diagnóstico Cromático",
    descripcion: "Diagnóstico cromático RF® y registro de procesos de coloración",
    enabled: true,
  },
  {
    id: "ASESORIA_CORTE",
    titulo: "Asesoría de Corte",
    descripcion: "Recomendaciones y plan de corte personalizado",
    enabled: true,
  },
  {
    id: "CUIDADO_POST_COLOR",
    titulo: "Cuidado Post Color",
    descripcion: "Recomendaciones para mantenimiento después del color",
    enabled: true,
  },
  {
    id: "VALORACION_PRUEBA_COLOR",
    titulo: "Valoración Prueba Color",
    descripcion: "Evaluación de pruebas de color y resultados",
    enabled: true,
  },
  {
    id: "OZONOTERAPIA_CAPILAR",
    titulo: "Ozonoterapia Capilar RF®",
    descripcion: "Protocolo de ozonoterapia y tratamiento capilar RF®",
    enabled: true,
  },
];
