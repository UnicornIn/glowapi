
"use client"

import { Search } from "lucide-react";

interface ServiceFiltersProps {
  filters: {
    search: string
    categoria: string
    activo: string
  }
  onFiltersChange: (filters: any) => void
  // Categorías reales de los servicios ya cargados — antes esta lista era
  // fija (Cortes, Coloración, Barba...), pensada para peluquería y ajena a
  // lo que este negocio realmente ofrece. Se deriva de los servicios reales
  // en el componente padre, no hay que tocar este archivo si el rubro cambia.
  categorias: string[]
}

export function ServiceFilters({ filters, onFiltersChange, categorias }: ServiceFiltersProps) {
  return (
    <div className="mb-6 space-y-4">
      <div className="relative">
        <Search className="absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-gray-400" />
        <input
          type="text"
          placeholder="Buscar servicios..."
          value={filters.search}
          onChange={(e) => onFiltersChange({ ...filters, search: e.target.value })}
          className="w-full pl-10 pr-3 py-2 text-sm border border-gray-300 focus:outline-none focus:border-gray-400"
        />
      </div>

      <div className="flex gap-2">
        <select
          value={filters.categoria}
          onChange={(e) => onFiltersChange({ ...filters, categoria: e.target.value })}
          className="flex-1 px-3 py-2 text-sm border border-gray-300 focus:outline-none focus:border-gray-400"
        >
          <option value="all">Todas las categorías</option>
          {categorias.map((categoria) => (
            <option key={categoria} value={categoria}>
              {categoria}
            </option>
          ))}
        </select>

        <select
          value={filters.activo}
          onChange={(e) => onFiltersChange({ ...filters, activo: e.target.value })}
          className="flex-1 px-3 py-2 text-sm border border-gray-300 focus:outline-none focus:border-gray-400"
        >
          <option value="all">Todos los estados</option>
          <option value="active">Activos</option>
          <option value="inactive">Inactivos</option>
        </select>
      </div>
    </div>
  )
}