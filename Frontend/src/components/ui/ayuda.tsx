// Globo de ayuda: un "?" que al pasar el cursor (o al tocarlo, en celular)
// explica en una frase qué significa el dato de al lado. Sirve para no
// llenar la pantalla de texto pero dejar la explicación a mano.
//
// El globo se dibuja fuera del recuadro donde está el "?" (en una capa
// aparte sobre la página): si se dibujara dentro, un panel con scroll o un
// modal lo recortaría. Además se voltea hacia abajo cuando no cabe arriba y
// no se sale por los lados de la pantalla.
import { useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";

interface Props {
  /** La explicación, en una o dos frases cortas */
  texto: ReactNode;
  className?: string;
}

const ANCHO = 224; // w-56
const MARGEN = 8;

export function Ayuda({ texto, className }: Props) {
  const boton = useRef<HTMLButtonElement>(null);
  const [globo, setGlobo] = useState<{ top: number; left: number; abajo: boolean } | null>(null);

  const abrir = () => {
    const r = boton.current?.getBoundingClientRect();
    if (!r) return;
    // Si arriba no hay espacio para el globo, sale hacia abajo.
    const abajo = r.top < 160;
    setGlobo({
      top: abajo ? r.bottom + MARGEN : r.top - MARGEN,
      left: Math.min(
        Math.max(r.left + r.width / 2 - ANCHO / 2, MARGEN),
        Math.max(window.innerWidth - ANCHO - MARGEN, MARGEN),
      ),
      abajo,
    });
  };

  const cerrar = () => setGlobo(null);

  // Al hacer scroll o cambiar el tamaño, el globo quedaría en el aire.
  useEffect(() => {
    if (!globo) return;
    window.addEventListener("scroll", cerrar, true);
    window.addEventListener("resize", cerrar);
    return () => {
      window.removeEventListener("scroll", cerrar, true);
      window.removeEventListener("resize", cerrar);
    };
  }, [globo]);

  return (
    <span className={`relative inline-flex align-middle ${className || ""}`}>
      <button
        ref={boton}
        type="button"
        aria-label="Ayuda"
        onMouseEnter={abrir}
        onMouseLeave={cerrar}
        onFocus={abrir}
        onBlur={cerrar}
        onClick={(e) => {
          e.stopPropagation();
          globo ? cerrar() : abrir();
        }}
        className="h-4 w-4 shrink-0 rounded-full border border-slate-300 text-[10px] font-bold leading-none text-slate-500 hover:bg-slate-100 flex items-center justify-center"
      >
        ?
      </button>
      {globo &&
        createPortal(
          <span
            role="tooltip"
            style={{
              position: "fixed",
              top: globo.top,
              left: globo.left,
              width: ANCHO,
              transform: globo.abajo ? undefined : "translateY(-100%)",
              zIndex: 2147483000,
            }}
            className="pointer-events-none block rounded-lg bg-slate-900 px-2.5 py-2 text-[11px] font-normal normal-case leading-snug tracking-normal text-white shadow-lg"
          >
            {texto}
          </span>,
          document.body,
        )}
    </span>
  );
}

export default Ayuda;
