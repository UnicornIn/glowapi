#!/usr/bin/env python3
"""
Bootstrap de un nuevo cliente GlowUp.

Inicializa desde cero la base de datos de un cliente en MongoDB Atlas:
  - Documento business_config (branding del negocio)
  - Usuario super_admin (contraseña hasheada con bcrypt)
  - Sede principal con company_id (CRÍTICO: prefijo en S3 -> companies/{company_id}/)
  - Índices en appointments, clients, users_auth

El script es idempotente: ejecutarlo dos veces no duplica datos.
Corre fuera del backend (no importa nada de FastAPI). Se ejecuta una sola vez por cliente
desde la máquina local del desarrollador, apuntando directamente a MongoDB Atlas.

Uso:
  python scripts/bootstrap_cliente.py \
    --mongodb-uri "mongodb+srv://USUARIO:PASS@cluster.mongodb.net/" \
    --db-name "glowup_spa_aurora" \
    --nombre-negocio "Spa Aurora" \
    --razon-social "SPA AURORA SAS" \
    --email-admin "admin@spaaurora.com" \
    --password-admin "Password123!" \
    --nombre-sede "Sede Principal" \
    --moneda "COP" \
    --zona-horaria "America/Bogota" \
    --company-id "TN-SPA-AURORA"
"""
import asyncio
import argparse
from datetime import datetime
from motor.motor_asyncio import AsyncIOMotorClient
from passlib.context import CryptContext

pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")


async def bootstrap(args):
    client = AsyncIOMotorClient(args.mongodb_uri)
    db = client[args.db_name]

    print(f"\n[INFO] Iniciando bootstrap en BD: {args.db_name}\n")

    # ── 1. business_config (upsert) ──────────────────────────────────────────
    await db["business_config"].update_one(
        {},
        {"$set": {
            "nombre_negocio": args.nombre_negocio,
            "razon_social": args.razon_social,
            "logo_url": "",
            "color_primario": "#000000",
            "email_remitente": args.email_admin,
            "footer_legal": f"© {args.nombre_negocio}. Todos los derechos reservados.",
        }},
        upsert=True
    )
    print("[OK] business_config creado/actualizado")

    # ── 2. Super admin ───────────────────────────────────────────────────────
    existente = await db["users_auth"].find_one({"correo_electronico": args.email_admin})
    if existente:
        print(f"[WARN] Usuario {args.email_admin} ya existe -> se omite la creación")
    else:
        await db["users_auth"].insert_one({
            "nombre": "Admin",
            "correo_electronico": args.email_admin,
            "hashed_password": pwd_context.hash(args.password_admin),
            "rol": "super_admin",
            "activo": True,
            "fecha_creacion": datetime.now().strftime("%Y-%m-%d %H:%M"),
        })
        print(f"[OK] Super admin creado: {args.email_admin}")

    # ── 3. Sede principal ────────────────────────────────────────────────────
    sede_id = f"SD-{args.company_id}"
    existente_sede = await db["branch"].find_one({"sede_id": sede_id})
    if existente_sede:
        print(f"[WARN] Sede {sede_id} ya existe -> se omite la creación")
    else:
        await db["branch"].insert_one({
            "sede_id": sede_id,
            "nombre": args.nombre_sede,
            "razon_social": args.razon_social,  # evita el default "RIZOS FELICES" en los Excel
            "company_id": args.company_id,    # clave para el prefijo de S3
            "zona_horaria": args.zona_horaria,
            "moneda": args.moneda,
            "direccion": "",
            "telefono": "",
            "activo": True,
            "fecha_creacion": datetime.now().strftime("%Y-%m-%d %H:%M"),
        })
        print(f"[OK] Sede creada: {sede_id}")

    # ── 4. Asociar sede al super admin (siempre) ─────────────────────────────
    await db["users_auth"].update_one(
        {"correo_electronico": args.email_admin},
        {"$set": {"sede_id": sede_id, "sedes_permitidas": [sede_id]}}
    )
    print(f"[OK] Admin asociado a la sede {sede_id}")

    # ── 5. Índices (create_index es idempotente) ─────────────────────────────
    await db["appointments"].create_index([("fecha", 1), ("sede_id", 1)])
    await db["appointments"].create_index([("profesional_id", 1)])
    await db["clients"].create_index([("sede_id", 1)])
    await db["users_auth"].create_index([("correo_electronico", 1)], unique=True)
    print("[OK] Índices creados")

    client.close()

    print("\n" + "=" * 44)
    print(f"Bootstrap completado: {args.nombre_negocio}")
    print(f"BD:          {args.db_name}")
    print(f"Admin:       {args.email_admin}")
    print(f"Sede:        {sede_id}")
    print(f"S3 prefix:   companies/{args.company_id}/")
    print("=" * 44 + "\n")


def parse_args():
    parser = argparse.ArgumentParser(
        description="Inicializa la base de datos de un nuevo cliente GlowUp."
    )
    parser.add_argument("--mongodb-uri", required=True,
                        help="URI de conexión a MongoDB Atlas")
    parser.add_argument("--db-name", required=True,
                        help="Nombre de la BD nueva, ej: glowup_spa_aurora")
    parser.add_argument("--nombre-negocio", required=True,
                        help='Nombre del negocio, ej: "Spa Aurora"')
    parser.add_argument("--razon-social", required=True,
                        help='Razón social legal, ej: "SPA AURORA SAS"')
    parser.add_argument("--email-admin", required=True,
                        help="Email del super_admin")
    parser.add_argument("--password-admin", required=True,
                        help="Contraseña del super_admin")
    parser.add_argument("--nombre-sede", default="Sede Principal",
                        help="Nombre de la sede principal")
    parser.add_argument("--moneda", default="COP",
                        help="Código de moneda")
    parser.add_argument("--zona-horaria", default="America/Bogota",
                        help="Zona horaria (TZ string)")
    parser.add_argument("--company-id", required=True,
                        help="Identificador único del cliente, ej: TN-SPA-AURORA. "
                             "Se usa como prefijo en S3: companies/{company_id}/")
    return parser.parse_args()


if __name__ == "__main__":
    asyncio.run(bootstrap(parse_args()))
