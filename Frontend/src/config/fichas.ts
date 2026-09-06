// Catálogo de referencia de TODAS las fichas que el frontend sabe renderizar
// (ver el switch de `renderFicha()` en attention-protocol.tsx). Es el
// FALLBACK del catálogo dinámico (`src/lib/fichaTemplates.ts`, que lee/escribe
// GET/POST /admin/ficha-templates) — mismo patrón que brand.ts para
// business-config: solo se usa si el backend no responde o aún no tiene
// templates configurados para un tenant nuevo.
//
// El `enabled` de acá es el estado por defecto, no el real: una vez que un
// admin activa/desactiva una ficha desde la pantalla de configuración, el
// backend manda y este archivo deja de importar para esa ficha.

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
    descripcion: "Plasticidad, porosidad, densidad y demás características del cabello",
    // Con componente y endpoint funcionando, pero nunca estuvo en el catálogo
    // visible — apagada por defecto para no cambiar el comportamiento actual.
    // Activable desde la pantalla de configuración de fichas sin deploy.
    enabled: false,
  },
  {
    id: "COLOR",
    titulo: "Color",
    descripcion: "Cuestionario de diagnóstico cromático antes de un servicio de color",
    enabled: false,
  },
  {
    id: "ASESORIA_CORTE",
    titulo: "Asesoría de Corte",
    descripcion: "Fotos de antes/después y descripción del corte realizado",
    enabled: false,
  },
  {
    id: "CUIDADO_POST_COLOR",
    titulo: "Cuidado Post Color",
    descripcion: "Recomendaciones personalizadas de cuidado después de un color",
    enabled: false,
  },
  {
    id: "VALORACION_PRUEBA_COLOR",
    titulo: "Valoración Prueba de Color",
    descripcion: "Acuerdos y recomendaciones de una prueba de color previa al servicio",
    enabled: false,
  },
  {
    id: "OZONOTERAPIA_CAPILAR",
    titulo: "Ozonoterapia Capilar",
    descripcion: "Registro de sesión de ozonoterapia capilar",
    enabled: false,
  },
  {
    id: "FICHA_ESTILIZADO",
    titulo: "Ficha de Estilizado",
    descripcion: "Evaluación capilar y recomendación de técnica de lavado",
    enabled: false,
  },
  {
    id: "HISTORIA_CLINICA_FISIOTERAPIA",
    titulo: "Historia Clínica Fisioterapia",
    descripcion: "Anamnesis, examen físico por segmento y evoluciones por sesión",
    enabled: true,
  },
  {
    id: "HISTORIA_CLINICA_PISO_PELVICO",
    titulo: "Historia Clínica Piso Pélvico",
    descripcion:
      "Antecedentes obstétricos, urinarios, coloproctológicos y evaluación cinesiológica funcional",
    enabled: true,
  },
];
