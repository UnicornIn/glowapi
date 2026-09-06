// ════════════════════════════════════════════════════════════
// Catálogo dinámico de fichas técnicas
//
// El backend ya tiene un mecanismo completo de self-service para
// esto: GET /ficha-templates (lectura) y POST/DELETE
// /admin/ficha-templates (activar/desactivar, incluso crear tipos
// nuevos) — sin necesitar deploy. Este módulo conecta ese mecanismo
// con el catálogo estático (src/config/fichas.ts), que pasa a ser
// solo el FALLBACK: mismo patrón que brand.ts para business-config
// ("solo se usan como fallback si GET falla o aún no responde").
// ════════════════════════════════════════════════════════════

import { API_BASE_URL } from "../types/config";
import type { FichaConfig } from "../config/fichas";

export interface FichaTemplateApi {
  tipo_ficha: string;
  label: string;
  activo: boolean;
  estricto?: boolean;
  categorias_foto?: string[];
  campos?: unknown[];
}

const getToken = (): string =>
  localStorage.getItem("access_token") || sessionStorage.getItem("access_token") || "";

/**
 * Lista los tipos de ficha configurados en el backend.
 * `soloActivos=false` trae también los desactivados (para la pantalla de
 * administración); el default (true) es para el selector de fichas del
 * protocolo de atención, que solo debe ofrecer las activas.
 */
export async function listarFichaTemplates(soloActivos = true): Promise<FichaTemplateApi[]> {
  const token = getToken();
  if (!token) return [];

  const response = await fetch(
    `${API_BASE_URL}ficha-templates?solo_activos=${soloActivos}`,
    { headers: { Authorization: `Bearer ${token}` } }
  );

  if (!response.ok) {
    throw new Error(`Error ${response.status} al listar tipos de ficha`);
  }

  const data = await response.json();
  return Array.isArray(data?.templates) ? data.templates : [];
}

/** Crea o actualiza (upsert) un tipo de ficha — activar/desactivar pasa por acá. */
export async function guardarFichaTemplate(
  tipoFicha: string,
  label: string,
  activo: boolean
): Promise<void> {
  const token = getToken();
  if (!token) throw new Error("No hay sesión activa");

  const response = await fetch(`${API_BASE_URL}admin/ficha-templates`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({ tipo_ficha: tipoFicha, label, activo }),
  });

  if (!response.ok) {
    const detalle = await response.json().catch(() => null);
    throw new Error(detalle?.detail || `Error ${response.status} al guardar`);
  }
}

/**
 * Combina el catálogo estático (id/título/descripción de referencia, y su
 * enabled de fallback) con lo que haya en el backend: si el backend ya tiene
 * un template para ese tipo_ficha, su `activo` manda; si no, se conserva el
 * `enabled` estático tal cual. Así una falla de red o un backend recién
 * desplegado sin templates aún no rompe el selector de fichas — simplemente
 * se comporta como hoy (estático) hasta que un admin toque el interruptor.
 */
export function combinarConTemplates(
  catalogoEstatico: FichaConfig[],
  templates: FichaTemplateApi[]
): FichaConfig[] {
  const porTipo = new Map(templates.map((t) => [t.tipo_ficha, t]));

  return catalogoEstatico.map((ficha) => {
    const remoto = porTipo.get(ficha.id);
    if (!remoto) return ficha;
    return { ...ficha, titulo: remoto.label || ficha.titulo, enabled: remoto.activo };
  });
}
