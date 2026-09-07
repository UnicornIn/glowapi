// ════════════════════════════════════════════════════════════
// Historia Clínica — Primitivas de UI y store del formulario
//
// Todos los campos se enlazan por "path" (ej. "urinarios.stop_pipi")
// para que el objeto resultante ya tenga la forma que consumirá el
// backend cuando se construya.
// ════════════════════════════════════════════════════════════

import { useCallback, useId, useMemo, useState, type ReactNode } from "react";
import type { Opcion } from "./hcCatalogos";

/* ── Store ──────────────────────────────────────────────── */

/** Estructura anidada de la ficha; las hojas son string o string[]. */
export type HCData = Record<string, unknown>;

export type HCStore = {
  data: HCData;
  /** Valor escalar de una hoja ("" si no existe). */
  get: (path: string) => string;
  /** Valor de una hoja de selección múltiple ([] si no existe). */
  getLista: (path: string) => string[];
  set: (path: string, value: string | string[]) => void;
  toggle: (path: string, value: string) => void;
  cargar: (data: HCData) => void;
  reset: () => void;
  soloLectura: boolean;
};

function leer(obj: unknown, path: string): unknown {
  return path
    .split(".")
    .reduce<unknown>(
      (acc, key) => (acc == null ? undefined : (acc as HCData)[key]),
      obj
    );
}

function escribir(obj: HCData, path: string, value: unknown): HCData {
  const [key, ...resto] = path.split(".");
  const actual = obj[key];
  return {
    ...obj,
    [key]: resto.length
      ? escribir((actual ?? {}) as HCData, resto.join("."), value)
      : value,
  };
}

export function useHCStore(inicial: HCData, soloLectura = false): HCStore {
  const [data, setData] = useState<HCData>(inicial);

  const get = useCallback(
    (path: string) => {
      const valor = leer(data, path);
      return typeof valor === "string" ? valor : "";
    },
    [data]
  );

  const getLista = useCallback(
    (path: string) => {
      const valor = leer(data, path);
      return Array.isArray(valor) ? (valor as string[]) : [];
    },
    [data]
  );

  const set = useCallback(
    (path: string, value: string | string[]) => {
      if (soloLectura) return;
      setData((prev) => escribir(prev, path, value));
    },
    [soloLectura]
  );

  const toggle = useCallback(
    (path: string, value: string) => {
      if (soloLectura) return;
      setData((prev) => {
        const previo = leer(prev, path);
        const actual = Array.isArray(previo) ? (previo as string[]) : [];
        const siguiente = actual.includes(value)
          ? actual.filter((v) => v !== value)
          : [...actual, value];
        return escribir(prev, path, siguiente);
      });
    },
    [soloLectura]
  );

  const cargar = useCallback((nuevo: HCData) => setData(nuevo), []);

  const reset = useCallback(() => setData(inicial), [inicial]);

  return useMemo(
    () => ({ data, get, getLista, set, toggle, cargar, reset, soloLectura }),
    [data, get, getLista, set, toggle, cargar, reset, soloLectura]
  );
}

/* ── Estructura ─────────────────────────────────────────── */

export function Seccion({
  id,
  numero,
  titulo,
  nota,
  children,
}: {
  id: string;
  numero: number | string;
  titulo: string;
  nota?: string;
  children: ReactNode;
}) {
  return (
    <section className="hc-section" id={id}>
      <header className="hc-section-head">
        <span className="hc-num">{numero}</span>
        <h2 className="hc-section-title">{titulo}</h2>
        {nota && <span className="hc-section-note">{nota}</span>}
      </header>
      <div className="hc-section-body">{children}</div>
    </section>
  );
}

export function SubBloque({ titulo, children }: { titulo: string; children: ReactNode }) {
  return (
    <div>
      <div className="hc-subhead">{titulo}</div>
      {children}
    </div>
  );
}

export function Grupo({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="hc-group">
      <span className="hc-group-label">{label}</span>
      {children}
    </div>
  );
}

export function Grid({ cols = 2, children }: { cols?: 2 | 3 | 4; children: ReactNode }) {
  return <div className={`hc-grid hc-grid-${cols}`}>{children}</div>;
}

/* ── Campos ─────────────────────────────────────────────── */

type BaseProps = {
  hc: HCStore;
  path: string;
  label: string;
  hint?: string;
  span?: "col-2" | "full";
};

const spanClass = (span?: BaseProps["span"]) =>
  span === "full" ? "hc-field hc-col-full" : span === "col-2" ? "hc-field hc-col-2" : "hc-field";

export function Texto({
  hc,
  path,
  label,
  hint,
  span,
  placeholder,
  type = "text",
}: BaseProps & { placeholder?: string; type?: "text" | "number" | "date" | "tel" }) {
  const id = useId();
  return (
    <div className={spanClass(span)}>
      <label className="hc-field-label" htmlFor={id}>
        {label}
      </label>
      <input
        id={id}
        className="hc-input"
        type={type}
        value={hc.get(path)}
        placeholder={placeholder}
        disabled={hc.soloLectura}
        onChange={(e) => hc.set(path, e.target.value)}
      />
      {hint && <span className="hc-field-hint">{hint}</span>}
    </div>
  );
}

export function Selector({
  hc,
  path,
  label,
  hint,
  span,
  options,
  placeholder = "Seleccionar…",
}: BaseProps & { options: Opcion[]; placeholder?: string }) {
  const id = useId();
  const value = hc.get(path);
  return (
    <div className={spanClass(span)}>
      <label className="hc-field-label" htmlFor={id}>
        {label}
      </label>
      <select
        id={id}
        className="hc-select"
        data-empty={value === "" ? "true" : "false"}
        value={value}
        disabled={hc.soloLectura}
        onChange={(e) => hc.set(path, e.target.value)}
      >
        <option value="">{placeholder}</option>
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
      {hint && <span className="hc-field-hint">{hint}</span>}
    </div>
  );
}

export function Area({
  hc,
  path,
  label,
  hint,
  span,
  placeholder,
  grande,
}: BaseProps & { placeholder?: string; grande?: boolean }) {
  const id = useId();
  return (
    <div className={spanClass(span)}>
      <label className="hc-field-label" htmlFor={id}>
        {label}
      </label>
      <textarea
        id={id}
        className={`hc-textarea${grande ? " hc-textarea-lg" : ""}`}
        value={hc.get(path)}
        placeholder={placeholder}
        disabled={hc.soloLectura}
        onChange={(e) => hc.set(path, e.target.value)}
      />
      {hint && <span className="hc-field-hint">{hint}</span>}
    </div>
  );
}

/** Segmentado Sí / No. Tercer clic sobre la opción activa la deselecciona. */
export function SiNo({ hc, path, label, hint, span }: BaseProps) {
  const value = hc.get(path);
  return (
    <div className={spanClass(span)}>
      <span className="hc-field-label">{label}</span>
      <div className="hc-seg" role="group" aria-label={label}>
        {(["Sí", "No"] as const).map((opcion) => {
          const activo = value === opcion;
          return (
            <button
              key={opcion}
              type="button"
              className={`hc-seg-btn${activo ? " active" : ""}`}
              data-tone={opcion === "Sí" ? "yes" : "no"}
              aria-pressed={activo}
              disabled={hc.soloLectura}
              onClick={() => hc.set(path, activo ? "" : opcion)}
            >
              {opcion}
            </button>
          );
        })}
      </div>
      {hint && <span className="hc-field-hint">{hint}</span>}
    </div>
  );
}

/** Segmentado genérico para catálogos cortos (2-4 opciones). */
export function Segmentado({
  hc,
  path,
  label,
  hint,
  span,
  options,
}: BaseProps & { options: Opcion[] }) {
  const value = hc.get(path);
  return (
    <div className={spanClass(span)}>
      <span className="hc-field-label">{label}</span>
      <div className="hc-seg" role="group" aria-label={label}>
        {options.map((o) => {
          const activo = value === o.value;
          return (
            <button
              key={o.value}
              type="button"
              className={`hc-seg-btn${activo ? " active" : ""}`}
              aria-pressed={activo}
              disabled={hc.soloLectura}
              onClick={() => hc.set(path, activo ? "" : o.value)}
            >
              {o.label}
            </button>
          );
        })}
      </div>
      {hint && <span className="hc-field-hint">{hint}</span>}
    </div>
  );
}

/** Escala numérica discreta (dolor 1-10, fuerza/movilidad 1-5). */
export function Escala({
  hc,
  path,
  label,
  hint,
  span,
  min = 1,
  max = 10,
  leyendaMin,
  leyendaMax,
}: BaseProps & { min?: number; max?: number; leyendaMin?: string; leyendaMax?: string }) {
  const value = hc.get(path);
  const valores = Array.from({ length: max - min + 1 }, (_, i) => String(min + i));
  return (
    <div className={spanClass(span)}>
      <span className="hc-field-label">{label}</span>
      <div className="hc-scale" role="group" aria-label={label}>
        {valores.map((n) => {
          const activo = value === n;
          return (
            <button
              key={n}
              type="button"
              className={`hc-scale-btn${activo ? " active" : ""}`}
              aria-pressed={activo}
              disabled={hc.soloLectura}
              onClick={() => hc.set(path, activo ? "" : n)}
            >
              {n}
            </button>
          );
        })}
        {(leyendaMin || leyendaMax) && (
          <span className="hc-scale-legend">
            {leyendaMin} → {leyendaMax}
          </span>
        )}
      </div>
      {hint && <span className="hc-field-hint">{hint}</span>}
    </div>
  );
}

/** Selección múltiple en chips. El valor guardado es string[]. */
export function Checks({
  hc,
  path,
  label,
  hint,
  span,
  options,
}: BaseProps & { options: Opcion[] }) {
  const seleccion = hc.getLista(path);
  return (
    <div className={spanClass(span)}>
      <span className="hc-field-label">{label}</span>
      <div className="hc-checks" role="group" aria-label={label}>
        {options.map((o) => {
          const activo = seleccion.includes(o.value);
          return (
            <button
              key={o.value}
              type="button"
              className={`hc-check${activo ? " active" : ""}`}
              aria-pressed={activo}
              disabled={hc.soloLectura}
              onClick={() => hc.toggle(path, o.value)}
            >
              <span className="hc-check-box" />
              {o.label}
            </button>
          );
        })}
      </div>
      {hint && <span className="hc-field-hint">{hint}</span>}
    </div>
  );
}
