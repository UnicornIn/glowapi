# Backend — Soporte para Ficha de Estilizado

## Contexto

El frontend ya tiene implementada la **Ficha de Estilizado**, un formulario que evalúa 4 variables capilares (óleo, porosidad, grosor, permeabilidad) y recomienda una técnica de lavado. Actualmente toda la lógica es local (useState) y no persiste datos. Necesitamos que el backend soporte este nuevo tipo de ficha para poder guardar, consultar y adjuntar fotos.

---

## 1. Nuevo tipo de ficha: `FICHA_ESTILIZADO`

El endpoint `POST /scheduling/quotes/create-ficha` actualmente acepta estos tipos:

```
COLOR | CORTE | TRATAMIENTO | MASAJE | OTRO
```

**Necesario:** agregar `FICHA_ESTILIZADO` a la lista de tipos válidos en la validación del backend.

---

## 2. Nuevo campo de fotos: `fotos_durante`

El endpoint `create-ficha` ya acepta archivos vía FormData en los campos:

- `fotos_antes` (ya existe)
- `fotos_despues` (ya existe)

**Necesario:** agregar soporte para un tercer campo:

- `fotos_durante` — mismo comportamiento que los otros dos (subir a S3/storage, guardar URLs en el documento)

La respuesta al consultar fichas debería incluir las fotos durante en la estructura:

```json
{
  "fotos": {
    "antes": ["https://..."],
    "durante": ["https://..."],
    "despues": ["https://..."]
  }
}
```

---

## 3. Estructura de `datos_especificos`

Los datos del formulario se enviarán dentro del campo `data` (JSON stringify en el FormData), bajo `datos_especificos`. No requieren validación estricta — el backend ya almacena este campo como JSON flexible. Solo documenten la estructura esperada:

```json
{
  "tipo_ficha": "FICHA_ESTILIZADO",
  "cliente_id": "CL-xxx",
  "profesional_id": "ES-xxx",
  "sede_id": "SD-xxx",
  "servicio_id": "SV-xxx",
  "datos_especificos": {
    "selections": {
      "oleo": "A",
      "porosidad": "M",
      "grosor": "A",
      "permeabilidad": "B"
    },
    "tecnica_recomendada": "MNSA",
    "observaciones": "Texto libre del estilista...",
    "cliente_nombre": "María García",
    "estilista_nombre": "Juan Pérez"
  }
}
```

### Valores posibles

| Campo | Valores |
|-------|---------|
| `selections.oleo` | `"A"` (alto), `"M"` (medio), `"B"` (bajo) |
| `selections.porosidad` | `"A"` (alta), `"M"` (media), `"B"` (baja) |
| `selections.grosor` | `"A"` (alto), `"M"` (medio), `"B"` (bajo) |
| `selections.permeabilidad` | `"A"` (alta), `"M"` (media), `"B"` (baja) |
| `tecnica_recomendada` | `"ASA"`, `"MNSA"`, `"ASMN"`, `"MHSA"`, `"ASMH"`, `"COPOO"`, `"MNPOO"`, `"MHPOO"` |
| `observaciones` | Texto libre (puede estar vacío) |

---

## 4. Endpoints existentes que NO necesitan cambios

| Endpoint | Uso | Cambios |
|----------|-----|---------|
| `GET /scheduling/quotes/fichas?cliente_id=X&cita_id=Y` | Consultar fichas | Ninguno — ya devuelve `datos_especificos` y `fotos` |
| `GET /scheduling/quotes/fichas/{fichaId}` | Detalle de ficha | Ninguno |
| `GET /clientes/fichas/{clienteId}` | Fichas por cliente | Ninguno |
| `GET /public/business-config` | Config del tenant | Ninguno |

---

## Resumen de cambios requeridos

| # | Qué | Dónde | Esfuerzo estimado |
|---|-----|-------|-------------------|
| 1 | Aceptar `tipo_ficha: "FICHA_ESTILIZADO"` | Validación en `create-ficha` | Bajo — agregar string a enum/lista |
| 2 | Aceptar campo `fotos_durante` en FormData | `create-ficha` + lógica de upload S3 | Medio — replicar lógica de `fotos_antes` |
| 3 | Devolver `fotos.durante` en las consultas | Serialización de fichas en GET | Bajo — agregar campo al response |

---

## Pregunta abierta

Si agregar `fotos_durante` es complejo a corto plazo, el frontend puede enviar las fotos "durante" dentro de `fotos_despues` como workaround temporal (etiquetándolas por convención en `datos_especificos`). Pero la solución limpia es el campo separado.
