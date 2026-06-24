import { useState } from "react";
import {
  TECHNIQUES,
  TECHNIQUE_NAMES,
  VAR_LIST,
  LEVEL_LABELS,
  VAR_GENDER,
  findBestTechnique,
  type VarName,
  type VarLevel,
  type CellValue,
} from "./techniques-data";
import { useTenantConfig } from "../../../../config/TenantConfigContext";
import "./ficha-estilizado.css";

interface FichaEstilizadoProps {
  cita?: any;
  datosIniciales?: any;
  onGuardar?: (datos: any) => void;
  onSubmit?: (datos: any) => void;
  onCancelar?: () => void;
  fichaId?: string;
  modoEdicion?: boolean;
}

type ActiveView = "stylist" | "client";

const LEVEL_BUTTONS: { level: VarLevel; labels: [string, string] }[] = [
  { level: "A", labels: ["Alto", "Alta"] },
  { level: "M", labels: ["Medio", "Media"] },
  { level: "B", labels: ["Bajo", "Baja"] },
];

function formatDateLong(date: Date): string {
  const days = ["Domingo", "Lunes", "Martes", "Miércoles", "Jueves", "Viernes", "Sábado"];
  const months = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];
  return `${days[date.getDay()]}, ${date.getDate()} de ${months[date.getMonth()]} · ${date.getFullYear()}`;
}

function suggestedNextDate(): string {
  const d = new Date();
  d.setDate(d.getDate() + 21);
  const months = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];
  return `${months[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()}`;
}

export function FichaEstilizado({
  cita,
  onGuardar,
  onSubmit,
}: FichaEstilizadoProps) {
  const { brand } = useTenantConfig();
  const [activeView, setActiveView] = useState<ActiveView>("stylist");
  const [selections, setSelections] = useState<Record<VarName, VarLevel | null>>({
    oleo: null,
    porosidad: null,
    grosor: null,
    permeabilidad: null,
  });
  const [clienteName, setClienteName] = useState(
    cita?.cliente?.nombre
      ? `${cita.cliente.nombre} ${cita.cliente.apellido || ""}`.trim()
      : "",
  );
  const [estilistaName, setEstilistaName] = useState("");
  const [observaciones, setObservaciones] = useState("");

  const allSelected = Object.values(selections).every((v) => v !== null);
  const bestTechniqueName = allSelected ? findBestTechnique(selections) : null;
  const bestTechnique = bestTechniqueName ? TECHNIQUES[bestTechniqueName] : null;

  function selectVar(varName: VarName, level: VarLevel) {
    setSelections((prev) => ({ ...prev, [varName]: level }));
  }

  function handleSave() {
    const data = {
      tipo_ficha: "FICHA_ESTILIZADO",
      cliente_nombre: clienteName,
      estilista_nombre: estilistaName,
      selections,
      tecnica_recomendada: bestTechniqueName,
      observaciones,
    };
    if (onGuardar) onGuardar(data);
    console.log("[FichaEstilizado] Guardado:", data);
  }

  function handleSaveAndSend() {
    handleSave();
    setActiveView("client");
  }

  function handleSubmit() {
    const data = {
      tipo_ficha: "FICHA_ESTILIZADO",
      cliente_nombre: clienteName,
      estilista_nombre: estilistaName,
      selections,
      tecnica_recomendada: bestTechniqueName,
      observaciones,
    };
    if (onSubmit) onSubmit(data);
  }

  function renderCell(value: CellValue) {
    if (value === "ideal") return <span className="fe-cell-ideal" />;
    if (value === "ok") return <span className="fe-cell-ok" />;
    return <span className="fe-cell-no">—</span>;
  }

  // ── STYLIST VIEW ──
  function renderStylistView() {
    return (
      <div className="fe-stylist-view">
        <div className="fe-header">
          <div className="fe-eyebrow">{brand.appName}</div>
          <h1 className="fe-title">
            Ficha de <em>estilizado</em>
          </h1>
          <p className="fe-subtitle">
            Selecciona las variables del cabello para obtener la técnica correcta
          </p>
        </div>

        {/* Client data */}
        <div className="fe-client-bar">
          <div className="fe-client-field">
            <label>Cliente</label>
            <input
              type="text"
              placeholder="Nombre completo"
              value={clienteName}
              onChange={(e) => setClienteName(e.target.value)}
            />
          </div>
          <div className="fe-client-field" style={{ maxWidth: 140 }}>
            <label>Estilista</label>
            <input
              type="text"
              placeholder="Tu nombre"
              value={estilistaName}
              onChange={(e) => setEstilistaName(e.target.value)}
            />
          </div>
        </div>

        {/* Variables */}
        <div className="fe-section-label">01 · Evaluación de variables</div>
        <div className="fe-variables-grid">
          {VAR_LIST.map((v) => (
            <div
              key={v.key}
              className={`fe-variable-row${selections[v.key] ? " has-selection" : ""}`}
            >
              <div className="fe-var-icon">{v.icon}</div>
              <div className="fe-var-name">{v.label}</div>
              <div className="fe-var-options">
                {LEVEL_BUTTONS.map((lb) => (
                  <button
                    key={lb.level}
                    className={`fe-var-btn${selections[v.key] === lb.level ? ` selected-${lb.level}` : ""}`}
                    onClick={() => selectVar(v.key, lb.level)}
                  >
                    {lb.level}
                    <span className="fe-var-label">{lb.labels[VAR_GENDER[v.key]]}</span>
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>

        {/* Result */}
        <div className="fe-section-label">02 · Técnica recomendada</div>
        <div className={`fe-result-card${bestTechnique ? " has-result" : ""}`}>
          {!bestTechnique ? (
            <div className="fe-result-empty">
              <span className="fe-result-empty-dot" />
              Selecciona las 4 variables para ver la técnica recomendada
            </div>
          ) : (
            <>
              <div className="fe-result-technique">{bestTechniqueName}</div>
              <div className="fe-result-name-full">{bestTechnique.full}</div>
              <div className="fe-result-steps">
                {bestTechnique.steps.map((step, i) => (
                  <div key={i} className="fe-result-step">
                    <span className="fe-result-step-num">
                      {String(i + 1).padStart(2, "0")}
                    </span>
                    <span>{step}</span>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>

        {/* Matrix */}
        <div className="fe-section-label">03 · Matriz de correspondencia</div>
        <div className="fe-matrix-wrapper">
          <table className="fe-matrix-table">
            <thead>
              <tr>
                <th className="technique-header" rowSpan={2}>
                  Técnica
                </th>
                <th colSpan={3}>Óleo</th>
                <th colSpan={3}>Porosidad</th>
                <th colSpan={3}>Grosor</th>
                <th colSpan={3}>Permeabilidad</th>
              </tr>
              <tr>
                {Array.from({ length: 4 }).flatMap((_, i) =>
                  (["A", "M", "B"] as const).map((l) => <th key={`${i}-${l}`}>{l}</th>),
                )}
              </tr>
            </thead>
            <tbody>
              {TECHNIQUE_NAMES.map((name) => {
                const t = TECHNIQUES[name];
                const isHighlighted = name === bestTechniqueName;
                return (
                  <tr key={name} className={isHighlighted ? "highlighted" : ""}>
                    <td className="technique-name">{name}</td>
                    {(["oleo", "porosidad", "grosor", "permeabilidad"] as VarName[]).flatMap(
                      (v) =>
                        (["A", "M", "B"] as VarLevel[]).map((l) => (
                          <td key={`${v}-${l}`}>{renderCell(t[v][l])}</td>
                        )),
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {/* Photos */}
        <div className="fe-section-label">04 · Registro fotográfico</div>
        <div className="fe-photo-row">
          {["Antes", "Durante", "Después"].map((label) => (
            <div key={label} className="fe-photo-slot">
              <div className="fe-photo-slot-icon">📷</div>
              <div className="fe-photo-slot-label">{label}</div>
            </div>
          ))}
        </div>

        {/* Notes */}
        <div className="fe-section-label">05 · Observaciones</div>
        <textarea
          className="fe-notes-field"
          placeholder="Observaciones del estilista sobre el cabello, el comportamiento del producto, recomendaciones para la próxima cita..."
          value={observaciones}
          onChange={(e) => setObservaciones(e.target.value)}
        />

        {/* CTA */}
        <div className="fe-cta-row">
          <button className="fe-btn-primary" onClick={handleSaveAndSend}>
            Guardar y enviar al cliente →
          </button>
          <button className="fe-btn-secondary" onClick={handleSave}>
            Guardar
          </button>
        </div>
      </div>
    );
  }

  // ── CLIENT VIEW ──
  function renderClientView() {
    const today = new Date();

    return (
      <div className="fe-client-view">
        <div className="fe-client-hero">
          <div className="fe-client-salon-name">{brand.appName}</div>
          <h1 className="fe-client-headline">
            Tu <em>Glow Journey</em>
            <br />
            de hoy
          </h1>
          <div className="fe-client-date">{formatDateLong(today)}</div>
        </div>

        {/* Photos */}
        <div className="fe-photos-result">
          <div className="fe-photo-result-slot">
            <span>Antes</span>
          </div>
          <div className="fe-photo-result-slot" style={{ background: "var(--fe-surface3)" }}>
            <span>Después</span>
          </div>
        </div>

        {/* Technique hero */}
        <div className="fe-technique-hero">
          <div className="fe-technique-eyebrow">Tu técnica de hoy</div>
          <div className="fe-technique-result">
            {bestTechniqueName || "—"}
          </div>
          <div className="fe-technique-full">
            {bestTechnique?.full || "Selecciona las variables en la vista Estilista"}
          </div>
          {allSelected && (
            <div className="fe-technique-badge">
              {VAR_LIST.map((v) => (
                <div key={v.key} className="fe-badge-item">
                  <div className="fe-badge-dot" />
                  {v.label} {selections[v.key]}
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Profile cards */}
        <div className="fe-profile-section">
          <div className="fe-profile-section-label">Tu perfil capilar</div>
          <div className="fe-profile-grid">
            {VAR_LIST.map((v) => {
              const level = selections[v.key];
              const levelClass = level === "A" ? "alto" : level === "M" ? "medio" : level === "B" ? "bajo" : "";
              const label = level
                ? LEVEL_LABELS[level][VAR_GENDER[v.key]]
                : "—";
              return (
                <div key={v.key} className="fe-profile-card">
                  <div className="fe-profile-card-icon">{v.icon}</div>
                  <div className="fe-profile-card-var">{v.label}</div>
                  <div className={`fe-profile-card-value ${levelClass}`}>{label}</div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Steps */}
        {bestTechnique && (
          <div className="fe-steps-section">
            <div className="fe-steps-title">Cómo se hizo hoy</div>
            {bestTechnique.steps.map((step, i) => (
              <div key={i} className="fe-step-item">
                <div className="fe-step-num">{String(i + 1).padStart(2, "0")}</div>
                <div className="fe-step-text">{step}</div>
              </div>
            ))}
          </div>
        )}

        {/* Next appointment */}
        <div className="fe-next-section">
          <div className="fe-next-label">Recomendación de tu estilista</div>
          <div className="fe-next-text">
            Para mantener la salud de tu cabello, te recomendamos volver en 3
            semanas con la misma técnica o evaluando si tu porosidad ha cambiado.
          </div>
          <div className="fe-next-date">→ Próxima cita sugerida: {suggestedNextDate()}</div>
        </div>

        {/* CTA */}
        <button className="fe-share-btn" onClick={handleSubmit}>
          Ver mi historial completo →
        </button>
        <button className="fe-whatsapp-btn">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="#25D366">
            <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413Z" />
          </svg>
          Compartir por WhatsApp
        </button>

        <div className="fe-powered-by">
          <p className="fe-powered-text">
            Impulsado por <span className="fe-powered-brand">sëns</span>
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="ficha-estilizado">
      <nav className="fe-nav">
        <div className="fe-nav-logo">
          sëns
        </div>
        <div className="fe-view-toggle">
          <button
            className={`fe-toggle-btn${activeView === "stylist" ? " active" : ""}`}
            onClick={() => setActiveView("stylist")}
          >
            Estilista
          </button>
          <button
            className={`fe-toggle-btn${activeView === "client" ? " active" : ""}`}
            onClick={() => setActiveView("client")}
          >
            Cliente
          </button>
        </div>
      </nav>

      {activeView === "stylist" ? renderStylistView() : renderClientView()}
    </div>
  );
}
