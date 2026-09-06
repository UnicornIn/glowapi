// URL base del API.
//
// Orden de resolución:
//   1. VITE_API_BASE_URL, si está definida. Vale en cualquier entorno, no solo
//      en localhost: es la forma de apuntar a un backend expuesto por un túnel
//      (ngrok / cloudflared) o a un backend de pruebas.
//   2. localhost / 127.0.0.1 → backend local en el puerto 8000.
//   3. Producción: spa-aurora.glowup.com → https://api-spa-aurora.glowup.com/
//
// NO hardcodear aquí la URL de un túnel: son efímeras y quedaban aplicándose a
// todo host que no fuera localhost, lo que rompía el login al servir el
// frontend por ngrok (las peticiones caían en el propio dev server → 404).
// Usa VITE_API_BASE_URL en un .env.local, que no se versiona.
function resolveApiBaseUrl(): string {
  const desdeEntorno = import.meta.env.VITE_API_BASE_URL;
  if (desdeEntorno) {
    // Una base relativa (ej. "/__api/") se resuelve contra el origen actual.
    // API_BASE_URL SIEMPRE debe ser absoluta: varios servicios hacen
    // new URL(`${API_BASE_URL}...`) para armar query params, y ese constructor
    // lanza TypeError si recibe una ruta relativa sin base.
    return desdeEntorno.startsWith("/")
      ? new URL(desdeEntorno, window.location.origin).toString()
      : desdeEntorno;
  }

  const { hostname } = window.location;

  if (hostname === "localhost" || hostname === "127.0.0.1") {
    return "http://localhost:8000/";
  }

  return `https://api-${hostname}/`;
}

export const API_BASE_URL = resolveApiBaseUrl();
