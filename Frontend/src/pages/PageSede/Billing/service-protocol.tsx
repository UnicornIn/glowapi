"use client";

import { toast } from "sonner";
import { confirmAction } from "../../../components/ui/confirm-dialog";
import { Button } from "../../../components/ui/button";
import { X, ChevronRight } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { API_BASE_URL } from "../../../types/config";
import { ProductCatalogModal } from "./ProductCatalogModal";
import { formatSedeNombre } from "../../../lib/sede";
import { formatDateDMY } from "../../../lib/dateFormat";
import { handleFacturarRequest } from "./facturarApi";
import {
  emitElectronicInvoice,
  extractElectronicTargets,
} from "../../../lib/electronic-invoice";
import { resolveAllegraGate } from "../../../lib/allegra-fe";
import { useAuth } from "../../../components/Auth/AuthContext";
import {
  PAYMENT_METHOD_OPTIONS,
  normalizePaymentMethodForBackend,
  getPaymentMethodLabel,
} from "../../../lib/payment-methods";
import { registrarPagoCita } from "../Appoinment/citasApi";
import {
  getPaquetePorId,
  getSesionesPaquete,
  ESTADO_COMISION_LABEL,
  type SesionPaquete,
  registrarPagoPaquete,
  type PaqueteCliente,
} from "../../../components/Quotes/clientsService";

interface Producto {
  _id?: string;
  id: string;
  nombre: string;
  categoria: string;
  descripcion: string;
  imagen: string;
  activo: boolean;
  tipo_codigo: string;
  descuento: string | number;
  stock: string | number;
  precios?: { COP?: number; MXN?: number; USD?: number };
  precio_local?: number;
  moneda_local?: string;
  precio?: number;
  stock_actual?: number;
  stock_minimo?: number;
  tipo_precio?: string;
}

interface HistorialPago {
  fecha: string;
  monto: number;
  metodo: string;
  tipo: string;
  registrado_por: string;
  saldo_despues: number;
  notas?: string;
}

interface Appointment {
  _id: string;
  cliente: string;
  cliente_id?: string;
  cliente_nombre?: string;
  cliente_telefono?: string;
  telefono_cliente?: string;
  fecha: string;
  hora_inicio: string;
  hora_fin: string;
  servicio: string;
  servicio_nombre?: string;
  servicios?: Array<{
    servicio_id: string;
    nombre: string;
    precio: number;
    precio_personalizado?: boolean;
    paquete_id?: string | null;
    numero_sesion?: number | null;
    comprar_paquete_sesiones?: number | null;
  }>;
  precio_total?: number;
  estilista?: string;
  profesional_nombre?: string;
  productos?: Array<{
    producto_id: string;
    nombre: string;
    cantidad: number;
    precio_unitario: number;
    subtotal: number;
    moneda: string;
    comision_porcentaje: number;
    comision_valor: number;
    agregador_por: string;
    agregado_por_rol: string;
    profesional_id: string;
  }>;
  estado: string;
  sede_id: string;
  sede_nombre?: string;
  valor_total?: number;
  estado_pago?: string;
  estado_factura?: string;
  abono?: number;
  saldo_pendiente?: number;
  historial_pagos?: HistorialPago[];
  ficha_realizada?: boolean;
  date?: string;
  appointment_date?: string;
}

interface ServiceProtocolProps {
  selectedAppointment: Appointment | null;
  onClose?: () => void;
  onAppointmentUpdated?: (appointment: Appointment) => void;
}

const formatMoney = (amount: number): string => {
  if (typeof amount !== "number" || isNaN(amount)) amount = 0;
  return amount.toLocaleString("es-CO", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  });
};

const getInitials = (name: string): string =>
  name
    .split(" ")
    .map((w) => w[0])
    .filter(Boolean)
    .slice(0, 2)
    .join("")
    .toUpperCase();

const getEstadoLabel = (estado: string): string => {
  const e = estado?.toLowerCase() || "";
  if (e.includes("complet")) return "Completada";
  if (e.includes("confirm")) return "Confirmada";
  if (e.includes("cancel")) return "Cancelada";
  if (e.includes("finaliz")) return "Finalizada";
  if (e.includes("factur")) return "Facturada";
  if (e.includes("termin")) return "Terminada";
  if (e.includes("realiz")) return "Realizada";
  if (e.includes("pendien")) return "Pendiente";
  return "—";
};

const getEstadoPagoLabel = (estado?: string): string => {
  if (!estado) return "Pendiente";
  const e = estado.toLowerCase();
  if (e === "pagado") return "Pagado";
  if (e === "pendiente") return "Pendiente";
  if (e === "parcial") return "Parcial";
  return estado;
};

const getEstadoColor = (label: string): string => {
  switch (label) {
    case "Completada":
    case "Pagado":
    case "Realizada":
    case "Facturada":
      return "text-teal-600 font-semibold";
    case "Pendiente":
      return "text-orange-500 font-semibold";
    case "Cancelada":
      return "text-red-600 font-semibold";
    default:
      return "text-gray-700 font-medium";
  }
};

export function ServiceProtocol({
  selectedAppointment,
  onClose,
  onAppointmentUpdated,
}: ServiceProtocolProps) {
  const { user, activeSedeId } = useAuth();
  const [lastFacturarResult, setLastFacturarResult] = useState<any>(null);
  // TODO: variables feStatus/feMessage eliminadas por saneamiento TS, posible
  // funcionalidad incompleta: la UI que mostraba el estado del envío de factura
  // electrónica fue retirada, pero los setters siguen usándose en los flujos de
  // reset y facturación.
  const [, setFeStatus] = useState<"idle" | "loading" | "success" | "error">(
    "idle",
  );
  const [, setFeMessage] = useState<string | null>(null);
  const [showProductModal, setShowProductModal] = useState(false);
  const [selectedProducts, setSelectedProducts] = useState<Producto[]>([]);
  const [productsQuantities, setProductsQuantities] = useState<Record<string, number>>({});
  const [isFacturando, setIsFacturando] = useState(false);

  const [selectedPaymentMethod, setSelectedPaymentMethod] = useState("efectivo");
  const [paymentAmount, setPaymentAmount] = useState("");
  const [registrandoPago, setRegistrandoPago] = useState(false);

  const activeSedeNombre =
    (typeof window !== "undefined"
      ? sessionStorage.getItem("beaux-nombre_local") ||
        localStorage.getItem("beaux-nombre_local")
      : null) ||
    user?.nombre_local ||
    "";

  const allegraGate = useMemo(
    () => resolveAllegraGate({ sedeId: activeSedeId, sedeNombre: activeSedeNombre }),
    [activeSedeId, activeSedeNombre],
  );
  const allegraEnabled = allegraGate.allowed;

  const feTarget = useMemo(() => {
    const fromLast = extractElectronicTargets(lastFacturarResult);
    const fromAppointment = extractElectronicTargets(selectedAppointment as any);
    return {
      saleId: fromLast.saleId || fromAppointment.saleId,
      invoiceId: fromLast.invoiceId || fromAppointment.invoiceId,
    };
  }, [lastFacturarResult, selectedAppointment]);

  const hasFeTarget = Boolean(feTarget.saleId || feTarget.invoiceId);

  useEffect(() => {
    setFeStatus("idle");
    setFeMessage(null);
    setLastFacturarResult(null);
    setSelectedProducts([]);
    setProductsQuantities({});
    setSelectedPaymentMethod("efectivo");
    setPaymentAmount("");
  }, [selectedAppointment?._id]);

  useEffect(() => {
    if (selectedAppointment?.productos && selectedAppointment.productos.length > 0) {
      const prods: Producto[] = selectedAppointment.productos.map((p) => ({
        id: p.producto_id,
        nombre: p.nombre,
        categoria: "",
        descripcion: "",
        imagen: "",
        activo: true,
        tipo_codigo: "",
        descuento: 0,
        stock: 0,
        precio: p.precio_unitario,
      }));
      const qtys: Record<string, number> = {};
      selectedAppointment.productos.forEach((p) => {
        qtys[p.producto_id] = p.cantidad;
      });
      setSelectedProducts(prods);
      setProductsQuantities(qtys);
    }
  }, [selectedAppointment?._id]);

  const servicioTotal = useMemo(() => {
    if (!selectedAppointment) return 0;
    return (
      selectedAppointment.precio_total ||
      selectedAppointment.valor_total ||
      selectedAppointment.servicios?.reduce((sum, s) => sum + (s.precio || 0), 0) ||
      0
    );
  }, [selectedAppointment]);

  const productosTotal = useMemo(() => {
    return selectedProducts.reduce((sum, product) => {
      const precio = product.precio || 0;
      const cantidad = productsQuantities[product.id] || 1;
      return sum + precio * cantidad;
    }, 0);
  }, [selectedProducts, productsQuantities]);

  // ── Paquete de sesiones ─────────────────────────────────────────────────
  // Un paquete es UNA venta: se factura una sola vez desde la cita que lo
  // compró, con lo pagado en todas sus sesiones. Una sesión ($0) no se
  // factura sola — desde acá se factura el paquete completo.
  const lineaPaquete = selectedAppointment?.servicios?.find((s) => s.paquete_id);
  const paqueteId = lineaPaquete?.paquete_id || null;
  const [paquete, setPaquete] = useState<PaqueteCliente | null>(null);
  const [cargandoPaquete, setCargandoPaquete] = useState(false);
  // Esta cita dentro del paquete: valor de la sesión y comisión de quien la atendió.
  const [sesionPaquete, setSesionPaquete] = useState<SesionPaquete | null>(null);
  const [sesionesPaquete, setSesionesPaquete] = useState<SesionPaquete[]>([]);

  const recargarPaquete = async () => {
    const token = user?.access_token || localStorage.getItem("access_token") || sessionStorage.getItem("access_token");
    if (!paqueteId || !token) {
      setPaquete(null);
      return;
    }
    setCargandoPaquete(true);
    try {
      const [datosPaquete, sesiones] = await Promise.all([
        getPaquetePorId(token, paqueteId),
        getSesionesPaquete(token, paqueteId).catch(() => null),
      ]);
      setPaquete(datosPaquete);
      setSesionesPaquete(sesiones?.sesiones || []);
      setSesionPaquete(sesiones?.sesiones.find((s) => s.cita_id === selectedAppointment?._id) || null);
    } finally {
      setCargandoPaquete(false);
    }
  };

  useEffect(() => {
    void recargarPaquete();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [paqueteId, selectedAppointment?._id]);

  const esCompraPaquete = !!paquete && paquete.cita_origen_id === selectedAppointment?._id;
  const esSesionPaquete = !!paquete && !esCompraPaquete;
  const paqueteFacturado = !!paquete?.facturacion;

  // Acumulado del paquete por profesional: qué sesiones ha hecho cada uno,
  // cuánto valen y cuánta comisión lleva (las agendadas van aparte, estimadas).
  const acumuladoProfesionales = useMemo(() => {
    const grupos = new Map<string, {
      nombre: string;
      realizadas: number[];
      agendadas: number[];
      valorRealizado: number;
      comisionRealizada: number;
      comisionEstimada: number;
      porcentaje: number;
    }>();
    for (const s of sesionesPaquete) {
      const c = s.comision;
      if (!c || s.cuenta === "no_cuenta") continue;
      const nombre = c.profesional_nombre || s.profesional_nombre || "Sin profesional";
      const g = grupos.get(nombre) || {
        nombre,
        realizadas: [],
        agendadas: [],
        valorRealizado: 0,
        comisionRealizada: 0,
        comisionEstimada: 0,
        porcentaje: c.porcentaje,
      };
      const numero = s.numero_sesion ?? 0;
      if (s.cuenta === "consumida") {
        g.realizadas.push(numero);
        g.valorRealizado += c.valor_sesion;
        g.comisionRealizada += c.comision;
      } else {
        g.agendadas.push(numero);
        g.comisionEstimada += c.comision;
      }
      grupos.set(nombre, g);
    }
    return Array.from(grupos.values()).sort((a, b) => b.realizadas.length - a.realizadas.length);
  }, [sesionesPaquete]);

  const totalGeneral = servicioTotal + productosTotal;
  const totalPagado = paquete ? paquete.abono : (selectedAppointment?.abono ?? 0);
  const saldoPendiente = paquete
    ? paquete.saldo_pendiente
    : (selectedAppointment?.saldo_pendiente ?? (totalGeneral - totalPagado));

  const clientName =
    selectedAppointment?.cliente_nombre || selectedAppointment?.cliente || "No especificado";
  const clientPhone = selectedAppointment?.cliente_telefono || selectedAppointment?.telefono_cliente || "";
  const sedeNombre = selectedAppointment?.sede_nombre || formatSedeNombre(activeSedeNombre, "—");

  const nombreServicioPrincipal =
    selectedAppointment?.servicios?.[0]?.nombre ||
    selectedAppointment?.servicio_nombre ||
    selectedAppointment?.servicio ||
    "Servicio";

  const fechaFormateada = formatDateDMY(selectedAppointment?.fecha || "", "");
  const horarioDisplay = `${selectedAppointment?.hora_inicio}–${selectedAppointment?.hora_fin}`;

  const estadoCitaLabel = getEstadoLabel(selectedAppointment?.estado || "");
  const estadoPagoLabel = getEstadoPagoLabel(selectedAppointment?.estado_pago);
  // La ficha la marca el backend (`ficha_realizada`: hay una ficha con esta
  // cita). Una venta directa no lleva ficha.
  const fichaLabel = (selectedAppointment as any)?.tipo_origen === "venta_directa"
    ? "No aplica"
    : selectedAppointment?.ficha_realizada ? "Realizada" : "Pendiente";

  const isPagado = paquete
    ? paquete.saldo_pendiente <= 0
    : selectedAppointment?.estado_pago?.toLowerCase() === "pagado";

  // Handlers
  const handleAddProducts = (products: Producto[]) => {
    if (products.length === 0) {
      setSelectedProducts([]);
      setProductsQuantities({});
      return;
    }
    const productosExistentes = new Map(selectedProducts.map((p) => [p.id, p]));
    const nuevasCantidades = { ...productsQuantities };
    const productosActualizados = [...selectedProducts];

    products.forEach((product) => {
      if (product?.id) {
        if (productosExistentes.has(product.id)) {
          nuevasCantidades[product.id] = (nuevasCantidades[product.id] || 1) + 1;
        } else {
          productosActualizados.push(product);
          nuevasCantidades[product.id] = 1;
        }
      }
    });
    setSelectedProducts(productosActualizados);
    setProductsQuantities(nuevasCantidades);
  };

  const handleDeleteProduct = async (productId: string) => {
    if (!selectedAppointment?._id) return;

    const product = selectedProducts.find((p) => p.id === productId);
    if (!product) return;

    const confirmed = await confirmAction({
      title: "Eliminar producto",
      message: `¿Eliminar "${product.nombre}"?`,
      confirmLabel: "Sí, eliminar",
      variant: "danger",
    });
    if (!confirmed) return;

    try {
      const token = localStorage.getItem("access_token") || sessionStorage.getItem("access_token");
      if (!token) return;

      const response = await fetch(
        `${API_BASE_URL}scheduling/quotes/cita/${selectedAppointment._id}/productos/${productId}`,
        {
          method: "DELETE",
          headers: { Authorization: `Bearer ${token}` },
        },
      );

      if (!response.ok) throw new Error("Error al eliminar");

      setSelectedProducts((prev) => prev.filter((p) => p.id !== productId));
      setProductsQuantities((prev) => {
        const next = { ...prev };
        delete next[productId];
        return next;
      });
    } catch (error) {
      toast.error("Error al eliminar producto");
    }
  };

  const handleRegistrarPago = async () => {
    if (!selectedAppointment?._id) return;

    const token =
      user?.access_token ||
      localStorage.getItem("access_token") ||
      sessionStorage.getItem("access_token");
    if (!token) {
      toast.error("No se encontró token");
      return;
    }

    const monto = parseFloat(paymentAmount);
    if (!monto || monto <= 0) {
      toast.error("Ingresa un monto válido");
      return;
    }

    if (monto > saldoPendiente) {
      toast.error("El monto excede el saldo pendiente");
      return;
    }

    const metodo = normalizePaymentMethodForBackend(selectedPaymentMethod);

    const confirmedPago = await confirmAction({
      title: "Registrar pago",
      message: `¿Registrar $${formatMoney(monto)} por ${metodo}?`,
      confirmLabel: "Sí, registrar",
      variant: "primary",
    });
    if (!confirmedPago) return;

    setRegistrandoPago(true);
    try {
      if (paquete) {
        // Queda guardado en esta sesión (caja lo ve hoy) y abona al paquete.
        const actualizado = await registrarPagoPaquete(token, paquete.paquete_id, {
          monto,
          metodo,
          cita_id: selectedAppointment._id,
        });
        setPaquete(actualizado);
        setPaymentAmount("");
        toast.success("Pago registrado al paquete");
        return;
      }
      const response = await registrarPagoCita(
        selectedAppointment._id,
        { monto, metodo_pago: metodo },
        token,
      );

      const updatedAppointment: Appointment = {
        ...selectedAppointment,
        abono: response.abono ?? totalPagado + monto,
        saldo_pendiente: response.saldo_pendiente ?? saldoPendiente - monto,
        estado_pago: response.estado_pago || selectedAppointment.estado_pago,
      };

      onAppointmentUpdated?.(updatedAppointment);
      setPaymentAmount("");
      toast.success("Pago registrado");
    } catch (error: any) {
      toast.error(error?.message || "Error al registrar pago");
    } finally {
      setRegistrandoPago(false);
    }
  };

  const handleFacturarCita = async () => {
    if (!selectedAppointment?._id) return;
    // Desde una sesión se factura la cita que compró el paquete.
    const idAFacturar = esSesionPaquete && paquete?.cita_origen_id ? paquete.cita_origen_id : selectedAppointment._id;

    try {
      setIsFacturando(true);
      setFeStatus("idle");
      setFeMessage(null);

      const token = localStorage.getItem("access_token") || sessionStorage.getItem("access_token");
      if (!token) {
        toast.error("No hay token");
        return;
      }

      const currentSaldo = paquete
        ? paquete.saldo_pendiente
        : selectedAppointment.saldo_pendiente ??
          (selectedAppointment.valor_total || 0) - (selectedAppointment.abono || 0);
      if (currentSaldo > 0) {
        toast.warning(`Saldo pendiente: $${formatMoney(currentSaldo)}`);
        return;
      }

      const confirmedFacturar = await confirmAction({
        title: paquete ? "Facturar paquete" : "Facturar cita",
        message: paquete
          ? `Se emite UNA factura por el paquete "${paquete.nombre_servicio}" (${formatMoney(paquete.valor_total)}) con todos los pagos de sus sesiones. Las sesiones quedan cubiertas por esa factura.`
          : "¿Facturar esta cita?",
        confirmLabel: "Sí, facturar",
        variant: "primary",
      });
      if (!confirmedFacturar) return;

      const productosParaFacturar = selectedProducts.map((product) => ({
        producto_id: product.id,
        nombre: product.nombre,
        precio: Number(product.precio || 0),
        cantidad: productsQuantities[product.id] || 1,
        categoria: product.categoria,
      }));

      const result = await handleFacturarRequest({
        id: idAFacturar,
        tipo: "cita",
        token,
        productos: productosParaFacturar,
        total_productos: productosTotal,
        total_final: totalGeneral,
      });

      setLastFacturarResult(result);
      toast.success("Facturación exitosa");

      setSelectedProducts([]);
      setProductsQuantities({});

      const updatedAppointment = {
        ...selectedAppointment,
        estado_factura: "facturado",
        estado_pago: "pagado",
        saldo_pendiente: 0,
      };
      onAppointmentUpdated?.(updatedAppointment);
    } catch (error: any) {
      toast.error(error?.message || "Error al facturar", { duration: 8000 });
    } finally {
      setIsFacturando(false);
    }
  };

  // TODO: posible funcionalidad incompleta — el botón que disparaba el envío
  // manual de factura electrónica (Allegra) fue retirado de la UI, dejando esta
  // función sin uso. Se conserva intacta (regla: no tocar lógica de facturación)
  // y se referencia con `void` para que el build de TypeScript pase.
  const handleSendFe = async () => {
    if (!allegraEnabled || !hasFeTarget) return;

    const token = user?.access_token;
    if (!token) {
      setFeStatus("error");
      setFeMessage("No hay token");
      return;
    }

    try {
      setFeStatus("loading");
      setFeMessage(null);
      const result = await emitElectronicInvoice({
        saleId: feTarget.saleId,
        invoiceId: feTarget.invoiceId,
        token,
        sedeId: activeSedeId,
      });
      setFeStatus("success");
      setFeMessage(result.message);
    } catch (error) {
      setFeStatus("error");
      setFeMessage("Error al enviar FE");
    }
  };
  void handleSendFe;

  if (!selectedAppointment) {
    return (
      <div className="h-full flex flex-col items-center justify-center p-8 text-center">
        <div className="mb-3 rounded-full bg-gray-100 p-3">
          <svg
            className="h-6 w-6 text-gray-400"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={1.5}
              d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2"
            />
          </svg>
        </div>
        <h3 className="text-sm font-semibold text-gray-900">Selecciona una cita</h3>
        <p className="text-xs text-gray-500 mt-1">Haz clic en una cita para ver detalles</p>
      </div>
    );
  }

  return (
    <>
      <ProductCatalogModal
        isOpen={showProductModal}
        onClose={() => setShowProductModal(false)}
        onAddProducts={handleAddProducts}
        selectedProducts={selectedProducts}
        citaId={selectedAppointment._id}
      />

      <div className="h-full flex flex-col bg-white">
        <div className="flex-1 overflow-y-auto">
          {/* Header */}
          <div className="px-6 pt-5 pb-4 border-b border-gray-200">
            <div className="flex items-start justify-between">
              <div className="flex-1">
                <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-1">
                  Detalle de cita
                </p>
                <h2 className="text-[15px] font-bold text-gray-900 leading-tight">
                  {nombreServicioPrincipal}
                </h2>
                <p className="text-xs text-gray-500 mt-0.5">
                  {fechaFormateada} · {horarioDisplay}
                </p>
              </div>
              {onClose && (
                <button
                  onClick={onClose}
                  className="p-1 rounded-lg hover:bg-gray-100 text-gray-400 hover:text-gray-900"
                >
                  <X className="h-[18px] w-[18px]" />
                </button>
              )}
            </div>
          </div>

          {/* CLIENTE */}
          <div className="px-6 py-4 border-b border-gray-200">
            <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3">
              Cliente
            </p>
            <div className="flex items-center gap-3 p-3 rounded-lg bg-gray-50 hover:bg-gray-100 cursor-pointer transition-colors">
              <div className="w-10 h-10 rounded-full bg-gray-700 flex items-center justify-center text-white text-xs font-bold flex-shrink-0">
                {getInitials(clientName)}
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold text-gray-900">{clientName}</p>
                {clientPhone && <p className="text-xs text-gray-500">{clientPhone}</p>}
              </div>
              <ChevronRight className="h-4 w-4 text-gray-300 flex-shrink-0" />
            </div>
          </div>

          {/* ESTADO */}
          <div className="px-6 py-4 border-b border-gray-200">
            <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3">
              Estado
            </p>
            <div className="space-y-1">
              <div className="flex items-center justify-between p-3 rounded-md bg-gray-50 text-sm">
                <span className="font-medium text-gray-700">Cita</span>
                <span className={getEstadoColor(estadoCitaLabel)}>
                  {estadoCitaLabel}
                </span>
              </div>
              <div className="flex items-center justify-between p-3 rounded-md bg-gray-50 text-sm">
                <span className="font-medium text-gray-700">Pago</span>
                <span className={getEstadoColor(estadoPagoLabel)}>
                  {estadoPagoLabel}
                </span>
              </div>
              <div className="flex items-center justify-between p-3 rounded-md bg-gray-50 text-sm">
                <span className="font-medium text-gray-700">Ficha</span>
                <span className={getEstadoColor(fichaLabel)}>
                  {fichaLabel}
                </span>
              </div>
            </div>
          </div>

          {/* DETALLE */}
          <div className="px-6 py-4 border-b border-gray-200">
            <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3">
              Detalle
            </p>
            <div className="text-[13px]">
              <div className="flex items-center justify-between py-2">
                <span className="text-gray-500 text-xs">Profesional</span>
                <span className="font-medium text-gray-900">
                  {selectedAppointment.profesional_nombre || selectedAppointment.estilista || "—"}
                </span>
              </div>
              <div className="flex items-center justify-between py-2 border-t border-gray-100">
                <span className="text-gray-500 text-xs">Sede</span>
                <span className="font-medium text-gray-900">{sedeNombre}</span>
              </div>
              <div className="flex items-center justify-between py-2 border-t border-gray-100">
                <span className="text-gray-500 text-xs">Horario</span>
                <span className="font-medium text-gray-900">{horarioDisplay}</span>
              </div>
            </div>
          </div>

          {/* SERVICIO */}
          <div className="px-6 py-4 border-b border-gray-200">
            <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3">
              Servicio
            </p>
            <div className="flex items-center justify-between p-3 rounded-md bg-gray-50">
              <div>
                <p className="text-[13px] font-medium text-gray-900">{nombreServicioPrincipal}</p>
                <p className="text-[10px] text-gray-400">Servicio</p>
              </div>
              <span className="text-[13px] font-bold text-gray-900">${formatMoney(servicioTotal)}</span>
            </div>
          </div>

          {/* PRODUCTOS AGREGADOS */}
          <div className="px-6 py-4 border-b border-gray-200">
            <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3">
              Productos Agregados
            </p>

            {selectedProducts.length > 0 && (
              <div className="space-y-2 mb-3">
                {Object.entries(productsQuantities).map(([productId, quantity]) => {
                  const product = selectedProducts.find((p) => p.id === productId);
                  if (!product) return null;
                  const precio = product.precio || 0;

                  return (
                    <div
                      key={productId}
                      className="flex items-center justify-between p-3 rounded-md bg-gray-50"
                    >
                      <div className="flex-1 min-w-0">
                        <p className="text-[13px] font-medium text-gray-900 truncate">
                          {product.nombre}
                          {quantity > 1 && (
                            <span className="text-gray-400 ml-1">×{quantity}</span>
                          )}
                        </p>
                        <p className="text-[10px] text-gray-400">Producto</p>
                      </div>
                      <div className="flex items-center gap-1 ml-2 flex-shrink-0">
                        <span className="text-[13px] font-bold text-gray-900">
                          ${formatMoney(precio * quantity)}
                        </span>
                        <button
                          onClick={() => handleDeleteProduct(productId)}
                          className="px-1.5 py-0.5 rounded text-gray-400 text-base hover:bg-gray-200 hover:text-gray-900"
                        >
                          ×
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}

            <div
              onClick={() => setShowProductModal(true)}
              className="w-full py-2 px-3 border border-gray-200 rounded-md text-sm text-gray-400 hover:border-gray-400 transition-colors cursor-pointer"
            >
              + Agregar producto...
            </div>
          </div>

          {/* TOTAL */}
          <div className="px-6 py-3 border-b border-gray-200">
            <div className="flex items-center justify-between pt-2 border-t border-gray-200">
              <span className="text-sm font-bold text-gray-900">Total</span>
              <span className="text-sm font-bold text-gray-900">${formatMoney(totalGeneral)}</span>
            </div>
          </div>

          {/* PAQUETE DE SESIONES */}
          {paqueteId && (
            <div className="px-6 py-4 border-b border-gray-200">
              <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3">
                Paquete de sesiones
              </p>
              {cargandoPaquete && !paquete ? (
                <p className="text-xs text-gray-400">Cargando paquete...</p>
              ) : paquete ? (
                <div className="rounded-md bg-gray-50 p-3 text-[13px] space-y-3">
                  <div className="flex justify-between items-baseline">
                    <span className="font-semibold text-gray-900">{paquete.nombre_servicio}</span>
                    <span className="font-bold text-gray-900">${formatMoney(paquete.valor_total)}</span>
                  </div>

                  {/* Datos de esta cita */}
                  <dl className="space-y-1 text-xs">
                    {([
                      [
                        "Esta cita",
                        esCompraPaquete
                          ? `Compra del paquete (sesión ${sesionPaquete?.numero_sesion ?? lineaPaquete?.numero_sesion ?? 1} de ${paquete.sesiones_totales})`
                          : `Sesión ${sesionPaquete?.numero_sesion ?? lineaPaquete?.numero_sesion ?? "–"} de ${paquete.sesiones_totales}`,
                      ],
                      [
                        "Avance",
                        `${paquete.sesiones_usadas} realizadas · ${paquete.sesiones_agendadas ?? 0} agendadas · ${
                          paquete.sesiones_disponibles ??
                          Math.max(paquete.sesiones_totales - paquete.sesiones_usadas - (paquete.sesiones_agendadas ?? 0), 0)
                        } disponibles`,
                      ],
                      [
                        "Valor por sesión",
                        `$${formatMoney(paquete.valor_por_sesion)} ($${formatMoney(paquete.valor_total)} ÷ ${paquete.sesiones_totales})`,
                      ],
                      ...(sesionPaquete?.comision && sesionPaquete.comision.estado !== "no_cuenta"
                        ? [
                            ["Profesional", sesionPaquete.comision.profesional_nombre || "—"],
                            [
                              "Comisión de esta sesión",
                              `$${formatMoney(sesionPaquete.comision.comision)}${
                                sesionPaquete.comision.porcentaje ? ` (${sesionPaquete.comision.porcentaje}%)` : ""
                              } · ${ESTADO_COMISION_LABEL[sesionPaquete.comision.estado] || sesionPaquete.comision.estado}`,
                            ],
                          ]
                        : []),
                      [
                        "Facturación",
                        paqueteFacturado
                          ? `Facturado · comprobante ${paquete.facturacion?.numero_comprobante}`
                          : "Una sola factura, con lo pagado en todas las sesiones",
                      ],
                    ] as [string, string][]).map(([etiqueta, valor]) => (
                      <div key={etiqueta} className="flex justify-between gap-3">
                        <dt className="text-gray-500 shrink-0">{etiqueta}</dt>
                        <dd className="text-gray-900 font-medium text-right">{valor}</dd>
                      </div>
                    ))}
                  </dl>

                  {/* Acumulado por profesional */}
                  {acumuladoProfesionales.length > 0 && (
                    <div className="pt-2 border-t border-gray-200 space-y-2">
                      <p className="text-[11px] font-semibold text-gray-400 uppercase tracking-wider">
                        Acumulado por profesional
                      </p>
                      {acumuladoProfesionales.map((g) => (
                        <div key={g.nombre} className="rounded-md bg-white border border-gray-200 px-3 py-2 text-xs">
                          <div className="flex justify-between gap-2">
                            <span className="font-semibold text-gray-900">{g.nombre}</span>
                            <span className="font-bold text-gray-900">${formatMoney(g.comisionRealizada)}</span>
                          </div>
                          <ul className="mt-1 space-y-0.5 text-gray-600">
                            <li>
                              • {g.realizadas.length} sesión(es) realizada(s)
                              {g.realizadas.length > 0 && ` (n.º ${[...g.realizadas].sort((x, y) => x - y).join(", ")})`}
                            </li>
                            {g.realizadas.length > 0 && (
                              <li>
                                • {g.realizadas.length} × ${formatMoney(paquete.valor_por_sesion)} = ${formatMoney(g.valorRealizado)}
                                {g.porcentaje ? ` × ${g.porcentaje}% = $${formatMoney(g.comisionRealizada)}` : " · sin % configurado"}
                              </li>
                            )}
                            {g.agendadas.length > 0 && (
                              <li className="text-gray-400">
                                • {g.agendadas.length} agendada(s) (n.º {[...g.agendadas].sort((x, y) => x - y).join(", ")})
                                {" · "}+${formatMoney(g.comisionEstimada)} estimado
                              </li>
                            )}
                          </ul>
                        </div>
                      ))}
                      <div className="flex justify-between text-xs px-1">
                        <span className="text-gray-500">
                          Total comisiones ({acumuladoProfesionales.reduce((t, g) => t + g.realizadas.length, 0)} sesiones realizadas)
                        </span>
                        <span className="font-bold text-gray-900">
                          ${formatMoney(acumuladoProfesionales.reduce((t, g) => t + g.comisionRealizada, 0))}
                        </span>
                      </div>
                    </div>
                  )}
                </div>
              ) : null}
            </div>
          )}

          {/* PAGOS */}
          <div className="px-6 py-4 border-b border-gray-200">
            <div className="border border-gray-200 rounded-lg overflow-hidden">
              {/* Pay header */}
              <div className="flex items-center justify-between px-4 py-3 bg-gray-50 text-sm font-semibold">
                <span>{paquete ? "Pagos del paquete" : "Pagos"}</span>
                <span className="text-xs font-medium text-gray-500">
                  Cobrado: ${formatMoney(totalPagado)} / ${formatMoney(paquete ? paquete.valor_total : totalGeneral)}
                </span>
              </div>

              <div className="p-4">
                {/* Payment history list — paquete: todos sus pagos, con la sesión donde se recibió */}
                {paquete && (paquete.pagos?.length ?? 0) > 0 && (
                  <div className="mb-3">
                    {paquete.pagos!.map((pago, idx) => (
                      <div
                        key={`${pago.origen}-${pago.cita_id}-${pago.indice}`}
                        className={`flex items-center justify-between py-2 text-sm ${idx > 0 ? "border-t border-gray-100" : ""}`}
                      >
                        <div className="min-w-0">
                          <p className="font-medium text-gray-800">
                            {formatDateDMY(pago.fecha, "")} · {getPaymentMethodLabel(pago.metodo)}
                          </p>
                          <p className={`text-[10px] ${pago.origen === "paquete" ? "text-amber-700 font-semibold" : "text-gray-400"}`}>
                            {pago.origen === "paquete"
                              ? "Solo en el paquete · resolver desde la agenda"
                              : pago.es_origen
                                ? "Compra del paquete"
                                : `Sesión ${pago.numero_sesion ?? "–"} (${formatDateDMY(pago.fecha_cita || "", "")})`}
                          </p>
                        </div>
                        <span className="font-semibold text-gray-900">${formatMoney(pago.monto)}</span>
                      </div>
                    ))}
                  </div>
                )}
                {!paquete && (selectedAppointment?.historial_pagos?.length ?? 0) > 0 && (
                  <div className="mb-3">
                    {selectedAppointment!.historial_pagos!.filter((p) => (p.monto ?? 0) > 0).map((pago, idx) => (
                      <div
                        key={idx}
                        className={`flex items-center justify-between py-2 text-sm ${idx > 0 ? "border-t border-gray-100" : ""}`}
                      >
                        <span className="font-medium text-gray-800">
                          {getPaymentMethodLabel(pago.metodo)}
                        </span>
                        <span className="font-semibold text-gray-900">
                          ${formatMoney(pago.monto)}
                        </span>
                      </div>
                    ))}
                  </div>
                )}

                {/* Balance */}
                <div className="flex items-center justify-between p-3 rounded-md bg-gray-50 border border-gray-200 text-sm font-semibold mb-3">
                  <span>{saldoPendiente > 0 ? "Saldo pendiente" : "Pagado"}</span>
                  <span>{saldoPendiente > 0 ? `$${formatMoney(saldoPendiente)}` : "✓"}</span>
                </div>

                {/* Payment form */}
                {saldoPendiente > 0 && !isPagado && (
                  <div className="border-t border-gray-200 pt-3">
                    <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">
                      Registrar pago
                    </p>

                    <div className="flex flex-wrap gap-1 mb-3">
                      {PAYMENT_METHOD_OPTIONS.map(({ id, label }) => {
                        const isSelected = selectedPaymentMethod === id;
                        return (
                          <button
                            key={id}
                            onClick={() => setSelectedPaymentMethod(id)}
                            disabled={registrandoPago}
                            className={`px-2.5 py-1.5 rounded-md text-xs font-medium border transition-colors ${
                              isSelected
                                ? "border-2 border-gray-900 text-gray-900 bg-gray-50 font-semibold"
                                : "border-gray-200 text-gray-500 hover:border-gray-400"
                            }`}
                          >
                            {label}
                          </button>
                        );
                      })}
                    </div>

                    <div className="flex items-center gap-2 mb-2">
                      <div className="flex-1 relative">
                        <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-xs text-gray-400 font-semibold">$</span>
                        <input
                          type="text"
                          value={paymentAmount}
                          onChange={(e) => setPaymentAmount(e.target.value.replace(/[^0-9]/g, ""))}
                          placeholder={String(saldoPendiente)}
                          className="w-full py-2.5 pl-5 pr-3 border border-gray-200 rounded-md text-base font-semibold text-gray-900 outline-none focus:border-gray-900"
                          disabled={registrandoPago}
                        />
                      </div>
                      <Button
                        onClick={handleRegistrarPago}
                        disabled={registrandoPago || !paymentAmount || parseFloat(paymentAmount) <= 0}
                        className="bg-gray-900 hover:bg-gray-800 text-white text-sm font-semibold px-4"
                      >
                        Agregar
                      </Button>
                    </div>

                    <div className="flex gap-1">
                      <button
                        onClick={() => setPaymentAmount(String(saldoPendiente))}
                        className="px-2 py-1 rounded border border-gray-200 text-[10px] font-medium text-gray-500 hover:bg-gray-50"
                      >
                        Total
                      </button>
                      <button
                        onClick={() => setPaymentAmount(String(Math.round(saldoPendiente / 2)))}
                        className="px-2 py-1 rounded border border-gray-200 text-[10px] font-medium text-gray-500 hover:bg-gray-50"
                      >
                        50%
                      </button>
                      <button
                        onClick={() => setPaymentAmount("100000")}
                        className="px-2 py-1 rounded border border-gray-200 text-[10px] font-medium text-gray-500 hover:bg-gray-50"
                      >
                        $100,000
                      </button>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="flex-shrink-0 border-t border-gray-200">
          {paqueteFacturado ? (
            <button
              className="w-full py-3.5 text-center text-sm font-bold text-gray-500 bg-gray-100 cursor-default rounded-lg"
              disabled
            >
              Cubierta por la factura del paquete ({paquete?.facturacion?.numero_comprobante})
            </button>
          ) : saldoPendiente > 0 && !isPagado ? (
            <button
              className="w-full py-3.5 text-center text-sm font-bold text-white bg-gray-900 opacity-30 cursor-default rounded-lg"
              disabled
            >
              {paquete ? "Paquete pendiente" : "Pendiente"}: ${formatMoney(saldoPendiente)}
            </button>
          ) : (
            <button
              onClick={handleFacturarCita}
              disabled={isFacturando}
              className="w-full py-3.5 text-center text-sm font-bold text-white bg-gray-900 hover:bg-gray-800 disabled:opacity-50 rounded-lg"
            >
              {isFacturando ? "Facturando..." : paquete ? "Facturar paquete completo" : "Factura completa"}
            </button>
          )}
        </div>
      </div>
    </>
  );
}
