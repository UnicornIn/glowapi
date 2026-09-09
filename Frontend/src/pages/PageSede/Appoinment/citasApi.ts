// components/Quotes/citasApi.ts - Agrega esta función
import { API_BASE_URL } from '../../../types/config'; // Ajusta la ruta según tu estructura
import { normalizePaymentMethodForBackend } from '../../../lib/payment-methods';
import { apiFetch } from '../../../lib/api';

export class ApiRequestError extends Error {
  status: number;
  payload: unknown;

  constructor(message: string, status: number, payload: unknown) {
    super(message);
    this.name = 'ApiRequestError';
    this.status = status;
    this.payload = payload;
  }
}

const parseApiDetail = (detail: unknown, fallback: string): string => {
  if (!detail) return fallback;
  if (typeof detail === 'string') return detail;

  if (Array.isArray(detail)) {
    const parsed = detail
      .map((item) => {
        if (typeof item === 'string') return item;
        if (item && typeof item === 'object' && 'msg' in item) {
          return String((item as { msg?: string }).msg || JSON.stringify(item));
        }
        return JSON.stringify(item);
      })
      .join(' | ');
    return parsed || fallback;
  }

  if (typeof detail === 'object') {
    const detailObj = detail as Record<string, unknown>;

    if (typeof detailObj.message === 'string') return detailObj.message;
    if (typeof detailObj.mensaje === 'string') return detailObj.mensaje;
    if (typeof detailObj.error === 'string') return detailObj.error;

    const parsed = Object.entries(detailObj)
      .map(([key, value]) => `${key}: ${typeof value === 'string' ? value : JSON.stringify(value)}`)
      .join(' | ');
    return parsed || fallback;
  }

  return fallback;
};

const buildApiRequestError = async (response: Response, fallback: string): Promise<ApiRequestError> => {
  const errorData = await response.json().catch(() => null);
  const message = parseApiDetail(errorData?.detail ?? errorData, fallback);
  return new ApiRequestError(message, response.status, errorData);
};

export const updateQuote = async (citaId: string, cambios: any, token: string) => {
  try {
    const response = await fetch(`${API_BASE_URL}scheduling/quotes/${citaId}`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      },
      body: JSON.stringify(cambios)
    });

    if (!response.ok) {
      const fallback = `Error ${response.status}: ${response.statusText}`;
      throw await buildApiRequestError(response, fallback);
    }

    return await response.json();
  } catch (error) {
    console.error('Error en updateQuote:', error);
    throw error;
  }

};

export const updateCita = updateQuote;
// En tu archivo citasApi.ts
export const confirmarCita = async (citaId: string, _token?: string) => {
  const response = await apiFetch(
    `${API_BASE_URL}scheduling/quotes/${citaId}/confirmar`,
    { method: 'POST' }
  );

  if (!response.ok) {
    throw await buildApiRequestError(response, 'Error al confirmar cita');
  }

  return await response.json();
};

export const reenviarCorreoCita = async (
  citaId: string,
  tipo: 'confirmacion' | 'recordatorio' | 'cancelacion',
  token: string
) => {
  const response = await fetch(
    `${API_BASE_URL}scheduling/quotes/${citaId}/reenviar-correo?tipo=${tipo}`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`,
      },
    }
  );

  if (!response.ok) {
    throw await buildApiRequestError(response, 'Error al reenviar correo');
  }

  return await response.json();
};

export const registrarPagoCita = async (
  citaId: string,
  pagoData: {
    monto: number;
    metodo_pago: string;
    notas?: string;
    codigo_giftcard?: string;
  },
  token: string
) => {
  const normalizedPaymentMethod = normalizePaymentMethodForBackend(pagoData.metodo_pago);
  const response = await fetch(
    `${API_BASE_URL}scheduling/quotes/citas/${citaId}/pago`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      },
      body: JSON.stringify({
        ...pagoData,
        metodo_pago: normalizedPaymentMethod,
      })
    }
  );

  if (!response.ok) {
    throw await buildApiRequestError(response, 'Error al registrar pago');
  }

  return await response.json();
};

// Cancelación "real" de la cita — a diferencia de mandar {estado:'cancelada'}
// por `updateQuote` (que solo cambia el campo y no dispara nada más), este
// endpoint dedicado libera la reserva de giftcard y traslada el abono a
// saldo a favor del cliente. Usar SIEMPRE este endpoint para cancelar, no
// updateQuote — de lo contrario esos efectos financieros nunca ocurren.
export const cancelarCita = async (citaId: string, token: string) => {
  const response = await fetch(`${API_BASE_URL}scheduling/quotes/${citaId}/cancelar`, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${token}` },
  });

  if (!response.ok) {
    throw await buildApiRequestError(response, 'Error al cancelar cita');
  }

  return await response.json();
};

// Finalizar el servicio desde el admin — mismo endpoint que ya usa la
// vista del profesional (attention-protocol.tsx). Marca la cita como
// "finalizado", genera/envía el PDF de la ficha si corresponde, y procesa
// cualquier paquete de sesiones de la cita (crea/redime — ver
// app.scheduling.submodules.quotes.paquetes_helpers en el backend). El
// admin puede necesitarlo si el profesional no lo hizo desde su propia app.
export const finalizarCita = async (citaId: string, token: string) => {
  const response = await fetch(`${API_BASE_URL}scheduling/quotes/citas/${citaId}/finalizar`, {
    method: 'PUT',
    headers: { 'Authorization': `Bearer ${token}` },
  });

  if (!response.ok) {
    throw await buildApiRequestError(response, 'Error al finalizar la cita');
  }

  return await response.json();
};

// Eliminación permanente — solo válida para citas ya canceladas o
// marcadas como "no asistió" (el backend lo re-valida igual).
export const eliminarCita = async (citaId: string, token: string) => {
  const response = await fetch(`${API_BASE_URL}scheduling/quotes/${citaId}`, {
    method: 'DELETE',
    headers: { 'Authorization': `Bearer ${token}` },
  });

  if (!response.ok) {
    throw await buildApiRequestError(response, 'Error al eliminar cita');
  }

  return await response.json();
};

// Corrige el método y/o el monto de un registro ya guardado en
// historial_pagos (por índice) — para cuando recepción se equivoca al
// registrar el pago (método incorrecto o monto mal tipeado). El backend
// recalcula abono/saldo_pendiente/estado_pago cuando cambia el monto, y
// bloquea la corrección si la cita ya fue facturada.
export const corregirPago = async (
  citaId: string,
  indice: number,
  cambios: { metodo?: string; monto?: number },
  token: string
) => {
  const response = await fetch(
    `${API_BASE_URL}scheduling/quotes/${citaId}/pagos/${indice}`,
    {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`,
      },
      body: JSON.stringify(cambios),
    }
  );

  if (!response.ok) {
    throw await buildApiRequestError(response, 'Error al corregir el pago');
  }

  return await response.json();
};
