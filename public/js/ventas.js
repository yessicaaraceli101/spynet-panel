let ventaItems = [];
let ventaPendienteEditar = null;
let formaPagoIdFinal = null;
let formaPagoSeleccionada = null;
let formaPagoIdSeleccionada = null;
let formaPagoNombreSeleccionado = null;
let ventaEliminarId = null;
let intentosEditar = 0;
let caja_id = null;
let productoManualSeleccionado = null;

window.cajaAbierta = window.cajaAbierta ?? false;
window.cajaActual = window.cajaActual ?? null;

let formaPagoFinal = { id: null, nombre: null };

const MAX_INTENTOS = 3;
const CLAVE_EDITAR = "editar123";

const ID_DEBITO = 1;
const ID_EFECTIVO = 2;

const FORMAS_PAGO_MAP = {
  1: "Débito",
  2: "Efectivo",
  3: "Crédito",
  4: "QR",
  5: "BNF",
  6: "Continental",
  7: "Banco Familiar",
  8: "Ueno Bank",
  9: "Banco Basa",
  10: "Mango"
};

/*
  Formas que requieren comprobante
*/
const FORMAS_CON_COMPROBANTE = new Set([
  1,  // Débito
  3,  // Crédito
  4,  // QR
  5,  // BNF
  6,  // Continental
  7,  // Familiar
  8,  // Ueno
  9,  // Basa
  10  // Mango
]);

const MONEDA_BASE = "PYG";
const MONEDAS_SOPORTADAS = ["PYG", "USD", "BRL"];

window.USER_EMPRESA = JSON.parse(localStorage.getItem("user") || "{}");

window.EMPRESA_NOMBRE =
  localStorage.getItem("empresa_nombre") ||
  window.USER_EMPRESA.empresa_nombre ||
  "Mi Empresa";

window.EMPRESA_LOGO =
  localStorage.getItem("empresa_logo") ||
  window.USER_EMPRESA.empresa_logo ||
  "img/logo.png";

window.COLOR_PRINCIPAL =
  localStorage.getItem("color_principal") ||
  window.USER_EMPRESA.color_principal ||
  "#2563eb";

document.documentElement.style.setProperty("--primary", COLOR_PRINCIPAL);
document.documentElement.style.setProperty("--color-principal", COLOR_PRINCIPAL);

function nf(n) {
  return new Intl.NumberFormat("es-PY").format(Number(n || 0));
}

function nfDecimal(n, dec = 2) {
  return new Intl.NumberFormat("es-PY", {
    minimumFractionDigits: dec,
    maximumFractionDigits: dec
  }).format(Number(n || 0));
}

function getMonedaVenta() {
  const moneda = (document.getElementById("v_moneda")?.value || MONEDA_BASE).trim().toUpperCase();
  return MONEDAS_SOPORTADAS.includes(moneda) ? moneda : MONEDA_BASE;
}

function getTipoCambioVenta() {
  const moneda = getMonedaVenta();
  if (moneda === MONEDA_BASE) return 1;

  const valor = Number(document.getElementById("v_tipo_cambio")?.value || 0);
  return valor > 0 ? valor : 0;
}

async function toggleTipoCambioVenta() {
  const moneda = document.getElementById("v_moneda")?.value || "PYG";
  const wrap = document.getElementById("wrapTipoCambio");
  const input = document.getElementById("v_tipo_cambio");

  let usd = 6350;
  let brl = 1250;

  try {
    const res = await fetch("/config/monedas", { credentials: "include" });
    const data = await res.json();

    if (Array.isArray(data.monedas)) {
      data.monedas.forEach(m => {
        if (m.moneda === "USD") usd = Number(m.tipo_cambio);
        if (m.moneda === "BRL") brl = Number(m.tipo_cambio);
      });
    }
  } catch (e) {
    console.error("No se pudo cargar moneda:", e);
  }

  if (moneda === "USD") {
    if (wrap) wrap.style.display = "block";
    if (input) input.value = usd;
  } else if (moneda === "BRL") {
    if (wrap) wrap.style.display = "block";
    if (input) input.value = brl;
  } else {
    if (wrap) wrap.style.display = "none";
    if (input) input.value = 1;
  }

  actualizarResumenMonedaVenta();
}

function calcularTotalesVenta() {
  const totalPyg = ventaItems.reduce((a, i) => a + (Number(i.subtotal) || 0), 0);
  const moneda = getMonedaVenta();
  const tipoCambio = getTipoCambioVenta();

  let totalMoneda = totalPyg;

  if (moneda !== MONEDA_BASE) {
    totalMoneda = tipoCambio > 0 ? (totalPyg / tipoCambio) : 0;
  }

  return {
    moneda,
    tipoCambio: moneda === MONEDA_BASE ? 1 : tipoCambio,
    total_pyg: totalPyg,
    total_moneda: totalMoneda
  };
}

function actualizarResumenMonedaVenta() {
  const lblMoneda = document.getElementById("v_total_moneda");
  const lblPyg = document.getElementById("v_total_pyg");

  if (!lblMoneda || !lblPyg) return;

  const { moneda, total_moneda, total_pyg } = calcularTotalesVenta();

  if (moneda === "PYG") {
    lblMoneda.innerText = `Gs. ${nf(total_moneda)}`;
  } else if (moneda === "USD") {
    lblMoneda.innerText = `US$ ${nfDecimal(total_moneda)}`;
  } else if (moneda === "BRL") {
    lblMoneda.innerText = `R$ ${nfDecimal(total_moneda)}`;
  } else {
    lblMoneda.innerText = nfDecimal(total_moneda);
  }

  lblPyg.innerText = `Gs. ${nf(total_pyg)}`;
}

function bsHideModal(id) {
  const el = document.getElementById(id);
  if (!el || typeof bootstrap === "undefined") return;
  const inst = bootstrap.Modal.getInstance(el);
  if (inst) inst.hide();
}

function bsShowModal(id, opts = {}) {
  const el = document.getElementById(id);
  if (!el) return false;
  if (typeof bootstrap === "undefined") return false;
  const inst = bootstrap.Modal.getOrCreateInstance(el, opts);
  inst.show();
  return true;
}

function mostrarModalCajaCerrada(msg = "Debe abrir la caja antes de realizar una venta.") {
  const body = document.getElementById("modalCajaCerradaBody");
  if (body) body.textContent = msg;

  const el = document.getElementById("modalCajaCerrada");
  if (!el) { alert(msg); return; }

  el.style.display = "flex";
  el.classList.add("show");
}


function toggleComprobanteUI(fp) {

  console.log("toggleComprobanteUI:", fp);

  const wrap =
    document.getElementById(
      "wrapComprobante"
    );

  if (!wrap) return;

  // SI NO HAY FORMA DE PAGO
  if (!fp) {

    wrap.style.display = "none";

    return;
  }

  // NORMALIZAR
  const tipo =
    String(fp.tipo || "")
      .trim()
      .toLowerCase();

  const nombre =
    String(fp.nombre || "")
      .trim()
      .toLowerCase();

  // EFECTIVO
  const esEfectivo =
    tipo === "efectivo" ||
    nombre === "efectivo";

  // MOSTRAR SOLO SI NO ES EFECTIVO
  const requiereComprobante =
    !esEfectivo;

  console.log(
    "requiereComprobante =",
    requiereComprobante
  );

  wrap.style.display =
    requiereComprobante
      ? "block"
      : "none";
}

function detectarFormaPagoDesdeBoton(btn) {
  let id = Number(btn?.dataset?.id || btn?.getAttribute?.("data-id") || 0);
  let nombre = (btn?.dataset?.nombre || "").trim();
  let tipo = (btn?.dataset?.tipo || "").trim();   // ← AGREGAR

  if (!nombre) nombre = (btn?.textContent || "").trim();

  if (!id && nombre) {
    const lower = nombre.toLowerCase();
    for (const [k, v] of Object.entries(FORMAS_PAGO_MAP)) {
      if (String(v).toLowerCase() === lower) {
        id = Number(k);
        break;
      }
    }
  }

  return { id: id || null, nombre: nombre || null, tipo: tipo || null };  // ← AGREGAR tipo
}

function iniciarPOS() {
  ventaItems = [];
  productoManualSeleccionado = null;
  formaPagoIdSeleccionada = null;
  formaPagoFinal = { id: null, nombre: null };

  const inp = document.getElementById("inputComprobante");
  if (inp) inp.value = "";
  toggleComprobanteUI(null);

  // Limpiar Otro Banco
  const inputOtroBanco = document.getElementById("inputOtroBanco");
  const wrapOtroBanco = document.getElementById("wrapOtroBanco");
  if (inputOtroBanco) inputOtroBanco.value = "";
  if (wrapOtroBanco) wrapOtroBanco.style.display = "none";

  const mr = document.getElementById("montoRecibido");
  if (mr) mr.value = "";

  const v = document.getElementById("vuelto");
  if (v) {
    v.textContent = "0";
    v.style.color = "";
  }

  const moneda = document.getElementById("v_moneda");
  const tipoCambio = document.getElementById("v_tipo_cambio");
  if (moneda) moneda.value = "PYG";
  if (tipoCambio) tipoCambio.value = "1";
  toggleTipoCambioVenta();

  const buscarManual = document.getElementById("buscarProductoManual");
  const cantidadManual = document.getElementById("cantidadManualVenta");
  const precioManual = document.getElementById("precioManualVenta");
  const listaManual = document.getElementById("listaProductosManual");

  if (buscarManual) buscarManual.value = "";
  if (cantidadManual) cantidadManual.value = 1;
  if (precioManual) precioManual.value = "";
  if (listaManual) {
    listaManual.innerHTML = "";
    listaManual.style.display = "none";
  }

  renderItemsVenta();
  iniciarScannerVenta();
}


async function cargarFormasPago() {
  try {
    const res = await fetch("/formas_pago", { credentials: "include" });

    if (!res.ok) throw new Error("Error cargando formas de pago");

    const formas = await res.json();

    const cont = document.getElementById("gridFormasPago");
    if (!cont) return console.error("No existe #gridFormasPago");

    cont.innerHTML = "";

    formas.forEach(fp => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "btn btnFormaPago";
      btn.dataset.id = fp.id;
      btn.dataset.nombre = fp.nombre;
      btn.dataset.tipo = fp.tipo || ""; 

      let icono = "";
      if (fp.nombre.toLowerCase().includes("efectivo")) icono = "";
      else if (
        fp.nombre.toLowerCase().includes("banco") ||
        fp.nombre.toLowerCase().includes("bnf") ||
        fp.nombre.toLowerCase().includes("continental") ||
        fp.nombre.toLowerCase().includes("ueno")
      ) icono = "";
      else if (
        fp.nombre.toLowerCase().includes("qr") ||
        fp.nombre.toLowerCase().includes("mango")
      ) icono = "";

      btn.innerHTML = `${icono} ${fp.nombre}`;
      btn.onclick = () => seleccionarFormaPago(fp, btn);
      cont.appendChild(btn);
    });

  } catch (err) {
    console.error("❌ Error cargando formas de pago:", err);
  }
}

function seleccionarFormaPago(fp, btn) {
  formaPagoSeleccionada = fp;
  formaPagoIdSeleccionada = Number(fp.id);
  window.formaPagoTipoSeleccionada = fp.tipo || "";

  document.querySelectorAll(".btnFormaPago").forEach(b => b.classList.remove("active"));
  btn.classList.add("active");

  toggleComprobanteUI(fp);

  // MOSTRAR/OCULTAR BLOQUE EFECTIVO
  const bloqueEfectivo = document.getElementById("bloqueEfectivo");
  const esEfectivo =
    String(fp.tipo || "").toLowerCase() === "efectivo" ||
    String(fp.nombre || "").toLowerCase() === "efectivo";

  if (bloqueEfectivo) {
    bloqueEfectivo.style.display = esEfectivo ? "block" : "none";
  }

  if (esEfectivo) {
    calcularVuelto();
  } else {
    const mr = document.getElementById("montoRecibido");
    if (mr) mr.value = "";
    const v = document.getElementById("vuelto");
    if (v) {
      v.textContent = "0";
      v.style.color = "";
    }
  }

  // Otro banco
  const esOtroBanco = String(fp.nombre || "").toLowerCase().includes("otro banco");
  const wrapOtro = document.getElementById("wrapOtroBanco");
  if (wrapOtro) {
    wrapOtro.style.display = esOtroBanco ? "block" : "none";
    if (!esOtroBanco) {
      const inp = document.getElementById("inputOtroBanco");
      if (inp) inp.value = "";
    }
  }

  console.log("Forma seleccionada:", fp);
}
async function cargarClientesVenta() {
  const select = document.getElementById("v_cliente");
  if (!select) return;

  select.innerHTML = `<option value="">Consumidor Final</option>`;

  try {
    const res = await fetch("/clientes", { credentials: "include" });
    const clientes = await res.json();

    clientes.forEach(c => {
      const opt = document.createElement("option");
      opt.value = c.id;
      opt.textContent = `${c.nombre} ${c.apellido || ""}`.trim();
      opt.dataset.ruc = c.ci || "";
      select.appendChild(opt);
    });
  } catch (e) {
    console.error("Error cargando clientes", e);
  }
}

document.addEventListener("change", e => {
  if (e.target.id === "v_cliente") {
    const opt = e.target.selectedOptions[0];
    const ruc = document.getElementById("v_ruc");
    if (ruc) ruc.value = opt?.dataset?.ruc || "";
  }

  if (e.target.id === "v_moneda") {
    toggleTipoCambioVenta();
  }
});

document.addEventListener("input", e => {
  if (e.target.id === "v_tipo_cambio") {
    actualizarResumenMonedaVenta();
  }
});


function iniciarScannerVenta() {
  const input = document.getElementById("barcodeVenta");
  if (!input) return;

  input.value = "";
  input.focus();

  input.onkeydown = async (e) => {
    if (e.key !== "Enter") return;
    e.preventDefault();

    const codigo = input.value.trim();
    if (!codigo) return;

    try {
      const res = await fetch(`/productos/barcode/${codigo}`, {
        credentials: "include"
      });

      if (!res.ok) throw new Error();

      const producto = await res.json();
      agregarProductoDesdeBarcode(producto);
    } catch {
      alert("❌ Producto no encontrado");
    }

    input.value = "";
    input.focus();
  };
}

function agregarProductoDesdeBarcode(producto) {
  const existente = ventaItems.find(p => p.producto_id === producto.id);

  if (existente) {
    existente.cantidad += 1;
    existente.subtotal = existente.cantidad * existente.precio;
  } else {
    ventaItems.push({
      producto_id: producto.id,
      nombre: producto.nombre,
      precio: Number(producto.precio),
      cantidad: 1,
      subtotal: Number(producto.precio)
    });
  }

  renderItemsVenta();
}

function renderItemsVenta() {
  const tbody = document.getElementById("v_items");
  if (!tbody) return;

  tbody.replaceChildren();

  let total = 0;

  ventaItems.forEach(it => {
    total += Number(it.subtotal || 0);

    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${it.nombre}</td>
      <td style="text-align:center;">${it.cantidad}</td>
      <td style="text-align:right;">${nf(it.subtotal)}</td>
    `;
    tbody.appendChild(tr);
  });

  const lbl = document.getElementById("v_total");
  if (lbl) lbl.textContent = nf(total);

  actualizarResumenMonedaVenta();
}

function abrirPago() {
  if (!ventaItems.length) {
    alert("No hay productos en la venta");
    return;
  }

  // Mover al body para que cubra toda la pantalla
  const modalPago = document.getElementById("modalPago");
  if (modalPago && modalPago.parentElement !== document.body) {
    document.body.appendChild(modalPago);
  }

  // Forzar estilos de overlay completo
  modalPago.style.cssText = `
    position: fixed !important;
    top: 0 !important;
    left: 0 !important;
    width: 100vw !important;
    height: 100vh !important;
    margin: 0 !important;
    padding: 16px !important;
    background: rgba(15, 23, 42, 0.85) !important;
    z-index: 2147483647 !important;
    display: flex !important;
    align-items: center !important;
    justify-content: center !important;
    box-sizing: border-box !important;
    overflow-y: auto !important;
  `;

  // Ocultar modal venta mientras está abierto el pago
  const modalVenta = document.getElementById("modalVenta");
  if (modalVenta) modalVenta.style.visibility = "hidden";

  // Bloquear scroll del fondo
  document.body.style.overflow = "hidden";

  formaPagoIdSeleccionada = null;
  formaPagoFinal = { id: null, nombre: null };

  const inp = document.getElementById("inputComprobante");
  if (inp) inp.value = "";
  toggleComprobanteUI(null);

  const mr = document.getElementById("montoRecibido");
  if (mr) mr.value = "";

  const v = document.getElementById("vuelto");
  if (v) {
    v.textContent = "0";
    v.style.color = "";
  }

  actualizarResumenMonedaVenta();
}
function confirmarPago(btn, formaPagoId) {

  formaPagoId = Number(formaPagoId);

  formaPagoIdSeleccionada =
    formaPagoId;

  document
    .querySelectorAll(
      ".pago-grid .btn, .btnFormaPago"
    )
    .forEach(b =>
      b.classList.remove("active")
    );

  btn.classList.add("active");

  // =====================================
  // DETECTAR FORMA PAGO
  // =====================================

  const det =
    detectarFormaPagoDesdeBoton(btn);

  // ✅ GUARDAR GLOBAL
  window.formaPagoSeleccionada = det;

  window.formaPagoTipoSeleccionada =
    det?.tipo || null;

  const nombre =
    det?.nombre ||
    FORMAS_PAGO_MAP[formaPagoId] ||
    (btn.textContent || "").trim();

  // =====================================
  // MENSAJE
  // =====================================

  const msg =
    document.getElementById(
      "mensajeFormaPago"
    );

  if (msg) {

    msg.style.display = "block";

    msg.textContent =
      `Forma de pago seleccionada: ${nombre}`;
  }

  formaPagoFinal = {
    id: formaPagoId,
    nombre
  };

  // =====================================
  // EFECTIVO
  // =====================================

  const bloque =
    document.getElementById(
      "bloqueEfectivo"
    );

  const esEfectivo =
    String(det?.tipo || "")
      .toLowerCase() === "efectivo"
    ||
    String(det?.nombre || "")
      .toLowerCase() === "efectivo";

  if (bloque) {

    bloque.style.display =
      esEfectivo
        ? "block"
        : "none";
  }

  if (esEfectivo) {

    calcularVuelto();

  } else {

    const mr =
      document.getElementById(
        "montoRecibido"
      );

    if (mr) {
      mr.value = "";
    }

    const v =
      document.getElementById(
        "vuelto"
      );

    if (v) {

      v.textContent = "0";

      v.style.color = "";
    }
  }

  // =====================================
  // COMPROBANTE
  // =====================================

  toggleComprobanteUI(det);
}

function normalizarTipoCaja(tipo) {
  let t = String(tipo || "").trim().toLowerCase();
  if (t === "trasferencia") t = "transferencia";
  if (t.includes("trans")) t = "transferencia";
  if (t.includes("efect")) t = "efectivo";
  return t;
}

async function confirmarPagoFinal() {

  const activeBtn = document.querySelector(
    ".pago-grid .btn.active, .btnFormaPago.active"
  );

  if (activeBtn) {
    const det = detectarFormaPagoDesdeBoton(activeBtn);
    if (det.id) formaPagoIdSeleccionada = Number(det.id);
    window.formaPagoSeleccionada = det;
    window.formaPagoTipoSeleccionada = det.tipo || null;
  }

  formaPagoIdSeleccionada = Number(formaPagoIdSeleccionada);

const esOtroBanco = String(formaPagoSeleccionada?.nombre || "").toLowerCase().includes("otro banco");

if (!formaPagoIdSeleccionada && !esOtroBanco) {
  alert("Seleccione una forma de pago");
  return;
}

  if (!ventaItems || ventaItems.length === 0) {
    alert("No hay productos en la venta");
    return;
  }

  const { moneda, tipoCambio, total_moneda, total_pyg } = calcularTotalesVenta();

  if (moneda !== "PYG" && (!tipoCambio || tipoCambio <= 0)) {
    alert("❌ Ingrese una cotización válida");
    return;
  }

  const clienteRaw = (document.getElementById("v_cliente")?.value || "").trim();
  const cliente_id = clienteRaw ? Number(clienteRaw) : null;

  let estado_pago = (document.getElementById("v_estado_pago")?.value || "pagado").trim().toLowerCase();
  if (!estado_pago) estado_pago = "pagado";

  const fechaInput = (document.getElementById("v_fecha")?.value || "").trim();
  const fecha = fechaInput || new Date().toISOString().slice(0, 10);

  const tipoFormaPago = String(window.formaPagoTipoSeleccionada || "").trim().toLowerCase();
  const nombreFormaPago = String(window.formaPagoSeleccionada?.nombre || "").trim().toLowerCase();
  const esEfectivo = tipoFormaPago === "efectivo" || nombreFormaPago === "efectivo";

  let vuelto = null;

  if (esEfectivo) {
    const input = document.getElementById("montoRecibido");
    let montoRecibido = 0;

    if (moneda === "PYG") {
      montoRecibido = Number((input?.value || "").replace(/\D/g, "") || 0);
    } else {
      montoRecibido = Number(String(input?.value || "0").replace(",", "."));
    }

    const totalComparar = moneda === "PYG" ? total_pyg : total_moneda;

    if (montoRecibido < totalComparar) {
      alert("❌ El monto recibido es menor al total");
      return;
    }

    vuelto = montoRecibido - totalComparar;
  }

  window.cajasActuales = window.cajasActuales || { efectivo: null, transferencia: null };
  const tipoCajaNecesaria = esEfectivo ? "efectivo" : "transferencia";

  if (typeof refrescarCajaAbierta === "function") {
    try {
      await refrescarCajaAbierta(tipoCajaNecesaria, fecha);
    } catch (e) {
      console.error("refrescarCajaAbierta falló:", e);
    }
  }

  let caja_id = Number(window.cajasActuales?.[tipoCajaNecesaria]?.id) || null;

  if (!caja_id && typeof refrescarCajaAbierta === "function") {
    try {
      await refrescarCajaAbierta(tipoCajaNecesaria, fecha);
      caja_id = Number(window.cajasActuales?.[tipoCajaNecesaria]?.id) || null;
    } catch (e) {
      console.error("refrescarCajaAbierta reintento falló:", e);
    }
  }

  if (!caja_id) {
    if (typeof closeModal === "function") closeModal("modalPago");
    if (typeof closeModal === "function") closeModal("modalVenta");
    const msg = esEfectivo
      ? "Debe abrir la caja de EFECTIVO antes de realizar una venta."
      : "Debe abrir la caja de TRANSFERENCIAS antes de realizar una venta.";
    mostrarModalCajaCerrada(msg);
    return;
  }

  // Validar Otro Banco
  if (esOtroBanco) {
    const otroBanco = (document.getElementById("inputOtroBanco")?.value || "").trim();
    if (!otroBanco) {
      alert("❌ Ingrese el nombre del banco");
      return;
    }
    formaPagoFinal.nombre = `Otro Banco - ${otroBanco}`;
  }

  let nro_comprobante = null;
  const requiereComprobante = !esEfectivo;

  if (requiereComprobante) {
    const inp = document.getElementById("inputComprobante");
    const comp = (inp?.value || "").trim();

    if (!comp) {
      alert("❌ Ingrese el número de comprobante");
      return;
    }

    nro_comprobante = comp;

    let checkData = { existe: false };

    try {
      const check = await fetch(
        `/ventas/comprobante/${encodeURIComponent(nro_comprobante)}`,
        { method: "GET", credentials: "include", headers: { "Content-Type": "application/json" } }
      );
      if (check.ok) checkData = await check.json();
      else console.warn("No se pudo verificar comprobante:", check.status);
    } catch (err) {
      console.error("Error verificando comprobante:", err);
    }

    if (checkData.existe) {
      // Marcar input en rojo
      const inp = document.getElementById("inputComprobante");
      if (inp) {
        inp.style.border = "2px solid #ef4444";
        inp.style.background = "#fef2f2";
        setTimeout(() => {
          inp.style.border = "";
          inp.style.background = "";
        }, 3000);
      }

      // Toast profesional
      document.querySelectorAll(".toast-comprobante").forEach(t => t.remove());

      const toast = document.createElement("div");
      toast.className = "toast-comprobante";
      toast.innerHTML = `
        <div style="font-size:1.4rem;line-height:1;">⚠️</div>
        <div style="flex:1;">
          <div style="font-weight:700;font-size:.95rem;margin-bottom:3px;">
            Comprobante duplicado
          </div>
          <div style="font-size:.83rem;opacity:.85;line-height:1.4;">
            El Nro. <strong>${nro_comprobante}</strong> ya fue registrado
            en esta empresa. Verificá el número e intentá de nuevo.
          </div>
        </div>
        <button onclick="this.parentElement.remove()" style="
          background:none;border:none;cursor:pointer;
          font-size:1.1rem;color:#991b1b;opacity:.7;
          margin-left:.5rem;padding:0;line-height:1;flex-shrink:0;
        ">✕</button>
      `;

      Object.assign(toast.style, {
        position: "fixed",
        top: "1.5rem",
        right: "1.5rem",
        display: "flex",
        alignItems: "flex-start",
        gap: "12px",
        padding: "1rem 1.25rem",
        background: "#fef2f2",
        color: "#991b1b",
        border: "1.5px solid #fca5a5",
        borderLeft: "5px solid #ef4444",
        borderRadius: "12px",
        boxShadow: "0 8px 24px rgba(0,0,0,.12)",
        zIndex: "99999",
        minWidth: "300px",
        maxWidth: "400px",
        opacity: "0",
        transform: "translateX(40px)",
        transition: "opacity .3s ease, transform .3s ease"
      });

      document.body.appendChild(toast);

      requestAnimationFrame(() => {
        toast.style.opacity = "1";
        toast.style.transform = "translateX(0)";
      });

      setTimeout(() => {
        toast.style.opacity = "0";
        toast.style.transform = "translateX(40px)";
        setTimeout(() => toast.remove(), 350);
      }, 5000);

      return;
    }
  }

  const body = {
    fecha,
    cliente_id,
    caja_id,
    total: total_pyg,
    total_pyg,
    total_moneda,
    moneda,
    tipo_cambio: tipoCambio,
    forma_pago_id: formaPagoIdSeleccionada,
    estado_pago,
    nro_comprobante,
    banco_nombre: esOtroBanco
        ? (document.getElementById("inputOtroBanco")?.value || "").trim()
        : null,
    items: ventaItems
};

  try {
    const res = await fetch("/ventas", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify(body)
    });

    const text = await res.text();
    let data = null;
    try { data = JSON.parse(text); } catch {}

    if (!res.ok) {
      const msg = (data && (data.msg || data.error)) || text || "Error al guardar la venta";
      if (typeof closeModal === "function") closeModal("modalPago");
      if (typeof closeModal === "function") closeModal("modalVenta");
      if (String(msg).toLowerCase().includes("caja")) {
        mostrarModalCajaCerrada(msg);
      } else {
        alert(msg);
      }
      return;
    }

    if (esEfectivo) {
      let simbolo = "Gs.";
      let vueltoTexto = "0";
      if (moneda === "USD") { simbolo = "US$"; vueltoTexto = nfDecimal(vuelto || 0); }
      else if (moneda === "BRL") { simbolo = "R$"; vueltoTexto = nfDecimal(vuelto || 0); }
      else { simbolo = "Gs."; vueltoTexto = nf(vuelto || 0); }
      mostrarExitoVenta(vueltoTexto, simbolo);
    } else {
      mostrarExitoVenta(null, null);
    }

    if (typeof closeModal === "function") closeModal("modalPago");
    if (typeof closeModal === "function") closeModal("modalVenta");

    const inp = document.getElementById("inputComprobante");
    if (inp) inp.value = "";
    if (typeof toggleComprobanteUI === "function") toggleComprobanteUI(null);

    iniciarPOS();
    await cargarVentas();

  } catch (err) {
    console.error(err);
    alert("❌ Error al guardar la venta");
  }
}
function formatearMontoRecibido() {
  const input = document.getElementById("montoRecibido");
  if (!input) return;

  const moneda = getMonedaVenta();

  if (moneda === "PYG") {
    const limpio = input.value.replace(/\D/g, "");

    if (!limpio) {
      input.value = "";
      calcularVuelto();
      return;
    }

    const monto = Number(limpio);
    input.value = monto.toLocaleString("es-PY");
  } else {
    let valor = input.value.replace(/[^0-9.,]/g, "").replace(",", ".");
    input.value = valor;
  }

  calcularVuelto();
}

function calcularVuelto() {
  const { moneda, total_pyg, total_moneda } = calcularTotalesVenta();

  const inputValue = document.getElementById("montoRecibido")?.value || "";
  let monto = 0;

  if (moneda === "PYG") {
    monto = Number(inputValue.replace(/\D/g, "") || 0);
  } else {
    monto = Number(String(inputValue).replace(",", ".") || 0);
  }

  const span = document.getElementById("vuelto");
  if (!span) return;

  const vueltoBox = span.closest(".vuelto-box-pro");
  const totalComparar = moneda === "PYG" ? total_pyg : total_moneda;
  const vuelto = monto - totalComparar;

  if (monto <= 0) {
    span.textContent = "0";
    span.style.color = "";
    vueltoBox?.classList.remove("insuficiente");
    return;
  }

  if (vuelto < 0) {
    span.textContent = "Monto insuficiente";
    span.style.color = "white";
    vueltoBox?.classList.add("insuficiente");
  } else {
    if (moneda === "PYG") {
      span.textContent = `${nf(vuelto)} Gs.`;
    } else if (moneda === "USD") {
      span.textContent = `${nfDecimal(vuelto)} US$`;
    } else if (moneda === "BRL") {
      span.textContent = `${nfDecimal(vuelto)} R$`;
    } else {
      span.textContent = `${nfDecimal(vuelto)}`;
    }
    span.style.color = "white";
    vueltoBox?.classList.remove("insuficiente");
  }
}
let ventasPaginaActual = 1;
const ventasPorPagina = 7;
let ventasCache = [];

async function cargarVentas() {
  try {
    const res = await fetch("/ventas", { credentials: "include" });
    const ventas = await res.json();

    if (!Array.isArray(ventas)) {
      console.error("Ventas no es un array:", ventas);
      return;
    }

    ventasCache = ventas;
    ventasPaginaActual = 1;

    renderVentasPaginadas();

  } catch (err) {
    console.error("❌ Error cargando ventas:", err);
  }
}

function renderVentasPaginadas() {
  const tbody = document.getElementById("tablaVentas");
  if (!tbody) return;
 
  tbody.innerHTML = "";
 
  if (ventasCache.length === 0) {
    tbody.innerHTML = `
      <tr>
        <td colspan="8" style="text-align:center;padding:40px;color:#6b7280;font-size:15px;">
          No se encontraron ventas para esta empresa.
        </td>
      </tr>`;
    renderPaginacionVentas();
    return;
  }
 
  const inicio = (ventasPaginaActual - 1) * ventasPorPagina;
  const fin    = inicio + ventasPorPagina;
  const ventasPagina = ventasCache.slice(inicio, fin);
 
  ventasPagina.forEach(v => {
    const tr = document.createElement("tr");
 
    // ── Fecha  dd/mm/yyyy ──────────────────────────────
    let fecha = "-";
    if (v.fecha) {
      const d = new Date(String(v.fecha).slice(0, 10) + "T12:00:00");
      if (!isNaN(d)) {
        const dd   = String(d.getDate()).padStart(2, "0");
        const mm   = String(d.getMonth() + 1).padStart(2, "0");
        const yyyy = d.getFullYear();
        fecha = `${dd}/${mm}/${yyyy}`;
      }
    }
 
    // ── Total ──────────────────────────────────────────
    const moneda = (v.moneda || "PYG").toUpperCase();
    let totalMostrar = "";
    let totalGs      = "";
 
    if (moneda === "USD") {
      totalMostrar = `US$ ${nfDecimal(v.total_moneda ?? 0)}`;
      totalGs      = `Gs. ${nf(v.total_pyg ?? v.total ?? 0)}`;
    } else if (moneda === "BRL") {
      totalMostrar = `R$ ${nfDecimal(v.total_moneda ?? 0)}`;
      totalGs      = `Gs. ${nf(v.total_pyg ?? v.total ?? 0)}`;
    } else {
      totalMostrar = `Gs. ${nf(v.total_pyg ?? v.total ?? 0)}`;
      totalGs      = "";
    }
 
    // ── Método de pago ─────────────────────────────────
    const metodoBruto  = v.banco_nombre
      ? `${v.forma_pago_nombre} - ${v.banco_nombre}`
      : (v.forma_pago_nombre || "-");
 
    const nombreMetodo = (v.forma_pago_nombre || "").toLowerCase();
    let iconoMetodo = "ti-credit-card";
    if (nombreMetodo.includes("efectivo"))                                       iconoMetodo = "ti-cash";
    else if (nombreMetodo.includes("qr") || nombreMetodo.includes("mango"))      iconoMetodo = "ti-qrcode";
    else if (
      nombreMetodo.includes("banco")       || nombreMetodo.includes("bnf")   ||
      nombreMetodo.includes("continental") || nombreMetodo.includes("ueno")  ||
      nombreMetodo.includes("basa")        || nombreMetodo.includes("familiar")
    ) iconoMetodo = "ti-building-bank";
 
    // ── Estado ─────────────────────────────────────────
    const estado = (v.estado_pago || "").toLowerCase();
    let badgeBg    = "#dcfce7";
    let badgeColor = "#166534";
    let badgeIcon  = "ti-check";
 
    if (estado === "pendiente") {
      badgeBg = "#fef9c3"; badgeColor = "#854d0e"; badgeIcon = "ti-clock";
    } else if (estado === "anulado") {
      badgeBg = "#fee2e2"; badgeColor = "#991b1b"; badgeIcon = "ti-x";
    }
 
    // ── Helper botón ───────────────────────────────────
    // Cada botón tiene un borde de color fijo (no solo en hover)
    // para que se distingan a simple vista sin ser "colorinches"
    const btn = (onclick, title, icon, borderColor, hoverBg, hoverColor) => `
      <button
        onclick="${onclick}"
        title="${title}"
        style="
          width:34px;height:34px;border-radius:8px;
          border:1.5px solid ${borderColor};
          background:#fff;cursor:pointer;
          display:inline-flex;align-items:center;
          justify-content:center;color:${hoverColor};
          font-size:16px;padding:0;
          transition:background .15s ease, transform .1s ease;"
        onmouseover="
          this.style.background='${hoverBg}';
          this.style.transform='translateY(-1px)';"
        onmouseout="
          this.style.background='#fff';
          this.style.transform='translateY(0)';">
        <i class="ti ${icon}" aria-hidden="true"></i>
      </button>`;
 
    tr.innerHTML = `
      <!-- ID -->
      <td style="padding:14px 12px;color:#9ca3af;font-size:13px;font-weight:600;white-space:nowrap;">
        #${v.id ?? "-"}
      </td>
 
      <!-- Fecha -->
      <td style="padding:14px 12px;font-size:14px;color:#374151;white-space:nowrap;font-weight:500;letter-spacing:.3px;">
        ${fecha}
      </td>
 
      <!-- Cliente -->
      <td style="padding:14px 12px;font-weight:700;font-size:14px;color:#111827;">
        ${v.cliente_nombre || "Consumidor Final"}
      </td>
 
      <!-- Productos -->
      <td style="padding:14px 12px;font-size:13px;color:#4b5563;
                 max-width:170px;white-space:nowrap;
                 overflow:hidden;text-overflow:ellipsis;">
        ${v.productos || "-"}
      </td>
 
      
      <!-- Método -->
      <td style="padding:14px 12px;font-size:13px;color:#374151;font-weight:500;">
        ${metodoBruto}
      </td>
 
      <!-- Total -->
      <td style="text-align:right;padding:14px 12px;">
        <span style="font-weight:700;font-size:15px;color:#111827;">${totalMostrar}</span>
        ${totalGs
          ? `<br><small style="font-size:12px;color:#9ca3af;font-weight:400;">${totalGs}</small>`
          : ""}
      </td>
 
      <!-- Estado -->
      <td style="text-align:center;padding:14px 12px;">
        <span style="
          display:inline-flex;align-items:center;gap:5px;
          padding:5px 13px;border-radius:20px;
          font-size:12px;font-weight:700;letter-spacing:.3px;
          background:${badgeBg};color:${badgeColor};">
          <i class="ti ${badgeIcon}" style="font-size:12px;" aria-hidden="true"></i>
          ${v.estado_pago || "-"}
        </span>
      </td>
 
      <!-- Acciones -->
      <td style="text-align:center;padding:14px 12px;">
        <div style="display:inline-flex;align-items:center;gap:6px;">
 
          <!-- Ticket: azul profundo -->
          ${btn(
            `imprimirTicket(${v.id})`,
            "Imprimir ticket",
            "ti-receipt",
            "#93c5fd",   /* borde azul claro */
            "#eff6ff",   /* hover fondo */
            "#1d4ed8"    /* color ícono */
          )}
 
          <!-- Pagaré: verde sobrio -->
          ${btn(
            `imprimirPagare(${v.id})`,
            "Imprimir Factura",
            "ti-file-text",
            "#6ee7b7",   /* borde verde claro */
            "#f0fdf4",
            "#065f46"
          )}
 
          <!-- Editar: celeste / cyan -->
          ${btn(
            `editarVenta(${v.id})`,
            "Editar venta",
            "ti-pencil",
            "#38bdf8",   /* borde celeste */
            "#e0f2fe",
            "#0369a1"
          )}
 
          <!-- Eliminar: rojo -->
          ${btn(
            `confirmarEliminarVenta(${v.id})`,
            "Eliminar venta",
            "ti-trash",
            "#fca5a5",   /* borde rojo claro */
            "#fee2e2",
            "#b91c1c"
          )}
 
        </div>
      </td>
    `;
 
    tbody.appendChild(tr);
  });
 
  renderPaginacionVentas();
}
 
function renderPaginacionVentas() {
  const div = document.getElementById("ventas-paginacion");
  if (!div) return;
 
  const total = Math.ceil(ventasCache.length / ventasPorPagina);
  div.innerHTML = "";
  if (total <= 1) return;
 
  div.style.cssText = `
    display:flex;align-items:center;gap:8px;
    justify-content:center;padding:20px 0 8px;`;
 
  const mkBtn = (html, disabled, onclick) => {
    const b = document.createElement("button");
    b.innerHTML = html;
    b.disabled  = disabled;
    b.style.cssText = `
      width:36px;height:36px;border-radius:8px;
      border:1.5px solid #e2e8f0;background:#fff;
      cursor:${disabled ? "not-allowed" : "pointer"};
      display:inline-flex;align-items:center;
      justify-content:center;color:#374151;
      font-size:16px;transition:all .15s ease;
      opacity:${disabled ? "0.35" : "1"};`;
    if (!disabled) {
      b.onmouseover = () => {
        b.style.background    = "#eff6ff";
        b.style.borderColor   = "#93c5fd";
        b.style.color         = "#1d4ed8";
      };
      b.onmouseout = () => {
        b.style.background    = "#fff";
        b.style.borderColor   = "#e2e8f0";
        b.style.color         = "#374151";
      };
      b.onclick = onclick;
    }
    return b;
  };
 
  div.appendChild(mkBtn(`<i class="ti ti-chevron-left"></i>`,  ventasPaginaActual === 1,     () => cambiarPaginaVentas(ventasPaginaActual - 1)));
 
  const info = document.createElement("span");
  info.style.cssText = "font-size:14px;color:#6b7280;padding:0 8px;";
  info.innerHTML     = `Página <strong style="color:#111827;font-weight:700;">${ventasPaginaActual}</strong> de ${total}`;
  div.appendChild(info);
 
  div.appendChild(mkBtn(`<i class="ti ti-chevron-right"></i>`, ventasPaginaActual === total, () => cambiarPaginaVentas(ventasPaginaActual + 1)));
}

function cambiarPaginaVentas(pagina) {
  const totalPaginas = Math.ceil(ventasCache.length / ventasPorPagina);
  if (pagina < 1 || pagina > totalPaginas) return;

  ventasPaginaActual = pagina;
  renderVentasPaginadas();
}

function confirmarEliminarVenta(id) {
  ventaEliminarId = id;
  openModal("modalEliminarVenta");
}

async function eliminarVentaConfirmada() {
  try {
    const res = await fetch(`/ventas/${ventaEliminarId}`, {
      method: "DELETE",
      credentials: "include"
    });

    if (!res.ok) throw new Error();

    closeModal("modalEliminarVenta");
    cargarVentas();
  } catch (err) {
    alert("Error eliminando la venta");
  }
}

function editarVenta(id) {
  ventaPendienteEditar = id;
  openModal("modalClaveEditar");
}

function pedirClaveEditar(id) {
  ventaPendienteEditar = id;
  intentosEditar = 0;

  const input = document.getElementById("claveEditar");
  const error = document.getElementById("errorClaveEditar");
  const btn = document.getElementById("btnConfirmarClave");

  input.value = "";
  input.disabled = false;
  btn.disabled = false;
  error.textContent = "";

  openModal("modalClaveEditar");
}

async function validarClaveEditar() {
  const password = document.getElementById("claveEditar").value;

  const res = await fetch("/ventas/validar-edicion", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify({ password })
  });

  if (!res.ok) {
    alert("❌ Contraseña incorrecta");
    return;
  }

  closeModal("modalClaveEditar");
  abrirEditarVenta(ventaPendienteEditar);
}

async function guardarEdicionVenta() {
  const id = document.getElementById("edit_venta_id").value;

  function toGsNumber(v) {
    return Number(String(v || "0").replace(/\./g, "").replace(/,/g, "."));
  }

  const rows = document.querySelectorAll("#edit_items tr");
  const items = [];

  rows.forEach(tr => {
    const cantEl = tr.querySelector(".edit-cant");
    const precioEl = tr.querySelector(".edit-precio");

    const producto_id = Number(cantEl?.dataset?.productoId || 0);
    const cantidad = toGsNumber(cantEl?.value || 0);
    const precio_unitario = toGsNumber(precioEl?.value || 0);

    if (producto_id && cantidad > 0 && precio_unitario >= 0) {
      items.push({ producto_id, cantidad, precio_unitario });
    }
  });

  if (items.length === 0) {
    alert("❌ La venta debe tener al menos 1 producto");
    return;
  }

  const total = items.reduce((a, it) => a + (it.cantidad * it.precio_unitario), 0);

  // ← NUEVO: leer moneda y tipo de cambio del modal
  const moneda     = document.getElementById("edit_moneda")?.value || "PYG";
  const tipoCambio = Number(document.getElementById("edit_tipo_cambio")?.value || 1);
  const total_moneda = (moneda !== "PYG" && tipoCambio > 0) ? total / tipoCambio : total;

  const body = {
    fecha:         document.getElementById("edit_fecha").value,
    forma_pago_id: Number(document.getElementById("edit_forma_pago").value),
    estado_pago:   document.getElementById("edit_estado").value,
    moneda,                  // ← NUEVO
    tipo_cambio: tipoCambio, // ← NUEVO
    total,
    total_pyg:  total,
    total_moneda,            // ← NUEVO
    items
  };

  try {
    const res = await fetch(`/ventas/${id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify(body)
    });

    const raw = await res.text();
    let data = null;
    try { data = JSON.parse(raw); } catch {}

    if (!res.ok) {
      alert((data && (data.msg || data.error)) || raw || "Error al guardar");
      return;
    }

    alert("✅ Venta actualizada");
    closeModal("modalEditarVenta");

    try {
      if (typeof window.cargarVentas === "function") await window.cargarVentas();
      else if (typeof cargarVentas === "function") await cargarVentas();
    } catch (e) {
      console.error("cargarVentas falló:", e);
    }

  } catch (err) {
    console.error(err);
    alert("❌ Error al guardar cambios");
  }
}

async function abrirEditarVenta(id) {
  try {
    const res = await fetch(`/ventas/${id}`, { credentials: "include" });
    if (!res.ok) throw new Error("Venta no encontrada");

    const venta = await res.json();

    document.getElementById("edit_venta_id").value  = venta.id;
    document.getElementById("edit_fecha").value     = (venta.fecha || "").slice(0, 10);
    document.getElementById("edit_estado").value    = venta.estado_pago || "pagado";
    document.getElementById("edit_forma_pago").value = venta.forma_pago_id;

    // Restaurar moneda y tipo de cambio
    const moneda = (venta.moneda || "PYG").toUpperCase();
    const selMoneda = document.getElementById("edit_moneda");
    const inpTC     = document.getElementById("edit_tipo_cambio");
    if (selMoneda) selMoneda.value = moneda;
    if (inpTC)     inpTC.value    = venta.tipo_cambio || 1;
    toggleEditTipoCambio();

    const tbody = document.getElementById("edit_items");
    tbody.innerHTML = "";

    (venta.items || []).forEach((it, idx) => {
      const cant       = Number(it.cantidad || 0);
      const precioUnit = Number(
        it.precio_unitario ??
        (cant > 0 ? (Number(it.subtotal || 0) / cant) : 0)
      );

      tbody.innerHTML += `
        <tr data-idx="${idx}">
          <td>${it.producto_nombre || "-"}</td>
          <td>
            <input type="number" min="1" class="form-control form-control-sm edit-cant"
                   value="${cant}" data-producto-id="${it.producto_id}" />
          </td>
          <td>
            <input type="number" min="0" class="form-control form-control-sm edit-precio"
                   value="${precioUnit}" />
          </td>
          <td style="text-align:right;">
            <span class="edit-subtotal">${nf(cant * precioUnit)}</span>
          </td>
          <td style="text-align:center;">
            <button class="btn btn-sm btn-danger btn-del-item" type="button">X</button>
          </td>
        </tr>
      `;
    });

    recalcularEditTotales();
    openModal("modalEditarVenta");

  } catch (err) {
    console.error(err);
    alert("❌ Error cargando la venta");
  }

}

function recalcularEditTotales() {
  const rows = document.querySelectorAll("#edit_items tr");
  let totalPyg = 0;

  rows.forEach(tr => {
    const cant   = Number(tr.querySelector(".edit-cant")?.value  || 0);
    const precio = Number(tr.querySelector(".edit-precio")?.value || 0);
    const sub    = cant * precio;
    const span   = tr.querySelector(".edit-subtotal");
    if (span) span.textContent = nf(sub);
    totalPyg += sub;
  });

  const moneda     = document.getElementById("edit_moneda")?.value || "PYG";
  const tipoCambio = Number(document.getElementById("edit_tipo_cambio")?.value || 1);

  const lblMoneda = document.getElementById("edit_total_moneda");
  const lblPyg    = document.getElementById("edit_total_pyg_small");

  if (moneda === "USD") {
    const totalUsd = tipoCambio > 0 ? totalPyg / tipoCambio : 0;
    if (lblMoneda) lblMoneda.textContent = `US$ ${nfDecimal(totalUsd)}`;
    if (lblPyg)    lblPyg.textContent    = `(Gs. ${nf(totalPyg)})`;
  } else if (moneda === "BRL") {
    const totalBrl = tipoCambio > 0 ? totalPyg / tipoCambio : 0;
    if (lblMoneda) lblMoneda.textContent = `R$ ${nfDecimal(totalBrl)}`;
    if (lblPyg)    lblPyg.textContent    = `(Gs. ${nf(totalPyg)})`;
  } else {
    if (lblMoneda) lblMoneda.textContent = `Gs. ${nf(totalPyg)}`;
    if (lblPyg)    lblPyg.textContent    = "";
  }

  // También actualizar el campo oculto que usa guardarEdicionVenta
  const lblLegacy = document.getElementById("edit_total");
  if (lblLegacy) lblLegacy.textContent = nf(totalPyg);
}
document.addEventListener("input", (e) => {
  if (!e.target.closest("#edit_items")) return;
  if (e.target.classList.contains("edit-cant") || e.target.classList.contains("edit-precio")) {
    recalcularEditTotales();
  }
});

document.addEventListener("click", (e) => {
  const btn = e.target.closest("#edit_items .btn-del-item");
  if (!btn) return;
  btn.closest("tr")?.remove();
  recalcularEditTotales();
});

function verificarClaveEditar() {
  const input = document.getElementById("claveEditar");
  const error = document.getElementById("errorClaveEditar");
  const btn = document.getElementById("btnConfirmarClave");

  const clave = input.value.trim();

  if (!clave) {
    error.textContent = "❌ Ingrese la contraseña";
    return;
  }

  if (clave !== CLAVE_EDITAR) {
    intentosEditar++;
    error.textContent = `❌ Contraseña incorrecta (${intentosEditar}/${MAX_INTENTOS})`;
    input.value = "";

    if (intentosEditar >= MAX_INTENTOS) {
      error.textContent = "🔒 Demasiados intentos. Edición bloqueada.";
      btn.disabled = true;
      input.disabled = true;
    }
    return;
  }

  intentosEditar = 0;
  error.textContent = "";
  input.value = "";

  closeModal("modalClaveEditar");
  abrirEditarVenta(ventaPendienteEditar);
}

function togglePasswordEditar() {
  const input = document.getElementById("claveEditar");
  input.type = input.type === "password" ? "text" : "password";
}

async function refrescarCajaAbierta(tipo = "efectivo", fecha = null) {
  try {
    let tipoKey = normalizarTipoCaja(tipo);

    const fechaInput = (fecha || document.getElementById("v_fecha")?.value || "").trim();
    const ymd = fechaInput || new Date().toISOString().slice(0, 10);

    const qs = `tipo=${encodeURIComponent(tipoKey)}&fecha=${encodeURIComponent(ymd)}`;

    const r = await fetch(`/caja/estado?${qs}`, {
      credentials: "include",
      cache: "no-store"
    });

    const data = await r.json().catch(() => ({}));
    const caja = data?.caja ?? data?.data?.caja ?? data?.data ?? null;

    window.cajasActuales = window.cajasActuales || { efectivo: null, transferencia: null };
    window.cajasActuales[tipoKey] = (caja && caja.id) ? caja : null;

    window.cajaActual = caja;
    window.cajaAbierta = !!(caja && caja.id);

    return window.cajaAbierta;
  } catch (e) {
    console.error("No se pudo consultar caja:", e);

    let tipoKey = normalizarTipoCaja(tipo);

    window.cajasActuales = window.cajasActuales || { efectivo: null, transferencia: null };
    window.cajasActuales[tipoKey] = null;

    window.cajaActual = null;
    window.cajaAbierta = false;
    return false;
  }
}

async function nuevaVenta() {
  openModal("modalVenta");

  const f = document.getElementById("v_fecha");
  if (f) f.value = new Date().toISOString().slice(0, 10);

  const moneda = document.getElementById("v_moneda");
  const tipoCambio = document.getElementById("v_tipo_cambio");
  if (moneda) moneda.value = "PYG";
  if (tipoCambio) tipoCambio.value = "1";

  toggleTipoCambioVenta();

  await cargarClientesVenta();
  await cargarFormasPago();
  iniciarPOS();
}

function onVentasPage() {
  return (location.hash || "").toLowerCase().includes("ventas");
}

document.addEventListener("DOMContentLoaded", () => {
  if (onVentasPage()) cargarVentas();
});

window.addEventListener("hashchange", () => {
  if (onVentasPage()) cargarVentas();
});

function imprimirTicket(id) {
  mostrarToastAccion("🧾 Imprimiendo ticket...");
  window.open(`/ventas/${id}/ticket`, "_blank");
}

function imprimirPagare(id) {
  mostrarToastAccion("📄 Imprimiendo factura...");
  window.open(`/ventas/${id}/pagare`, "_blank");
}

async function buscarProductosManual(texto) {
  const lista = document.getElementById("listaProductosManual");
  if (!lista) return;

  const q = String(texto || "").trim();
  productoManualSeleccionado = null;

  const precioInput = document.getElementById("precioManualVenta");
  if (precioInput) precioInput.value = "";

  if (q.length < 2) {
    lista.style.display = "none";
    lista.innerHTML = "";
    return;
  }

  try {
    const res = await fetch(`/productos?buscar=${encodeURIComponent(q)}`, {
      credentials: "include"
    });

    const productos = await res.json();

    if (!Array.isArray(productos) || productos.length === 0) {
      lista.style.display = "block";
      lista.innerHTML = `<div style="padding:10px; color:#666;">No se encontraron productos</div>`;
      return;
    }

    lista.style.display = "block";
    lista.innerHTML = productos.map(p => `
      <div
        style="padding:10px; border-bottom:1px solid #eee; cursor:pointer;"
        onclick="seleccionarProductoManualVenta(${p.id}, '${String(p.nombre || "").replace(/'/g, "\\'")}', ${Number(p.precio || 0)})"
      >
        <strong>${p.nombre || "-"}</strong><br>
        <small>Código: ${p.codigo || "-"} | Precio: Gs. ${nf(Number(p.precio || 0))}</small>
      </div>
    `).join("");

  } catch (err) {
    console.error("Error buscando productos manualmente:", err);
    lista.style.display = "block";
    lista.innerHTML = `<div style="padding:10px; color:red;">Error al buscar productos</div>`;
  }
}

function seleccionarProductoManualVenta(id, nombre, precio) {
  productoManualSeleccionado = {
    id: Number(id),
    nombre,
    precio: Number(precio || 0)
  };

  const buscar = document.getElementById("buscarProductoManual");
  const precioInput = document.getElementById("precioManualVenta");
  const lista = document.getElementById("listaProductosManual");

  if (buscar) buscar.value = nombre;
  if (precioInput) precioInput.value = nf(precio);

  if (lista) {
    lista.innerHTML = "";
    lista.style.display = "none";
  }
}

function agregarProductoManualVenta() {
  if (!productoManualSeleccionado) {
    alert("Seleccione un producto.");
    return;
  }

  const cantidad = Number(document.getElementById("cantidadManualVenta")?.value || 1);

  if (cantidad <= 0) {
    alert("Cantidad inválida.");
    return;
  }

  const existente = ventaItems.find(p => p.producto_id === productoManualSeleccionado.id);

  if (existente) {
    existente.cantidad += cantidad;
    existente.subtotal = existente.cantidad * existente.precio;
  } else {
    ventaItems.push({
      producto_id: productoManualSeleccionado.id,
      nombre: productoManualSeleccionado.nombre,
      precio: productoManualSeleccionado.precio,
      cantidad,
      subtotal: productoManualSeleccionado.precio * cantidad
    });
  }

  renderItemsVenta();

  document.getElementById("buscarProductoManual").value = "";
  document.getElementById("cantidadManualVenta").value = 1;
  document.getElementById("precioManualVenta").value = "";

  const lista = document.getElementById("listaProductosManual");
  if (lista) {
    lista.innerHTML = "";
    lista.style.display = "none";
  }

  productoManualSeleccionado = null;
}

async function toggleEditTipoCambio() {
  const moneda = document.getElementById("edit_moneda")?.value || "PYG";
  const wrap   = document.getElementById("wrapEditTipoCambio");
  const input  = document.getElementById("edit_tipo_cambio");

  if (moneda === "PYG") {
    if (wrap)  wrap.style.display = "none";
    if (input) input.value = 1;
    recalcularEditTotales();
    return;
  }

  // Traer cotización del servidor (igual que toggleTipoCambioVenta)
  let usd = 6350;
  let brl = 1250;

  try {
    const res  = await fetch("/config/monedas", { credentials: "include" });
    const data = await res.json();

    if (Array.isArray(data.monedas)) {
      data.monedas.forEach(m => {
        if (m.moneda === "USD") usd = Number(m.tipo_cambio);
        if (m.moneda === "BRL") brl = Number(m.tipo_cambio);
      });
    }
  } catch (e) {
    console.error("No se pudo cargar cotización:", e);
  }

  if (wrap) wrap.style.display = "block";

  if (input) {
    input.value    = moneda === "USD" ? usd : brl;
    input.readOnly = true;  // ← solo lectura, se cambia desde el panel admin
    input.style.background = "#f3f4f6";
    input.style.color      = "#6b7280";
    input.style.cursor     = "not-allowed";
  }

  recalcularEditTotales();
}

function mostrarExitoVenta(vueltoTexto, simbolo) {
  document.getElementById("modalExitoVenta")?.remove();

  const overlay = document.createElement("div");
  overlay.id = "modalExitoVenta";
  overlay.style.cssText = `
    position:fixed;inset:0;
    background:rgba(15,23,42,0.75);
    z-index:2147483647;
    display:flex;align-items:center;justify-content:center;
    padding:16px;
  `;

  const vueltoHTML = vueltoTexto !== null ? `
    <div style="
      background:#f0fdf4;border:2px solid #16a34a;
      border-radius:14px;padding:16px 20px;margin-bottom:24px;
    ">
      <div style="font-size:.85rem;font-weight:600;color:#16a34a;margin-bottom:4px;">VUELTO</div>
      <div style="font-size:2rem;font-weight:900;color:#15803d;">${vueltoTexto} ${simbolo}</div>
    </div>
  ` : `<div style="margin-bottom:24px;"></div>`;

  overlay.innerHTML = `
    <div style="
      background:#fff;border-radius:20px;padding:36px 32px;
      width:min(420px,100%);text-align:center;
      box-shadow:0 24px 60px rgba(0,0,0,.25);
      animation:popIn .25s ease;
    ">
      <div style="
        width:72px;height:72px;background:#dcfce7;border-radius:50%;
        display:flex;align-items:center;justify-content:center;
        margin:0 auto 18px;font-size:2rem;
      ">✅</div>
      <h2 style="margin:0 0 8px;font-size:1.5rem;font-weight:800;color:#0f172a;">
        ¡Venta registrada!
      </h2>
      <p style="margin:0 0 20px;color:#64748b;font-size:1rem;">
        La venta fue guardada correctamente.
      </p>
      ${vueltoHTML}
      <button onclick="document.getElementById('modalExitoVenta').remove()" style="
        width:100%;height:48px;background:#16a34a;color:#fff;
        border:none;border-radius:12px;font-size:1rem;font-weight:700;cursor:pointer;
      ">Aceptar</button>
    </div>
    <style>@keyframes popIn{from{opacity:0;transform:scale(.9)}to{opacity:1;transform:scale(1)}}</style>
  `;

  document.body.appendChild(overlay);
}

function mostrarToastAccion(mensaje) {
  // Eliminar toast anterior si existe
  document.querySelectorAll(".toast-accion-venta").forEach(t => t.remove());

  const toast = document.createElement("div");
  toast.className = "toast-accion-venta";
  toast.textContent = mensaje;
  toast.style.cssText = `
    position:fixed;
    bottom:28px;
    left:50%;
    transform:translateX(-50%) translateY(10px);
    background:#1e293b;
    color:#fff;
    padding:10px 22px;
    border-radius:10px;
    font-size:14px;
    font-weight:500;
    z-index:999999;
    opacity:0;
    transition:opacity .2s ease, transform .2s ease;
    pointer-events:none;
    box-shadow:0 8px 24px rgba(0,0,0,.2);
  `;

  document.body.appendChild(toast);

  requestAnimationFrame(() => {
    toast.style.opacity = "1";
    toast.style.transform = "translateX(-50%) translateY(0)";
  });

  setTimeout(() => {
    toast.style.opacity = "0";
    toast.style.transform = "translateX(-50%) translateY(10px)";
    setTimeout(() => toast.remove(), 250);
  }, 1800);
}
async function imprimirTicket(id) {
  const venta = ventasCache.find(v => v.id === id);
  if (!venta) { window.open(`/ventas/${id}/ticket`, "_blank"); return; }

  const fecha = venta.fecha
    ? (() => {
        const d = new Date(String(venta.fecha).slice(0,10) + "T12:00:00");
        return `${String(d.getDate()).padStart(2,"0")}/${String(d.getMonth()+1).padStart(2,"0")}/${d.getFullYear()}`;
      })()
    : "-";

  mostrarModalImpresion({
    tipo:    "Ticket",
    icono:   "ti-receipt",
    color:   "#1d4ed8",
    bgColor: "#eff6ff",
    venta,
    fecha,
    onConfirm: () => window.open(`/ventas/${id}/ticket`, "_blank")
  });
}

async function imprimirPagare(id) {
  const venta = ventasCache.find(v => v.id === id);
  if (!venta) { window.open(`/ventas/${id}/pagare`, "_blank"); return; }

  const fecha = venta.fecha
    ? (() => {
        const d = new Date(String(venta.fecha).slice(0,10) + "T12:00:00");
        return `${String(d.getDate()).padStart(2,"0")}/${String(d.getMonth()+1).padStart(2,"0")}/${d.getFullYear()}`;
      })()
    : "-";

  mostrarModalImpresion({
    tipo:    "Factura",
    icono:   "ti-file-invoice",
    color:   "#065f46",
    bgColor: "#f0fdf4",
    venta,
    fecha,
    onConfirm: () => window.open(`/ventas/${id}/pagare`, "_blank")
  });
}

function mostrarModalImpresion({ tipo, icono, color, bgColor, venta, fecha, onConfirm }) {
  document.getElementById("modalImpresionVenta")?.remove();

  const moneda = (venta.moneda || "PYG").toUpperCase();
  let totalTexto = "";
  if (moneda === "USD")      totalTexto = `US$ ${nfDecimal(venta.total_moneda ?? 0)} (Gs. ${nf(venta.total_pyg ?? 0)})`;
  else if (moneda === "BRL") totalTexto = `R$ ${nfDecimal(venta.total_moneda ?? 0)} (Gs. ${nf(venta.total_pyg ?? 0)})`;
  else                       totalTexto = `Gs. ${nf(venta.total_pyg ?? venta.total ?? 0)}`;

  const overlay = document.createElement("div");
  overlay.id = "modalImpresionVenta";
  overlay.style.cssText = `
    position:fixed;inset:0;
    background:rgba(15,23,42,.55);
    display:flex;align-items:center;justify-content:center;
    padding:16px;z-index:2147483647;
    animation:fadeInOverlay .2s ease;
  `;

  overlay.innerHTML = `
    <style>
      @keyframes fadeInOverlay { from{opacity:0} to{opacity:1} }
      @keyframes popUp { from{opacity:0;transform:scale(.94) translateY(10px)} to{opacity:1;transform:scale(1) translateY(0)} }
    </style>

    <div style="
      background:#fff;border-radius:20px;
      width:min(440px,100%);
      box-shadow:0 24px 60px rgba(0,0,0,.22);
      overflow:hidden;
      animation:popUp .22s ease;
    ">

      <!-- Header -->
      <div style="
        background:${bgColor};
        padding:22px 24px 18px;
        border-bottom:1px solid ${color}22;
        display:flex;align-items:center;gap:14px;
      ">
        <div style="
          width:48px;height:48px;border-radius:14px;
          background:${color}18;border:1.5px solid ${color}44;
          display:flex;align-items:center;justify-content:center;
          font-size:22px;color:${color};flex-shrink:0;
        ">
          <i class="ti ${icono}"></i>
        </div>
        <div>
          <div style="font-size:17px;font-weight:800;color:#0f172a;">
            Imprimir ${tipo}
          </div>
          <div style="font-size:13px;color:#64748b;margin-top:2px;">
            Confirmá los datos antes de imprimir
          </div>
        </div>
      </div>

      <!-- Datos -->
      <div style="padding:20px 24px;">

        <div style="
          background:#f8fafc;border:1px solid #e2e8f0;
          border-radius:14px;overflow:hidden;
        ">

          ${fila("# Venta",    `#${venta.id}`)}
          ${fila("Fecha",      fecha)}
          ${fila("Cliente",    venta.cliente_nombre || "Consumidor Final")}
          ${fila("Productos",  venta.productos || "-")}
          ${fila("Método",     venta.forma_pago_nombre || "-")}
          ${fila("Total",      totalTexto, true)}
          ${fila("Estado",     venta.estado_pago || "-")}

        </div>

      </div>

      <!-- Botones -->
      <div style="
        padding:0 24px 22px;
        display:flex;gap:10px;justify-content:flex-end;
      ">
        <button
          onclick="document.getElementById('modalImpresionVenta').remove()"
          style="
            height:42px;padding:0 20px;border-radius:10px;
            border:1.5px solid #e2e8f0;background:#fff;
            color:#374151;font-size:14px;font-weight:600;cursor:pointer;
          ">
          Cancelar
        </button>
        <button
          id="btnConfirmarImpresion"
          style="
            height:42px;padding:0 22px;border-radius:10px;
            border:none;background:${color};
            color:#fff;font-size:14px;font-weight:700;cursor:pointer;
            display:inline-flex;align-items:center;gap:8px;
            box-shadow:0 8px 20px ${color}44;
          ">
          <i class="ti ${icono}" style="font-size:16px;"></i>
          Imprimir ${tipo}
        </button>
      </div>

    </div>
  `;

  document.body.appendChild(overlay);

  // Cerrar al click en el fondo
  overlay.addEventListener("click", e => {
    if (e.target === overlay) overlay.remove();
  });

  // Confirmar
  document.getElementById("btnConfirmarImpresion").onclick = () => {
    overlay.remove();
    onConfirm();
  };
}

// Helper fila de datos
function fila(label, valor, destacado = false) {
  return `
    <div style="
      display:flex;justify-content:space-between;align-items:center;
      padding:10px 14px;border-bottom:1px solid #e2e8f0;
    ">
      <span style="font-size:13px;color:#64748b;font-weight:500;">${label}</span>
      <span style="
        font-size:${destacado ? "15px" : "13px"};
        font-weight:${destacado ? "800" : "600"};
        color:${destacado ? "#0f172a" : "#334155"};
        text-align:right;max-width:220px;
        white-space:nowrap;overflow:hidden;text-overflow:ellipsis;
      ">${valor}</span>
    </div>
  `;
}
window.mostrarExitoVenta = mostrarExitoVenta;
window.imprimirTicket = imprimirTicket;
window.imprimirPagare = imprimirPagare;
window.nuevaVenta = nuevaVenta;
window.abrirPago = abrirPago;
window.confirmarPago = confirmarPago;
window.confirmarPagoFinal = confirmarPagoFinal;
window.eliminarVentaConfirmada = eliminarVentaConfirmada;
window.confirmarEliminarVenta = confirmarEliminarVenta;
window.editarVenta = editarVenta;
window.verificarClaveEditar = verificarClaveEditar;
window.togglePasswordEditar = togglePasswordEditar;
window.guardarEdicionVenta = guardarEdicionVenta;
window.mostrarModalCajaCerrada = mostrarModalCajaCerrada;
window.cargarVentas = cargarVentas;
window.formatearMontoRecibido = formatearMontoRecibido;
window.calcularVuelto = calcularVuelto;
window.buscarProductosManual = buscarProductosManual;
window.seleccionarProductoManualVenta = seleccionarProductoManualVenta;
window.agregarProductoManualVenta = agregarProductoManualVenta;
window.toggleTipoCambioVenta = toggleTipoCambioVenta;
window.actualizarResumenMonedaVenta = actualizarResumenMonedaVenta;
window.refrescarCajaAbierta = refrescarCajaAbierta;