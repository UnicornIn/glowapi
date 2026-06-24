from datetime import datetime, time, timedelta

async def construir_html_confirmacion(cita: dict, sede: dict) -> str:
    """Genera el HTML del correo de confirmación a partir de un doc de cita ya guardado."""
    from app.utils.branding import get_config, color_acento, recomendaciones_items
    config = await get_config()
    logo_url = config.get("logo_url", "")
    nombre_negocio = config.get("nombre_negocio", "GlowUp")
    footer = config.get(
        "footer_legal",
        f"© {nombre_negocio}. Todos los derechos reservados."
    )
    color = color_acento(config)
    nombres_servicios = ", ".join(
        s.get("nombre", "Servicio") for s in cita.get("servicios", [])
    ) or cita.get("servicio_nombre", "Sin servicio")

    # Bloque de recomendaciones (configurable; se omite si la lista está vacía)
    recos = recomendaciones_items(config)
    bloque_recos = ""
    if recos:
        items_html = "".join(f'<li style="margin-bottom:8px;">{r}</li>' for r in recos)
        bloque_recos = f"""
          <div style="background:#f7f7f7;padding:20px;border-radius:12px;border-left:5px solid {color};">
            <div style="color:{color};font-weight:bold;margin-bottom:10px;">📋 Recomendaciones importantes</div>
            <ul style="margin:0;padding-left:20px;color:#555;font-size:14px;">{items_html}</ul>
          </div>"""

    return f"""
    <!DOCTYPE html><html lang="es"><head><meta charset="UTF-8"></head>
    <body style="font-family:'Segoe UI',sans-serif;background:#f4f4f4;margin:0;padding:0;">
      <div style="max-width:600px;margin:20px auto;background:#fff;border-radius:15px;
                  overflow:hidden;border:1px solid {color};">
        <div style="background:#000;padding:40px 20px;text-align:center;">
          <img src="{logo_url}"
               style="max-width:180px;margin-bottom:20px;" alt="{nombre_negocio}">
          <h1 style="color:#fff;margin:0;font-size:28px;letter-spacing:2px;">¡CITA CONFIRMADA!</h1>
          <p style="color:#fff;margin:10px 0 0;opacity:.9;">Tu reserva ha sido agendada exitosamente</p>
        </div>
        <div style="padding:30px;">
          <div style="font-size:18px;font-weight:bold;color:#333;margin-bottom:20px;
                      padding-bottom:10px;border-bottom:2px solid {color};">📅 Detalles de la cita</div>
          <div style="display:grid;grid-template-columns:repeat(2,1fr);gap:15px;margin-bottom:20px;">
            <div style="padding:15px;border-radius:10px;border:1px solid {color};">
              <div style="color:{color};font-size:12px;font-weight:bold;margin-bottom:5px;">CLIENTE</div>
              <div style="color:#333;font-size:15px;font-weight:600;">{cita.get('cliente_nombre','')}</div>
            </div>
            <div style="padding:15px;border-radius:10px;border:1px solid {color};">
              <div style="color:{color};font-size:12px;font-weight:bold;margin-bottom:5px;">SERVICIO(S)</div>
              <div style="color:#333;font-size:15px;font-weight:600;">{nombres_servicios}</div>
            </div>
            <div style="padding:15px;border-radius:10px;border:1px solid {color};">
              <div style="color:{color};font-size:12px;font-weight:bold;margin-bottom:5px;">PROFESIONAL</div>
              <div style="color:#333;font-size:15px;font-weight:600;">{cita.get('profesional_nombre','')}</div>
            </div>
            <div style="padding:15px;border-radius:10px;border:1px solid {color};">
              <div style="color:{color};font-size:12px;font-weight:bold;margin-bottom:5px;">SEDE</div>
              <div style="color:#333;font-size:15px;font-weight:600;">{cita.get('sede_nombre','')}</div>
              <small style="color:#888;">{sede.get('direccion','')}</small>
            </div>
            <div style="padding:15px;border-radius:10px;border:1px solid {color};">
              <div style="color:{color};font-size:12px;font-weight:bold;margin-bottom:5px;">FECHA</div>
              <div style="color:#333;font-size:15px;font-weight:600;">{cita.get('fecha','')}</div>
            </div>
            <div style="padding:15px;border-radius:10px;border:1px solid {color};">
              <div style="color:{color};font-size:12px;font-weight:bold;margin-bottom:5px;">HORARIO</div>
              <div style="color:#333;font-size:15px;font-weight:600;">{cita.get('hora_inicio','')} - {cita.get('hora_fin','')}</div>
            </div>
          </div>
          {bloque_recos}
          <div style="margin-top:20px;padding:20px;border-radius:12px;border:1px solid {color};">
            <div style="font-size:16px;font-weight:600;color:{color};margin-bottom:8px;">📞 ¿Necesitas ayuda?</div>
            <p style="color:#333;margin:0;"><strong>{sede.get('nombre','')}:</strong> {sede.get('telefono','No disponible')}</p>
          </div>
        </div>
        <div style="background:#f9f9f9;padding:20px;text-align:center;color:#777;font-size:13px;">
          <p>{footer}</p>
          <p style="margin-top:8px;font-size:12px;opacity:.7;">Este es un correo automático, por favor no responder.</p>
        </div>
      </div>
    </body></html>
    """