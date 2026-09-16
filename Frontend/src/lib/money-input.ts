// Campos de monto escritos a mano. En Colombia se escribe "10.000" con punto
// de miles, y un <input type="number"> lo lee como 10 (punto = decimal) — así
// llegaban abonos de $10 o $1 que en realidad eran $10.000 o $1.000.
// Para monedas sin decimales (COP) se ignora cualquier separador y se toman
// solo los dígitos; para las demás se acepta coma o punto como decimal.

const MONEDAS_SIN_DECIMALES = new Set(["COP", "CLP", "PYG"]);

export const monedaSinDecimales = (moneda?: string | null): boolean =>
  MONEDAS_SIN_DECIMALES.has(String(moneda || "COP").toUpperCase());

export function parseMontoInput(texto: string | number | null | undefined, moneda?: string | null): number {
  if (typeof texto === "number") return Number.isFinite(texto) ? texto : 0;
  const limpio = String(texto ?? "").trim();
  if (!limpio) return 0;

  if (monedaSinDecimales(moneda)) {
    const digitos = limpio.replace(/\D/g, "");
    return digitos ? Number(digitos) : 0;
  }

  // Con decimales: el último separador (coma o punto) es el decimal si le
  // siguen 1 o 2 dígitos; los demás separadores son de miles.
  const sinEspacios = limpio.replace(/[^\d.,]/g, "");
  const match = sinEspacios.match(/^(.*)[.,](\d{1,2})$/);
  const numero = match
    ? `${match[1].replace(/[.,]/g, "")}.${match[2]}`
    : sinEspacios.replace(/[.,]/g, "");
  const valor = Number(numero);
  return Number.isFinite(valor) ? valor : 0;
}

/** Texto a mostrar en el campo mientras se escribe (con puntos de miles en COP). */
export function formatMontoInput(texto: string | number | null | undefined, moneda?: string | null): string {
  if (texto === null || texto === undefined || texto === "") return "";
  if (monedaSinDecimales(moneda)) {
    const valor = parseMontoInput(texto, moneda);
    return valor ? valor.toLocaleString("es-CO") : "";
  }
  return String(texto);
}

/** Un abono menor a $1.000 COP casi siempre es un error de tipeo. */
export const montoSospechoso = (monto: number, moneda?: string | null): boolean =>
  monedaSinDecimales(moneda) && monto > 0 && monto < 1000;
