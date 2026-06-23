// Valores por defecto del tenant.
// Solo se usan como fallback si GET /public/business-config falla o aún no
// responde. En producción, el branding viene de la API.
//
// REGLA: ningún componente React debe importar este archivo directamente;
// consumir siempre vía useTenantConfig(). Excepciones documentadas: módulos
// fuera del árbol de React (ej. src/lib/pdfGenerator.ts).

export const brand = {
  appName: import.meta.env.VITE_APP_NAME || "GlowUp",
  companyName: import.meta.env.VITE_APP_COMPANY_NAME || "GlowUp",
  logoUrl: import.meta.env.VITE_APP_LOGO_URL || "",
  faviconUrl: import.meta.env.VITE_APP_FAVICON_URL || "/favicon.png",
  footerLegal: "",
  wsUrl: "",
  colors: {
    primary: import.meta.env.VITE_COLOR_PRIMARY || "oklch(0.205 0 0)",
    secondary: import.meta.env.VITE_COLOR_SECONDARY || "oklch(0.97 0 0)",
    accent: import.meta.env.VITE_COLOR_ACCENT || "oklch(0.97 0 0)",
  },
};

export type Brand = typeof brand;
