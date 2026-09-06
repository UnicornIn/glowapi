"use client"
import { useState, useCallback, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { toast } from 'sonner'
import type { Cliente } from "../../../types/cliente"
import { EditClientModal } from "./EditClientModal"
import { clientesService, type PaqueteCliente } from "./clientesService"
import { useAuth } from "../../../components/Auth/AuthContext"
import { API_BASE_URL } from "../../../types/config"
import { confirmAction } from "../../../components/ui/confirm-dialog"
import { FichaEditModal } from "../../../components/Clients/FichaEditModal"

interface ClientDetailProps {
  client: Cliente
  isOpen: boolean
  onClose: () => void
  onClientUpdated?: () => void
}

type Tab = 'resumen' | 'evolucion' | 'historial' | 'notas'

const fmt = (n: number) => "$" + Math.round(n).toLocaleString("es-CO")
const ini = (n: string) =>
  n.split(" ").map(w => w[0]).filter(Boolean).slice(0, 2).join("").toUpperCase()

const fmtDate = (s?: string): string => {
  if (!s) return '—'
  const iso = s.match(/^(\d{4})-(\d{2})-(\d{2})/)
  if (iso) return `${iso[3]}/${iso[2]}/${iso[1]}`
  return s
}

const fmtDateLong = (s?: string): string => {
  if (!s) return '—'
  try {
    const d = new Date(s)
    if (isNaN(d.getTime())) return fmtDate(s)
    const months = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic']
    return `${d.getDate()} ${months[d.getMonth()]} ${d.getFullYear()}`
  } catch { return fmtDate(s) }
}

const cleanPhone = (phone: string): string => phone.replace(/\D/g, '')
const whatsappUrl = (phone: string) => `https://wa.me/${cleanPhone(phone)}`

// ── Sub-components ───────────────────────────────────────────

function ResumenTab({ client }: { client: Cliente }) {
  const visits = client.historialCitas?.length ?? 0
  const daysSince = client.diasSinVenir ?? 0
  const overdue = daysSince > 30
  const extraDays = overdue ? daysSince - 30 : 0

  const recPct = Math.min(100, Math.round((daysSince / Math.max(30, 1)) * 100))
  const recColor = daysSince <= 30 ? 'fill-green' : daysSince <= 60 ? 'fill-yellow' : 'fill-red'

  const segLabel = daysSince <= 30 ? 'Activa' : daysSince <= 60 ? 'Tibia' : daysSince <= 120 ? 'En riesgo' : 'Perdida'
  const segCls = daysSince <= 30 ? 'tag-green' : daysSince <= 60 ? 'tag-yellow' : daysSince <= 120 ? 'tag-red' : 'tag-gray'

  const lastFour = (client.historialCitas ?? []).slice(0, 4)

  return (
    <>
      {/* KPIs */}
      <div className="glw-kpi-strip">
        <div className="glw-kpi">
          <div className="glw-kpi-label">LTV</div>
          <div className="glw-kpi-value">{fmt(client.ltv)}</div>
          <div className="glw-kpi-sub">{visits} visitas</div>
        </div>
        <div className="glw-kpi">
          <div className="glw-kpi-label">Ticket prom.</div>
          <div className="glw-kpi-value">{fmt(client.ticketPromedio)}</div>
          <div className="glw-kpi-sub">por visita</div>
        </div>
        <div className="glw-kpi">
          <div className="glw-kpi-label">Días sin venir</div>
          <div className="glw-kpi-value">{daysSince === 0 ? 'Hoy' : daysSince}</div>
          <div className="glw-kpi-sub">{overdue ? 'Fuera de ciclo' : 'Dentro del rango'}</div>
        </div>
        <div className="glw-kpi">
          <div className="glw-kpi-label">Segmento</div>
          <div className="glw-kpi-value" style={{ fontSize: 13, marginTop: 5 }}>
            <span className={`glw-tag ${segCls}`}>{segLabel}</span>
          </div>
          <div className="glw-kpi-sub">{overdue ? `${extraDays}d extra` : 'En ciclo'}</div>
        </div>
      </div>

      {/* Recurrence indicator */}
      <div className="glw-rec-block">
        <div className="glw-rec-label">Indicador de recurrencia</div>
        <div className="glw-bar-track">
          <div className={`glw-bar-fill ${recColor}`} style={{ width: `${recPct}%` }} />
        </div>
        <div className="glw-rec-meta">
          <span>Última visita: {fmtDate(client.ultima_visita)}</span>
          <span>{daysSince} días transcurridos</span>
        </div>
        {overdue && (
          <div className="glw-rec-note">
            Lleva <strong>{extraDays} días extra</strong> sin visitar — el ciclo esperado era 30 días.
          </div>
        )}
      </div>

      {/* Personal info */}
      <div className="glw-s-title">Información personal</div>
      <div className="glw-info-grid">
        <div className="glw-info-item"><label>Teléfono</label><span>{client.telefono}</span></div>
        <div className="glw-info-item"><label>Email</label><span>{client.email}</span></div>
        {client.cedula && <div className="glw-info-item"><label>Cédula</label><span>{client.cedula}</span></div>}
        <div className="glw-info-item"><label>Cliente desde</label><span>{fmtDate(client.fecha_creacion)}</span></div>
      </div>

      {/* Opportunities */}
      {overdue && (
        <>
          <div className="glw-s-title">Oportunidades</div>
          <div className="glw-op-list">
            <div className="glw-op-item">
              <div className="glw-op-icon">⏰</div>
              <div className="glw-op-body">
                <div className="glw-op-title">Reagendamiento urgente</div>
                <div className="glw-op-desc">{extraDays} días extra sin visitar. Enviar WhatsApp de reactivación.</div>
              </div>
              <button
                className="glw-btn glw-btn-sm"
                onClick={() => {
                  if (client.telefono && client.telefono !== 'No disponible') {
                    window.open(whatsappUrl(client.telefono), '_blank', 'noopener')
                  }
                }}
              >
                Enviar
              </button>
            </div>
          </div>
        </>
      )}

      {/* Last visits */}
      {lastFour.length > 0 && (
        <>
          <div className="glw-s-title">Últimas visitas</div>
          <table className="glw-hist-table">
            <thead>
              <tr>
                <th>Fecha</th>
                <th>Servicio</th>
                <th>Profesional</th>
                <th style={{ textAlign: 'right' }}>Valor</th>
              </tr>
            </thead>
            <tbody>
              {lastFour.map((h, i) => (
                <tr key={i}>
                  <td>{fmtDate(h.fecha)}</td>
                  <td style={{ fontWeight: 500 }}>{h.servicio}</td>
                  <td>{h.profesional}</td>
                  <td style={{ textAlign: 'right', fontWeight: 600 }}>
                    {typeof h.valor_total === 'number' ? fmt(h.valor_total) : h.valor_total || '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
    </>
  )
}

function EvolucionTab({ client }: { client: Cliente }) {
  const fichas = client.fichas ?? []

  if (fichas.length === 0 && (client.historialCitas?.length ?? 0) === 0) {
    return <div className="glw-empty-state">Sin datos de evolución</div>
  }

  const entries = fichas.length > 0
    ? fichas.map(f => ({
        date: fmtDateLong(f.fecha_ficha),
        service: f.servicio_nombre || f.servicio || '—',
        profesional: `${f.profesional_nombre || '—'} · ${f.sede_nombre || f.sede || ''}`,
        notes: f.comentario_interno || f.notas_cliente || '',
      }))
    : client.historialCitas.map(h => ({
        date: fmtDateLong(h.fecha),
        service: h.servicio,
        profesional: h.profesional,
        notes: h.notas || '',
      }))

  return (
    <>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
        <div>
          <div className="glw-s-title" style={{ margin: '0 0 2px' }}>Evolución del cliente</div>
          <div style={{ fontSize: 11.5, color: '#717171' }}>Seguimiento de servicios y sesiones</div>
        </div>
      </div>

      <div className="glw-s-title">Registros</div>
      {entries.map((ev, i) => (
        <div key={i} className="glw-evo-entry">
          <div className="glw-evo-entry-head">
            <div>
              <div className="glw-evo-entry-date">{ev.date}</div>
              <div className="glw-evo-entry-svc">{ev.service}</div>
            </div>
            <div className="glw-evo-entry-prof">{ev.profesional}</div>
          </div>
          {ev.notes && (
            <div className="glw-evo-notes">{ev.notes}</div>
          )}
        </div>
      ))}
    </>
  )
}

function HistorialTab({ client, onFichaChanged }: { client: Cliente; onFichaChanged?: () => void }) {
  const { user } = useAuth()
  const [verTodas, setVerTodas] = useState(false)
  const [descargando, setDescargando] = useState<string | null>(null)
  const [eliminandoId, setEliminandoId] = useState<string | null>(null)
  const [fichaEditando, setFichaEditando] = useState<any>(null)

  const fichas = client.fichas ?? []
  const fichasMostradas = verTodas ? fichas : fichas.slice(0, 5)
  const lastFicha = fichas[0]
  const datosUltimaFicha = lastFicha?.datos_especificos || lastFicha?.contenido

  const historial = client.historialCitas ?? []
  const total = historial.reduce((s, h) => {
    const v = typeof h.valor_total === 'number' ? h.valor_total : Number(h.valor_total) || 0
    return s + v
  }, 0)

  const getAuthToken = () =>
    user?.access_token || localStorage.getItem('access_token') || sessionStorage.getItem('access_token') || ''

  const [paquetes, setPaquetes] = useState<PaqueteCliente[]>([])

  useEffect(() => {
    const token = getAuthToken()
    if (!token || !client.id) return
    clientesService.obtenerPaquetesCliente(token, client.id)
      .then(setPaquetes)
      .catch(() => setPaquetes([]))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [client.id])

  const getDescargaId = (ficha: any): string | undefined =>
    ficha.contenido?.cita_id ||       // real cita_id first
    ficha.datos_especificos?.cita_id ||
    ficha.cita_id ||
    ficha.id ||                        // ficha._id as last resort — backend detects this as a direct ficha lookup
    ficha._id

  const handleEliminarFicha = async (ficha: any) => {
    const fichaId = ficha._id || ficha.id
    const token = getAuthToken()
    if (!fichaId || !token) return

    const confirmado = await confirmAction({
      title: 'Eliminar ficha',
      message: `¿Eliminar la ficha de ${ficha.servicio_nombre || ficha.servicio || 'este servicio'}? Esta acción no se puede deshacer.`,
      confirmLabel: 'Sí, eliminar',
      variant: 'danger',
    })
    if (!confirmado) return

    setEliminandoId(fichaId)
    try {
      const response = await fetch(`${API_BASE_URL}scheduling/quotes/fichas/${fichaId}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      })
      if (!response.ok) {
        const detalle = await response.json().catch(() => null)
        throw new Error(detalle?.detail || `Error ${response.status} al eliminar la ficha`)
      }
      toast.success('Ficha eliminada')
      onFichaChanged?.()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'No se pudo eliminar la ficha')
    } finally {
      setEliminandoId(null)
    }
  }

  const handleDescargar = async (ficha: any) => {
    const token = user?.access_token || localStorage.getItem('access_token') || sessionStorage.getItem('access_token')
    const citaId = getDescargaId(ficha)
    if (!citaId || !token) return
    const fichaKey = ficha._id || ficha.id
    setDescargando(fichaKey)
    try {
      const res = await fetch(
        `${API_BASE_URL}api/pdf/generar-pdf/${client.id}/${citaId}`,
        { headers: { Authorization: `Bearer ${token}`, Accept: 'application/pdf' } },
      )
      if (!res.ok) throw new Error(`Error ${res.status}`)
      const blob = await res.blob()
      const url = window.URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = url
      link.download = `ficha_${(ficha.nombre || 'cliente').replace(/\s+/g, '_').toLowerCase()}_${(ficha.fecha_ficha || '').split('T')[0]}.pdf`
      document.body.appendChild(link)
      link.click()
      setTimeout(() => { document.body.removeChild(link); window.URL.revokeObjectURL(url) }, 100)
    } catch { /* silent */ } finally {
      setDescargando(null)
    }
  }

  if (historial.length === 0 && fichas.length === 0 && paquetes.length === 0) {
    return <div className="glw-empty-state">Sin historial de servicios</div>
  }

  return (
    <>
      {paquetes.length > 0 && (
        <>
          <div className="glw-s-title" style={{ marginTop: 0 }}>Paquetes de sesiones activos</div>
          <table className="glw-hist-table">
            <thead>
              <tr>
                <th>Paquete</th>
                <th>Sesiones restantes</th>
                <th>Comprado</th>
              </tr>
            </thead>
            <tbody>
              {paquetes.map((p) => (
                <tr key={p.paquete_id}>
                  <td>{p.nombre_servicio}</td>
                  <td>{p.sesiones_restantes} de {p.sesiones_totales}</td>
                  <td>{p.fecha_compra ? new Date(p.fecha_compra).toLocaleDateString() : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}

      {fichas.length > 0 && (
        <>
          <div className="glw-s-title" style={{ marginTop: 0 }}>Fichas registradas</div>
          <table className="glw-hist-table">
            <thead>
              <tr>
                <th>Fecha</th>
                <th>Servicio</th>
                <th>Profesional</th>
                <th>Sede</th>
                <th style={{ textAlign: 'right' }}></th>
              </tr>
            </thead>
            <tbody>
              {fichasMostradas.map((ficha: any) => {
                const fichaKey = ficha._id || ficha.id
                const descargaId = getDescargaId(ficha)
                const tieneCitaId = !!descargaId
                return (
                  <tr key={fichaKey}>
                    <td>{fmtDate(ficha.fecha_ficha)}</td>
                    <td style={{ fontWeight: 500 }}>{ficha.servicio_nombre || ficha.servicio || '—'}</td>
                    <td>{ficha.profesional_nombre || '—'}</td>
                    <td>{ficha.sede_nombre || ficha.sede || '—'}</td>
                    <td style={{ textAlign: 'right' }}>
                      <div style={{ display: 'inline-flex', gap: 6 }}>
                        {tieneCitaId ? (
                          <button
                            onClick={() => handleDescargar(ficha)}
                            disabled={descargando === fichaKey}
                            className="glw-btn glw-btn-sm"
                            style={{ fontSize: 11 }}
                          >
                            {descargando === fichaKey ? 'Descargando...' : '↓ Descargar'}
                          </button>
                        ) : (
                          <span style={{ fontSize: 10, color: '#aaa', alignSelf: 'center' }}>—</span>
                        )}
                        <button
                          onClick={() => setFichaEditando(ficha)}
                          className="glw-btn glw-btn-sm"
                          style={{ fontSize: 11 }}
                        >
                          Editar
                        </button>
                        <button
                          onClick={() => handleEliminarFicha(ficha)}
                          disabled={eliminandoId === fichaKey}
                          className="glw-btn glw-btn-sm"
                          style={{ fontSize: 11, color: '#b83030', borderColor: '#f0d0d0' }}
                        >
                          {eliminandoId === fichaKey ? 'Eliminando...' : 'Eliminar'}
                        </button>
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
          {fichas.length > 5 && (
            <button
              onClick={() => setVerTodas(v => !v)}
              className="glw-btn glw-btn-sm"
              style={{ marginTop: 8 }}
            >
              {verTodas ? 'Ver menos' : `Ver todas (${fichas.length})`}
            </button>
          )}

          {datosUltimaFicha?.recomendaciones_personalizadas && (
            <>
              <div className="glw-s-title">Recomendaciones del especialista</div>
              <div className="glw-nota">
                <div className="glw-nota-text">{datosUltimaFicha.recomendaciones_personalizadas}</div>
              </div>
            </>
          )}
        </>
      )}

      {historial.length > 0 && (
        <>
          <div
            style={{
              display: 'flex', justifyContent: 'space-between', alignItems: 'center',
              marginBottom: 14, marginTop: fichas.length > 0 ? 24 : 0,
            }}
          >
            <div className="glw-s-title" style={{ margin: 0 }}>Historial completo</div>
            <span style={{ fontSize: 11.5, color: '#717171' }}>{historial.length} visitas · {fmt(total)}</span>
          </div>
          <table className="glw-hist-table">
            <thead>
              <tr>
                <th>Fecha</th>
                <th>Servicio</th>
                <th>Profesional</th>
                <th>Estado</th>
                <th style={{ textAlign: 'right' }}>Valor</th>
              </tr>
            </thead>
            <tbody>
              {historial.map((h, i) => (
                <tr key={i}>
                  <td>{fmtDate(h.fecha)}</td>
                  <td>
                    <div style={{ fontWeight: 500 }}>{h.servicio}</div>
                  </td>
                  <td>{h.profesional}</td>
                  <td>
                    <span className={`glw-tag ${h.estado_pago === 'pagado' ? 'tag-green' : 'tag-gray'}`}>
                      {h.estado_pago === 'pagado' ? 'Facturada' : h.estado_pago || h.estado || 'Pendiente'}
                    </span>
                  </td>
                  <td style={{ textAlign: 'right', fontWeight: 600 }}>
                    {typeof h.valor_total === 'number' ? fmt(h.valor_total) : h.valor_total || '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}

      {fichaEditando && (
        <FichaEditModal
          ficha={fichaEditando}
          token={getAuthToken()}
          onClose={() => setFichaEditando(null)}
          onSaved={() => onFichaChanged?.()}
        />
      )}
    </>
  )
}


function NotasTab({ client, onNoteAdded }: { client: Cliente; onNoteAdded?: () => void }) {
  const { user } = useAuth()
  const [newNote, setNewNote] = useState('')
  const [saving, setSaving] = useState(false)

  const getToken = () =>
    user?.access_token || sessionStorage.getItem("access_token") || localStorage.getItem("access_token") || ""
  const autorName = user?.name || user?.nombre_local || ''

  const handleSave = useCallback(async () => {
    if (!newNote.trim()) return
    const token = getToken()
    if (!token) return
    setSaving(true)
    try {
      await clientesService.agregarNota(token, client.id, newNote.trim(), autorName)
      setNewNote('')
      onNoteAdded?.()
    } catch (err) {
      console.error("Error guardando nota:", err)
    } finally {
      setSaving(false)
    }
  }, [newNote, client.id, onNoteAdded, autorName])

  const notes = Array.isArray(client.notas_historial) && client.notas_historial.length > 0
    ? client.notas_historial
    : client.nota
    ? [{ contenido: client.nota, fecha: '', autor: '' }]
    : []

  return (
    <>
      {notes.length === 0 ? (
        <div className="glw-empty-state">Sin notas registradas</div>
      ) : (
        notes.map((n, i) => (
          <div key={i} className="glw-nota">
            <div className="glw-nota-meta">
              <span>{fmtDate(n.fecha)}</span>
              {n.autor && <span>{n.autor}</span>}
            </div>
            <div className="glw-nota-text">{n.contenido}</div>
          </div>
        ))
      )}

      <textarea
        className="glw-nota-add"
        value={newNote}
        onChange={e => setNewNote(e.target.value)}
        placeholder="Agregar nota…"
        onKeyDown={e => {
          if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) handleSave()
        }}
      />
      {newNote.trim() && (
        <div className="glw-nota-actions">
          <button
            onClick={handleSave}
            disabled={saving}
            className="glw-btn glw-btn-sm glw-btn-primary"
          >
            {saving ? 'Guardando...' : 'Guardar nota'}
          </button>
        </div>
      )}
    </>
  )
}

// ── Main slide-over panel ────────────────────────────────────

export function ClientDetail({ client, isOpen, onClose, onClientUpdated }: ClientDetailProps) {
  const [tab, setTab] = useState<Tab>('resumen')
  const [isEditOpen, setIsEditOpen] = useState(false)
  const [isDeleting, setIsDeleting] = useState(false)
  const navigate = useNavigate()
  const { user: authUser } = useAuth()
  const token = (authUser as any)?.access_token || sessionStorage.getItem("access_token") || localStorage.getItem("access_token") || ""

  const handleWhatsApp = useCallback(() => {
    if (client.telefono && client.telefono !== 'No disponible') {
      window.open(whatsappUrl(client.telefono), '_blank', 'noopener,noreferrer')
    }
  }, [client.telefono])

  const handleEliminarCliente = useCallback(async () => {
    if (!token) return
    const confirmado = await confirmAction({
      title: 'Eliminar cliente',
      message: `¿Eliminar a ${client.nombre}? No se borra su historial de citas, fichas ni facturación — deja de aparecer en las listas, pero se puede reactivar más adelante.`,
      confirmLabel: 'Sí, eliminar',
      variant: 'danger',
    })
    if (!confirmado) return

    setIsDeleting(true)
    try {
      await clientesService.eliminarCliente(token, client.id)
      toast.success('Cliente eliminado')
      onClientUpdated?.()
      onClose()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'No se pudo eliminar el cliente')
    } finally {
      setIsDeleting(false)
    }
  }, [token, client.id, client.nombre, onClientUpdated, onClose])

  const handleAgendarCita = useCallback(() => {
    navigate('/agenda', {
      state: {
        clienteNombre: client.nombre,
        clienteId: client.id,
        clienteTelefono: client.telefono,
      },
    })
  }, [navigate, client.nombre, client.id, client.telefono])

  const tabs: { key: Tab; label: string }[] = [
    { key: 'resumen', label: 'Resumen' },
    { key: 'evolucion', label: 'Evolución' },
    { key: 'historial', label: 'Historial' },
    { key: 'notas', label: 'Notas' },
  ]

  return (
    <>
      {/* Overlay */}
      <div
        className={`glw-overlay ${isOpen ? 'open' : ''}`}
        onClick={onClose}
      />

      {/* Slide panel */}
      <div className={`glw-slide-panel ${isOpen ? 'open' : ''}`}>
        {/* Panel header */}
        <div className="glw-panel-header">
          <div className="glw-panel-avatar">{ini(client.nombre)}</div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div className="glw-panel-name">{client.nombre}</div>
            <div className="glw-panel-sub">
              <span>{client.telefono}</span>
              <span>{client.email}</span>
              {client.fecha_creacion && (
                <span>Cliente desde {fmtDate(client.fecha_creacion)}</span>
              )}
            </div>
            <div className="glw-panel-actions">
              <button className="glw-btn glw-btn-sm" onClick={handleWhatsApp}>WhatsApp</button>
              <button className="glw-btn glw-btn-sm" onClick={() => setIsEditOpen(true)}>Editar</button>
              <button
                className="glw-btn glw-btn-sm"
                onClick={handleEliminarCliente}
                disabled={isDeleting}
                style={{ color: '#dc2626' }}
              >
                {isDeleting ? 'Eliminando...' : 'Eliminar'}
              </button>
              <button className="glw-btn glw-btn-sm glw-btn-primary" onClick={handleAgendarCita}>Agendar cita</button>
            </div>
          </div>
          <button className="glw-panel-close" onClick={onClose}>✕</button>
        </div>

        {/* Panel tabs */}
        <div className="glw-panel-tabs">
          {tabs.map(t => (
            <div
              key={t.key}
              className={`glw-panel-tab ${tab === t.key ? 'active' : ''}`}
              onClick={() => setTab(t.key)}
            >
              {t.label}
            </div>
          ))}
        </div>

        {/* Panel body */}
        <div className="glw-panel-body">
          {tab === 'resumen' && <ResumenTab client={client} />}
          {tab === 'evolucion' && <EvolucionTab client={client} />}
          {tab === 'historial' && <HistorialTab client={client} onFichaChanged={onClientUpdated} />}
          {tab === 'notas' && <NotasTab client={client} onNoteAdded={onClientUpdated} />}
        </div>
      </div>

      {isEditOpen && (
        <EditClientModal
          cliente={client}
          token={token}
          isOpen={isEditOpen}
          onClose={() => setIsEditOpen(false)}
          onSuccess={() => { setIsEditOpen(false); onClientUpdated?.() }}
        />
      )}
    </>
  )
}