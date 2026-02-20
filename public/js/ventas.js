let ventaItems = [];
let ventaPendienteEditar = null;
let formaPagoIdFinal = null;
let formaPagoSeleccionada = null;     // texto
let formaPagoIdSeleccionada = null;
let formaPagoNombreSeleccionado = null;
let ventaEliminarId = null;
let intentosEditar = 0;
let caja_id = null;

window.cajaAbierta = window.cajaAbierta ?? false;
window.cajaActual  = window.cajaActual  ?? null;

let formaPagoFinal = { id: null, nombre: null };

const MAX_INTENTOS = 3;
const CLAVE_EDITAR = "editar123";

const ID_DEBITO   = 1;
const ID_EFECTIVO = 2;

/* ===============================
   FORMAT NUMBER
=============================== */
function nf(n) {
  return new Intl.NumberFormat("es-PY").format(n || 0);
}

/* ===============================
   HELPERS MODALES BOOTSTRAP (evitar superposición)
=============================== */
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

/* ===============================
   MODAL PROFESIONAL: CAJA CERRADA
=============================== */
function mostrarModalCajaCerrada(msg = "Debe abrir la caja antes de realizar una venta.") {
  const body = document.getElementById("modalCajaCerradaBody");
  if (body) body.textContent = msg;

  if (typeof bootstrap === "undefined") {
    alert(msg);
    return;
  }

  bsHideModal("modalPago");
  bsHideModal("modalVenta");

  setTimeout(() => {
    const ok = bsShowModal("modalCajaCerrada", { backdrop: "static", keyboard: false });
    if (!ok) alert(msg);
  }, 180);
}

/* ===============================
   FORMAS con comprobante
=============================== */
const FORMAS_CON_COMPROBANTE = new Set([4, 5, 6, 7, 8, 9, 10]);

function toggleComprobanteUI(formaPagoId) {
  const wrap = document.getElementById("wrapComprobante");
  const input = document.getElementById("inputComprobante");
  if (!wrap || !input) return;

  const necesita = FORMAS_CON_COMPROBANTE.has(Number(formaPagoId));
  wrap.style.display = necesita ? "block" : "none";

  if (!necesita) input.value = "";
}

/* ===============================
   MAP FORMA PAGO
=============================== */
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

function detectarFormaPagoDesdeBoton(btn) {
  // 1) Por dataset
  let id = Number(btn?.dataset?.id || btn?.getAttribute?.("data-id") || 0);
  let nombre = (btn?.dataset?.nombre || "").trim();

  // 2) Si no hay nombre en dataset, usar texto del botón
  if (!nombre) nombre = (btn?.textContent || "").trim();

  // 3) Si no hay id, inferir por el texto comparando con el map
  if (!id && nombre) {
    const lower = nombre.toLowerCase();
    for (const [k, v] of Object.entries(FORMAS_PAGO_MAP)) {
      if (String(v).toLowerCase() === lower) {
        id = Number(k);
        break;
      }
    }
  }

  return { id: id || null, nombre: nombre || null };
}

/* ===============================
   SELECCIÓN FORMA PAGO (ÚNICA Y ROBUSTA)
   - Captura clicks en botones de pago aunque tengan clase diferente
=============================== */
document.addEventListener("click", (e) => {
  const btn = e.target.closest(".pago-grid .btn, .btnFormaPago");
  if (!btn) return;

  const { id } = detectarFormaPagoDesdeBoton(btn);
  if (!id) return;

  confirmarPago(btn, id);
});

/* ===============================
   INICIAR POS
=============================== */
function iniciarPOS() {
  ventaItems = [];
  formaPagoIdSeleccionada = null;
  formaPagoFinal = { id: null, nombre: null };

  const inp = document.getElementById("inputComprobante");
  if (inp) inp.value = "";
  toggleComprobanteUI(null);

  const mr = document.getElementById("montoRecibido");
  if (mr) mr.value = "";
  const v = document.getElementById("vuelto");
  if (v) { v.textContent = "0"; v.style.color = ""; }

  renderItemsVenta();
  iniciarScannerVenta();
}

/* ===============================
   CLIENTES
=============================== */
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
});

/* ===============================
   SCANNER
=============================== */
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
      const res = await fetch(`/productos/barcode/${codigo}`);
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

/* ===============================
   AGREGAR PRODUCTO
=============================== */
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

/* ===============================
   RENDER ITEMS
=============================== */
function renderItemsVenta() {
  const tbody = document.getElementById("v_items");
  if (!tbody) return;

  tbody.replaceChildren();

  let total = 0;

  ventaItems.forEach(it => {
    total += it.subtotal;

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
}

/* ===============================
   FLUJO DE PAGO
=============================== */
function abrirPago() {
  if (!ventaItems.length) {
    alert("No hay productos en la venta");
    return;
  }

  formaPagoIdSeleccionada = null;
  formaPagoFinal = { id: null, nombre: null };

  const inp = document.getElementById("inputComprobante");
  if (inp) inp.value = "";
  toggleComprobanteUI(null);

  const mr = document.getElementById("montoRecibido");
  if (mr) mr.value = "";
  const v = document.getElementById("vuelto");
  if (v) { v.textContent = "0"; v.style.color = ""; }

  openModal("modalPago");
}

function confirmarPago(btn, formaPagoId) {
  formaPagoId = Number(formaPagoId);
  formaPagoIdSeleccionada = formaPagoId;

  document.querySelectorAll(".pago-grid .btn, .btnFormaPago")
    .forEach(b => b.classList.remove("active"));
  btn.classList.add("active");

  const nombre = FORMAS_PAGO_MAP[formaPagoId] || (btn.textContent || "").trim();

  const msg = document.getElementById("mensajeFormaPago");
  if (msg) {
    msg.style.display = "block";
    msg.textContent = `Forma de pago seleccionada: ${nombre}`;
  }

  formaPagoFinal = { id: formaPagoId, nombre };

  const bloque = document.getElementById("bloqueEfectivo");
  const esEfectivo = (formaPagoId === ID_EFECTIVO);

  if (bloque) bloque.style.display = esEfectivo ? "block" : "none";

  if (esEfectivo) {
    calcularVuelto();
  } else {
    const mr = document.getElementById("montoRecibido");
    if (mr) mr.value = "";
    const v = document.getElementById("vuelto");
    if (v) { v.textContent = "0"; v.style.color = ""; }
  }

  toggleComprobanteUI(formaPagoId);
}

function normalizarTipoCaja(tipo) {
  let t = String(tipo || "").trim().toLowerCase();
  if (t === "trasferencia") t = "transferencia";
  if (t.includes("trans")) t = "transferencia";
  if (t.includes("efect")) t = "efectivo";
  return t;
}

async function confirmarPagoFinal() {
  // ✅ anti-bug: si la variable quedó mal, tomamos el botón active
  const activeBtn = document.querySelector(".pago-grid .btn.active, .btnFormaPago.active");
  if (activeBtn) {
    const det = detectarFormaPagoDesdeBoton(activeBtn);
    if (det.id) formaPagoIdSeleccionada = det.id;
  }

  formaPagoIdSeleccionada = Number(formaPagoIdSeleccionada);

  if (!formaPagoIdSeleccionada) {
    alert("Seleccione una forma de pago");
    return;
  }

  if (!ventaItems || ventaItems.length === 0) {
    alert("No hay productos en la venta");
    return;
  }

  const total = ventaItems.reduce((a, i) => a + (Number(i.subtotal) || 0), 0);

  const clienteRaw = (document.getElementById("v_cliente")?.value || "").trim();
  const cliente_id = clienteRaw ? Number(clienteRaw) : null;

  let estado_pago = (document.getElementById("v_estado_pago")?.value || "pagado")
    .trim()
    .toLowerCase();
  if (!estado_pago) estado_pago = "pagado";

  const fechaInput = (document.getElementById("v_fecha")?.value || "").trim();
  const fecha = fechaInput || new Date().toISOString().slice(0, 10);

  const esEfectivo = (formaPagoIdSeleccionada === ID_EFECTIVO);

  // 💵 EFECTIVO: validar vuelto
  let vuelto = null;
  if (esEfectivo) {
    const input = document.getElementById("montoRecibido");
    const montoRecibido = Number((input?.value || "").replace(/\D/g, "") || 0);

    if (montoRecibido < total) {
      alert("❌ El monto recibido es menor al total");
      return;
    }
    vuelto = montoRecibido - total;
  }

  // ✅ CAJA según forma de pago (sin usar window.cajaActual)
  window.cajasActuales = window.cajasActuales || { efectivo: null, transferencia: null };
  const tipoCajaNecesaria = esEfectivo ? "efectivo" : "transferencia";

  // 1) Consultar estado de la caja requerida (tipo + fecha)
  if (typeof refrescarCajaAbierta === "function") {
    try {
      await refrescarCajaAbierta(tipoCajaNecesaria, fecha);
    } catch (e) {
      console.error("refrescarCajaAbierta falló:", e);
    }
  }

  // 2) Leer caja_id SOLO desde window.cajasActuales[tipo]
  let caja_id = Number(window.cajasActuales?.[tipoCajaNecesaria]?.id) || null;

  // 3) Reintento por si vino lento / quedó null
  if (!caja_id && typeof refrescarCajaAbierta === "function") {
    try {
      await refrescarCajaAbierta(tipoCajaNecesaria, fecha);
      caja_id = Number(window.cajasActuales?.[tipoCajaNecesaria]?.id) || null;
    } catch (e) {
      console.error("refrescarCajaAbierta (reintento) falló:", e);
    }
  }

  if (!caja_id) {
    if (typeof closeModal === "function") closeModal("modalPago");
    if (typeof closeModal === "function") closeModal("modalVenta");

    const msg = esEfectivo
      ? "Debe abrir la caja de EFECTIVO antes de realizar una venta."
      : "Debe abrir la caja de TRANSFERENCIAS antes de realizar una venta por banco/QR/transferencia.";

    mostrarModalCajaCerrada(msg);
    return;
  }

  // ✅ Comprobante
  let nro_comprobante = null;
  if (FORMAS_CON_COMPROBANTE.has(Number(formaPagoIdSeleccionada))) {
    const inp = document.getElementById("inputComprobante");
    const comp = (inp?.value || "").trim();
    if (!comp) {
      alert("❌ Ingrese el número de comprobante para esta forma de pago");
      return;
    }
    nro_comprobante = comp;
  }

  const body = {
    fecha,
    cliente_id,
    caja_id,
    total,
    forma_pago_id: formaPagoIdSeleccionada,
    estado_pago,
    nro_comprobante,
    items: ventaItems
  };

  console.log("ENVIANDO VENTA:", body);

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

      if (String(msg).toLowerCase().includes("caja")) mostrarModalCajaCerrada(msg);
      else alert(msg);
      return;
    }

    if (esEfectivo) {
      alert(`✅ Venta registrada. Vuelto: ${Number(vuelto || 0).toLocaleString("es-PY")} Gs.`);
    } else {
      alert("✅ Venta registrada correctamente");
    }

    if (typeof closeModal === "function") closeModal("modalPago");
    if (typeof closeModal === "function") closeModal("modalVenta");

    const inp = document.getElementById("inputComprobante");
    if (inp) inp.value = "";
    toggleComprobanteUI(null);

    iniciarPOS();
    await cargarVentas();

  } catch (err) {
    console.error(err);
    alert("❌ Error al guardar la venta");
  }
}
/* ===============================
   EFECTIVO - VUELTO
=============================== */
function formatearMontoRecibido() {
  const input = document.getElementById("montoRecibido");
  if (!input) return;

  const limpio = input.value.replace(/\D/g, "");

  if (!limpio) {
    input.value = "";
    const sp = document.getElementById("vuelto");
    if (sp) { sp.textContent = "0"; sp.style.color = ""; }
    return;
  }

  const monto = Number(limpio);
  input.value = monto.toLocaleString("es-PY");
  calcularVuelto();
}

function calcularVuelto() {
  const total = ventaItems.reduce((a, i) => a + (Number(i.subtotal) || 0), 0);
  const monto = Number((document.getElementById("montoRecibido")?.value || "").replace(/\D/g, "") || 0);

  const span = document.getElementById("vuelto");
  if (!span) return;

  const vuelto = monto - total;

  if (monto <= 0) {
    span.textContent = "0";
    span.style.color = "";
    return;
  }

  if (vuelto < 0) {
    span.textContent = "Monto insuficiente";
    span.style.color = "#dc2626";
  } else {
    span.textContent = vuelto.toLocaleString("es-PY") + " Gs.";
    span.style.color = "#065f46";
  }
}

/* ===============================
   VENTAS LISTAR
=============================== */
async function cargarVentas() {
  try {
    const res = await fetch("/ventas");
    const ventas = await res.json();

    const tbody = document.getElementById("tablaVentas");
    if (!tbody) return;

    tbody.innerHTML = "";

    ventas.forEach(v => {
      const tr = document.createElement("tr");
      tr.innerHTML = `
        <td>${v.id}</td>
        <td>${(typeof fmtDate === "function") ? fmtDate(v.fecha) : String(v.fecha).slice(0, 10)}</td>
        <td>${v.cliente_nombre || "Consumidor Final"}</td>
        <td>${v.forma_pago_nombre || "—"}</td>
        <td>Gs. ${(typeof money === "function") ? money(v.total) : new Intl.NumberFormat("es-PY").format(v.total || 0)}</td>
        <td>
          <span class="estado-badge ${v.estado_pago}">
            ${v.estado_pago}
          </span>
        </td>
        <td style="text-align:center;">
          <button class="btn-icon print-ticket" onclick="imprimirTicket(${v.id})" title="Ticket">🧾</button>
          <button class="btn-icon print-pagare" onclick="imprimirPagare(${v.id})" title="Pagaré">📄</button>
          <button class="btn-icon edit" onclick="editarVenta(${v.id})" title="Editar">✏️</button>
          <button class="btn-icon delete" onclick="confirmarEliminarVenta(${v.id})" title="Eliminar">🗑</button>
        </td>
      `;
      tbody.appendChild(tr);
    });

  } catch (err) {
    console.error("Error cargando ventas", err);
  }
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

/* ===============================
   EDITAR VENTA (tu código igual)
=============================== */
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

  const body = {
    fecha: document.getElementById("edit_fecha").value,
    forma_pago_id: Number(document.getElementById("edit_forma_pago").value),
    estado_pago: document.getElementById("edit_estado").value,
    total,
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
      else alert("⚠️ Se guardó la venta pero no se pudo refrescar la tabla.");
    } catch (e) {
      console.error("cargarVentas falló:", e);
      alert("⚠️ Se guardó la venta pero falló refrescar la tabla (mirá consola).");
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

    document.getElementById("edit_venta_id").value = venta.id;
    document.getElementById("edit_fecha").value = (venta.fecha || "").slice(0, 10);
    document.getElementById("edit_estado").value = venta.estado_pago || "pagado";
    document.getElementById("edit_forma_pago").value = venta.forma_pago_id;

    const tbody = document.getElementById("edit_items");
    tbody.innerHTML = "";

    (venta.items || []).forEach((it, idx) => {
      const cant = Number(it.cantidad || 0);
      const precioUnit = Number(
        it.precio_unitario ??
        (cant > 0 ? (Number(it.subtotal || 0) / cant) : 0)
      );

      const sub = cant * precioUnit;

      tbody.innerHTML += `
        <tr data-idx="${idx}">
          <td>${it.producto_nombre}</td>
          <td style="text-align:center; width:120px;">
            <input type="number" min="1" class="form-control form-control-sm edit-cant"
              value="${cant}" data-producto-id="${it.producto_id}" />
          </td>
          <td style="text-align:right; width:160px;">
            <input type="number" min="0" class="form-control form-control-sm edit-precio"
              value="${precioUnit}" />
          </td>
          <td style="text-align:right; width:160px;">
            <span class="edit-subtotal">${nf(sub)}</span>
          </td>
          <td style="text-align:center; width:70px;">
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
  let total = 0;

  rows.forEach(tr => {
    const cant = Number(tr.querySelector(".edit-cant")?.value || 0);
    const precio = Number(tr.querySelector(".edit-precio")?.value || 0);
    const sub = cant * precio;

    const span = tr.querySelector(".edit-subtotal");
    if (span) span.textContent = nf(sub);

    total += sub;
  });

  const lbl = document.getElementById("edit_total");
  if (lbl) lbl.textContent = nf(total);
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

/* ===============================
   CAJA
=============================== */
async function refrescarCajaAbierta(tipo = "efectivo", fecha = null) {
  try {
    // ✅ normalizar tipo (arregla el typo "trasferencia")
    let tipoKey = String(tipo || "").trim().toLowerCase();
    if (tipoKey === "trasferencia") tipoKey = "transferencia";
    if (tipoKey.includes("trans")) tipoKey = "transferencia";
    if (tipoKey.includes("efect")) tipoKey = "efectivo";

    // ✅ fecha
    const fechaInput = (fecha || document.getElementById("v_fecha")?.value || "").trim();
    const ymd = fechaInput || new Date().toISOString().slice(0, 10);

    // 🔁 probar 2 variantes de tipo (por si el backend es case-sensitive)
    const tiposAProbar = (tipoKey === "efectivo")
      ? ["efectivo", "Efectivo"]
      : ["transferencia", "Transferencia"];

    let caja = null;
    let data = null;

    for (const t of tiposAProbar) {
      const qs = `tipo=${encodeURIComponent(t)}&fecha=${encodeURIComponent(ymd)}`;

      const r = await fetch(`/caja/estado?${qs}`, {
        credentials: "include",
        cache: "no-store",
      });

      data = await r.json().catch(() => ({}));
      caja = data?.caja ?? data?.data?.caja ?? data?.data ?? null;

      console.log("🔎 /caja/estado", { t, ymd, ok: r.ok, caja });

      if (caja && caja.id) break;
    }

    // ✅ guardar SIEMPRE con clave normalizada
    window.cajasActuales = window.cajasActuales || { efectivo: null, transferencia: null };
    window.cajasActuales[tipoKey] = (caja && caja.id) ? caja : null;

    // compat
    window.cajaActual = caja;
    window.cajaAbierta = !!(caja && caja.id);

    console.log("refrescarCajaAbierta OK ->", { tipoKey, ymd, abierta: window.cajaAbierta, caja });

    return window.cajaAbierta;
  } catch (e) {
    console.error("No se pudo consultar caja:", e);

    let tipoKey = String(tipo || "").trim().toLowerCase();
    if (tipoKey === "trasferencia") tipoKey = "transferencia";
    if (tipoKey.includes("trans")) tipoKey = "transferencia";
    if (tipoKey.includes("efect")) tipoKey = "efectivo";

    window.cajasActuales = window.cajasActuales || { efectivo: null, transferencia: null };
    window.cajasActuales[tipoKey] = null;

    window.cajaActual = null;
    window.cajaAbierta = false;
    return false;
  }
}
/* ===============================
   NUEVA VENTA
=============================== */
async function nuevaVenta() {
  openModal("modalVenta");

  const f = document.getElementById("v_fecha");
  if (f) f.value = new Date().toISOString().slice(0, 10);

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
  window.open(`/ventas/${id}/ticket`, "_blank");
}

function imprimirPagare(id) {
  window.open(`/ventas/${id}/pagare`, "_blank");
}

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

// si usás esto en input: oninput="formatearMontoRecibido()"
window.formatearMontoRecibido = formatearMontoRecibido;
window.calcularVuelto = calcularVuelto;