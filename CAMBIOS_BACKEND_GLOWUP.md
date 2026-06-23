# GlowUp — Cambios aplicados al backend (multi-cliente)

> Estado: **aplicado y verificado end-to-end** contra la BD `glowup_spa_aurora` en Atlas.
> Referencia para **devops** (despliegue/env) y **frontend** (contrato de API).
> El backend pasó de servir a un solo negocio a soportar múltiples clientes:
> un proceso `uvicorn` + una BD MongoDB por cliente. **Sin** middleware de tenants ni refactor estructural.

---

## 1. Resumen por rol

- **Devops:** secciones **3 (Variables de entorno)** y **5 (Bootstrap)**. Hay nombres de variable que
  difieren de las guías viejas — usar los de aquí.
- **Frontend:** sección **4 (Contrato de API)**. Todo el branding sale de `business_config`.
- **Backend/PR:** sección **2** lista archivos tocados.

---

## 2. Archivos modificados y creados

### Creados
| Archivo | Qué hace |
|---|---|
| `Backend/app/utils/branding.py` | `get_config()` (lee `business_config` con caché en memoria por proceso) + `invalidar_cache()` |
| `Backend/app/admin/routes_config.py` | Endpoints de branding: público + admin (GET/POST/PATCH) + subida de logo |
| `Backend/scripts/bootstrap_cliente.py` | Inicializa la BD de un cliente nuevo (idempotente) |

### Modificados
| Archivo | Cambio |
|---|---|
| `app/core/config.py` | CORS desde env `CORS_ORIGINS`; registra `router_config` |
| `app/database/mongo.py` | + `collection_business_config = db["business_config"]` |
| `app/bills/routes_reporte.py` | Bucket S3 sin default `"rfichas"` (lanza error si falta); banner Excel dinámico desde branding |
| `app/auth/routes.py` | Cookies `secure=True, samesite="lax"`; `/change-password` ahora **requiere autenticación** |
| `app/scheduling/utils.py` | `construir_html_confirmacion` → async con branding (logo/footer dinámicos) |
| `app/scheduling/submodules/quotes/routes_quotes.py` | `enviar_correo` → async con branding; plantillas de email dinámicas |
| `app/scheduling/submodules/quotes/controllers.py` | Branding dinámico en PDFs de ficha y remitente; `crear_html_correo_ficha` → async |
| `app/clients_service/generate_pdf.py` | `await` al llamar `crear_html_correo_ficha` |
| `app/scheduling/submodules/fichas/controllers.py` | `await` al llamar `crear_html_correo_ficha` |

> Todo el texto de marca visible al cliente (emails, PDFs, banner Excel) ahora sale de `business_config`.

---

## 3. Variables de entorno (devops)

`.env` por cliente (un archivo por proceso uvicorn). **Atención a los nombres en negrita.**

```bash
# Base de datos — lo único que cambia siempre por cliente
MONGODB_URI=mongodb+srv://USUARIO:PASS@cluster.mongodb.net/?retryWrites=true&w=majority
MONGODB_NAME=glowup_spa_aurora        # ⚠️ MONGODB_NAME (NO "MONGODB_DB")

# JWT
SECRET_KEY=<openssl rand -hex 32>
ALGORITHM=HS256
ACCESS_TOKEN_EXPIRE_MINUTES=720
REFRESH_TOKEN_EXPIRE_DAYS=30

# CORS — orígenes del frontend separados por coma
CORS_ORIGINS=https://spa-aurora.glowup.com,http://localhost:5173

# Email — ⚠️ nombres reales que lee el código
EMAIL_REMITENTE=citas@spaaurora.com   # ⚠️ NO "EMAIL_SENDER"
EMAIL_CONTRASENA=app_password         # ⚠️ NO "EMAIL_PASSWORD"

# S3 (mismo bucket e IAM para todos; se aíslan por company_id)
AWS_ACCESS_KEY_ID=AKIA...
AWS_SECRET_ACCESS_KEY=...
AWS_BUCKET_NAME=glowup-fichas
AWS_REGION=us-east-2
AWS_PUBLIC_BASE_URL=https://glowup-fichas.s3.us-east-2.amazonaws.com
```

**Correcciones respecto a guías previas:**
- `MONGODB_NAME` — `mongo.py` lee esta variable; `MONGODB_DB` se ignora (cae al default).
- `EMAIL_REMITENTE` / `EMAIL_CONTRASENA` — con `EMAIL_SENDER`/`EMAIL_PASSWORD` los emails fallan en silencio.

Arranque: `uvicorn app.core.config:app --host 0.0.0.0 --port 800X --workers 2`

---

## 4. Contrato de API (frontend)

### Branding
| Método | Ruta | Auth | Uso |
|---|---|---|---|
| GET | `/public/business-config` | ❌ | Cargar branding antes del login. Si no hay doc → defaults de GlowUp |
| GET | `/admin/business-config` | ✅ Bearer | Leer config completa |
| POST | `/admin/business-config` | ✅ admin/super_admin | Reemplazo total |
| PATCH | `/admin/business-config` | ✅ admin/super_admin | Update parcial (solo campos enviados) |
| POST | `/admin/branding/logo` | ✅ admin/super_admin | Sube imagen (multipart `file`) a S3 y actualiza `logo_url` |

**Forma de `business_config`:**
```jsonc
{
  "nombre_negocio": "Spa Aurora",
  "razon_social": "SPA AURORA SAS",
  "logo_url": "https://glowup-fichas.s3.us-east-2.amazonaws.com/companies/TN-SPA-AURORA/branding/logo-<uuid>.png",
  "color_primario": "#D4A5A5",
  "footer_legal": "© Spa Aurora. Todos los derechos reservados.",
  "email_remitente": "citas@spaaurora.com",
  "ws_url": null   // solo clientes con mensajería; null/ausente → WebSocket desactivado
}
```

- `PATCH` ej.: `{ "color_primario": "#D4A5A5" }` → `{ "ok": true, "updated": ["color_primario"] }`.
  La caché se invalida sola; `GET /public/business-config` refleja el cambio de inmediato.
- `POST /admin/branding/logo`: `multipart/form-data` campo `file` (PNG/JPG/WEBP/SVG) → `{ "ok": true, "logo_url": "..." }`.
  El `company_id` se deriva de la sede del usuario.

### Login
| Método | Ruta | Body |
|---|---|---|
| POST | `/auth/token` | form-urlencoded `username` + `password` → `{ access_token, ... }` |

### Notas frontend
- URL base del API derivada del hostname (`spa-aurora.glowup.com` → `https://api-spa-aurora.glowup.com/`).
  El backend solo necesita el origen del frontend en `CORS_ORIGINS`.
- `/change-password` ahora exige token (toma el email del token).

---

## 5. Crear un cliente nuevo (bootstrap)

`bootstrap_cliente.py` es idempotente. Crea `business_config`, super_admin (bcrypt), sede con
`company_id` y `razon_social`, e índices base.

```bash
cd Backend/
python scripts/bootstrap_cliente.py \
  --mongodb-uri "mongodb+srv://USUARIO:PASS@cluster.mongodb.net/" \
  --db-name "glowup_spa_aurora" \
  --nombre-negocio "Spa Aurora" \
  --razon-social "SPA AURORA SAS" \
  --email-admin "admin@spaaurora.com" \
  --password-admin "<password fuerte>" \
  --nombre-sede "Sede Principal" \
  --moneda "COP" \
  --zona-horaria "America/Bogota" \
  --company-id "TN-SPA-AURORA"
```

**Colecciones:** el bootstrap siembra el mínimo. El resto (`services`, `stylist`, `stylist_schedules`,
`sales`, `fichas`, etc.) las crea MongoDB **automáticamente** al usar cada módulo. No hay que pre-crearlas.

---

## 6. Verificación realizada (contra `glowup_spa_aurora` en Atlas)

- ✅ `GET /health`
- ✅ `GET /public/business-config` (sin token) → branding del cliente
- ✅ `POST /auth/token` → `access_token` (hash bcrypt verifica `True`)
- ✅ `GET /admin/business-config` (con token)
- ✅ `PATCH` parcial → actualiza solo el campo y la caché se invalida (público lo refleja)
- ✅ `/admin/business-config` y `/change-password` sin token → `401`
- ✅ CRUD real de `/admin/servicios` → crea la colección `services` de forma lazy
- ✅ Datos en Atlas correctos (business_config, super_admin con sede, branch con company_id + razon_social, índice único)

---

## 7. Notas

- **Warning `error reading bcrypt version`** — cosmético (passlib 1.7.4 + bcrypt 4.x). El hash funciona.
  Silenciar (opcional): `pip install "bcrypt==4.0.1"`.
- **Índices extra** — el bootstrap crea los 3 críticos; se pueden añadir más si se quiere optimizar.
- **Logo** — además del `aws s3 cp` manual, existe `POST /admin/branding/logo` para autoservicio.
- **EC2 / Nginx / systemd / DNS / CloudFront** — responsabilidad de devops.
