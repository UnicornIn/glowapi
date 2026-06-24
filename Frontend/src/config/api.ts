function resolveApiBaseUrl(): string {
  const { hostname } = window.location;

  if (hostname === "localhost" || hostname === "127.0.0.1") {
    return import.meta.env.VITE_API_BASE_URL || "http://localhost:8000/";
  }

  // Producción: spa-aurora.glowup.com → https://api-spa-aurora.glowup.com/
  return `https://uncover-ferment-deskbound.ngrok-free.dev/`;
}

export const API_BASE_URL = resolveApiBaseUrl();
