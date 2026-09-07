"use client";

import { StylistsTeamWorkspace } from "../../../features/stylists-team/StylistsTeamWorkspace";
import { estilistaService } from "./estilistaService";
import { serviciosService } from "../Services/serviciosService";

// No se pasa `legacyCreateModal` (antes EstilistaFormModal) a propósito: ese
// modal viejo no permite asignar comisión por servicio/categoría al crear
// (su lógica de detección de "binding" requiere un profesional ya existente
// para saber dónde persistir la comisión). Sin la prop, StylistsTeamWorkspace
// usa su propio panel de creación (el mismo que ya usa para editar), que sí
// tiene servicios agrupados por categoría con comisión configurable.
export default function EstilistasPage() {
  return (
    <StylistsTeamWorkspace
      stylistApi={estilistaService}
      servicesApi={{
        getServicios: (token: string) => serviciosService.getServicios(token),
      }}
    />
  );
}
