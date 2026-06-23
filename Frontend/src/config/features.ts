// Feature flags por tenant.
// Fase 1: solo se definen y se exponen vía TenantConfigContext.
// Fase 2: se aplicarán a rutas y menús para habilitar/deshabilitar módulos.
export const features = {
  fichasTecnicas: true,
  crm: true,
  finanzas: true,
  multiSede: true,
  cierreCaja: true,
};

export type Features = typeof features;
