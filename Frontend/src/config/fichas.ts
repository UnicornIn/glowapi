export interface FichaConfig {
  id: string;
  titulo: string;
  descripcion: string;
  enabled: boolean;
}

export const fichas: FichaConfig[] = [
  {
    id: "FICHA_ESTILIZADO",
    titulo: "Ficha de Estilizado",
    descripcion: "Evaluación capilar y recomendación de técnica de lavado",
    enabled: true,
  },
];
