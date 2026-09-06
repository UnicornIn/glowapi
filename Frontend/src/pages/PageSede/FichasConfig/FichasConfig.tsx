"use client"

// Activar/desactivar qué fichas técnicas ve el equipo, sin deploy.
//
// El backend ya tenía el mecanismo completo (GET /ficha-templates,
// POST/DELETE /admin/ficha-templates) — esta pantalla es la primera UI
// que lo usa. Antes, ocultar/mostrar una ficha significaba editar
// src/config/fichas.ts y desplegar; ahora es un interruptor acá.

import { useEffect, useState } from "react"
import { toast } from "sonner"
import { Loader2 } from "lucide-react"
import { Sidebar } from "../../../components/Layout/Sidebar"
import { fichas as fichasEstaticas, type FichaConfig } from "../../../config/fichas"
import {
  combinarConTemplates,
  guardarFichaTemplate,
  listarFichaTemplates,
} from "../../../lib/fichaTemplates"

export default function FichasConfigPage() {
  const [fichas, setFichas] = useState<FichaConfig[]>(fichasEstaticas)
  const [cargando, setCargando] = useState(true)
  const [guardandoId, setGuardandoId] = useState<string | null>(null)

  useEffect(() => {
    let cancelado = false
    setCargando(true)
    listarFichaTemplates(false)
      .then((templates) => {
        if (!cancelado) setFichas(combinarConTemplates(fichasEstaticas, templates))
      })
      .catch(() => {
        toast.error("No se pudo cargar el estado real de las fichas, mostrando valores por defecto")
      })
      .finally(() => {
        if (!cancelado) setCargando(false)
      })
    return () => { cancelado = true }
  }, [])

  const handleToggle = async (ficha: FichaConfig) => {
    const nuevoEstado = !ficha.enabled
    setGuardandoId(ficha.id)

    // Optimista: refleja el cambio de inmediato, revierte si falla.
    setFichas((prev) =>
      prev.map((f) => (f.id === ficha.id ? { ...f, enabled: nuevoEstado } : f))
    )

    try {
      await guardarFichaTemplate(ficha.id, ficha.titulo, nuevoEstado)
      toast.success(
        nuevoEstado ? `"${ficha.titulo}" activada` : `"${ficha.titulo}" desactivada`,
        { description: "El equipo ya lo ve reflejado, sin necesidad de recargar nada más." }
      )
    } catch (error) {
      setFichas((prev) =>
        prev.map((f) => (f.id === ficha.id ? { ...f, enabled: ficha.enabled } : f))
      )
      toast.error(error instanceof Error ? error.message : "No se pudo guardar el cambio")
    } finally {
      setGuardandoId(null)
    }
  }

  return (
    <div className="flex flex-col h-screen bg-white">
      <Sidebar />
      <main className="flex-1 overflow-y-auto bg-white">
        <div className="max-w-3xl mx-auto px-4 md:px-8 py-8">
          <div className="mb-6">
            <h1 className="text-2xl font-bold text-gray-900">Fichas técnicas</h1>
            <p className="text-sm text-gray-500 mt-1">
              Elige qué fichas puede usar tu equipo al atender una cita. Los cambios
              se aplican de inmediato, sin necesidad de un desarrollador.
            </p>
          </div>

          {cargando ? (
            <div className="flex items-center gap-2 text-sm text-gray-500 py-10 justify-center">
              <Loader2 className="h-4 w-4 animate-spin" />
              Cargando fichas…
            </div>
          ) : (
            <div className="rounded-lg border border-gray-200 divide-y divide-gray-100 bg-white">
              {fichas.map((ficha) => (
                <div key={ficha.id} className="flex items-center justify-between gap-4 px-5 py-4">
                  <div className="min-w-0">
                    <p className="font-medium text-gray-900">{ficha.titulo}</p>
                    <p className="text-sm text-gray-500 mt-0.5">{ficha.descripcion}</p>
                  </div>

                  <button
                    type="button"
                    role="switch"
                    aria-checked={ficha.enabled}
                    disabled={guardandoId === ficha.id}
                    onClick={() => handleToggle(ficha)}
                    className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors disabled:opacity-50 ${
                      ficha.enabled ? "bg-gray-900" : "bg-gray-200"
                    }`}
                  >
                    <span
                      className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                        ficha.enabled ? "translate-x-6" : "translate-x-1"
                      }`}
                    />
                  </button>
                </div>
              ))}
            </div>
          )}

          <p className="text-xs text-gray-400 mt-4">
            Una ficha desactivada no se elimina: el historial de fichas ya creadas de
            ese tipo se conserva, solo deja de ofrecerse para citas nuevas.
          </p>
        </div>
      </main>
    </div>
  )
}
