import { API_BASE_URL } from "../../types/config";
// Removí el import no usado: import { useAuth } from "../../context/AuthContext";

export interface Servicio {
  _id: string;
  servicio_id?: string;
  nombre: string;
  descripcion?: string;
  duracion: number;
  precio: number;
  precio_local?: number;
  moneda_local?: string;
  estado: string;
  duracion_minutos: number;
  comision_estilista?: number | null;
  categoria?: string;
  requiere_producto?: boolean;
  activo?: boolean;
  creado_por?: string;
  created_at?: string;
  updated_at?: string;
  precios_completos?: Record<string, number>;
  sede_id?: string | null; // 🔥 CAMBIO: Permitir string | null | undefined
  codigo_referencia?: string;
  // Paquetes de sesiones prepagas de este mismo servicio (ej. "5 sesiones
  // por 750.000") — opciones de precio/cantidad, no un servicio aparte.
  paquetes_sesiones?: { sesiones: number; precio: number }[];
}

// 🔥 INTERFAZ PARA DATOS DE SERVICIO DE LA API
interface ServicioAPI {
  _id: string;
  servicio_id?: string;
  nombre: string;
  duracion_minutos: number;
  precios: Record<string, number>;
  comision_estilista?: number;
  categoria?: string;
  requiere_producto?: boolean;
  activo?: boolean;
  sede_id?: string;
  creado_por?: string;
  created_at?: string;
  updated_at?: string;
  paquetes_sesiones?: { sesiones: number; precio: number }[];
}

// 🔥 INTERFAZ PARA SERVICIOS DE EJEMPLO
interface ServicioEjemplo {
  codigo: string;
  nombre: string;
  duracion: number;
  categoria: string;
  precio: number;
  requiere_producto: boolean;
}

// 🔥 LISTA COMPLETA DE TODOS LOS SERVICIOS DE GUAYAQUIL (22 servicios)
const TODOS_SERVICIOS_GUAYAQUIL: ServicioEjemplo[] = [
  { codigo: '1687644', nombre: 'PEINADOS O TRENZADOS', duracion: 40, categoria: 'Peinados', precio: 5, requiere_producto: false },
  { codigo: '1542486', nombre: 'SERVICIO EXPRESS', duracion: 90, categoria: 'Express', precio: 35, requiere_producto: false },
  { codigo: '1128696', nombre: 'COLOR', duracion: 120, categoria: 'Color', precio: 300, requiere_producto: false },
  { codigo: '736672', nombre: 'TRANSICION D MEDIA - EX ALTA', duracion: 180, categoria: 'Transición', precio: 60, requiere_producto: false },
  { codigo: '736667', nombre: 'TRANSICIÓN D EXB - MEDIA', duracion: 105, categoria: 'Transición', precio: 30, requiere_producto: false },
  { codigo: '736662', nombre: 'COMPLETO EX ALTA', duracion: 180, categoria: 'Completo', precio: 70, requiere_producto: false },
  { codigo: '736660', nombre: 'COMPLETO ALTA', duracion: 120, categoria: 'Completo', precio: 60, requiere_producto: false },
  { codigo: '736658', nombre: 'COMPLETO MEDIA', duracion: 90, categoria: 'Completo', precio: 50, requiere_producto: false },
  { codigo: '736656', nombre: 'COMPLETO BAJA', duracion: 75, categoria: 'Completo', precio: 40, requiere_producto: false },
  { codigo: '736651', nombre: 'COMPLETO EX BAJA', duracion: 60, categoria: 'Completo', precio: 30, requiere_producto: false },
  { codigo: '736648', nombre: 'OZONOTERAPIA', duracion: 60, categoria: 'Tratamientos', precio: 35, requiere_producto: true },
  { codigo: '736647', nombre: 'HIDRATACION D ALTA-E ALTA', duracion: 70, categoria: 'Tratamientos', precio: 35, requiere_producto: true },
  { codigo: '736646', nombre: 'HIDRATACION D BAJA-MEDIA', duracion: 60, categoria: 'Tratamientos', precio: 25, requiere_producto: true },
  { codigo: '736645', nombre: 'NUTRICION D ALTA-E TALTA', duracion: 70, categoria: 'Tratamientos', precio: 35, requiere_producto: true },
  { codigo: '736644', nombre: 'NUTRICION CAPILAR D BAJA-MEDIA', duracion: 60, categoria: 'Tratamientos', precio: 25, requiere_producto: true },
  { codigo: '736643', nombre: 'DEFINICION EA', duracion: 180, categoria: 'Definición', precio: 60, requiere_producto: true },
  { codigo: '736642', nombre: 'DEFINICION DA', duracion: 120, categoria: 'Definición', precio: 50, requiere_producto: true },
  { codigo: '736639', nombre: 'DEFINICION DM', duracion: 90, categoria: 'Definición', precio: 40, requiere_producto: true },
  { codigo: '736637', nombre: 'DEFINICION DB', duracion: 75, categoria: 'Definición', precio: 30, requiere_producto: true },
  { codigo: '736634', nombre: 'DEFINICION EB', duracion: 60, categoria: 'Definición', precio: 20, requiere_producto: true },
  { codigo: '736625', nombre: 'CORTE DE FORMA', duracion: 50, categoria: 'Corte', precio: 25, requiere_producto: true },
  { codigo: '736534', nombre: 'CORTE DE PUNTAS', duracion: 40, categoria: 'Corte', precio: 20, requiere_producto: true }
];

// 🔥 OBTENER LA MONEDA DE LA SEDE ACTUAL
function getMonedaSede(): string {
  const monedaSede = localStorage.getItem('beaux-moneda') || sessionStorage.getItem('beaux-moneda');
  return monedaSede || 'USD'; // Default a USD si no hay moneda
}

// 🔥 FUNCIÓN AUXILIAR PARA OBTENER PRECIO SEGÚN MONEDA
// Antes solo reconocía COP/MXN explícitos y caía a USD para cualquier otra
// moneda (incl. BOB) — si el servicio no tenía precio en USD cargado (como
// "prueba servicio", solo con BOB), devolvía 0 en vez del precio real.
// Ahora busca primero la moneda real de la sede en el mapa, sin importar
// cuál sea, y solo cae a USD / la primera moneda disponible como fallback.
function obtenerPrecioPorMoneda(
  precios: Record<string, number>,
  monedaSede: string
): { precio: number; moneda: string } {
  if (precios[monedaSede] !== undefined && precios[monedaSede] !== null) {
    return { precio: precios[monedaSede], moneda: monedaSede };
  }

  if (precios.USD !== undefined && precios.USD !== null) {
    return { precio: precios.USD, moneda: 'USD' };
  }

  const primeraMoneda = Object.keys(precios)[0];
  if (primeraMoneda !== undefined) {
    return { precio: precios[primeraMoneda], moneda: primeraMoneda };
  }

  // Si de verdad no hay ningún precio cargado, sí es 0.
  return { precio: 0, moneda: monedaSede };
}

// 🔥 FUNCIÓN PRINCIPAL: Obtener servicios según la sede
export async function getServicios(token: string): Promise<Servicio[]> {
  try {
    // 🔥 OBTENER LA SEDE DESDE EL STORAGE O AUTH CONTEXT
    const sedeId = localStorage.getItem('beaux-sede_id') || sessionStorage.getItem('beaux-sede_id');
    const nombreLocal = localStorage.getItem('beaux-nombre_local') || sessionStorage.getItem('beaux-nombre_local');
    const monedaSede = getMonedaSede();
    
    console.log(`📍 Sede actual: ${sedeId} - ${nombreLocal}`);
    console.log(`💰 Moneda de la sede: ${monedaSede}`);
    
    // 🔥 VERIFICAR SI ES GUAYAQUIL
    const esGuayaquil = sedeId === 'SD-28080' || 
                        nombreLocal?.toLowerCase().includes('guayaquil') ||
                        nombreLocal === 'RF GUAYAQUIL';
    
    if (!esGuayaquil) {
      console.log('📍 No es Guayaquil, obteniendo servicios normales de la API');
      return await getServiciosNormales(token, sedeId || undefined, monedaSede); // 🔥 Pasar monedaSede
    }
    
    console.log('📍 Es Guayaquil, usando servicios EXCLUSIVOS');
    return await getServiciosExclusivosGuayaquil(token, sedeId || undefined, monedaSede); // 🔥 Pasar monedaSede
    
  } catch (error) {
    console.error('❌ Error en getServicios:', error);
    return [];
  }
}

// 🔥 FUNCIÓN PARA OBTENER SERVICIOS NORMALES (para sedes que NO son Guayaquil)
async function getServiciosNormales(token: string, sedeId?: string, monedaSede: string = 'USD'): Promise<Servicio[]> {
  try {
    let url = `${API_BASE_URL}admin/servicios/`;
    
    // Si hay sedeId, agregarlo como parámetro
    if (sedeId) {
      url += `?sede_id=${sedeId}`;
    }
    
    console.log('📍 Obteniendo servicios normales desde:', url);
    console.log(`💰 Mostrando precios en moneda: ${monedaSede}`);
    
    const res = await fetch(url, {
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      credentials: "include",
    });
    
    if (!res.ok) {
      console.error(`❌ Error HTTP ${res.status}:`, res.statusText);
      throw new Error(`Error ${res.status} al cargar servicios`);
    }
    
    const serviciosData: ServicioAPI[] = await res.json();
    console.log('📦 Servicios normales obtenidos de API:', serviciosData.length);
    
    // Procesar los servicios de la API
    const serviciosProcesados: Servicio[] = serviciosData.map((servicio: ServicioAPI) => {
      // Usar la función auxiliar para obtener el precio según la moneda
      const { precio: precioFinal, moneda: monedaParaUsuario } = obtenerPrecioPorMoneda(
        servicio.precios || { USD: 0 },
        monedaSede
      );
      
      console.log(`💰 ${servicio.nombre}: ${precioFinal} ${monedaParaUsuario} (precios disponibles: ${JSON.stringify(servicio.precios)})`);
      
      return {
        _id: servicio._id,
        servicio_id: servicio.servicio_id || servicio._id,
        nombre: servicio.nombre,
        descripcion: servicio.categoria || '',
        duracion: servicio.duracion_minutos || 30,
        duracion_minutos: servicio.duracion_minutos || 30,
        precio: precioFinal,
        precio_local: precioFinal,
        moneda_local: monedaParaUsuario,
        estado: servicio.activo ? 'activo' : 'inactivo',
        comision_estilista: servicio.comision_estilista || 0,
        categoria: servicio.categoria || 'General',
        requiere_producto: servicio.requiere_producto || false,
        activo: servicio.activo !== undefined ? servicio.activo : true,
        creado_por: servicio.creado_por,
        created_at: servicio.created_at,
        updated_at: servicio.updated_at,
        sede_id: servicio.sede_id || sedeId || null,
        precios_completos: servicio.precios || { USD: precioFinal },
        paquetes_sesiones: servicio.paquetes_sesiones
      };
    });

    console.log('✅ Servicios normales procesados:', serviciosProcesados.length);
    
    // Mostrar resumen de precios
    console.log('💰 === RESUMEN DE PRECIOS POR MONEDA ===');
    const serviciosPorMoneda = serviciosProcesados.reduce((acc, servicio) => {
      const moneda = servicio.moneda_local || 'USD';
      acc[moneda] = (acc[moneda] || 0) + 1;
      return acc;
    }, {} as Record<string, number>);
    
    Object.entries(serviciosPorMoneda).forEach(([moneda, cantidad]) => {
      console.log(`   ${moneda}: ${cantidad} servicios`);
    });
    console.log('========================================');
    
    return serviciosProcesados;
    
  } catch (error) {
    console.error('❌ Error en getServiciosNormales:', error);
    return [];
  }
}

// 🔥 FUNCIÓN PARA OBTENER SERVICIOS EXCLUSIVOS DE GUAYAQUIL
async function getServiciosExclusivosGuayaquil(token: string, sedeId?: string, monedaSede: string = 'USD'): Promise<Servicio[]> {
  try {
    // 🔥 URL usando el endpoint específico
    const url = `${API_BASE_URL}scheduling/services/?sede_id=${sedeId || 'SD-28080'}`;
    
    console.log('📍 Obteniendo servicios EXCLUSIVOS de Guayaquil desde:', url);
    console.log(`💰 Mostrando precios en moneda: ${monedaSede}`);
    
    const res = await fetch(url, {
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      credentials: "include",
    });
    
    if (!res.ok) {
      console.error(`❌ Error HTTP ${res.status}:`, res.statusText);
      throw new Error(`Error ${res.status} al cargar servicios exclusivos de Guayaquil`);
    }
    
    const serviciosData: ServicioAPI[] = await res.json();
    console.log('📦 Servicios obtenidos de API:', serviciosData.length);
    
    let serviciosProcesados: Servicio[] = [];
    
    if (serviciosData.length === 0) {
      console.warn('⚠️ La API no devolvió servicios, usando lista completa de servicios');
      return crearServiciosExclusivosGuayaquil(monedaSede);
    }
    
    // 🔥 PROCESAR LOS SERVICIOS DE LA API
    serviciosProcesados = serviciosData.map((servicio: ServicioAPI) => {
      // Usar la función auxiliar para obtener el precio según la moneda
      const { precio: precioFinal, moneda: monedaParaUsuario } = obtenerPrecioPorMoneda(
        servicio.precios || { USD: 0 },
        monedaSede
      );
      
      // 🔥 BUSCAR EL CÓDIGO EN NUESTRA LISTA COMPLETA
      const servicioCompleto = TODOS_SERVICIOS_GUAYAQUIL.find(s => 
        s.nombre.toLowerCase() === servicio.nombre.toLowerCase()
      );
      
      const codigoRef = servicioCompleto ? servicioCompleto.codigo : '';
      
      console.log(`💰 ${servicio.nombre}: ${precioFinal} ${monedaParaUsuario}`);
      
      return {
        _id: servicio._id,
        servicio_id: servicio.servicio_id || servicio._id,
        codigo_referencia: codigoRef,
        nombre: servicio.nombre,
        descripcion: servicio.categoria || '',
        duracion: servicio.duracion_minutos || 30,
        duracion_minutos: servicio.duracion_minutos || 30,
        precio: precioFinal,
        precio_local: precioFinal,
        moneda_local: monedaParaUsuario,
        estado: servicio.activo ? 'activo' : 'inactivo',
        comision_estilista: servicio.comision_estilista || 0,
        categoria: servicio.categoria || 'General',
        requiere_producto: servicio.requiere_producto || false,
        activo: servicio.activo !== undefined ? servicio.activo : true,
        creado_por: servicio.creado_por,
        created_at: servicio.created_at,
        updated_at: servicio.updated_at,
        sede_id: servicio.sede_id || sedeId || null,
        precios_completos: servicio.precios || { USD: precioFinal },
        paquetes_sesiones: servicio.paquetes_sesiones
      };
    });

    // 🔥 VERIFICAR SI FALTAN SERVICIOS
    const nombresApi = serviciosData.map(s => s.nombre.toLowerCase());
    const serviciosFaltantes = TODOS_SERVICIOS_GUAYAQUIL.filter(s => 
      !nombresApi.includes(s.nombre.toLowerCase())
    );
    
    if (serviciosFaltantes.length > 0) {
      console.warn(`⚠️ Faltan ${serviciosFaltantes.length} servicios en la API:`);
      serviciosFaltantes.forEach(s => {
        console.log(`   ❌ ${s.nombre} (${s.codigo})`);
      });
      
      // 🔥 AÑADIR LOS SERVICIOS FALTANTES
      const serviciosFaltantesProcesados: Servicio[] = serviciosFaltantes.map(servicio => {
        // Convertir precio según moneda de la sede
        let precioConvertido = servicio.precio;
        
        if (monedaSede === 'COP') {
          precioConvertido = servicio.precio * 4000; // Conversión USD a COP
        } else if (monedaSede === 'MXN') {
          precioConvertido = servicio.precio * 18; // Conversión USD a MXN
        }
        
        return {
          _id: `faltante-${servicio.codigo}`,
          servicio_id: `SV-${servicio.codigo}`,
          codigo_referencia: servicio.codigo,
          nombre: servicio.nombre,
          descripcion: `${servicio.categoria} - Servicio EXCLUSIVO Guayaquil`,
          duracion: servicio.duracion,
          duracion_minutos: servicio.duracion,
          precio: precioConvertido,
          precio_local: precioConvertido,
          moneda_local: monedaSede,
          estado: 'activo',
          categoria: servicio.categoria,
          requiere_producto: servicio.requiere_producto,
          activo: true,
          comision_estilista: 0,
          creado_por: 'sistema-guayaquil-completo',
          sede_id: sedeId || 'SD-28080' || null,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
          precios_completos: { 
            USD: servicio.precio,
            COP: servicio.precio * 4000,
            MXN: servicio.precio * 18
          }
        };
      });
      
      serviciosProcesados = [...serviciosProcesados, ...serviciosFaltantesProcesados];
    }
    
    console.log('🎯 Total servicios procesados para Guayaquil:', serviciosProcesados.length, '(22 esperados)');
    
    // 🔥 MOSTRAR TODOS LOS SERVICIOS
    console.log('📋 === SERVICIOS COMPLETOS GUAYAQUIL (22 servicios) ===');
    serviciosProcesados.forEach((servicio, index) => {
      const ref = servicio.codigo_referencia ? `[${servicio.codigo_referencia}]` : '[SIN CODIGO]';
      console.log(`${index + 1}. ${ref} ${servicio.nombre} - ${servicio.moneda_local} ${servicio.precio} - ${servicio.duracion}min - ${servicio.categoria}`);
    });
    console.log('=======================================================');
    
    return serviciosProcesados;
    
  } catch (error) {
    console.error('❌ Error en getServiciosExclusivosGuayaquil:', error);
    
    // 🔥 EN CASO DE ERROR, CREAR TODOS LOS SERVICIOS
    console.log('🚧 Creando TODOS los servicios EXCLUSIVOS de Guayaquil...');
    return crearServiciosExclusivosGuayaquil(monedaSede);
  }
}

// 🔥 FUNCIÓN PARA CREAR TODOS LOS SERVICIOS (actualizada para usar moneda)
function crearServiciosExclusivosGuayaquil(monedaSede: string = 'USD'): Servicio[] {
  return TODOS_SERVICIOS_GUAYAQUIL.map((servicio: ServicioEjemplo) => {
    // Convertir precio según moneda de la sede
    let precioConvertido = servicio.precio;
    
    if (monedaSede === 'COP') {
      precioConvertido = servicio.precio * 4000; // Conversión USD a COP
    } else if (monedaSede === 'MXN') {
      precioConvertido = servicio.precio * 18; // Conversión USD a MXN
    }
    
    return {
      _id: `guayaquil-exclusivo-${servicio.codigo}`,
      servicio_id: `SV-${servicio.codigo}`,
      codigo_referencia: servicio.codigo,
      nombre: servicio.nombre,
      descripcion: `${servicio.categoria} - Servicio EXCLUSIVO Guayaquil`,
      duracion: servicio.duracion,
      duracion_minutos: servicio.duracion,
      precio: precioConvertido,
      precio_local: precioConvertido,
      moneda_local: monedaSede,
      estado: 'activo',
      categoria: servicio.categoria,
      requiere_producto: servicio.requiere_producto,
      activo: true,
      comision_estilista: 0,
      creado_por: 'sistema-guayaquil-completo',
      sede_id: 'SD-28080',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      precios_completos: { 
        USD: servicio.precio,
        COP: servicio.precio * 4000,
        MXN: servicio.precio * 18
      }
    };
  });
}

// 🔥 OBTENER SERVICIOS DE UN ESTILISTA
export async function getServiciosEstilista(estilistaId: string, token: string): Promise<Servicio[]> {
  try {
    // 1. Obtener todos los servicios según la sede
    const todosServicios = await getServicios(token);
    
    if (todosServicios.length === 0) {
      return [];
    }
    
    // 2. Obtener el estilista
    const res = await fetch(`${API_BASE_URL}admin/profesionales/${estilistaId}`, {
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      credentials: "include",
    });
    
    if (!res.ok) {
      console.warn('⚠️ No se pudo obtener el estilista, mostrando todos los servicios');
      return todosServicios;
    }
    
    const estilista = await res.json();
    
    // 3. Si el estilista no tiene restricciones, devolver todos
    if (!estilista.servicios_no_presta || !Array.isArray(estilista.servicios_no_presta)) {
      return todosServicios;
    }
    
    // 4. Filtrar servicios que el estilista NO presta
    const serviciosFiltrados = todosServicios.filter((servicio: Servicio) => {
      const servicioId = servicio.servicio_id || servicio._id;
      const codigoRef = servicio.codigo_referencia || '';
      return !estilista.servicios_no_presta.includes(servicioId) && 
             !estilista.servicios_no_presta.includes(codigoRef);
    });
    
    console.log(`👨‍🎨 Estilista ${estilista.nombre}: ${serviciosFiltrados.length} servicios disponibles de ${todosServicios.length}`);
    
    return serviciosFiltrados;
    
  } catch (error) {
    console.error('❌ Error en getServiciosEstilista:', error);
    return [];
  }
}

// 🔥 OBTENER SERVICIO POR CÓDIGO DE REFERENCIA
export async function getServicioPorCodigo(token: string, codigoRef: string): Promise<Servicio | null> {
  try {
    const todosServicios = await getServicios(token);
    const servicio = todosServicios.find((s: Servicio) => 
      s.codigo_referencia === codigoRef || 
      s.servicio_id === codigoRef
    );
    
    return servicio || null;
  } catch (error) {
    console.error('❌ Error en getServicioPorCodigo:', error);
    return null;
  }
}

// 🔥 FORMATEAR PRECIO
export function formatPrice(price: number, currency: string): string {
  if (!price && price !== 0) return 'Precio no disponible';
  const safePrice = Math.round(Number.isFinite(price) ? price : 0);
  
  switch (currency) {
    case 'COP':
      return `$${safePrice.toLocaleString('es-CO', { maximumFractionDigits: 0 })} COP`;
    case 'MXN':
      return `$${safePrice.toLocaleString('es-MX', { maximumFractionDigits: 0 })} MXN`;
    case 'USD':
      return `$${safePrice.toLocaleString('en-US', { maximumFractionDigits: 0 })} USD`;
    default:
      return `$${safePrice.toLocaleString('es-CO', { maximumFractionDigits: 0 })} ${currency}`;
  }
}

// 🔥 OBTENER SÍMBOLO DE MONEDA
export function getCurrencySymbol(currency: string): string {
  switch (currency) {
    case 'COP': return 'COP';
    case 'MXN': return 'MXN';
    case 'USD': return 'USD';
    default: return currency;
  }
}

// 🔥 INTERFAZ PARA CREAR SERVICIO
export interface CreateServicioData {
  nombre: string;
  duracion_minutos: number;
  precios: {
    USD: number;
    COP?: number;
    MXN?: number;
  };
  comision_estilista?: number | null;
  categoria?: string;
  requiere_producto?: boolean;
  activo?: boolean;
  codigo_referencia?: string;
}

// 🔥 CREAR SERVICIO
export async function createServicio(token: string, servicio: CreateServicioData): Promise<any> {
  const response = await fetch(`${API_BASE_URL}admin/servicios/`, {
    method: 'POST',
    headers: {
      'accept': 'application/json',
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`
    },
    body: JSON.stringify({
      nombre: servicio.nombre.trim(),
      duracion_minutos: servicio.duracion_minutos,
      precios: servicio.precios,
      comision_estilista: servicio.comision_estilista,
      categoria: servicio.categoria?.trim() || 'General',
      requiere_producto: servicio.requiere_producto || false,
      activo: servicio.activo !== undefined ? servicio.activo : true
    })
  });

  if (!response.ok) {
    const errorData = await response.json().catch(() => null);
    throw new Error(errorData?.detail || `Error al crear servicio: ${response.statusText}`);
  }

  return await response.json();
}

// 🔥 ACTUALIZAR SERVICIO
export async function updateServicio(token: string, servicioId: string, servicio: Partial<CreateServicioData>): Promise<any> {
  const response = await fetch(`${API_BASE_URL}admin/servicios/${servicioId}`, {
    method: 'PUT',
    headers: {
      'accept': 'application/json',
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`
    },
    body: JSON.stringify({
      ...servicio,
      nombre: servicio.nombre?.trim(),
      categoria: servicio.categoria?.trim() || 'General'
    })
  });

  if (!response.ok) {
    const errorData = await response.json().catch(() => null);
    throw new Error(errorData?.detail || `Error al actualizar servicio: ${response.statusText}`);
  }

  return await response.json();
}

// 🔥 ELIMINAR SERVICIO
export async function deleteServicio(token: string, servicioId: string): Promise<any> {
  const response = await fetch(`${API_BASE_URL}admin/servicios/${servicioId}`, {
    method: 'DELETE',
    headers: {
      'accept': 'application/json',
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`
    }
  });

  if (!response.ok) {
    const errorData = await response.json().catch(() => null);
    throw new Error(errorData?.detail || `Error al eliminar servicio: ${response.statusText}`);
  }

  return await response.json();
}

// 🔥 FUNCIÓN AUXILIAR PARA PROCESAR SERVICIO CON MONEDA
function procesarServicioConMonedaIndividual(servicioData: any): Servicio {
  const monedaSede = getMonedaSede();
  
  // Usar la función auxiliar para obtener el precio según la moneda
  const { precio: precioFinal, moneda: monedaParaUsuario } = obtenerPrecioPorMoneda(
    servicioData.precios || { USD: 0 },
    monedaSede
  );
  
  return {
    _id: servicioData._id,
    servicio_id: servicioData.servicio_id || servicioData._id,
    nombre: servicioData.nombre,
    descripcion: servicioData.categoria || '',
    duracion: servicioData.duracion_minutos || 30,
    duracion_minutos: servicioData.duracion_minutos || 30,
    precio: precioFinal,
    precio_local: precioFinal,
    moneda_local: monedaParaUsuario,
    estado: servicioData.activo ? 'activo' : 'inactivo',
    comision_estilista: servicioData.comision_estilista || null,
    categoria: servicioData.categoria || 'General',
    requiere_producto: servicioData.requiere_producto || false,
    activo: servicioData.activo !== undefined ? servicioData.activo : true,
    creado_por: servicioData.creado_por,
    created_at: servicioData.created_at,
    updated_at: servicioData.updated_at,
    precios_completos: servicioData.precios,
    sede_id: servicioData.sede_id || null,
    paquetes_sesiones: servicioData.paquetes_sesiones
  };
}

// 🔥 OBTENER SERVICIO POR ID
export async function getServicioById(token: string, servicioId: string): Promise<Servicio | null> {
  try {
    const response = await fetch(`${API_BASE_URL}admin/servicios/${servicioId}`, {
      headers: {
        'accept': 'application/json',
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      }
    });

    if (!response.ok) {
      console.error(`❌ Error obteniendo servicio ${servicioId}:`, response.status);
      return null;
    }

    const servicioData = await response.json();
    
    // Procesar según la moneda solicitada
    const servicio = procesarServicioConMonedaIndividual(servicioData);
    return servicio;
    
  } catch (error) {
    console.error('❌ Error en getServicioById:', error);
    return null;
  }
}

// 🔥 HOOK PARA USAR EN COMPONENTES QUE NECESITAN VERIFICAR LA SEDE
export function useEsGuayaquil(): boolean {
  const sedeId = localStorage.getItem('beaux-sede_id') || sessionStorage.getItem('beaux-sede_id');
  const nombreLocal = localStorage.getItem('beaux-nombre_local') || sessionStorage.getItem('beaux-nombre_local');
  
  return sedeId === 'SD-28080' || 
         nombreLocal?.toLowerCase().includes('guayaquil') ||
         nombreLocal === 'RF GUAYAQUIL';
}

// 🔥 HOOK PARA OBTENER LA MONEDA ACTUAL
export function useMonedaActual(): string {
  return getMonedaSede();
}
