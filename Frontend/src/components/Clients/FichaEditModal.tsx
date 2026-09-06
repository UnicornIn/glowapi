"use client"

// Edición genérica de una ficha técnica ya guardada, reutilizable desde
// Clientes (Sede y SuperAdmin). Es intencionalmente genérica en vez de
// reusar el formulario específico de cada tipo de ficha (FichaColor,
// FichaAsesoriaCorte, etc.): esos componentes viven en el flujo del
// estilista y asumen una `Cita` real (cliente/servicio/sede/estilista de
// la agenda). Aquí solo tenemos la ficha ya guardada, así que se editan
// los campos simples de `datos_especificos` (texto/número/booleano) más
// `estado` y `comentario_interno`, que el backend acepta directamente
// (ver `campos_editables` en `PUT /scheduling/quotes/fichas/{id}`).
//
// Deliberadamente NO edita: fotos, `respuestas` (array de FichaColor) ni
// otros campos anidados — eso queda para una versión futura por tipo de
// ficha si hace falta.

import { useMemo, useState } from "react"
import { X, Loader2, Save } from "lucide-react"
import { toast } from "sonner"
import { API_BASE_URL } from "../../types/config"

interface FichaEditModalProps {
  ficha: Record<string, any>
  token: string
  onClose: () => void
  onSaved: () => void
}

const CAMPOS_OMITIDOS = new Set([
  "respuestas",
  "foto_antes",
  "foto_despues",
  "foto_estado_actual",
  "foto_expectativa",
  "fotos",
  "fotos_antes",
  "fotos_despues",
  "autorizacion_publicacion",
  "firma_profesional",
])

const humanizarLabel = (key: string): string =>
  key
    .replace(/_/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase())

function extraerCamposEditables(datos: Record<string, any> | undefined | null) {
  if (!datos || typeof datos !== "object") return [] as Array<{ key: string; value: string; multilinea: boolean }>

  return Object.entries(datos)
    .filter(([key, value]) => {
      if (CAMPOS_OMITIDOS.has(key)) return false
      if (value === null || value === undefined) return true
      const tipo = typeof value
      return tipo === "string" || tipo === "number" || tipo === "boolean"
    })
    .map(([key, value]) => ({
      key,
      value: value === null || value === undefined ? "" : String(value),
      multilinea: typeof value === "string" && value.length > 60,
    }))
}

export function FichaEditModal({ ficha, token, onClose, onSaved }: FichaEditModalProps) {
  const fichaId: string | undefined = ficha._id || ficha.id
  const datosOriginales = useMemo(
    () => ficha.datos_especificos || ficha.contenido || {},
    [ficha.datos_especificos, ficha.contenido]
  )

  const camposIniciales = useMemo(() => extraerCamposEditables(datosOriginales), [datosOriginales])
  const [campos, setCampos] = useState(camposIniciales)
  const [estado, setEstado] = useState<string>(ficha.estado || "")
  const [comentarioInterno, setComentarioInterno] = useState<string>(ficha.comentario_interno || "")
  const [guardando, setGuardando] = useState(false)

  const actualizarCampo = (key: string, value: string) => {
    setCampos((prev) => prev.map((c) => (c.key === key ? { ...c, value } : c)))
  }

  const handleGuardar = async () => {
    if (!fichaId) {
      toast.error("No se pudo identificar la ficha a editar")
      return
    }

    setGuardando(true)
    try {
      const datosActualizados: Record<string, any> = { ...datosOriginales }
      campos.forEach(({ key, value }) => {
        const original = datosOriginales[key]
        // Conserva el tipo original (número/booleano) en vez de forzar string.
        if (typeof original === "number") {
          const numero = Number(value)
          datosActualizados[key] = Number.isFinite(numero) ? numero : value
        } else if (typeof original === "boolean") {
          datosActualizados[key] = value === "true"
        } else {
          datosActualizados[key] = value
        }
      })

      const cambios: Record<string, any> = { datos_especificos: datosActualizados }
      if (estado.trim()) cambios.estado = estado.trim()
      cambios.comentario_interno = comentarioInterno

      const formData = new FormData()
      formData.append("data", JSON.stringify(cambios))

      const response = await fetch(`${API_BASE_URL}scheduling/quotes/fichas/${fichaId}`, {
        method: "PUT",
        headers: { Authorization: `Bearer ${token}` },
        body: formData,
      })

      if (!response.ok) {
        const detalle = await response.json().catch(() => null)
        throw new Error(detalle?.detail || `Error ${response.status} al guardar la ficha`)
      }

      toast.success("Ficha actualizada")
      onSaved()
      onClose()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "No se pudo guardar la ficha")
    } finally {
      setGuardando(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
      <div className="relative w-full max-w-xl rounded-lg bg-white shadow-lg">
        <div className="sticky top-0 z-10 flex items-center justify-between border-b border-gray-200 bg-white px-6 py-4">
          <div>
            <h2 className="text-lg font-semibold text-gray-900">Editar ficha</h2>
            <p className="text-sm text-gray-500">
              {ficha.servicio_nombre || ficha.servicio || "Ficha técnica"}
              {ficha.fecha_ficha ? ` · ${String(ficha.fecha_ficha).split("T")[0]}` : ""}
            </p>
          </div>
          <button onClick={onClose} disabled={guardando} className="rounded-full p-1 hover:bg-gray-100 disabled:opacity-50">
            <X className="h-5 w-5 text-gray-500" />
          </button>
        </div>

        <div className="max-h-[65vh] overflow-y-auto px-6 py-4 space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="mb-1.5 block text-sm font-medium text-gray-700">Estado</label>
              <input
                type="text"
                value={estado}
                onChange={(e) => setEstado(e.target.value)}
                placeholder="completada, borrador…"
                className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-gray-400 focus:outline-none focus:ring-1 focus:ring-gray-400"
              />
            </div>
          </div>

          <div>
            <label className="mb-1.5 block text-sm font-medium text-gray-700">Comentario interno</label>
            <textarea
              value={comentarioInterno}
              onChange={(e) => setComentarioInterno(e.target.value)}
              rows={2}
              placeholder="Nota interna, no visible para el cliente"
              className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-gray-400 focus:outline-none focus:ring-1 focus:ring-gray-400"
            />
          </div>

          {campos.length > 0 && (
            <div>
              <h3 className="mb-2 text-sm font-medium text-gray-900">Contenido de la ficha</h3>
              <div className="space-y-3">
                {campos.map(({ key, value, multilinea }) => (
                  <div key={key}>
                    <label className="mb-1.5 block text-sm font-medium text-gray-700">
                      {humanizarLabel(key)}
                    </label>
                    {multilinea ? (
                      <textarea
                        value={value}
                        onChange={(e) => actualizarCampo(key, e.target.value)}
                        rows={3}
                        className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-gray-400 focus:outline-none focus:ring-1 focus:ring-gray-400"
                      />
                    ) : (
                      <input
                        type="text"
                        value={value}
                        onChange={(e) => actualizarCampo(key, e.target.value)}
                        className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-gray-400 focus:outline-none focus:ring-1 focus:ring-gray-400"
                      />
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {campos.length === 0 && (
            <p className="text-sm text-gray-500">
              Esta ficha no tiene campos de texto simples para editar aquí. Fotos y
              respuestas de cuestionario no se editan desde esta ventana.
            </p>
          )}
        </div>

        <div className="flex items-center justify-end gap-2 border-t border-gray-200 px-6 py-4">
          <button
            onClick={onClose}
            disabled={guardando}
            className="rounded-md border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
          >
            Cancelar
          </button>
          <button
            onClick={handleGuardar}
            disabled={guardando}
            className="flex items-center gap-2 rounded-md bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-gray-800 disabled:opacity-50"
          >
            {guardando ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
            Guardar cambios
          </button>
        </div>
      </div>
    </div>
  )
}
