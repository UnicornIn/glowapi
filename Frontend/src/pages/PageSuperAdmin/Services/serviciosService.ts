import { API_BASE_URL } from "../../../types/config";
import { Service, PaqueteSesionesOpcion } from "../../../types/service";
import { getStoredCurrency } from "../../../lib/currency";

export interface CreateServiceData {
  nombre: string;
  duracion_minutos: number;
  precio: number;
  categoria?: string;
  requiere_producto?: boolean;
  activo?: boolean;
  paquetes_sesiones?: PaqueteSesionesOpcion[];
}

export interface UpdateServiceData {
  nombre?: string;
  duracion_minutos?: number;
  precio?: number;
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

  async getServicios(token: string): Promise<Service[]> {
    const response = await fetch(`${API_BASE_URL}admin/servicios/`, {
      method: 'GET',
      headers: {
        'accept': 'application/json',
        'Authorization': `Bearer ${token}`
      }
    });

    if (!response.ok) {
      throw new Error(`Error al obtener servicios: ${response.statusText}`);
    }

    const data: ServiceResponse[] = await response.json();
    const moneda = getStoredCurrency('USD');

    // Transformar la respuesta del backend al formato del frontend.
    // El backend siempre devuelve `precios` (mapa por moneda) — nunca un
    // `precio` plano — así que hay que resolver cuál mostrar según la
    // moneda real de la sede, con el primer valor disponible como fallback
    // para no mostrar $0 si esa moneda puntual no está en el mapa.
    return data.map(servicio => {
      const precios = servicio.precios || {};
      const precio = precios[moneda] ?? Object.values(precios)[0] ?? 0;
      return {
        id: servicio.servicio_id,
        nombre: servicio.nombre,
        descripcion: servicio.categoria || 'Sin descripción', // Usar categoría como descripción
        precio,
        duracion: servicio.duracion_minutos,
        categoria: servicio.categoria || 'General',
        activo: servicio.activo,
        comision_porcentaje: 0,
        imagen: this.getDefaultImage(servicio.categoria),
        // Campos adicionales para compatibilidad
        servicio_id: servicio.servicio_id,
        requiere_producto: servicio.requiere_producto,
        paquetes_sesiones: servicio.paquetes_sesiones
      };
    });
  },

  async createServicio(token: string, servicio: CreateServiceData): Promise<ServiceResponse> {
    const requestData = {
      nombre: servicio.nombre.trim(),
      duracion_minutos: servicio.duracion_minutos,
      // El backend exige `precios` (mapa por moneda), no un `precio` plano.
      precios: { [getStoredCurrency('USD')]: servicio.precio },
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

    // El backend requiere `precios` (mapa por moneda) — un `precio` plano
    // causa 422 (campo faltante). El backend hace `$set` sobre el mapa
    // completo, así que si solo mandáramos la moneda editada se perderían
    // las demás monedas ya cargadas para este servicio (ej. USD global +
    // BOB local) — por eso primero se trae el mapa actual y se fusiona.
    if (servicio.precio !== undefined && servicio.precio !== null) {
      let preciosActuales: Record<string, number> = {};
      try {
        const actual = await this.obtenerServicioPorId(token, servicioId);
        preciosActuales = actual?.precios || {};
      } catch {
        // Si no se puede leer el servicio actual, se sigue con el mapa vacío
        // — peor caso: se pierden otras monedas, pero al menos no falla el 422.
      }
      requestData.precios = { ...preciosActuales, [getStoredCurrency('USD')]: servicio.precio };
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
      'Pedicura': '/pedicure.png'
    };
    
    return imageMap[categoria || 'General'] || '/pair-of-scissors.png';
  }
};