"use client";

import { useState, useEffect } from "react";
import { X, Loader, Plus, Trash2 } from "lucide-react";
import { toast } from 'sonner';
import type { Service, PaqueteSesionesOpcion } from "../../../types/service";

interface ServiceFormModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSave: (service: Service) => void;
  service: Service | null;
  allServices?: Service[];
  isSaving?: boolean;
}

// Fila en edición: números pueden quedar vacíos mientras se tipea, se
// validan recién al guardar (mismo criterio que precio/duración arriba).
interface PaqueteDraft {
  sesiones: number | undefined;
  precio: number | undefined;
}

export function ServiceFormModal({
  isOpen,
  onClose,
  onSave,
  service,
  isSaving = false,
}: ServiceFormModalProps) {
  const [formData, setFormData] = useState<Partial<Service>>({
    nombre: "",
    descripcion: "",
    categoria: "",
    activo: true,
  });
  const [paquetesDraft, setPaquetesDraft] = useState<PaqueteDraft[]>([]);

  useEffect(() => {
    if (service) {
      setFormData(service);
      setPaquetesDraft(
        (service.paquetes_sesiones || []).map((p) => ({ sesiones: p.sesiones, precio: p.precio }))
      );
    } else {
      setFormData({
        nombre: "",
        descripcion: "",
        categoria: "",
        activo: true,
      });
      setPaquetesDraft([]);
    }
  }, [service, isOpen]);

  const addPaqueteRow = () => setPaquetesDraft((prev) => [...prev, { sesiones: undefined, precio: undefined }]);

  const updatePaqueteRow = (idx: number, field: keyof PaqueteDraft, value: number | undefined) => {
    setPaquetesDraft((prev) => prev.map((p, i) => (i === idx ? { ...p, [field]: value } : p)));
  };

  const removePaqueteRow = (idx: number) => setPaquetesDraft((prev) => prev.filter((_, i) => i !== idx));

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();

    // Validaciones básicas
    if (!formData.nombre?.trim()) {
      toast.warning('El nombre del servicio es requerido');
      return;
    }

    if (!formData.precio || formData.precio <= 0) {
      toast.warning('El precio debe ser mayor a 0');
      return;
    }

    if (!formData.duracion || formData.duracion <= 0) {
      toast.warning('La duración debe ser mayor a 0');
      return;
    }

    const sesionesVistas = new Set<number>();
    for (const p of paquetesDraft) {
      if (!p.sesiones || p.sesiones < 2) {
        toast.warning('Cada paquete de sesiones debe indicar 2 sesiones o más');
        return;
      }
      if (!p.precio || p.precio <= 0) {
        toast.warning('Cada paquete de sesiones debe tener un precio mayor a 0');
        return;
      }
      if (sesionesVistas.has(p.sesiones)) {
        toast.warning(`Ya hay un paquete de ${p.sesiones} sesiones — no puede repetirse`);
        return;
      }
      sesionesVistas.add(p.sesiones);
    }

    const paquetes_sesiones: PaqueteSesionesOpcion[] | undefined = paquetesDraft.length > 0
      ? paquetesDraft.map((p) => ({ sesiones: p.sesiones as number, precio: p.precio as number }))
      : undefined;

    onSave({ ...formData, paquetes_sesiones } as Service);
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="w-full max-w-2xl max-h-[90vh] overflow-y-auto rounded-lg bg-white p-6">
        <div className="mb-6 flex items-center justify-between">
          <h2 className="text-2xl font-bold">
            {service ? "Editar servicio" : "Nuevo servicio"}
          </h2>
          <button
            type="button"
            onClick={onClose}
            disabled={isSaving}
            className="rounded-lg p-2 text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-600 disabled:opacity-50"
          >
            <X className="h-6 w-6" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label htmlFor="nombre" className="mb-1 block text-sm font-medium text-gray-700">
              Nombre *
            </label>
            <input
              id="nombre"
              type="text"
              value={formData.nombre || ""}
              onChange={(e) =>
                setFormData({ ...formData, nombre: e.target.value })
              }
              className="w-full rounded-lg border border-gray-300 px-4 py-2 focus:border-[oklch(0.55_0.25_280)] focus:outline-none focus:ring-2 focus:ring-[oklch(0.55_0.25_280)]/20"
              required
              disabled={isSaving}
              placeholder="Ej: Consulta general"
            />
          </div>

          <div>
            <label htmlFor="descripcion" className="mb-1 block text-sm font-medium text-gray-700">
              Descripción
            </label>
            <textarea
              id="descripcion"
              value={formData.descripcion || ""}
              onChange={(e) =>
                setFormData({ ...formData, descripcion: e.target.value })
              }
              className="w-full rounded-lg border border-gray-300 px-4 py-2 focus:border-[oklch(0.55_0.25_280)] focus:outline-none focus:ring-2 focus:ring-[oklch(0.55_0.25_280)]/20"
              rows={3}
              disabled={isSaving}
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label htmlFor="precio" className="mb-1 block text-sm font-medium text-gray-700">
                Precio *
              </label>
              <input
                id="precio"
                type="number"
                min="0"
                step="0.01"
                value={formData.precio ?? ""}
                onChange={(e) => {
                  const raw = e.target.value;
                  setFormData({
                    ...formData,
                    precio: raw === "" ? undefined : parseFloat(raw),
                  });
                }}
                className="w-full rounded-lg border border-gray-300 px-4 py-2 focus:border-[oklch(0.55_0.25_280)] focus:outline-none focus:ring-2 focus:ring-[oklch(0.55_0.25_280)]/20"
                required
                disabled={isSaving}
                placeholder="Ej: 50000"
              />
            </div>

            <div>
              <label htmlFor="duracion" className="mb-1 block text-sm font-medium text-gray-700">
                Duración (min) *
              </label>
              <input
                id="duracion"
                type="number"
                min="5"
                step="5"
                value={formData.duracion ?? ""}
                onChange={(e) => {
                  const raw = e.target.value;
                  setFormData({
                    ...formData,
                    duracion: raw === "" ? undefined : parseInt(raw, 10),
                  });
                }}
                className="w-full rounded-lg border border-gray-300 px-4 py-2 focus:border-[oklch(0.55_0.25_280)] focus:outline-none focus:ring-2 focus:ring-[oklch(0.55_0.25_280)]/20"
                required
                disabled={isSaving}
                placeholder="Ej: 45"
              />
            </div>
          </div>

          <div>
            <label htmlFor="categoria" className="mb-1 block text-sm font-medium text-gray-700">
              Categoría
            </label>
            <input
              id="categoria"
              type="text"
              value={formData.categoria || ""}
              onChange={(e) =>
                setFormData({ ...formData, categoria: e.target.value })
              }
              className="w-full rounded-lg border border-gray-300 px-4 py-2 focus:border-[oklch(0.55_0.25_280)] focus:outline-none focus:ring-2 focus:ring-[oklch(0.55_0.25_280)]/20"
              disabled={isSaving}
              placeholder="Ej: Fisioterapia"
            />
          </div>

          <div className="rounded-lg border border-gray-200 px-4 py-3 space-y-3">
            <div>
              <label className="block text-base font-medium text-gray-700">
                Paquetes de sesiones (opcional)
              </label>
              <p className="text-sm text-gray-500">
                Este mismo servicio también se puede vender en bloque — ej. "5 sesiones por 750.000". No es un servicio aparte: al agendar, se elige si se cobra el precio normal o se compra uno de estos paquetes.
              </p>
            </div>

            {paquetesDraft.length > 0 && (
              <div className="space-y-2">
                {paquetesDraft.map((p, idx) => (
                  <div key={idx} className="flex items-center gap-2">
                    <input
                      type="number"
                      min="2"
                      step="1"
                      placeholder="Sesiones"
                      value={p.sesiones ?? ""}
                      onChange={(e) => {
                        const raw = e.target.value;
                        updatePaqueteRow(idx, 'sesiones', raw === "" ? undefined : parseInt(raw, 10));
                      }}
                      className="w-24 rounded-lg border border-gray-300 px-3 py-1.5 text-sm focus:border-[oklch(0.55_0.25_280)] focus:outline-none"
                      disabled={isSaving}
                    />
                    <span className="text-sm text-gray-500 shrink-0">sesiones por</span>
                    <input
                      type="number"
                      min="0"
                      step="0.01"
                      placeholder="Precio total"
                      value={p.precio ?? ""}
                      onChange={(e) => {
                        const raw = e.target.value;
                        updatePaqueteRow(idx, 'precio', raw === "" ? undefined : parseFloat(raw));
                      }}
                      className="flex-1 rounded-lg border border-gray-300 px-3 py-1.5 text-sm focus:border-[oklch(0.55_0.25_280)] focus:outline-none"
                      disabled={isSaving}
                    />
                    <button
                      type="button"
                      onClick={() => removePaqueteRow(idx)}
                      disabled={isSaving}
                      className="p-1.5 text-red-400 hover:text-red-600 disabled:opacity-50"
                      title="Quitar este paquete"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                ))}
              </div>
            )}

            <button
              type="button"
              onClick={addPaqueteRow}
              disabled={isSaving}
              className="flex items-center gap-1.5 text-sm font-medium text-[oklch(0.55_0.25_280)] hover:underline disabled:opacity-50"
            >
              <Plus className="h-4 w-4" />
              Agregar paquete
            </button>
          </div>

          <div className="flex items-center justify-between rounded-lg border border-gray-200 px-4 py-3">
            <div>
              <label htmlFor="activo" className="block text-base font-medium text-gray-700">
                Activo
              </label>
              <p className="text-sm text-gray-500">Disponible para agendar</p>
            </div>
            <input
              id="activo"
              type="checkbox"
              checked={!!formData.activo}
              onChange={(e) =>
                setFormData({ ...formData, activo: e.target.checked })
              }
              className="h-4 w-4 rounded border-gray-300 text-[oklch(0.55_0.25_280)] focus:ring-[oklch(0.55_0.25_280)]"
              disabled={isSaving}
            />
          </div>

          <div className="flex justify-end gap-3 pt-4">
            <button
              type="button"
              onClick={onClose}
              disabled={isSaving}
              className="rounded-lg border border-gray-300 px-6 py-2 font-medium text-gray-700 transition-colors hover:bg-gray-50 disabled:opacity-50"
            >
              Cancelar
            </button>
            <button
              type="submit"
              disabled={isSaving}
              className="flex items-center gap-2 rounded-lg bg-gray-900 px-6 py-2 font-medium text-white transition-colors hover:bg-gray-800 disabled:opacity-50"
            >
              {isSaving ? (
                <>
                  <Loader className="h-4 w-4 animate-spin" />
                  Guardando...
                </>
              ) : (
                service ? "Guardar cambios" : "Crear servicio"
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
