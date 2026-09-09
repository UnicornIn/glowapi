// services/clientsService.ts
import { API_BASE_URL } from "../../types/config";

export interface Cliente {
  _id?: string;
  cliente_id: string;
  nombre: string;
  correo?: string;
  telefono?: string;
  cedula?: string;
  ciudad?: string;
  fecha_de_nacimiento?: string;
  sede_id: string;
  notas?: string;
  fecha_creacion?: string;
  notas_historial?: NotaCliente[];
}

export interface NotaCliente {
  contenido: string;
  fecha?: string;
  autor?: string;
}

export interface CrearClienteRequest {
  nombre: string;
  correo?: string;
  telefono?: string;
  cedula?: string;
  ciudad?: string;
  fecha_de_nacimiento?: string;
  sede_id?: string;
  notas?: string;
}

export interface ClienteBusqueda {
  id: string;
  cliente_id: string;
  nombre: string;
  correo: string;
  cedula: string;
  telefono: string;
  sede_id: string;
  franquicia_id: string;
}

const DEFAULT_LIMIT = 15;

export async function buscarCliente(
  termino: string,
  token: string,
  sedeId?: string
): Promise<ClienteBusqueda[]> {
  if (termino.trim().length < 2) return [];

  const headers: Record<string, string> = {
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
  };

  const activeSede =
    sedeId ??
    sessionStorage.getItem("beaux-sede_id") ??
    localStorage.getItem("beaux-sede_id");
  if (activeSede) headers["X-Sede-Id"] = activeSede;

  const res = await fetch(
    `${API_BASE_URL}clientes/buscar?filtro=${encodeURIComponent(termino.trim())}&limite=15`,
    { headers }
  );

  if (!res.ok) {
    if (res.status === 400) return [];
    throw new Error("Error buscando cliente");
  }

  const data = await res.json();
  return Array.isArray(data) ? (data as ClienteBusqueda[]) : [];
}

const withOptionalField = (
  payload: Record<string, string>,
  key: string,
  value?: string
) => {
  const normalized = value?.trim();
  if (normalized) {
    payload[key] = normalized;
  }
};

const buildCrearClientePayload = (clienteData: CrearClienteRequest): Record<string, string> => {
  const nombre = clienteData.nombre?.trim();
  if (!nombre) {
    throw new Error("El nombre del cliente es requerido");
  }

  const payload: Record<string, string> = { nombre };
  withOptionalField(payload, "correo", clienteData.correo);
  withOptionalField(payload, "telefono", clienteData.telefono);
  withOptionalField(payload, "cedula", clienteData.cedula);
  withOptionalField(payload, "ciudad", clienteData.ciudad);
  withOptionalField(payload, "fecha_de_nacimiento", clienteData.fecha_de_nacimiento);
  withOptionalField(payload, "sede_id", clienteData.sede_id);
  withOptionalField(payload, "notas", clienteData.notas);

  return payload;
};

const resolveSedeId = (value?: string): string | undefined => {
  const normalized = value?.trim();
  return normalized ? normalized : undefined;
};

const normalizarCliente = (c: any): Cliente => ({
  _id: c._id,
  cliente_id: c.cliente_id || c.id || c._id,
  nombre: c.nombre || "",
  correo: c.email || c.correo,
  telefono: c.telefono,
  cedula: c.cedula,
  ciudad: c.ciudad,
  fecha_de_nacimiento: c.fecha_de_nacimiento,
  sede_id: c.sede_id || "",
  notas: c.nota || c.notas,
  fecha_creacion: c.fecha_creacion,
  notas_historial: c.notas_historial,
});


// Búsqueda con debounce recomendado de 300ms — respuesta es array directo
export async function buscarClientesRapidFuzz(
  token: string,
  filtro?: string,
  limite: number = 20
): Promise<Cliente[]> {
  try {
    const url = new URL(`${API_BASE_URL}clientes/buscar`);
    const q = filtro?.trim();
    if (q) url.searchParams.set("filtro", q);
    url.searchParams.set("limite", String(Math.min(Math.max(limite, 1), 100)));

    const res = await fetch(url.toString(), {
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      credentials: "include",
    });

    if (!res.ok) throw new Error(`Error ${res.status}`);
    const data = await res.json();
    return (Array.isArray(data) ? data : []).map(normalizarCliente);
  } catch (error) {
    console.error("❌ Error en buscarClientesRapidFuzz:", error);
    return [];
  }
}

// Busca clientes usando /clientes/buscar — respuesta es array directo, sin analytics
export async function buscarClientes(
  token: string,
  filtro?: string,
  _limite: number = DEFAULT_LIMIT
): Promise<Cliente[]> {
  try {
    if (!filtro?.trim() || filtro.trim().length < 2) return [];
    const results = await buscarCliente(filtro.trim(), token);
    return results.map(normalizarCliente);
  } catch (error) {
    console.error("❌ Error buscando clientes:", error);
    return [];
  }
}

export async function buscarClientesPorSede(
  token: string,
  sedeId: string,
  filtro?: string,
  _limite: number = DEFAULT_LIMIT
): Promise<Cliente[]> {
  try {
    if (!filtro?.trim() || filtro.trim().length < 2) return [];
    const results = await buscarCliente(filtro.trim(), token, sedeId);
    return results.map(normalizarCliente);
  } catch (error) {
    console.error("❌ Error buscando clientes por sede:", error);
    return [];
  }
}

// 🔥 BUSCAR CON DEBOUNCE — incluye protección contra race conditions
let _debounceTimer: ReturnType<typeof setTimeout> | null = null;
let _activeSearchId = 0;

export function buscarClientesConDebounce(
  token: string,
  filtro: string,
  callback: (clientes: Cliente[]) => void,
  delay: number = 300
): void {
  if (_debounceTimer) clearTimeout(_debounceTimer);

  const searchId = ++_activeSearchId;

  _debounceTimer = setTimeout(async () => {
    try {
      const resultados = await buscarClientes(token, filtro, 50);
      // Solo actualizar la UI si sigue siendo la búsqueda más reciente
      if (searchId === _activeSearchId) {
        callback(resultados);
      }
    } catch (error) {
      console.error("❌ Error en búsqueda con debounce:", error);
      if (searchId === _activeSearchId) {
        callback([]);
      }
    }
  }, delay);
}

// 🔥 CREAR NUEVO CLIENTE
export async function crearCliente(token: string, clienteData: CrearClienteRequest): Promise<{success: boolean; cliente: Cliente}> {
  try {
    const payload = buildCrearClientePayload(clienteData);
    const sedeId = resolveSedeId(clienteData.sede_id);
    console.log('🔄 Creando nuevo cliente:', payload);
    const res = await fetch(`${API_BASE_URL}clientes/`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
        ...(sedeId ? { 'X-Sede-Id': sedeId } : {}),
      },
      credentials: "include",
      body: JSON.stringify(payload),
    });
    
    if (!res.ok) {
      const raw = await res.text().catch(() => "");
      let message = `Error ${res.status} al crear cliente`;

      if (raw) {
        try {
          const parsed = JSON.parse(raw);
          message = parsed?.detail || parsed?.message || raw;
        } catch {
          message = raw;
        }
      }

      throw new Error(message);
    }
    
    const data = await res.json();
    console.log('✅ Cliente creado exitosamente');
    return data;
  } catch (error) {
    console.error('❌ Error creando cliente:', error);
    throw error;
  }
}

// 🔥 OBTENER CLIENTE POR ID
export async function getClientePorId(token: string, clienteId: string): Promise<Cliente> {
  try {
    const res = await fetch(`${API_BASE_URL}clientes/${clienteId}`, {
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      credentials: "include",
    });
    
    if (!res.ok) throw new Error("Error al cargar cliente");
    const data = await res.json();
    return data;
  } catch (error) {
    console.error('❌ Error cargando cliente:', error);
    throw error;
  }
}

// 🔥 ACTUALIZAR CLIENTE
export async function actualizarCliente(token: string, clienteId: string, clienteData: Partial<CrearClienteRequest>): Promise<{success: boolean; msg: string}> {
  try {
    const res = await fetch(`${API_BASE_URL}clientes/${clienteId}`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      credentials: "include",
      body: JSON.stringify(clienteData),
    });
    
    if (!res.ok) {
      const errorData = await res.json();
      throw new Error(errorData.detail || "Error al actualizar cliente");
    }
    
    const data = await res.json();
    return data;
  } catch (error) {
    console.error('❌ Error actualizando cliente:', error);
    throw error;
  }
}

// 🔥 AGREGAR NOTA A CLIENTE
export async function agregarNotaCliente(token: string, clienteId: string, nota: string): Promise<{success: boolean; msg: string}> {
  try {
    const res = await fetch(`${API_BASE_URL}clientes/${clienteId}/notas`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      credentials: "include",
      body: JSON.stringify({ contenido: nota }),
    });
    
    if (!res.ok) {
      const errorData = await res.json();
      throw new Error(errorData.detail || "Error al agregar nota");
    }
    
    const data = await res.json();
    return data;
  } catch (error) {
    console.error('❌ Error agregando nota:', error);
    throw error;
  }
}

// Paquete de sesiones prepagas (ej. "5 sesiones de Terapia individual piso
// pélvico") que el cliente compró — lo crea automáticamente el backend al
// facturar una cita que compra un paquete. Usado en "Nueva Cita" para
// ofrecer "usar sesión del paquete" cuando el servicio elegido tiene saldo
// disponible.
export interface PagoPaquete {
  fecha: string;
  monto: number;
  metodo: string;
  tipo: "abono_inicial" | "pago_completo" | "pago_adicional";
  registrado_por: string;
  saldo_despues: number;
  notas?: string | null;
  corregido_por?: string;
  corregido_en?: string;
}

export interface PaqueteCliente {
  paquete_id: string;
  cliente_id: string;
  servicio_id: string;
  nombre_servicio: string;
  sesiones_totales: number;
  sesiones_usadas: number;
  sesiones_restantes: number;
  valor_por_sesion: number;
  moneda: string;
  activo: boolean;
  // Ledger de pago del paquete (Fase 3) — abono es el único campo real
  // guardado; valor_total/saldo_pendiente/estado_pago los calcula siempre
  // el backend al vuelo (ver _enriquecer_paquete_con_pago).
  abono: number;
  valor_total: number;
  saldo_pendiente: number;
  estado_pago: "pendiente" | "abonado" | "pagado";
  historial_pagos: PagoPaquete[];
}

export async function getPaquetesCliente(token: string, clienteId: string): Promise<PaqueteCliente[]> {
  try {
    const res = await fetch(`${API_BASE_URL}clientes/${clienteId}/paquetes`, {
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      credentials: "include",
    });

    if (!res.ok) return [];
    const data = await res.json();
    return Array.isArray(data) ? data : [];
  } catch (error) {
    console.error('❌ Error cargando paquetes del cliente:', error);
    return [];
  }
}

// Un paquete puntual, con su abono/historial_pagos actuales — usado por la
// pestaña "Pagos" de una cita ligada a un paquete (a diferencia de
// getPaquetesCliente, incluye paquetes ya agotados/inactivos).
export async function getPaquetePorId(token: string, paqueteId: string): Promise<PaqueteCliente | null> {
  try {
    const res = await fetch(`${API_BASE_URL}clientes/paquetes/${paqueteId}`, {
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      credentials: "include",
    });
    if (!res.ok) return null;
    return await res.json();
  } catch (error) {
    console.error('❌ Error cargando el paquete:', error);
    return null;
  }
}

// Registra un abono/pago contra el PAQUETE completo — se puede llamar
// desde cualquier cita que pertenezca a ese paquete, todas ven el mismo
// abonado/historial acumulado (ver Backend: registrar_pago_paquete).
export async function registrarPagoPaquete(
  token: string,
  paqueteId: string,
  pagoData: { monto: number; metodo: string; notas?: string },
): Promise<PaqueteCliente> {
  const res = await fetch(`${API_BASE_URL}clientes/paquetes/${paqueteId}/pago`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(pagoData),
  });
  if (!res.ok) {
    const errorData = await res.json().catch(() => null);
    throw new Error(errorData?.detail || 'Error al registrar el pago del paquete');
  }
  return await res.json();
}

// Corrige un pago ya registrado contra un paquete (índice en su propio
// historial_pagos) — mismo criterio que corregirPago de citas.
export async function corregirPagoPaquete(
  token: string,
  paqueteId: string,
  indice: number,
  cambios: { metodo?: string; monto?: number },
): Promise<PaqueteCliente> {
  const res = await fetch(`${API_BASE_URL}clientes/paquetes/${paqueteId}/pagos/${indice}`, {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(cambios),
  });
  if (!res.ok) {
    const errorData = await res.json().catch(() => null);
    throw new Error(errorData?.detail || 'Error al corregir el pago del paquete');
  }
  return await res.json();
}

// 🔥 OBTENER HISTORIAL DE CLIENTE
export async function getHistorialCliente(token: string, clienteId: string): Promise<any[]> {
  try {
    const res = await fetch(`${API_BASE_URL}clientes/${clienteId}/historial`, {
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      credentials: "include",
    });
    
    if (!res.ok) throw new Error("Error al cargar historial del cliente");
    const data = await res.json();
    return data || [];
  } catch (error) {
    console.error('❌ Error cargando historial:', error);
    throw error;
  }
}
