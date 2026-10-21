window.compraItems = window.compraItems || [];
let editCompraItems = [];
let productoSeleccionado = null;
let compraAEliminar = null;
let productosEditarCache = [];
let productosCompraCache = [];

const MONEDA_BASE_COMPRA = "PYG";
const MONEDAS_COMPRA = ["PYG", "USD", "BRL"];

/* ===============================
   MULTIEMPRESA
=============================== */
const USER_COMPRA = JSON.parse(localStorage.getItem("user") || "{}");

const EMPRESA_NOMBRE_COMPRA =
  localStorage.getItem("empresa_nombre") ||
  USER_COMPRA.empresa_nombre ||
  "";

const EMPRESA_LOGO_COMPRA =
  localStorage.getItem("empresa_logo") ||
  USER_COMPRA.empresa_logo ||
  "img/logo.png";

const COLOR_PRINCIPAL_COMPRA =
  localStorage.getItem("color_principal") ||
  USER_COMPRA.color_principal ||
  "#2563eb";

document.documentElement.style.setProperty("--primary", COLOR_PRINCIPAL_COMPRA);
document.documentElement.style.setProperty("--color-principal", COLOR_PRINCIPAL_COMPRA);

function aplicarEmpresaCompras() {
  const titulo = document.querySelector("#compras h2, #compras h3, .compras-title");
  if (titulo && !titulo.dataset.empresaAplicada) {
    titulo.dataset.empresaAplicada = "1";
    titulo.textContent = `Compras ${EMPRESA_NOMBRE_COMPRA}`;
  }

  const logo = document.querySelector("#logoEmpresa, .empresa-logo");
  if (logo) logo.src = EMPRESA_LOGO_COMPRA;
}

/* ===============================
   HELPERS
=============================== */
function numberFormat(n) {
  return new Intl.NumberFormat("es-PY").format(Number(n || 0));
}

function numberFormatDecimal(n, dec = 2) {
  return new Intl.NumberFormat("es-PY", {
    minimumFractionDigits: dec,
    maximumFractionDigits: dec
  }).format(Number(n || 0));
}

function nfCompraDecimal(n, dec = 2) {
  return new Intl.NumberFormat("es-PY", {
    minimumFractionDigits: dec,
    maximumFractionDigits: dec
  }).format(Number(n || 0));
}

function formatFecha(f) {
  if (!f) return "";
  return new Date(f).toISOString().slice(0, 10);
}

function parsePYMoney(v) {
  return Number(String(v || "").replace(/\./g, "").replace(/,/g, "").trim() || 0);
}

function openModal(id) {
  const modal = document.getElementById(id);
  if (!modal) return;

  // Mover al body para que fixed funcione bien
  if (modal.parentElement !== document.body) {
    document.body.appendChild(modal);
  }

  modal.style.display = "flex";
  modal.classList.add("show");
  document.body.classList.add("modal-open");
}

function closeModal(id) {
  const modal = document.getElementById(id);
  if (!modal) return;
  modal.classList.remove("show");
  modal.style.display = "none";
  document.body.classList.remove("modal-open");
}

function attachMoneyFormatterById(id) {
  const el = document.getElementById(id);
  if (!el) return;
  if (el.dataset.moneyBound === "1") return;

  el.dataset.moneyBound = "1";

  el.addEventListener("input", () => {
    const moneda = id === "edit_c_costo"
      ? getMonedaEditarCompra()
      : getMonedaCompra();

    if (moneda === "PYG") {
      const n = parsePYMoney(el.value);
      el.value = numberFormat(n);
    } else {
      let valor = String(el.value || "")
        .replace(/[^0-9.,]/g, "")
        .replace(",", ".");
      el.value = valor;
    }
  });
}

/* ===============================
   MONEDA NUEVA COMPRA
=============================== */
function getMonedaCompra() {
  const moneda = (document.getElementById("c_moneda")?.value || MONEDA_BASE_COMPRA)
    .trim()
    .toUpperCase();

  return MONEDAS_COMPRA.includes(moneda) ? moneda : MONEDA_BASE_COMPRA;
}

function getTipoCambioCompra() {
  const moneda = getMonedaCompra();
  if (moneda === MONEDA_BASE_COMPRA) return 1;

  const valor = Number(document.getElementById("c_tipo_cambio_moneda")?.value || 0);
  return valor > 0 ? valor : 0;
}

function getSimboloMonedaCompra(moneda = getMonedaCompra()) {
  if (moneda === "USD") return "US$";
  if (moneda === "BRL") return "R$";
  return "Gs.";
}

function parseCostoCompraInput() {
  const moneda = getMonedaCompra();
  const valor = document.getElementById("c_costo")?.value || "0";

  if (moneda === "PYG") return parsePYMoney(valor);

  return Number(String(valor).replace(",", ".") || 0);
}

function autocompletarCostoCompraDesdeMoneda() {
  const inputCosto = document.getElementById("c_costo");
  if (!inputCosto || !productoSeleccionado) return;

  const costoGs = Number(productoSeleccionado.costo || 0);
  inputCosto.value = numberFormat(costoGs);
}

async function toggleMonedaCompra() {
  const moneda = getMonedaCompra();
  const wrap = document.getElementById("wrap_c_tipo_cambio");
  const input = document.getElementById("c_tipo_cambio_moneda");
  const labelCosto = document.getElementById("label_c_costo");
  const costoInput = document.getElementById("c_costo");

  if (labelCosto) labelCosto.textContent = "Costo (Gs.)";

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
    console.error("No se pudo cargar tipo de cambio:", e);
  }

  if (wrap && input) {
    if (moneda === "PYG") {
      wrap.style.display = "none";
      input.value = "1";
      input.disabled = false;
      input.readOnly = false;
    } else {
      wrap.style.display = "block";
      input.value = moneda === "USD" ? usd : brl;
      input.disabled = true;
      input.readOnly = true;
    }
  }

  if (costoInput) {
    const n = parsePYMoney(costoInput.value);
    costoInput.value = numberFormat(n);
  }

  if (productoSeleccionado) autocompletarCostoCompraDesdeMoneda();


  recalcularMonedaItemsCompra();

  renderItemsCompra();
}
function recalcularMonedaItemsCompra() {
  const moneda = getMonedaCompra();
  const tipoCambio = getTipoCambioCompra();

  compraItems.forEach((it) => {
    if (moneda === "PYG") {
      it.costo_moneda = it.costo;
      it.subtotal_moneda = it.subtotal;
    } else {
      if (!tipoCambio || tipoCambio <= 0) {
        it.costo_moneda = 0;
        it.subtotal_moneda = 0;
      } else {
        it.costo_moneda = it.costo / tipoCambio;
        it.subtotal_moneda = it.subtotal / tipoCambio;
      }
    }
  });
}


/* ===============================
   MONEDA EDITAR COMPRA
=============================== */
function getMonedaEditarCompra() {
  const moneda = (document.getElementById("edit_c_moneda")?.value || "PYG")
    .trim()
    .toUpperCase();

  return MONEDAS_COMPRA.includes(moneda) ? moneda : "PYG";
}

function getSimboloMonedaEditarCompra(moneda = getMonedaEditarCompra()) {
  if (moneda === "USD") return "US$";
  if (moneda === "BRL") return "R$";
  return "Gs.";
}

function getTipoCambioEditarCompra() {
  const moneda = getMonedaEditarCompra();
  if (moneda === "PYG") return 1;

  const valor = Number(document.getElementById("edit_c_tipo_cambio_moneda")?.value || 0);
  return valor > 0 ? valor : 0;
}

function parseCostoEditarCompraInput() {
  const moneda = getMonedaEditarCompra();
  const valor = document.getElementById("edit_c_costo")?.value || "0";

  if (moneda === "PYG") return parsePYMoney(valor);

  return Number(String(valor).replace(",", ".") || 0);
}

async function toggleMonedaEditarCompra() {
  const moneda = getMonedaEditarCompra();
  const wrap = document.getElementById("wrap_edit_c_tipo_cambio");
  const input = document.getElementById("edit_c_tipo_cambio_moneda");
  const labelCosto = document.getElementById("label_edit_c_costo");
  const costoInput = document.getElementById("edit_c_costo");

  if (labelCosto) labelCosto.textContent = "Costo (Gs.)";

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
    console.error("No se pudo cargar tipo de cambio:", e);
  }

  if (wrap && input) {
    if (moneda === "PYG") {
      wrap.style.display = "none";
      input.value = "1";
      input.disabled = false;
      input.readOnly = false;
    } else {
      wrap.style.display = "block";
      input.value = moneda === "USD" ? usd : brl;
      input.disabled = true;
      input.readOnly = true;
    }
  }

  if (costoInput) {
    const n = parsePYMoney(costoInput.value);
    costoInput.value = numberFormat(n);
  }

  onChangeProductoEditarCompra();
  renderItemsEditarCompra();
}

/* ===============================
   TOTALES
=============================== */
function calcularTotalesCompra() {
  const moneda = getMonedaCompra();
  const tipoCambio = getTipoCambioCompra();

  let subtotalMoneda = compraItems.reduce((acc, it) => acc + Number(it.subtotal_moneda || 0), 0);
  let subtotalPyg = compraItems.reduce((acc, it) => acc + Number(it.subtotal || 0), 0);

  const ivaPyg = Math.round(subtotalPyg * 0.1);
  const totalPyg = subtotalPyg + ivaPyg;

  let ivaMoneda = ivaPyg;
  let totalMoneda = totalPyg;

  if (moneda !== "PYG") {
    ivaMoneda = tipoCambio > 0 ? ivaPyg / tipoCambio : 0;
    totalMoneda = tipoCambio > 0 ? totalPyg / tipoCambio : 0;
  } else {
    subtotalMoneda = subtotalPyg;
  }

  return {
    moneda,
    tipo_cambio: moneda === "PYG" ? 1 : tipoCambio,
    subtotal_pyg: subtotalPyg,
    iva_pyg: ivaPyg,
    total_pyg: totalPyg,
    subtotal_moneda: subtotalMoneda,
    iva_moneda: ivaMoneda,
    total_moneda: totalMoneda
  };
}

function actualizarResumenCompra() {
  const lblSubtotal = document.getElementById("c_subtotal");
  const lblIva = document.getElementById("c_iva");
  const lblTotal = document.getElementById("c_total");

  const lblPyg = document.getElementById("c_total_pyg");
  const lblUsd = document.getElementById("c_total_usd");
  const lblBrl = document.getElementById("c_total_brl");

  const { subtotal_pyg, iva_pyg, total_pyg, tipo_cambio, moneda } = calcularTotalesCompra();

  if (lblSubtotal) lblSubtotal.textContent = numberFormat(subtotal_pyg);
  if (lblIva) lblIva.textContent = numberFormat(iva_pyg);
  if (lblTotal) lblTotal.textContent = numberFormat(total_pyg);

  let usdRate = 7900;
  let brlRate = 1450;

  if (moneda === "USD" && tipo_cambio > 0) usdRate = tipo_cambio;
  if (moneda === "BRL" && tipo_cambio > 0) brlRate = tipo_cambio;

  if (lblPyg) lblPyg.textContent = `Gs. ${numberFormat(total_pyg)}`;
  if (lblUsd) lblUsd.textContent = `US$ ${nfCompraDecimal(total_pyg / usdRate)}`;
  if (lblBrl) lblBrl.textContent = `R$ ${nfCompraDecimal(total_pyg / brlRate)}`;
}

function renderResumenMonedaCompra() {
  const lblSub = document.getElementById("c_subtotal_moneda");
  const lblIva = document.getElementById("c_iva_moneda");
  const lblTotTop = document.getElementById("c_total_moneda");
  const lblTotText = document.getElementById("c_total_moneda_text");
  const lblPyg = document.getElementById("c_total_pyg_resumen");

  if (!lblSub || !lblIva || !lblPyg) {
    actualizarResumenCompra();
    return;
  }

  const { moneda, subtotal_moneda, iva_moneda, total_moneda, total_pyg } = calcularTotalesCompra();
  const simbolo = getSimboloMonedaCompra(moneda);

  if (moneda === "PYG") {
    lblSub.textContent = `Gs. ${numberFormat(subtotal_moneda)}`;
    lblIva.textContent = `Gs. ${numberFormat(iva_moneda)}`;
    if (lblTotTop) lblTotTop.textContent = `Gs. ${numberFormat(total_moneda)}`;
    if (lblTotText) lblTotText.textContent = `Gs. ${numberFormat(total_moneda)}`;
  } else {
    lblSub.textContent = `${simbolo} ${numberFormatDecimal(subtotal_moneda)}`;
    lblIva.textContent = `${simbolo} ${numberFormatDecimal(iva_moneda)}`;
    if (lblTotTop) lblTotTop.textContent = `${simbolo} ${numberFormatDecimal(total_moneda)}`;
    if (lblTotText) lblTotText.textContent = `${simbolo} ${numberFormatDecimal(total_moneda)}`;
  }

  lblPyg.textContent = `Gs. ${numberFormat(total_pyg)}`;
  actualizarResumenCompra();
}

/* ===============================
   FACTURA
=============================== */
function setProximaFacturaCompra() {
  const selProv = document.getElementById("c_proveedor");
  const inputFactura = document.getElementById("c_factura");

  if (!selProv || !inputFactura) return;

  const opt = selProv.selectedOptions[0];
  inputFactura.value = opt?.dataset?.ruc || "";
}

/* ===============================
   LISTAR COMPRAS
=============================== */
async function cargarComprasLista() {
  try {
    aplicarEmpresaCompras();

    const res = await fetch("/compras", { credentials: "include" });

    if (res.status === 401) {
      alert("Sesión expirada. Inicie sesión de nuevo.");
      location.href = "/login.html";
      return;
    }

    if (!res.ok) {
      const txt = await res.text();
      console.error("Error /compras:", res.status, txt);
      return;
    }

    const data = await res.json();

    if (!Array.isArray(data)) {
      console.error("Respuesta inesperada /compras:", data);
      return;
    }

    const tabla = document.getElementById("tabla-compras");
    if (!tabla) return;

    tabla.innerHTML = `
      <table class="table">
        <thead>
          <tr>
            <th>ID</th>
            <th>Fecha</th>
            <th>N° Factura</th>
            <th>Proveedor</th>
            <th>Código</th>
            <th>Producto</th>
            <th>Cantidad</th>
            <th>Categoría</th>
            <th>Total</th>
            <th>RUC</th>
            <th style="text-align:center;">Acciones</th>
          </tr>
        </thead>
        <tbody id="tablaCompras"></tbody>
      </table>
    `;

    renderTablaCompras(data);
  } catch (err) {
    console.error("Error cargando compras:", err);
  }
}

/* ===============================
   EDITAR COMPRA
=============================== */
async function editarCompra(id) {
  try {
    await cargarProductosEditarCompra();
    attachMoneyFormatterById("edit_c_costo");

    const res = await fetch(`/compras/${id}`, { credentials: "include" });

    if (res.status === 401) {
      alert("Sesión expirada. Inicie sesión de nuevo.");
      location.href = "/login.html";
      return;
    }

    if (!res.ok) {
      console.error("Error /compras/:id:", res.status, await res.text());
      return alert("No se pudo cargar la compra");
    }

    const data = await res.json();

    const elId = document.getElementById("edit_compra_id");
    const elProv = document.getElementById("edit_compra_proveedor");
    const elFecha = document.getElementById("edit_compra_fecha");
    const elFactura = document.getElementById("edit_compra_factura");
    const elTipoPago = document.getElementById("edit_compra_tipo_pago");
    const elMoneda = document.getElementById("edit_c_moneda");
    const elTipoCambio = document.getElementById("edit_c_tipo_cambio_moneda");
    const elProducto = document.getElementById("edit_c_producto");
    const elCant = document.getElementById("edit_c_cantidad");
    const elCosto = document.getElementById("edit_c_costo");

    if (!elId || !elProv || !elFecha || !elFactura || !elTipoPago || !elProducto || !elCant || !elCosto) {
      console.error("Faltan elementos del modalEditarCompra");
      return alert("Faltan campos del modal de edición.");
    }

    elId.value = id;

    const provRes = await fetch("/proveedores", { credentials: "include" });

    if (!provRes.ok) {
      console.error("Error /proveedores:", provRes.status, await provRes.text());
      return alert("No se pudieron cargar proveedores");
    }

    const proveedores = await provRes.json();
    elProv.innerHTML = "";

    proveedores.forEach((p) => {
      const op = document.createElement("option");
      op.value = p.id;
      op.textContent = `${p.nombre} — ${p.ruc}`;
      if (Number(p.id) === Number(data.proveedor_id)) op.selected = true;
      elProv.appendChild(op);
    });

    elFecha.value = String(data.fecha || "").slice(0, 10);
    elFactura.value = data.factura || "";
    elTipoPago.value = data.tipo_pago || "efectivo";

    const monedaCompra = (data.moneda || "PYG").toUpperCase();
    const tipoCambioCompra = Number(data.tipo_cambio || 1);

    if (elMoneda) elMoneda.value = monedaCompra;
    if (elTipoCambio) elTipoCambio.value = tipoCambioCompra > 0 ? tipoCambioCompra : 1;

    editCompraItems = (Array.isArray(data.items) ? data.items : []).map((it) => {
      const costoGs = Number(it.costo || 0);
      const subtotalGs = Number(it.subtotal || 0);

      let costoMoneda = Number(it.costo_moneda || 0);
      let subtotalMoneda = Number(it.subtotal_moneda || 0);

      if (!costoMoneda) {
        costoMoneda = monedaCompra !== "PYG" && tipoCambioCompra > 0
          ? costoGs / tipoCambioCompra
          : costoGs;
      }

      if (!subtotalMoneda) {
        subtotalMoneda = monedaCompra !== "PYG" && tipoCambioCompra > 0
          ? subtotalGs / tipoCambioCompra
          : subtotalGs;
      }

      return {
        producto_id: Number(it.producto_id || 0),
        producto_nombre: it.producto_nombre || "SIN NOMBRE",
        cantidad: Number(it.cantidad || 0),
        costo: costoGs,
        subtotal: subtotalGs,
        costo_moneda: costoMoneda,
        subtotal_moneda: subtotalMoneda
      };
    });

    if (elProducto) elProducto.value = "";
    if (elCant) elCant.value = 1;
    if (elCosto) elCosto.value = monedaCompra === "PYG" ? "0" : "0.00";

    openModal("modalEditarCompra");

    requestAnimationFrame(() => {
      const sidebar = document.querySelector("#modalEditarCompra .ec-sidebar");
      const tableBox = document.querySelector("#modalEditarCompra .ec-table-wrap");

      if (sidebar) sidebar.scrollTop = 0;
      if (tableBox) tableBox.scrollTop = 0;

      toggleMonedaEditarCompra();
      renderItemsEditarCompra();
    });

  } catch (err) {
    console.error("FALLO editarCompra():", err);
    alert("Ocurrió un error al abrir la edición.");
  }
}

async function guardarEdicionCompra() {
  const id = Number(document.getElementById("edit_compra_id")?.value || 0);
  const moneda = getMonedaEditarCompra();
  const tipo_cambio = getTipoCambioEditarCompra();

  let subtotalPyg = 0;
  let subtotalMoneda = 0;

  editCompraItems.forEach((it) => {
    subtotalPyg += Number(it.subtotal || 0);
    subtotalMoneda += Number(it.subtotal_moneda || 0);
  });

  const ivaPyg = Math.round(subtotalPyg * 0.1);
  const totalPyg = subtotalPyg + ivaPyg;

  let ivaMoneda = ivaPyg;
  let totalMoneda = totalPyg;

  if (moneda !== "PYG") {
    if (!tipo_cambio || tipo_cambio <= 0) {
      return alert("Ingrese un tipo de cambio válido.");
    }

    ivaMoneda = ivaPyg / tipo_cambio;
    totalMoneda = totalPyg / tipo_cambio;
  } else {
    subtotalMoneda = subtotalPyg;
  }

  const body = {
    proveedor_id: Number(document.getElementById("edit_compra_proveedor")?.value || 0),
    fecha: document.getElementById("edit_compra_fecha")?.value || "",
    factura: document.getElementById("edit_compra_factura")?.value || "",
    tipo_pago: document.getElementById("edit_compra_tipo_pago")?.value || "efectivo",
    moneda,
    tipo_cambio,
    subtotal: subtotalPyg,
    iva: ivaPyg,
    total: totalPyg,
    subtotal_moneda: subtotalMoneda,
    iva_moneda: ivaMoneda,
    total_moneda: totalMoneda,
    items: editCompraItems
  };

  const res = await fetch(`/compras/${id}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify(body)
  });

  let data;

  try {
    data = await res.json();
  } catch {
    data = { ok: false, msg: "Respuesta inválida del servidor" };
  }

  if (!data.ok) return alert("Error: " + (data.msg || "No se pudo actualizar"));

  alert("Compra actualizada correctamente");
  closeModal("modalEditarCompra");
  cargarComprasLista();
}

function renderItemsEditarCompra() {
  const tbody = document.getElementById("edit_compra_items");
  if (!tbody) return;

  tbody.innerHTML = "";

  const moneda = getMonedaEditarCompra();
  const simbolo = getSimboloMonedaEditarCompra(moneda);

  let subtotalPyg = 0;

  editCompraItems.forEach((it, idx) => {
    subtotalPyg += Number(it.subtotal || 0);

    let costoTexto = "";
    let subtotalTexto = "";

    if (moneda === "PYG") {
      costoTexto = `Gs. ${numberFormat(it.costo || 0)}`;
      subtotalTexto = `Gs. ${numberFormat(it.subtotal || 0)}`;
    } else {
      costoTexto = `${simbolo} ${numberFormatDecimal(it.costo_moneda || 0)}`;
      subtotalTexto = `${simbolo} ${numberFormatDecimal(it.subtotal_moneda || 0)}`;
    }

    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${it.producto_nombre}</td>
      <td style="text-align:center;">${it.cantidad}</td>
      <td>${costoTexto}</td>
      <td>${subtotalTexto}</td>
      <td style="text-align:center; white-space:nowrap;">
        <button class="btn btn-warning btn-sm" onclick="editarItemEditarCompra(${idx})">
          <i class="fa fa-pen"></i>
        </button>
        <button class="btn btn-danger btn-sm" onclick="borrarItemEditarCompra(${idx})">
          <i class="fa fa-trash"></i>
        </button>
      </td>
    `;
    tbody.appendChild(tr);
  });

  const ivaPyg = Math.round(subtotalPyg * 0.1);
  const totalPyg = subtotalPyg + ivaPyg;
  const tc = getTipoCambioEditarCompra();

  let subtotalMostrar = "";
  let ivaMostrar = "";
  let totalMostrar = "";

  if (moneda === "PYG") {
    subtotalMostrar = `Gs. ${numberFormat(subtotalPyg)}`;
    ivaMostrar = `Gs. ${numberFormat(ivaPyg)}`;
    totalMostrar = `Gs. ${numberFormat(totalPyg)}`;
  } else {
    subtotalMostrar = `${simbolo} ${numberFormatDecimal(tc > 0 ? subtotalPyg / tc : 0)}`;
    ivaMostrar = `${simbolo} ${numberFormatDecimal(tc > 0 ? ivaPyg / tc : 0)}`;
    totalMostrar = `${simbolo} ${numberFormatDecimal(tc > 0 ? totalPyg / tc : 0)}`;
  }

  const elSubtotal = document.getElementById("edit_compra_subtotal");
  const elIva = document.getElementById("edit_compra_iva");
  const elTotal = document.getElementById("edit_compra_total");
  const elTotalTop = document.getElementById("edit_compra_total_top");
  const elTotalSidebar = document.getElementById("edit_compra_total_sidebar");

  if (elSubtotal) elSubtotal.textContent = subtotalMostrar;
  if (elIva) elIva.textContent = ivaMostrar;
  if (elTotal) elTotal.textContent = totalMostrar;
  if (elTotalTop) elTotalTop.textContent = totalMostrar;
  if (elTotalSidebar) elTotalSidebar.textContent = totalMostrar;
}

function editarItemEditarCompra(idx) {
  const it = editCompraItems[idx];
  if (!it) return;

  const sel = document.getElementById("edit_c_producto");
  const inpCant = document.getElementById("edit_c_cantidad");
  const inpCosto = document.getElementById("edit_c_costo");
  const moneda = getMonedaEditarCompra();

  if (sel) sel.value = String(it.producto_id);
  if (inpCant) inpCant.value = it.cantidad;

  if (inpCosto) {
    if (moneda === "PYG") {
      inpCosto.value = numberFormat(it.costo || 0);
    } else {
      inpCosto.value = numberFormatDecimal(it.costo_moneda || 0);
    }
  }

  editCompraItems.splice(idx, 1);
  renderItemsEditarCompra();
}

function borrarItemEditarCompra(idx) {
  if (!confirm("¿Eliminar este producto?")) return;
  editCompraItems.splice(idx, 1);
  renderItemsEditarCompra();
}

/* ===============================
   ELIMINAR COMPRA
=============================== */
async function eliminarCompra(id) {
  if (!confirm("¿Seguro que desea eliminar esta compra?")) return;

  const res = await fetch(`/compras/${id}`, {
    method: "DELETE",
    credentials: "include"
  });

  const data = await res.json();

  if (!data.ok) return alert("Error: " + data.msg);

  alert("Compra eliminada ✔");
  cargarComprasLista();
}

function confirmarEliminarCompra(id) {
  const input = document.getElementById("delete_compra_id");
  if (input) input.value = id;
  openModal("modalEliminarCompra");
}

async function eliminarCompraConfirmada() {
  const id = document.getElementById("delete_compra_id")?.value;

  const res = await fetch(`/compras/${id}`, {
    method: "DELETE",
    credentials: "include"
  });

  const data = await res.json();

  if (!data.ok) {
    alert("Error: " + data.msg);
    return;
  }

  closeModal("modalEliminarCompra");
  cargarComprasLista();
}

/* ===============================
   PROVEEDORES
=============================== */
async function cargarProveedoresCompra() {
  try {
    const res = await fetch("/proveedores", { credentials: "include" });
    const data = await res.json();

    const sel = document.getElementById("c_proveedor");
    if (!sel) return;

    sel.innerHTML = "<option value=''>Seleccione proveedor…</option>";
    sel.onchange = setProximaFacturaCompra;

    data.forEach((p) => {
      const op = document.createElement("option");
      op.value = p.id;
      op.textContent = p.nombre;
      op.dataset.ruc = p.ruc || "";
      sel.appendChild(op);
    });
  } catch (err) {
    console.error("Error cargando proveedores:", err);
  }
}

/* ===============================
   NUEVA COMPRA
=============================== */
async function abrirNuevaCompra() {
  attachMoneyFormatterById("c_costo");

  await cargarProveedoresCompra();
  await cargarProductosCompra();

  openModal("modalNuevaCompra");

  const hoy = new Date().toISOString().slice(0, 10);

  const fecha = document.getElementById("c_fecha");
  const factura = document.getElementById("c_factura");
  const proveedor = document.getElementById("c_proveedor");
  const tipoPago = document.getElementById("c_tipo_pago");
  const monedaEl = document.getElementById("c_moneda");
  const tcEl = document.getElementById("c_tipo_cambio_moneda");
  const productoSel = document.getElementById("c_producto");
  const cantidad = document.getElementById("c_cantidad");
  const costo = document.getElementById("c_costo");
  const lista = document.getElementById("c_lista_productos");

  if (fecha) fecha.value = hoy;
  if (factura) factura.value = "";
  if (proveedor) proveedor.value = "";
  if (tipoPago) tipoPago.value = "efectivo";
  if (monedaEl) monedaEl.value = "PYG";
  if (tcEl) tcEl.value = "1";
  if (productoSel) productoSel.value = "";
  if (cantidad) cantidad.value = 1;
  if (costo) costo.value = "0";
  if (lista) lista.innerHTML = "";

  compraItems = [];
  productoSeleccionado = null;

  toggleMonedaCompra();
  renderItemsCompra();
}

/* ===============================
   AGREGAR ITEM
=============================== */
function agregarItemCompra() {
  if (!productoSeleccionado) return alert("Debe seleccionar un producto de la lista.");

  const cantidad = Number(document.getElementById("c_cantidad")?.value || 0);
  const costoMoneda = parseCostoCompraInput();
  const moneda = getMonedaCompra();
  const tipoCambio = getTipoCambioCompra();

  if (cantidad <= 0) return alert("Cantidad inválida.");
  if (costoMoneda <= 0) return alert("Costo inválido.");
  if (moneda !== "PYG" && (!tipoCambio || tipoCambio <= 0)) {
    return alert("Ingrese un tipo de cambio válido.");
  }

  const costoPyg = costoMoneda;
  const subtotalPyg = cantidad * costoPyg;

  compraItems.push({
    producto_id: productoSeleccionado.id,
    producto_nombre: productoSeleccionado.nombre,
    cantidad,
    costo: costoPyg,
    costo_moneda: moneda === "PYG" ? costoPyg : costoPyg / tipoCambio,
    subtotal: subtotalPyg,
    subtotal_moneda: moneda === "PYG" ? subtotalPyg : subtotalPyg / tipoCambio
  });

  const sel = document.getElementById("c_producto");
  const cant = document.getElementById("c_cantidad");
  const costo = document.getElementById("c_costo");

  if (sel) sel.value = "";
  if (cant) cant.value = 1;
  if (costo) costo.value = "0";

  productoSeleccionado = null;
  renderItemsCompra();
}

function editarItemCompra(i) {
  const it = compraItems[i];
  const moneda = getMonedaCompra();

  const buscar = document.getElementById("c_buscar_producto");
  const cantidad = document.getElementById("c_cantidad");
  const costo = document.getElementById("c_costo");

  if (buscar) buscar.value = it.producto_nombre;
  if (cantidad) cantidad.value = it.cantidad;

  if (costo) {
    if (moneda === "PYG") {
      costo.value = numberFormat(it.costo);
    } else {
      costo.value = numberFormatDecimal(it.costo_moneda || 0);
    }
  }

  productoSeleccionado = {
    id: it.producto_id,
    nombre: it.producto_nombre,
    costo: it.costo
  };

  compraItems.splice(i, 1);
  renderItemsCompra();
}

function borrarItemCompra(i) {
  if (!confirm("¿Desea eliminar este producto?")) return;
  compraItems.splice(i, 1);
  renderItemsCompra();
}

function renderItemsCompra() {
  const tbody = document.getElementById("c_items");
  if (!tbody) return;

  tbody.innerHTML = "";

  const moneda = getMonedaCompra();
  const simbolo = getSimboloMonedaCompra(moneda);

  compraItems.forEach((it, idx) => {
    let costoTexto = "";
    let subtotalTexto = "";

    if (moneda === "PYG") {
      costoTexto = `Gs. ${numberFormat(it.costo || 0)}`;
      subtotalTexto = `Gs. ${numberFormat(it.subtotal || 0)}`;
    } else {
      costoTexto = `${simbolo} ${numberFormatDecimal(it.costo_moneda || 0)}`;
      subtotalTexto = `${simbolo} ${numberFormatDecimal(it.subtotal_moneda || 0)}`;
    }

    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${it.producto_nombre || "-"}</td>
      <td style="text-align:center;">${it.cantidad || 0}</td>
      <td>${costoTexto}</td>
      <td>${subtotalTexto}</td>
      <td style="text-align:center; white-space:nowrap;">
        <button class="btn btn-warning btn-sm" onclick="editarItemCompra(${idx})">
          <i class="fa fa-pen"></i>
        </button>
        <button class="btn btn-danger btn-sm" onclick="borrarItemCompra(${idx})">
          <i class="fa fa-trash"></i>
        </button>
      </td>
    `;
    tbody.appendChild(tr);
  });

  const { subtotal_pyg, iva_pyg, total_pyg } = calcularTotalesCompra();

  const elSubtotal = document.getElementById("c_subtotal");
  const elIva = document.getElementById("c_iva");
  const elTotal = document.getElementById("c_total");

  if (elSubtotal) elSubtotal.textContent = numberFormat(subtotal_pyg || 0);
  if (elIva) elIva.textContent = numberFormat(iva_pyg || 0);
  if (elTotal) elTotal.textContent = numberFormat(total_pyg || 0);

  const elTotalPrincipal = document.getElementById("c_total_principal");

  if (elTotalPrincipal) {
    if (moneda === "PYG") {
      elTotalPrincipal.textContent = `Gs. ${numberFormat(total_pyg || 0)}`;
    } else {
      const tipoCambio = getTipoCambioCompra();
      const totalMoneda = tipoCambio > 0 ? (total_pyg || 0) / tipoCambio : 0;
      elTotalPrincipal.textContent = `${simbolo} ${numberFormatDecimal(totalMoneda || 0)}`;
    }
  }

  renderResumenMonedaCompra();
}

/* ===============================
   GUARDAR COMPRA
=============================== */
async function guardarCompra() {
  const proveedor_id = Number(document.getElementById("c_proveedor")?.value || 0);
  const fecha = document.getElementById("c_fecha")?.value || "";
  const factura = document.getElementById("c_factura")?.value || "";
  const tipo_pago = document.getElementById("c_tipo_pago")?.value || "";

  if (!proveedor_id) return alert("Seleccione proveedor.");
  if (!fecha) return alert("Ingrese fecha.");
  if (!tipo_pago) return alert("Seleccione forma de pago.");
  if (!compraItems.length) return alert("Agregue productos.");

  const {
    moneda,
    tipo_cambio,
    subtotal_pyg,
    iva_pyg,
    total_pyg,
    subtotal_moneda,
    iva_moneda,
    total_moneda
  } = calcularTotalesCompra();

  if (moneda !== "PYG" && (!tipo_cambio || tipo_cambio <= 0)) {
    return alert("Ingrese un tipo de cambio válido.");
  }

  const body = {
    proveedor_id,
    fecha,
    factura,
    tipo_pago,
    moneda,
    tipo_cambio,
    subtotal: subtotal_pyg,
    iva: iva_pyg,
    total: total_pyg,
    subtotal_moneda,
    iva_moneda,
    total_moneda,
    items: compraItems
  };

  try {
    const res = await fetch("/compras", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify(body)
    });

    const data = await res.json();

    if (!data.ok) return alert("Error: " + data.msg);

    alert("Compra registrada ✔");
    closeModal("modalNuevaCompra");
    cargarComprasLista();
  } catch (err) {
    console.error(err);
    alert("No se pudo guardar la compra.");
  }
}

/* ===============================
   DETALLE
=============================== */
async function verCompraDetalle(id) {
  try {
    const res = await fetch(`/compras/${id}`, { credentials: "include" });
    const data = await res.json();

    const vId = document.getElementById("v_id");
    const vFecha = document.getElementById("v_fecha");
    const vProveedor = document.getElementById("v_proveedor");
    const vRuc = document.getElementById("v_ruc");
    const vFactura = document.getElementById("v_factura");
    const vTotal = document.getElementById("v_total");
    const tbody = document.getElementById("v_items");

    if (vId) vId.textContent = data.id;
    if (vFecha) vFecha.textContent = formatFecha(data.fecha);
    if (vProveedor) vProveedor.textContent = data.proveedor_nombre;
    if (vRuc) vRuc.textContent = data.proveedor_ruc;
    if (vFactura) vFactura.textContent = data.factura;
    if (vTotal) vTotal.textContent = numberFormat(data.total);

    if (tbody) {
      tbody.innerHTML = "";

      (data.items || []).forEach((it) => {
        tbody.innerHTML += `
          <tr>
            <td>${it.producto_nombre}</td>
            <td>${it.cantidad}</td>
            <td>${numberFormat(it.costo)}</td>
            <td>${numberFormat(it.subtotal)}</td>
          </tr>`;
      });
    }

    openModal("modalVerCompra");
  } catch (err) {
    console.error("Error:", err);
  }
}

/* ===============================
   AUTOCOMPLETAR PRODUCTOS
=============================== */
async function autocompletarProductoCompra(texto) {
  const lista = document.getElementById("c_lista_productos");

  if (!lista) return;

  if (!texto || texto.trim().length < 1) {
    lista.innerHTML = "";
    productoSeleccionado = null;
    return;
  }

  try {
    const res = await fetch("/productos?buscar=" + encodeURIComponent(texto.trim()), {
      credentials: "include"
    });

    if (!res.ok) return;

    const data = await res.json();

    lista.innerHTML = "";
    productoSeleccionado = null;

    if (!Array.isArray(data) || !data.length) {
      lista.innerHTML = `<div class="autocomplete-item">Sin resultados</div>`;
      return;
    }

    data.forEach((p) => {
      const item = document.createElement("div");
      item.className = "autocomplete-item";

      const categoria = (p.categoria || "Sin categoría").trim();
      const marca = (p.marca || "Sin marca").trim();
      const codigo = (p.codigo || "").trim();
      const nombre = (p.nombre || "").trim();

      const label =
        (codigo && nombre && codigo !== nombre)
          ? `${nombre} (${codigo})`
          : (nombre || codigo || "SIN NOMBRE");

      item.textContent = `${categoria} — [${marca}] ${label}`;

      item.onclick = () => {
        const input = document.getElementById("c_buscar_producto");
        if (input) input.value = nombre || codigo || "";

        productoSeleccionado = {
          id: p.id,
          nombre: nombre || codigo || "SIN NOMBRE",
          costo: Number(p.costo || 0),
          categoria: p.categoria || null,
          marca: p.marca || null,
          codigo: p.codigo || null
        };

        autocompletarCostoCompraDesdeMoneda();
        lista.innerHTML = "";
      };

      lista.appendChild(item);
    });
  } catch (err) {
    console.error("Error en autocomplete:", err);
  }
}

/* ===============================
   FILTROS
=============================== */
async function filtrarCompras() {
  const texto = (document.getElementById("f_compra_buscar")?.value || "").toLowerCase();
  const proveedor = document.getElementById("f_compra_proveedor")?.value;
  const estado = document.getElementById("f_compra_estado")?.value;
  const desde = document.getElementById("f_compra_desde")?.value || "";
  const hasta = document.getElementById("f_compra_hasta")?.value || "";

  const res = await fetch("/compras", { credentials: "include" });
  let data = await res.json();

  if (texto.trim()) {
    data = data.filter(
      (c) =>
        (c.proveedor_nombre || "").toLowerCase().includes(texto) ||
        (c.factura || "").toLowerCase().includes(texto) ||
        (c.productos || "").toLowerCase().includes(texto) ||
        (c.categorias || "").toLowerCase().includes(texto)
    );
  }

  if (proveedor) data = data.filter((c) => c.proveedor_id == proveedor);
  if (estado) data = data.filter((c) => c.estado == estado);
  if (desde) data = data.filter((c) => String(c.fecha).slice(0, 10) >= desde);
  if (hasta) data = data.filter((c) => String(c.fecha).slice(0, 10) <= hasta);

  renderTablaCompras(data);
}

function renderTablaCompras(data) {
  const tbody = document.getElementById("tablaCompras");
  if (!tbody) return;

  tbody.innerHTML = "";

  if (!data.length) {
    tbody.innerHTML = `
      <tr>
        <td colspan="11" style="text-align:center; color:#666; padding:20px;">
          No se encontraron compras para esta empresa.
        </td>
      </tr>
    `;
    return;
  }

  data.forEach((c) => {
    const tr = document.createElement("tr");
    const moneda = (c.moneda || "PYG").toUpperCase();

    let totalMostrar = "";

    if (moneda === "USD") {
      totalMostrar = `US$ ${numberFormatDecimal(c.total_moneda ?? 0)}`;
    } else if (moneda === "BRL") {
      totalMostrar = `R$ ${numberFormatDecimal(c.total_moneda ?? 0)}`;
    } else {
      totalMostrar = `Gs. ${numberFormat(c.total_pyg ?? c.total ?? 0)}`;
    }

    tr.innerHTML = `
      <td>${c.id}</td>
      <td>${formatFecha(c.fecha)}</td>
      <td>${c.factura || "-"}</td>
      <td>${c.proveedor_nombre || "-"}</td>
      <td>${c.productos || "-"}</td>
      <td>${c.nombres_productos || "-"}</td>
      <td>${c.cantidad_total || 0}</td>
      <td>${c.categorias || "-"}</td>
      <td>
        <b>${totalMostrar}</b><br>
        <small style="color:#666;">Gs. ${numberFormat(c.total_pyg ?? c.total ?? 0)}</small>
      </td>
      <td>${c.proveedor_ruc || "-"}</td>
      <td style="text-align:center; white-space:nowrap;">
        <button class="btn-icon blue" onclick="editarCompra(${c.id})">
          <i class="fa-solid fa-pen"></i>
        </button>
        <button class="btn-icon red" onclick="confirmarEliminarCompra(${c.id})">
          <i class="fa-solid fa-trash"></i>
        </button>
      </td>
    `;

    tbody.appendChild(tr);
  });
}

/* ===============================
   PRODUCTOS NUEVA COMPRA
=============================== */
async function cargarProductosCompra() {
  const sel = document.getElementById("c_producto");
  if (!sel) return;

  const res = await fetch("/productos", { credentials: "include" });

  if (!res.ok) {
    console.error("No se pudo cargar /productos", res.status, await res.text());
    return;
  }

  const productos = await res.json();
  productosCompraCache = Array.isArray(productos) ? productos : [];

  sel.innerHTML = `<option value="">Seleccione producto...</option>`;

  productosCompraCache.forEach((p) => {
    const categoria = (p.categoria || "Sin categoría").trim();
    const marca = (p.marca || "Sin marca").trim();
    const codigo = (p.codigo || "").trim();
    const nombre = (p.nombre || "").trim();

    const label = (nombre && codigo && nombre !== codigo)
      ? `${categoria} — [${marca}] ${nombre} (${codigo})`
      : `${categoria} — [${marca}] ${nombre || codigo || "SIN NOMBRE"}`;

    const op = document.createElement("option");
    op.value = p.id;
    op.textContent = label;
    op.dataset.nombre = nombre || codigo || "SIN NOMBRE";
    op.dataset.costo = Number(p.costo || p.precio || 0);
    sel.appendChild(op);
  });
}

function onChangeProductoCompra() {
  const sel = document.getElementById("c_producto");
  const costoInput = document.getElementById("c_costo");

  if (!sel || !costoInput) return;

  const productoId = Number(sel.value);

  if (!productoId) {
    productoSeleccionado = null;
    costoInput.value = getMonedaCompra() === "PYG" ? "0" : "0.00";
    return;
  }

  const producto = productosCompraCache.find(p => Number(p.id) === productoId);
  if (!producto) return;

  productoSeleccionado = {
    id: Number(producto.id),
    nombre: producto.nombre || producto.codigo || "SIN NOMBRE",
    costo: Number(producto.costo || producto.precio || 0),
    categoria: producto.categoria || null,
    marca: producto.marca || null,
    codigo: producto.codigo || null
  };

  autocompletarCostoCompraDesdeMoneda();
}

/* ===============================
   PRODUCTOS EDITAR COMPRA
=============================== */
async function cargarProductosEditarCompra() {
  const sel = document.getElementById("edit_c_producto");
  if (!sel) return;

  const res = await fetch("/productos", { credentials: "include" });

  if (!res.ok) {
    console.error("No se pudo cargar /productos", res.status, await res.text());
    return;
  }

  const productos = await res.json();
  productosEditarCache = Array.isArray(productos) ? productos : [];

  sel.innerHTML = `<option value="">Seleccione producto...</option>`;

  productosEditarCache.forEach((p) => {
    const categoria = (p.categoria || "Sin categoría").trim();
    const marca = (p.marca || "Sin marca").trim();
    const codigo = (p.codigo || "").trim();
    const nombre = (p.nombre || "").trim();

    const label = (nombre && codigo && nombre !== codigo)
      ? `${categoria} — [${marca}] ${nombre} (${codigo})`
      : `${categoria} — [${marca}] ${nombre || codigo || "SIN NOMBRE"}`;

    const op = document.createElement("option");
    op.value = p.id;
    op.textContent = label;
    op.dataset.nombre = nombre || codigo || "SIN NOMBRE";
    op.dataset.costo = Number(p.costo || p.precio || 0);
    sel.appendChild(op);
  });
}

function onChangeProductoEditarCompra() {
  const sel = document.getElementById("edit_c_producto");
  const costoInput = document.getElementById("edit_c_costo");

  if (!sel || !costoInput) return;

  const productoId = Number(sel.value);

  if (!productoId) {
    costoInput.value = getMonedaEditarCompra() === "PYG" ? "0" : "0.00";
    return;
  }

  const producto = productosEditarCache.find(p => Number(p.id) === productoId);
  if (!producto) return;

  const costoGs = Number(producto.costo || producto.precio || 0);
  const moneda = getMonedaEditarCompra();
  const tipoCambio = getTipoCambioEditarCompra();

  if (moneda === "PYG") {
    costoInput.value = numberFormat(costoGs);
  } else {
    if (!tipoCambio || tipoCambio <= 0) {
      costoInput.value = "0.00";
      return;
    }

    costoInput.value = numberFormatDecimal(costoGs / tipoCambio);
  }
}

function agregarProductoEditarCompra() {
  const sel = document.getElementById("edit_c_producto");
  const inpCant = document.getElementById("edit_c_cantidad");
  const inpCosto = document.getElementById("edit_c_costo");

  if (!sel || !inpCant || !inpCosto) return alert("Faltan campos del editor.");

  const producto_id = Number(sel.value);
  if (!producto_id) return alert("Seleccione un producto.");

  const cantidad = Number(inpCant.value || 0);
  const costoMoneda = parseCostoEditarCompraInput();
  const moneda = getMonedaEditarCompra();
  const tipoCambio = getTipoCambioEditarCompra();

  if (cantidad <= 0) return alert("Cantidad inválida.");
  if (costoMoneda <= 0) return alert("Costo inválido.");
  if (moneda !== "PYG" && (!tipoCambio || tipoCambio <= 0)) {
    return alert("Ingrese un tipo de cambio válido.");
  }

  const costoGs = moneda === "PYG"
    ? costoMoneda
    : Math.round(costoMoneda * tipoCambio);

  const producto_nombre =
    sel.options[sel.selectedIndex]?.dataset?.nombre ||
    sel.options[sel.selectedIndex]?.textContent ||
    "SIN NOMBRE";

  const subtotalGs = cantidad * costoGs;
  const subtotalMoneda = cantidad * costoMoneda;

  const idx = editCompraItems.findIndex(x => Number(x.producto_id) === producto_id);

  const nuevoItem = {
    producto_id,
    producto_nombre,
    cantidad,
    costo: costoGs,
    subtotal: subtotalGs,
    costo_moneda: costoMoneda,
    subtotal_moneda: subtotalMoneda
  };

  if (idx >= 0) {
    editCompraItems[idx] = nuevoItem;
  } else {
    editCompraItems.push(nuevoItem);
  }

  sel.value = "";
  inpCant.value = 1;
  inpCosto.value = moneda === "PYG" ? "0" : "0.00";

  renderItemsEditarCompra();
}

/* ===============================
   INIT
=============================== */
if (document.getElementById("tabla-compras")) {
  attachMoneyFormatterById("c_costo");
  aplicarEmpresaCompras();
  cargarComprasLista();
}


document.addEventListener("DOMContentLoaded", () => {
  const modalIds = [
    "modalVenta",
    "modalPago",
    "modalNuevaCompra",
    "modalEditarCompra",
    "logoutModal",
    "modalCajaCerrada",
    "modalEliminarVenta",
    "modalEliminarCompra",
    "modalCuentaPagar",
    "modalEliminarCuentaPagar"
  ];

  modalIds.forEach((id) => {
    const el = document.getElementById(id);
    if (el && el.parentElement !== document.body) {
      document.body.appendChild(el);
    }
  });
});

/* ===============================
   EXPORTS
=============================== */
window.openModal = openModal;
window.closeModal = closeModal;

window.editarCompra = editarCompra;
window.guardarEdicionCompra = guardarEdicionCompra;
window.agregarProductoEditarCompra = agregarProductoEditarCompra;
window.editarItemEditarCompra = editarItemEditarCompra;
window.borrarItemEditarCompra = borrarItemEditarCompra;
window.onChangeProductoEditarCompra = onChangeProductoEditarCompra;
window.toggleMonedaEditarCompra = toggleMonedaEditarCompra;

window.confirmarEliminarCompra = confirmarEliminarCompra;
window.eliminarCompraConfirmada = eliminarCompraConfirmada;

window.abrirNuevaCompra = abrirNuevaCompra;
window.guardarCompra = guardarCompra;
window.agregarItemCompra = agregarItemCompra;
window.editarItemCompra = editarItemCompra;
window.borrarItemCompra = borrarItemCompra;
window.toggleMonedaCompra = toggleMonedaCompra;
window.autocompletarProductoCompra = autocompletarProductoCompra;
window.filtrarCompras = filtrarCompras;
window.onChangeProductoCompra = onChangeProductoCompra;
window.verCompraDetalle = verCompraDetalle;


/* =====================================================================
   CONSUMO INTERNO (uso propio)
   ---------------------------------------------------------------------
   - Registrar consumo (descuenta stock, no toca caja)
   - Resumen simple: cuántos productos se usaron y cuánta plata no entró
   - Tarjeta informativa en Caja (no suma ni resta)
   Va dentro de una función para que sus variables no choquen con
   las de compras.js ni app.js.
   ===================================================================== */
(function () {
let consumoProductoSel = null;
let consumoBuscarTimer = null;
let consumoRangoActual = "mes"; // hoy | semana | mes

/* ---------- Utilidades ---------- */
function fmtGsConsumo(n) {
  return "Gs. " + new Intl.NumberFormat("es-PY").format(Math.round(Number(n || 0)));
}

function fmtNumConsumo(n) {
  return new Intl.NumberFormat("es-PY").format(Number(n || 0));
}

function escConsumo(str) {
  return String(str ?? "").replace(/[&<>"']/g, s => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  }[s]));
}

function hoyConsumo() {
  return new Date().toLocaleDateString("en-CA", { timeZone: "America/Asuncion" });
}

function fmtFechaConsumo(f) {
  if (!f) return "-";
  const d = new Date(f);
  if (isNaN(d)) return "-";
  return d.toLocaleString("es-PY", {
    timeZone: "America/Asuncion",
    day: "2-digit", month: "2-digit", year: "numeric",
    hour: "2-digit", minute: "2-digit"
  });
}

function fmtHoraConsumo(f) {
  const d = new Date(f);
  if (isNaN(d)) return "-";
  return d.toLocaleTimeString("es-PY", { timeZone: "America/Asuncion", hour: "2-digit", minute: "2-digit" });
}

function avisoConsumo(msg, tipo = "success") {
  if (typeof toast === "function") toast(msg, tipo);
  else if (typeof mostrarToastAccion === "function") mostrarToastAccion(msg);
  else alert(msg);
}

/* ---------- Buscar producto ---------- */
function buscarProductoConsumo(texto) {
  clearTimeout(consumoBuscarTimer);
  consumoBuscarTimer = setTimeout(() => buscarProductoConsumoAhora(texto), 250);
}

async function buscarProductoConsumoAhora(texto) {
  const lista = document.getElementById("consumoListaProductos");
  if (!lista) return;

  const q = String(texto || "").trim();
  consumoProductoSel = null;
  actualizarInfoProductoConsumo();

  if (q.length < 2) {
    lista.style.display = "none";
    lista.innerHTML = "";
    return;
  }

  try {
    const res = await fetch(`/productos?buscar=${encodeURIComponent(q)}`, { credentials: "include" });
    const productos = await res.json();

    lista.innerHTML = "";
    lista.style.display = "block";

    if (!Array.isArray(productos) || !productos.length) {
      lista.innerHTML = `<div style="padding:10px;color:#6b7280;">No se encontraron productos</div>`;
      return;
    }

    productos.slice(0, 15).forEach(p => {
      const item = document.createElement("div");
      item.style.cssText = "padding:10px 12px;border-bottom:1px solid #eef2f7;cursor:pointer;";
      item.onmouseover = () => (item.style.background = "#f8fafc");
      item.onmouseout = () => (item.style.background = "");
      item.innerHTML = `
        <strong style="color:#111827;">${escConsumo(p.nombre || "-")}</strong><br>
        <small style="color:#6b7280;">Código: ${escConsumo(p.codigo || "-")} | Stock: ${Number(p.stock || 0)} | Precio: ${fmtGsConsumo(p.precio)}</small>
      `;
      item.addEventListener("click", () => seleccionarProductoConsumo(p));
      lista.appendChild(item);
    });
  } catch (err) {
    console.error("Error buscando productos (consumo):", err);
    lista.style.display = "block";
    lista.innerHTML = `<div style="padding:10px;color:#b91c1c;">Error al buscar productos</div>`;
  }
}

function seleccionarProductoConsumo(p) {
  consumoProductoSel = {
    id: Number(p.id),
    nombre: p.nombre,
    stock: Number(p.stock || 0),
    costo: Number(p.costo || 0),
    precio: Number(p.precio || 0)
  };

  const input = document.getElementById("consumoBuscar");
  const lista = document.getElementById("consumoListaProductos");
  if (input) input.value = p.nombre || "";
  if (lista) { lista.innerHTML = ""; lista.style.display = "none"; }

  actualizarInfoProductoConsumo();
  document.getElementById("consumoCantidad")?.focus();
}

function actualizarInfoProductoConsumo() {
  const info = document.getElementById("consumoInfoProducto");
  if (!info) return;

  if (!consumoProductoSel) {
    info.style.display = "none";
    info.innerHTML = "";
    return;
  }

  const cant = Number(document.getElementById("consumoCantidad")?.value || 0);
  const valorVenta = cant * consumoProductoSel.precio;

  info.style.display = "block";
  info.innerHTML = `
    Stock disponible: <strong>${consumoProductoSel.stock}</strong>
    &nbsp;|&nbsp; Si se vendía: <strong style="color:#c2410c;">${fmtGsConsumo(valorVenta)}</strong>
    (no entra a caja)
  `;
}

/* ---------- Registrar ---------- */
async function registrarConsumoInterno() {
  if (!consumoProductoSel) {
    alert("Seleccioná un producto");
    return;
  }

  const cantidad = Number(document.getElementById("consumoCantidad")?.value || 0);
  const motivo = (document.getElementById("consumoMotivo")?.value || "").trim();

  if (!cantidad || cantidad <= 0) {
    alert("Ingresá una cantidad válida");
    return;
  }
  if (cantidad > consumoProductoSel.stock) {
    alert(`Stock insuficiente. Disponible: ${consumoProductoSel.stock}`);
    return;
  }

  const btn = document.getElementById("btnRegistrarConsumo");
  if (btn) btn.disabled = true;

  try {
    const res = await fetch("/consumos", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ producto_id: consumoProductoSel.id, cantidad, motivo })
    });
    const data = await res.json().catch(() => ({}));

    if (!res.ok || !data.ok) {
      alert(data.msg || "Error registrando el consumo");
      return;
    }

    avisoConsumo("Consumo registrado");
    consumosPagina = 1;
    limpiarFormConsumo();
    await refrescarConsumoInterno();
  } catch (err) {
    console.error(err);
    alert("Error registrando el consumo");
  } finally {
    if (btn) btn.disabled = false;
  }
}

function limpiarFormConsumo() {
  consumoProductoSel = null;
  const b = document.getElementById("consumoBuscar");
  const c = document.getElementById("consumoCantidad");
  const m = document.getElementById("consumoMotivo");
  if (b) b.value = "";
  if (c) c.value = 1;
  if (m) m.value = "";
  actualizarInfoProductoConsumo();
}

/* ---------- Pedir datos al servidor con mensajes claros ---------- */
async function pedirJsonConsumo(url) {
  let res;
  try {
    res = await fetch(url, { credentials: "include", cache: "no-store" });
  } catch {
    throw new Error("No hay conexión con el servidor. Revisá que esté encendido.");
  }
  let data = null;
  try { data = await res.json(); } catch { data = null; }

  if (res.status === 404 && !data) {
    throw new Error("El servidor que está corriendo no tiene las rutas nuevas de consumo interno. Cortalo (Ctrl + C) y volvé a iniciarlo.");
  }
  if (res.status === 401) {
    throw new Error("La sesión venció. Volvé a iniciar sesión.");
  }
  if (!res.ok || !data) {
    throw new Error((data && (data.msg || data.error)) || `Error del servidor (${res.status}). Mirá la terminal del servidor.`);
  }
  return data;
}

/* ---------- Resumen simple (Hoy / Semana / Mes) ---------- */
function rangoConsumo(tipo) {
  consumoRangoActual = tipo;
  document.querySelectorAll(".ci-tabs button").forEach(b => {
    b.classList.toggle("activo", b.dataset.rango === tipo);
  });
  cargarResumenConsumo();
}

function desdeRangoConsumo(tipo, hoy) {
  if (tipo === "hoy") return hoy;
  if (tipo === "semana") {
    const d = new Date(hoy + "T12:00:00");
    const dia = d.getDay(); // 0 = domingo
    d.setDate(d.getDate() - (dia === 0 ? 6 : dia - 1)); // lunes
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  }
  return hoy.slice(0, 8) + "01"; // mes
}

async function cargarResumenConsumo() {
  const elUnid = document.getElementById("ciKpiUnidades");
  const elVenta = document.getElementById("ciKpiVenta");
  const elFrase = document.getElementById("ciFrase");
  if (!elUnid || !elVenta || !elFrase) return;

  const hoy = hoyConsumo();
  const desde = desdeRangoConsumo(consumoRangoActual, hoy);

  try {
    const r = await pedirJsonConsumo(`/consumos/resumen?desde=${desde}&hasta=${hoy}`);

    const unidades = Number(r.unidades || 0);
    const plata = fmtGsConsumo(r.venta);
    const periodo = { hoy: "Hoy", semana: "Esta semana", mes: "Este mes" }[consumoRangoActual];

    elUnid.textContent = fmtNumConsumo(unidades);
    elVenta.textContent = plata;
    elFrase.textContent = unidades > 0
      ? `${periodo} se ${unidades === 1 ? "usó 1 producto" : `usaron ${fmtNumConsumo(unidades)} productos`} del negocio. ${unidades === 1 ? "Si se vendía, era" : "Si se vendían, eran"} ${plata}.`
      : `${periodo} no se usó ningún producto del negocio.`;
  } catch (e) {
    console.error("Error resumen consumo interno:", e);
    elFrase.textContent = e.message || "No se pudo cargar el resumen.";
  }
}

/* Monto que no entró a caja; si el producto no tiene precio, lo avisa */
function montoConsumoHtml(c) {
  if (c.valor_venta === undefined) {
    return `<span title="Reiniciá el servidor para ver este dato" style="color:#94a3b8;font-weight:500;">Reiniciar servidor</span>`;
  }
  if (Number(c.valor_venta) > 0) return fmtGsConsumo(c.valor_venta);
  return `<span title="El producto no tiene precio de venta cargado. Cargalo en Productos." style="display:inline-block;padding:2px 8px;border-radius:999px;background:#fef3c7;color:#92400e;font-size:.78rem;font-weight:600;">Sin precio</span>`;
}

/* ---------- Historial ---------- */
let consumosLista = [];
let consumosPagina = 1;
const CONSUMOS_POR_PAGINA = 10;

async function cargarConsumos() {
  const tbody = document.getElementById("tablaConsumos");
  if (!tbody) return;

  try {
    const res = await fetch("/consumos", { credentials: "include", cache: "no-store" });
    const rows = await res.json();
    consumosLista = Array.isArray(rows) ? rows : [];
    renderConsumosPagina();
  } catch (err) {
    console.error("Error cargando consumos:", err);
  }
}

function renderConsumosPagina() {
  const tbody = document.getElementById("tablaConsumos");
  if (!tbody) return;

  const total = consumosLista.length;
  const totalPaginas = Math.max(1, Math.ceil(total / CONSUMOS_POR_PAGINA));
  if (consumosPagina > totalPaginas) consumosPagina = totalPaginas;
  if (consumosPagina < 1) consumosPagina = 1;

  tbody.innerHTML = "";

  if (!total) {
    tbody.innerHTML = `
      <tr><td colspan="7" style="text-align:center;padding:32px;color:#6b7280;">
        Todavía no hay consumos registrados.
      </td></tr>`;
    renderConsumosPaginacion(0, 1);
    return;
  }

  const inicio = (consumosPagina - 1) * CONSUMOS_POR_PAGINA;
  consumosLista.slice(inicio, inicio + CONSUMOS_POR_PAGINA).forEach(c => {
    const tr = document.createElement("tr");
    tr.style.borderTop = "1px solid #eef2f6";
    tr.innerHTML = `
      <td style="padding:12px;white-space:nowrap;color:#374151;">${fmtFechaConsumo(c.fecha)}</td>
      <td style="padding:12px;font-weight:600;color:#111827;">${escConsumo(c.producto_nombre || "-")}</td>
      <td style="padding:12px;text-align:center;">${Number(c.cantidad)}</td>
      <td style="padding:12px;text-align:right;font-weight:600;color:#c2410c;">${montoConsumoHtml(c)}</td>
      <td style="padding:12px;color:#4b5563;">${escConsumo(c.motivo || "-")}</td>
      <td style="padding:12px;color:#4b5563;">${escConsumo(c.usuario_nombre || "-")}</td>
      <td style="padding:12px;text-align:center;">
        <button title="Eliminar y devolver stock" style="
          width:34px;height:34px;border-radius:8px;border:1.5px solid #fca5a5;
          background:#fff;color:#b91c1c;cursor:pointer;font-size:16px;">
          <i class="fa-solid fa-trash"></i>
        </button>
      </td>
    `;
    tr.querySelector("button").addEventListener("click", () => eliminarConsumo(c.id));
    tbody.appendChild(tr);
  });

  renderConsumosPaginacion(total, totalPaginas);
}

function renderConsumosPaginacion(total, totalPaginas) {
  const cont = document.getElementById("consumosPaginacion");
  if (!cont) return;

  if (total <= CONSUMOS_POR_PAGINA) {
    cont.innerHTML = total
      ? `<span class="cp-info">${total} ${total === 1 ? "consumo" : "consumos"}</span>`
      : "";
    return;
  }

  const desde = (consumosPagina - 1) * CONSUMOS_POR_PAGINA + 1;
  const hasta = Math.min(consumosPagina * CONSUMOS_POR_PAGINA, total);

  // Números visibles: primera, última y las cercanas a la actual
  let botones = "";
  for (let i = 1; i <= totalPaginas; i++) {
    if (i === 1 || i === totalPaginas || Math.abs(i - consumosPagina) <= 1) {
      botones += `<button type="button" data-pag="${i}" class="${i === consumosPagina ? "activo" : ""}"${i === consumosPagina ? ' aria-current="page"' : ""}>${i}</button>`;
    } else if (Math.abs(i - consumosPagina) === 2) {
      botones += `<span class="cp-puntos">…</span>`;
    }
  }

  cont.innerHTML = `
    <span class="cp-info">Mostrando ${desde}–${hasta} de ${total}</span>
    <div class="cp-botones">
      <button type="button" data-pag="${consumosPagina - 1}" ${consumosPagina === 1 ? "disabled" : ""} aria-label="Página anterior">‹</button>
      ${botones}
      <button type="button" data-pag="${consumosPagina + 1}" ${consumosPagina === totalPaginas ? "disabled" : ""} aria-label="Página siguiente">›</button>
    </div>
  `;

  cont.querySelectorAll("button[data-pag]").forEach(b => {
    b.addEventListener("click", () => {
      consumosPagina = Number(b.dataset.pag);
      renderConsumosPagina();
    });
  });
}

/* ---------- Eliminar ---------- */
function confirmarEliminarConsumoModal() {
  return new Promise(resolve => {
    document.getElementById("modalEliminarConsumo")?.remove();

    const overlay = document.createElement("div");
    overlay.id = "modalEliminarConsumo";
    overlay.style.cssText = `
      position:fixed;inset:0;z-index:2147483647;
      background:rgba(15,23,42,.55);
      display:flex;align-items:center;justify-content:center;padding:16px;
    `;

    overlay.innerHTML = `
      <div role="dialog" aria-modal="true" aria-labelledby="tituloEliminarConsumo" style="
        width:min(420px,100%);background:#fff;border-radius:16px;padding:2rem;
        box-shadow:0 20px 60px rgba(0,0,0,.2);text-align:center;">

        <div style="width:64px;height:64px;border-radius:50%;background:#fee2e2;
          display:flex;align-items:center;justify-content:center;margin:0 auto 1rem;">
          <i class="fa-solid fa-trash" style="font-size:1.5rem;color:#ef4444;"></i>
        </div>

        <h3 id="tituloEliminarConsumo" style="margin:0 0 .5rem;font-size:1.2rem;font-weight:700;color:#111827;">
          Eliminar consumo
        </h3>
        <p style="margin:0 0 1.5rem;color:#6b7280;font-size:.95rem;">
          ¿Seguro que querés eliminar este consumo? El stock se devolverá al producto.
        </p>

        <div style="display:flex;gap:.75rem;">
          <button type="button" data-accion="cancelar" style="
            flex:1;padding:.75rem;border-radius:10px;border:none;cursor:pointer;
            background:#e5e7eb;color:#374151;font-weight:600;font-size:.95rem;">
            Cancelar
          </button>
          <button type="button" data-accion="eliminar" style="
            flex:1;padding:.75rem;border-radius:10px;border:none;cursor:pointer;
            background:#ef4444;color:#fff;font-weight:600;font-size:.95rem;
            box-shadow:0 4px 12px rgba(239,68,68,.3);">
            <i class="fa-solid fa-trash" style="margin-right:.4rem;"></i>Eliminar
          </button>
        </div>
      </div>
    `;

    const cerrar = (resultado) => {
      document.removeEventListener("keydown", onKey);
      overlay.remove();
      resolve(resultado);
    };
    const onKey = (e) => { if (e.key === "Escape") cerrar(false); };

    overlay.addEventListener("click", e => {
      if (e.target === overlay) return cerrar(false);
      const accion = e.target.closest("button")?.dataset.accion;
      if (accion === "cancelar") cerrar(false);
      if (accion === "eliminar") cerrar(true);
    });
    document.addEventListener("keydown", onKey);

    document.body.appendChild(overlay);
    overlay.querySelector('[data-accion="cancelar"]').focus();
  });
}

async function eliminarConsumo(id) {
  const confirmado = await confirmarEliminarConsumoModal();
  if (!confirmado) return;

  try {
    const res = await fetch(`/consumos/${id}`, { method: "DELETE", credentials: "include" });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data.ok) {
      alert(data.msg || "Error eliminando consumo");
      return;
    }
    avisoConsumo("Consumo eliminado. El stock volvió al producto.");
    await refrescarConsumoInterno();
  } catch (err) {
    console.error(err);
    alert("Error eliminando consumo");
  }
}

async function refrescarConsumoInterno() {
  await Promise.all([cargarConsumos(), cargarResumenConsumo()]);
}

/* ---------- Tarjeta en Caja (informativa: no suma ni resta) ---------- */
function fechaCajaConsumo() {
  return (document.getElementById("fechaCajaEfectivo")?.value || "").trim() ||
         (document.getElementById("fechaCajaTransferencia")?.value || "").trim() ||
         hoyConsumo();
}

async function cargarConsumoCaja(fecha) {
  const cont = document.getElementById("cic-lista");
  if (!cont) return; // la tarjeta no está en el HTML

  const f = fecha || fechaCajaConsumo();
  const set = (id, txt) => { const el = document.getElementById(id); if (el) el.textContent = txt; };

  try {
    const data = await pedirJsonConsumo(`/consumos/caja?fecha=${encodeURIComponent(f)}`);

    const dia = data.dia || { items: [], unidades: 0, venta: 0 };
    const mes = data.mes || { unidades: 0, venta: 0 };

    set("cic-dia-unidades", fmtNumConsumo(dia.unidades));
    set("cic-dia-venta", fmtGsConsumo(dia.venta));
    set("cic-mes-unidades", fmtNumConsumo(mes.unidades));
    set("cic-mes-venta", fmtGsConsumo(mes.venta));

    cont.innerHTML = (dia.items || []).length
      ? dia.items.map(c => `
          <div class="cic-fila">
            <span class="cic-hora">${fmtHoraConsumo(c.fecha)}</span>
            <span class="cic-prod"><strong>${Number(c.cantidad)} × ${escConsumo(c.producto_nombre)}</strong>
              <small>${escConsumo(c.usuario_nombre || "-")}${c.motivo ? " · " + escConsumo(c.motivo) : ""}</small>
            </span>
            <span class="cic-monto">${montoConsumoHtml(c)}</span>
          </div>`).join("")
      : `<div class="cic-vacio">Este día no se usó ningún producto del negocio.</div>`;
  } catch (e) {
    console.error("Error consumo interno en caja:", e);
    cont.innerHTML = `<div class="cic-vacio" style="color:#b91c1c;">${escConsumo(e.message || "No se pudo cargar el consumo interno.")}</div>`;
  }
}

/* ---------- Eventos ---------- */
document.addEventListener("input", e => {
  if (e.target.id === "consumoBuscar") buscarProductoConsumo(e.target.value);
  if (e.target.id === "consumoCantidad") actualizarInfoProductoConsumo();
});

// Cambiar la fecha en Caja actualiza la tarjeta de consumo interno
document.addEventListener("change", e => {
  if (e.target.id === "fechaCajaEfectivo" || e.target.id === "fechaCajaTransferencia") {
    cargarConsumoCaja(e.target.value);
  }
});

// Cerrar la lista de búsqueda al tocar fuera
document.addEventListener("click", e => {
  const lista = document.getElementById("consumoListaProductos");
  const input = document.getElementById("consumoBuscar");
  if (!lista || lista.style.display === "none") return;
  if (!lista.contains(e.target) && e.target !== input) lista.style.display = "none";
});

function enConsumoPage() {
  return (location.hash || "").toLowerCase() === "#consumo-interno";
}

function enCajaPage() {
  return (location.hash || "").toLowerCase() === "#caja";
}

function alCambiarPantallaConsumo() {
  if (enConsumoPage()) refrescarConsumoInterno();
  if (enCajaPage()) cargarConsumoCaja();
}

document.addEventListener("DOMContentLoaded", alCambiarPantallaConsumo);
window.addEventListener("hashchange", alCambiarPantallaConsumo);

window.registrarConsumoInterno = registrarConsumoInterno;
window.cargarConsumos = cargarConsumos;
window.eliminarConsumo = eliminarConsumo;
window.limpiarFormConsumo = limpiarFormConsumo;
window.rangoConsumo = rangoConsumo;
window.cargarResumenConsumo = cargarResumenConsumo;
window.cargarConsumoCaja = cargarConsumoCaja;
})();