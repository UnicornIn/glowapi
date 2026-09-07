import { API_BASE_URL } from "../../../types/config";
import { Service, PaqueteSesionesOpcion } from "../../../types/service";

export interface CreateServiceData {
  nombre: string;
  duracion_minutos: number;
  precios: Record<string, number>;
  categoria?: string;
  requiere_producto?: boolean;
  activo?: boolean;
  paquetes_sesiones?: PaqueteSesionesOpcion[];
}

export interface UpdateServiceData {
  nombre?: string;
  duracion_minutos?: number;
  precios?: Record<string, number>;
  categoria?: string;
  requiere_producto?: boolean;
  activo?: boolean;
  paquetes_sesiones?: PaqueteSesionesOpcion[];
}

export interface ServiceResponse {
  _id: string;
  servicio_id: string;
  nombre: string;
  duracion_minutos: number;
  precios: Record<string, number>;
  categoria?: string;
  requiere_producto: boolean;
  activo: boolean;
  creado_por?: string;
  created_at?: string;
  updated_at?: string;
  paquetes_sesiones?: PaqueteSesionesOpcion[];
}

// 🔥 ACTUALIZADO: Extender el tipo Service para incluir campos adicionales
export interface ServiceWithCurrency extends Service {
  precio_local?: number;
  moneda_local?: string;
  precios_completos?: Record<string, number>;
  servicio_id?: string;
  requiere_producto?: boolean;
}

export const serviciosService = {
  async obtenerServicioPorId(token: string, servicioId: string): Promise<ServiceResponse | null> {
    const response = await fetch(`${API_BASE_URL}admin/servicios/${servicioId}`, {
      method: 'GET',
      headers: {
        'accept': 'application/json',
        'Authorization': `Bearer ${token}`
      }
    });
    if (!response.ok) return null;
    return await response.json();
  },

  async getServicios(token: string, moneda?: string): Promise<ServiceWithCurrency[]> {
    const url = moneda 
      ? `${API_BASE_URL}admin/servicios/?moneda=${moneda}`
      : `${API_BASE_URL}admin/servicios/`;

    const response = await fetch(url, {
      method: 'GET',
      headers: {
        'accept': 'application/json',
        'Authorization': `Bearer ${token}`
      }
    });

    if (!response.ok) {
      throw new Error(`Error al obtener servicios: ${response.statusText}`);
    }

    const data: any[] = await response.json();
    
    console.log('📥 Datos recibidos del backend:', data);
    
    return data.map(servicio => {
      let precioAMostrar = servicio.precio;
      let precioLocal = servicio.precio_local;
      let monedaLocal = servicio.moneda_local || moneda || 'USD';

      if (servicio.precio_local !== undefined) {
        precioAMostrar = servicio.precio_local;
      }
      else if (servicio.precios) {
        // Busca la moneda real de la sede en el mapa (soporta cualquier
        // moneda, no solo COP/MXN/USD) — con el primer valor disponible
        // como fallback si esa moneda puntual no está cargada.
        const precioEnMoneda = moneda ? servicio.precios[moneda] : undefined;
        precioAMostrar = precioEnMoneda ?? Object.values(servicio.precios)[0];
        monedaLocal = precioEnMoneda !== undefined ? moneda! : Object.keys(servicio.precios)[0] || 'USD';
      }

      const servicioConMoneda: ServiceWithCurrency = {
        id: servicio.servicio_id || servicio._id,
        nombre: servicio.nombre,
        descripcion: servicio.categoria || 'Sin descripción',
        precio: precioAMostrar,
        precio_local: precioLocal || precioAMostrar,
        moneda_local: monedaLocal,
        duracion: servicio.duracion_minutos,
        categoria: servicio.categoria || 'General',
        activo: servicio.activo,
        comision_porcentaje: servicio.comision_estilista || 0,
        imagen: this.getDefaultImage(servicio.categoria),
        servicio_id: servicio.servicio_id || servicio._id,
        requiere_producto: servicio.requiere_producto,
        precios_completos: servicio.precios, // 🔥 Asegurar que existe
        paquetes_sesiones: servicio.paquetes_sesiones
      };

      return servicioConMoneda;
    });
  },

  async createServicio(token: string, servicio: CreateServiceData): Promise<ServiceResponse> {
    const requestData = {
      nombre: servicio.nombre.trim(),
      duracion_minutos: servicio.duracion_minutos,
      precios: servicio.precios,
      categoria: servicio.categoria?.trim() || 'General',
      requiere_producto: servicio.requiere_producto || false,
      activo: servicio.activo !== undefined ? servicio.activo : true,
      paquetes_sesiones: servicio.paquetes_sesiones
    };

    console.log('📤 Creando servicio con datos:', requestData);

    const response = await fetch(`${API_BASE_URL}admin/servicios/`, {
      method: 'POST',
      headers: {
        'accept': 'application/json',
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      },
      body: JSON.stringify(requestData)
    });

    if (!response.ok) {
      let errorMessage = `Error ${response.status}: ${response.statusText}`;
      
      try {
        const errorData = await response.json();
        console.error('❌ Error del backend:', errorData);
        
        if (errorData.detail) {
          if (typeof errorData.detail === 'string') {
            errorMessage = errorData.detail;
          } else if (Array.isArray(errorData.detail)) {
            errorMessage = errorData.detail.map((err: any) => {
              const field = err.loc?.[err.loc.length - 1] || 'campo';
              const value = err.input !== undefined ? ` (valor: ${JSON.stringify(err.input)})` : '';
              return `${field}: ${err.msg}${value}`;
            }).join('; ');
          }
        }
      } catch (parseError) {
        console.error('Error parseando respuesta:', parseError);
      }
      
      throw new Error(errorMessage);
    }

    return await response.json();
  },

  async updateServicio(token: string, servicioId: string, servicio: UpdateServiceData): Promise<any> {
    const requestData: any = {
      nombre: servicio.nombre?.trim(),
      duracion_minutos: servicio.duracion_minutos,
      categoria: servicio.categoria?.trim(),
      requiere_producto: servicio.requiere_producto,
      activo: servicio.activo,
      paquetes_sesiones: servicio.paquetes_sesiones
    };

    if (servicio.precios) {
      requestData.precios = servicio.precios;
    }

    console.log('📤 Actualizando servicio:', requestData);

    const response = await fetch(`${API_BASE_URL}admin/servicios/${servicioId}`, {
      method: 'PUT',
      headers: {
        'accept': 'application/json',
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      },
      body: JSON.stringify(requestData)
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => null);
      throw new Error(errorData?.detail || `Error al actualizar servicio: ${response.statusText}`);
    }

    return await response.json();
  },

  async deleteServicio(token: string, servicioId: string): Promise<void> {
    const response = await fetch(`${API_BASE_URL}admin/servicios/${servicioId}`, {
      method: 'DELETE',
      headers: {
        'accept': 'application/json',
        'Authorization': `Bearer ${token}`
      }
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => null);
      throw new Error(errorData?.detail || `Error al eliminar servicio: ${response.statusText}`);
    }
  },

  getDefaultImage(categoria?: string): string {
    const imageMap: { [key: string]: string } = {
      'Cortes': '/pair-of-scissors.png',
      'Coloración': '/diverse-hair-colors.png',
      'Barba': '/beard.jpg',
      'Tratamientos': '/keratin-treatment.jpg',
      'Peinados': '/diverse-hairstyles.png',
      'Manicura': '/manicure.png',
      'Pedicura': '/pedicure.png',
      'Formacion Presencial': '/training.png'
    };
    
    return imageMap[categoria || 'General'] || '/pair-of-scissors.png';
  },

  getMonedaFromPais(pais?: string): string {
    if (!pais) return 'USD';
    
    const countryCurrencyMap: Record<string, string> = {
      'Colombia': 'COP',
      'México': 'MXN',
      'Mexico': 'MXN',
      'Ecuador': 'USD',
      'Perú': 'USD',
      'Chile': 'USD',
      'Argentina': 'USD',
      'Estados Unidos': 'USD',
      'United States': 'USD',
      'USA': 'USD',
    };
    
    return countryCurrencyMap[pais] || 'USD';
  }
};