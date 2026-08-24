const API = window.location.origin;

/* =========================================
   MULTIEMPRESA / PERSONALIZACIÓN
========================================= */
const USER = JSON.parse(localStorage.getItem("user") || "{}");

// Leer empresa del array multiempresa
const _empresaActivaId = localStorage.getItem("empresa_activa");
const _empresas = JSON.parse(localStorage.getItem("empresas") || "[]");
const _empresa = _empresas.find(e => String(e.id) === String(_empresaActivaId)) || {};

const EMPRESA_NOMBRE =
  _empresa.nombre ||
  USER.empresa_nombre ||
  "Mi Empresa";

const EMPRESA_LOGO =
  _empresa.logo ||
  USER.empresa_logo ||
  "img/logo2.png";

const EMPRESA_COLOR =
  _empresa.color_principal ||
  USER.color_principal ||
  "#2563eb";

document.documentElement.style.setProperty("--primary", EMPRESA_COLOR);
document.documentElement.style.setProperty("--color-principal", EMPRESA_COLOR);

function aplicarPersonalizacionEmpresa() {
  document.title = `${EMPRESA_NOMBRE} • Panel`;

  document.querySelectorAll(".empresa-nombre").forEach(el => {
    el.textContent = EMPRESA_NOMBRE;
  });

  document.querySelectorAll(".empresa-logo").forEach(el => {
    el.src = EMPRESA_LOGO;
  });

  const sidebarLogo = document.getElementById("sidebarEmpresaLogo");
  if (sidebarLogo) sidebarLogo.src = EMPRESA_LOGO || "img/logo2.png";

  const sidebarNombre = document.getElementById("sidebarEmpresaNombre");
  if (sidebarNombre) sidebarNombre.textContent = EMPRESA_NOMBRE || "Mi Empresa";

  const logoPanel = document.getElementById("logoEmpresa");
  if (logoPanel) logoPanel.src = EMPRESA_LOGO;

  const nombrePanel = document.getElementById("nombreEmpresa");
  if (nombrePanel) nombrePanel.textContent = EMPRESA_NOMBRE;

  document.querySelectorAll(".btn-primary").forEach(btn => {
    btn.style.background = EMPRESA_COLOR;
    btn.style.borderColor = EMPRESA_COLOR;
  });

  document.documentElement.style.setProperty("--primary", EMPRESA_COLOR);
  document.documentElement.style.setProperty("--color-principal", EMPRESA_COLOR);
}

/* =========================================
   LOGOS / PDF — multiempresa
========================================= */
let logoConsorcio = "";
let logoSpynet    = "";

async function initPDF() {
  const logoUrl = EMPRESA_LOGO || "img/logo2.png";
  try {
    logoConsorcio = await cargarLogoBase64(logoUrl);
    logoSpynet    = logoConsorcio;
  } catch (e) {
    console.warn("No se pudo cargar el logo para PDF:", e);
    logoConsorcio = "";
    logoSpynet    = "";
  }
}

/* =========================================
   ESTADOS GLOBALES
========================================= */
let cajaAbierta = false;
let cajaActual = null;
let chartVentasComprasInstance = null;
let cuentaPagarAEliminar = null;

let fpMovPaginaActual = 1;
const fpMovPorPagina = 5;
let FP_MOV_CACHE = [];

let cuentasPagar = [];
let cuentasPagarFiltradas = [];
let egresosCuentasPagar = [];
let cuentasPagarPagina = 1;
const cuentasPagarPorPagina = 10;
let cuentasPagarTotal = 0;
let cuentasPagarTotalPages = 0;

function guardarCuentasPagarStorage() {
  localStorage.setItem(
    `cuentasPagar_${USER.empresa_id || "default"}`,
    JSON.stringify(cuentasPagar)
  );
}

function guardarEgresosStorage() {
  localStorage.setItem(
    `egresosCuentasPagar_${USER.empresa_id || "default"}`,
    JSON.stringify(egresosCuentasPagar)
  );
}

const empresa = {
  nombre: EMPRESA_NOMBRE,
  direccion: USER.empresa_direccion || "",
  ruc: USER.empresa_ruc || "",
  telefono: USER.empresa_telefono || "",
  email: USER.empresa_email || ""
};

let PROD_CACHE = [];
let PROD_CACHE_FILTER = [];
let ONLY_LOW_STOCK = false;

/* =========================================
   COMPRAS
========================================= */
let subtotalCompra = 0;
let ivaCompra = 0;
let totalCompra = 0;

let pp_item_edit_index = -1;
let PP_PRODUCTO_ACTUAL = null;
let pp_items = [];

/* =========================================
   AUTENTICACIÓN
========================================= */

function mustAuth() {
  const auth = localStorage.getItem("auth");
  if (auth !== "ok") {
    window.location.href = "login.html";
    return;
  }
}

mustAuth();

/* =========================================
   FECHAS / CAJA
========================================= */
function hoyLocal() {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'America/Asuncion' });
}

function asegurarFechasCaja() {
  const fE = document.getElementById("fechaCajaEfectivo");
  const fT = document.getElementById("fechaCajaTransferencia");
  if (fE && !fE.value) fE.value = hoyLocal();
  if (fT && !fT.value) fT.value = hoyLocal();
}

/* =========================================
   UTILIDADES BÁSICAS
========================================= */
function qs(s) { return document.querySelector(s); }
function qsa(s) { return [...document.querySelectorAll(s)]; }
function fmtDate(d) {
  if (!d) return "-";
  const fecha = toYMD(d);
  return fecha || "-";
}

/* =========================================
   PEDIDOS
========================================= */
async function listarPedidos() {
  console.time("TOTAL_LISTAR_PEDIDOS");
  const tabla = document.getElementById("tabla_pedidos");
  if (!tabla) return;

  tabla.innerHTML = `<tr><td colspan="12" class="text-center py-3 text-muted">Cargando...</td></tr>`;

  try {
    const pedidos = await jget("/api/pedidos");
    console.log("DESPUES DE API", pedidos);
    if (!Array.isArray(pedidos) || !pedidos.length) {
      tabla.innerHTML = `<tr><td colspan="12" class="text-center py-3 text-muted">No hay pedidos registrados.</td></tr>`;
      return;
    }
    tabla.innerHTML = "";
    pedidos.forEach(p => {
      const items = Array.isArray(p.items) ? p.items : [];
      const prodArr = items.map(i => i.producto_nombre || "¿?").filter(Boolean);
      const prodVis = prodArr.slice(0, 2);
      const prodExtra = prodArr.length - prodVis.length;
      const productosHtml = prodArr.length
        ? `<div class="text-truncate" style="max-width:320px" title="${prodArr.join(", ")}">${prodVis.join(", ")}${prodExtra > 0 ? ` <span class="badge bg-secondary">+${prodExtra}</span>` : ""}</div>`
        : `<span class="text-muted">—</span>`;

      const catArr = [...new Set(items.map(i => i.categoria_nombre || "Sin categoría"))];
      const categoriasHtml = catArr.length
        ? `<div class="text-truncate" style="max-width:220px" title="${catArr.join(", ")}">${catArr.join(", ")}</div>`
        : `<span class="text-muted">—</span>`;

      const cantidad_items = items.reduce((a, i) => a + Number(i.cantidad || 0), 0);
      const recibido = !!p.fecha_recepcion;
      const estadoHtml = recibido
        ? `<span class="badge bg-success">Recibido</span>`
        : `<span class="badge bg-warning text-dark">Pendiente</span>`;

      const nombreProveedorSeguro = JSON.stringify(p.proveedor_nombre || "");
      const proveedorEmail = p.proveedor_email || p.email || "—";

      const tr = document.createElement("tr");
      tr.innerHTML = `
        <td class="fw-semibold">#${p.id}</td>
        <td><div class="fw-semibold">${p.proveedor_nombre || "—"}</div></td>
        <td><div class="text-truncate" style="max-width:220px" title="${proveedorEmail !== "—" ? proveedorEmail : ""}">${proveedorEmail !== "—" ? `<a href="mailto:${proveedorEmail}">${proveedorEmail}</a>` : `<span class="text-muted">—</span>`}</div></td>
        <td>${productosHtml}</td>
        <td>${categoriasHtml}</td>
        <td>${fmtDate(p.fecha_pedido)}</td>
        <td><div class="d-flex flex-column gap-1"><span>${p.fecha_recepcion ? fmtDate(p.fecha_recepcion) : "—"}</span>${estadoHtml}</div></td>
        <td class="text-center">${cantidad_items}</td>
        <td class="text-end">Gs. ${money(p.subtotal)}</td>
        <td class="text-end">Gs. ${money(p.iva)}</td>
        <td class="text-end fw-semibold">Gs. ${money(p.total)}</td>
        <td class="text-center" style="min-width:180px">
          <div style="display:flex;gap:6px;justify-content:center;flex-wrap:wrap;">
            <button class="btn btn-sm" onclick='exportarPDF_Proveedor(${nombreProveedorSeguro})' title="Generar PDF" style="background:#6b7280;color:#fff;border:none;"><i class="fa-solid fa-file-pdf"></i></button>
            ${!recibido ? `<button class="btn btn-success btn-sm" onclick="recibirPedido(${p.id})" title="Marcar recibido"><i class="fa-solid fa-check"></i></button>` : ""}
            <button class="btn btn-danger btn-sm" onclick="eliminarPedido(${p.id})" title="Eliminar"><i class="fa-solid fa-trash"></i></button>
          </div>
        </td>
      `;
      tabla.appendChild(tr);
    });
  } catch (err) {
    console.error(err);
    tabla.innerHTML = `<tr><td colspan="12" class="text-center py-3 text-danger">Error cargando pedidos.</td></tr>`;
  }
}

/* =========================================
   AUTO INICIO
========================================= */
document.addEventListener("DOMContentLoaded", () => {
  aplicarPersonalizacionEmpresa();
  asegurarFechasCaja();
});

function limpiarNombreArchivo(nombre) {
  return String(nombre || "Proveedor")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^\w\s-]/g, "")
    .trim()
    .replace(/\s+/g, "_");
}

function imgType(base64) {
  if (!base64 || typeof base64 !== "string") return "PNG";
  if (base64.startsWith("data:image/jpeg")) return "JPEG";
  if (base64.startsWith("data:image/jpg")) return "JPEG";
  if (base64.startsWith("data:image/webp")) return "WEBP";
  return "PNG";
}

function getEmpresaActualPDF() {
  const user = JSON.parse(localStorage.getItem("user") || "{}");
  return {
    nombre: localStorage.getItem("empresa_nombre") || user.empresa_nombre || empresa?.nombre || "Mi Empresa",
    direccion: user.empresa_direccion || empresa?.direccion || "",
    ruc: user.empresa_ruc || empresa?.ruc || "",
    telefono: user.empresa_telefono || empresa?.telefono || "",
    email: user.empresa_email || empresa?.email || "",
    logo: localStorage.getItem("empresa_logo") || user.empresa_logo || EMPRESA_LOGO || "img/logo2.png",
    color: localStorage.getItem("color_principal") || user.color_principal || EMPRESA_COLOR || "#2563eb"
  };
}

function hexToRgbArray(hex, fallback = [37, 99, 235]) {
  const clean = String(hex || "").replace("#", "").trim();
  if (clean.length !== 6) return fallback;
  const r = parseInt(clean.slice(0, 2), 16);
  const g = parseInt(clean.slice(2, 4), 16);
  const b = parseInt(clean.slice(4, 6), 16);
  if ([r, g, b].some(n => Number.isNaN(n))) return fallback;
  return [r, g, b];
}

async function exportarPDF_Proveedor(proveedorNombre) {
  const emp = getEmpresaActualPDF();
  try {
    if (!logoConsorcio || !logoSpynet) {
      logoConsorcio = await cargarLogoBase64(emp.logo);
      logoSpynet = await cargarLogoBase64(emp.logo);
    }
  } catch (e) { console.warn("No se pudieron cargar los logos:", e); }

  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({ compression: "FAST", unit: "mm", format: "a4" });
  let pedidos = [];
  try { pedidos = await jget("/api/pedidos"); } catch (e) { console.error("Error cargando pedidos:", e); alert("No se pudieron cargar los pedidos."); return; }

  const hoy = hoyLocal();
  const pedidosProveedor = pedidos.filter(p =>
    String(p.proveedor_nombre || "").trim().toLowerCase() === String(proveedorNombre || "").trim().toLowerCase()
    && String(p.fecha_pedido || "").slice(0, 10) === hoy
  );
  if (!pedidosProveedor.length) { alert("No hay pedidos de hoy para este proveedor."); return; }

  const pageW = doc.internal.pageSize.getWidth();
  const cx = pageW / 2;
  const colorPrincipal = hexToRgbArray(emp.color);

  try {
    if (logoConsorcio) doc.addImage(logoConsorcio, imgType(logoConsorcio), 10, 8, 32, 18);
    if (logoSpynet) doc.addImage(logoSpynet, imgType(logoSpynet), pageW - 10 - 28, 8, 28, 18);
  } catch (e) { console.warn("Error addImage logos:", e); }

  doc.setFont("times", "bold").setFontSize(22).text(emp.nombre || "Mi Empresa", cx, 14, { align: "center" });
  doc.setFont("helvetica", "normal").setFontSize(10.5);
  if (emp.ruc) doc.text(`RUC: ${emp.ruc}`, cx, 20, { align: "center" });
  if (emp.direccion) doc.text(emp.direccion, cx, emp.ruc ? 25 : 20, { align: "center" });
  const contacto = [emp.telefono ? `Tel: ${emp.telefono}` : "", emp.email || ""].filter(Boolean).join(" | ");
  if (contacto) { doc.setFontSize(9); doc.text(contacto, cx, emp.direccion ? 30 : 25, { align: "center" }); }

  doc.setLineWidth(0.4).line(10, 45, pageW - 10, 45);
  doc.setFont("helvetica", "bold").setFontSize(14).text("Listado de Pedidos a Proveedor", 10, 54);
  doc.setFont("helvetica", "bold").setFontSize(11).text(`Proveedor: ${proveedorNombre || "—"}`, 10, 61);
  doc.setFont("helvetica", "normal").setFontSize(10).text(`Fecha: ${hoy}`, 10, 67);

  const rows = [];
  pedidosProveedor.forEach(p => {
    const items = Array.isArray(p.items) ? p.items : [];
    items.forEach(i => {
      const subtotalTexto = (() => {
        const subtotalItem = Number(i.subtotal || 0);
        if (subtotalItem > 0) return "Gs. " + money(subtotalItem);
        const totalCantPedido = items.reduce((a, x) => a + Number(x.cantidad || 0), 0) || 0;
        const subtotalPedido = Number(p.subtotal || 0);
        if (subtotalPedido > 0 && totalCantPedido > 0) {
          const proporcional = subtotalPedido * (Number(i.cantidad || 0) / totalCantPedido);
          return "Gs. " + money(Math.round(proporcional));
        }
        return "Gs. 0";
      })();
      rows.push([
        p.id || "—",
        i.producto_codigo || i.codigo || "—",
        i.producto_nombre || "—",
        p.fecha_pedido ? String(p.fecha_pedido).slice(0, 10) : "—",
        p.fecha_recepcion ? String(p.fecha_recepcion).slice(0, 10) : "Sin recibir",
        Number(i.cantidad || 0),
        subtotalTexto
      ]);
    });
  });

  doc.autoTable({
    startY: 72,
    head: [["ID", "Código", "Producto", "Fecha Pedido", "Recepción", "Cant.", "Subtotal"]],
    body: rows,
    theme: "grid",
    styles: { fontSize: 9, cellPadding: 2.5, valign: "middle" },
    headStyles: { fillColor: colorPrincipal, textColor: 255, fontStyle: "bold" },
    margin: { left: 10, right: 10 }
  });

  const finalY = doc.lastAutoTable?.finalY || 260;
  doc.setFont("helvetica", "normal").setFontSize(8).setTextColor(110)
    .text(`Generado automáticamente por ${emp.nombre || "Mi Empresa"}`, cx, Math.min(finalY + 12, 285), { align: "center" });

  const nombreArchivo = `Pedido_${limpiarNombreArchivo(emp.nombre)}_${limpiarNombreArchivo(proveedorNombre)}_${hoy}.pdf`;
  doc.save(nombreArchivo);
}

function confirmarEliminarPedido(id) {
  if (!confirm("¿Está seguro de eliminar este pedido?")) return;
  eliminarPedido(id);
}

function money(v) {
  const n = Number(v || 0);
  return n.toLocaleString("es-PY", { minimumFractionDigits: 0 });
}

const fmtPYG = (n) =>
  new Intl.NumberFormat("es-PY", { style: "currency", currency: "PYG", maximumFractionDigits: 0 })
    .format(Number(n || 0));

const fmtDateTime = (d) =>
  new Date(d).toLocaleString("es-PY", { dateStyle: "short", timeStyle: "short" });

const escapeHtml = (str) =>
  (str ?? "").toString().replace(/[&<>"'`=\/]/g, (s) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;", "/": "&#x2F;", "`": "&#x60;", "=": "&#x3D;" }[s])
  );

/* =========================================
   NAVEGACIÓN DE SECCIONES
========================================= */
function show(hash) {
  const targetHash = hash || "#accesos";
  qsa("section.view").forEach(sec => sec.classList.add("hidden"));
  const el = qs(targetHash);
  if (el) el.classList.remove("hidden");
  qsa(".sidebar-nav a[data-link]").forEach(a => {
    a.classList.toggle("active", a.getAttribute("href") === targetHash);
  });
  aplicarPersonalizacionEmpresa();
  if (targetHash === "#dashboard") { cargarVentasResumen(); cargarVentasComparadas(); }
  if (targetHash === "#ventas" && typeof cargarVentas === "function") cargarVentas();
  if (targetHash === "#clientes" && typeof listarClientes === "function") listarClientes();
  if (targetHash === "#productos" && typeof listarProductos === "function") listarProductos();
  if (targetHash === "#proveedores" && typeof listarProveedores === "function") listarProveedores();
  if (targetHash === "#categorias" && typeof listarCategorias === "function") listarCategorias();
  if (targetHash === "#compras" && typeof cargarComprasLista === "function") cargarComprasLista();
  if (targetHash === "#lista_pedidos" && typeof listarPedidos === "function") listarPedidos();
  if (targetHash === "#pedidos" && typeof cargarProveedoresPedido === "function") cargarProveedoresPedido();
  if (targetHash === "#cuentas-pagar" && typeof cargarCuentasPagar === "function") cargarCuentasPagar();
  if (targetHash === "#caja") {
    if (typeof asegurarFechasCaja === "function") asegurarFechasCaja();
    if (typeof verificarCaja === "function") verificarCaja();
    if (typeof cargarRecaudacionFecha === "function") cargarRecaudacionFecha();
  }
  if (targetHash === "#formas-pago" && typeof listarFP === "function") listarFP();
}

function esDelMesActual(fecha) {
  const f = new Date(fecha);
  const hoy = new Date();
  return (f.getMonth() === hoy.getMonth() && f.getFullYear() === hoy.getFullYear());
}

function nav(hash) {
  console.log("NAV", hash);
  location.hash = hash;
  show(hash);
}

/* =========================================
   MODALES
========================================= */
function openModal(id) {
  const el = document.getElementById(id);
  if (!el) { console.error("Modal no encontrado:", id); return; }
  el.style.display = "flex";
  el.classList.add("show");
  document.body.classList.add("modal-open");
}

function closeModal(id) {
  const el = document.getElementById(id);
  if (!el) { console.error("Modal no encontrado:", id); return; }
  el.classList.remove("show");
  el.style.display = "none";
  document.body.classList.remove("modal-open");
  if (id === "modalPago") {
    el.style.cssText = "display: none;";
    const modalVenta = document.getElementById("modalVenta");
    if (modalVenta) modalVenta.style.visibility = "visible";
    document.body.style.overflow = "";
  }
  if (id === "modalVenta") document.body.style.overflow = "";
}
window.openModal = openModal;
window.closeModal = closeModal;

/* =========================================
   MODAL SELECCIONAR PRODUCTO PARA PEDIDO
========================================= */
async function abrirModalSelProducto() {
  openModal("modalSelProducto");
  await cargarProductosModalPP();
}
window.abrirModalSelProducto = abrirModalSelProducto;

/* =========================================
   AGREGAR PRODUCTO AL PEDIDO
========================================= */
function agregarProductoAlPedido() {
  const p = window.PP_PRODUCTO_ACTUAL || PP_PRODUCTO_ACTUAL || null;
  if (!p) return alert("No hay producto seleccionado");
  const cantidad = Number(document.getElementById("pp_edit_cantidad")?.value || 0);
  const unidad = (document.getElementById("pp_edit_unidad")?.value || "unidad").trim();
  const costoTxt = (document.getElementById("pp_edit_costo")?.value || "").trim();
  const costo = Number(costoTxt.replace(/\D/g, "")) || 0;
  if (cantidad <= 0 || costo <= 0) return alert("Cantidad o costo inválido");
  if (!Array.isArray(window.pp_items)) window.pp_items = [];
  const item = {
    id: p.id,
    producto_id: p.id,
    nombre: p.nombre || "",
    producto_nombre: p.nombre || "",
    categoria_nombre: p.categoria || p.categoria_nombre || "Sin categoría",
    cantidad,
    unidad,
    costo,
    precio_unit: costo,
    costo_estimado: costo,
    subtotal: cantidad * costo,
    total: cantidad * costo
  };
  const idx = window.pp_items.findIndex(x => Number(x.id || x.producto_id) === Number(item.id));
  if (idx >= 0) window.pp_items[idx] = item;
  else window.pp_items.push(item);
  pp_items = window.pp_items;
  if (typeof renderPP_Items === "function") renderPP_Items();
  closeModal("modalEditarPP");
}
window.agregarProductoAlPedido = agregarProductoAlPedido;

let INSUMOS_CACHE = [];

async function cargarProductosModalPP() {
  const grid = document.getElementById("tablaSelProductos");
  if (!grid) return console.error("❌ No existe #tablaSelProductos");
  grid.innerHTML = `<p style="color:#aaa;font-size:13px;grid-column:1/-1;text-align:center;padding:20px 0;">Cargando...</p>`;
  try {
    const [productos, insumos] = await Promise.all([
      jget("/productos"),
      jget("/insumos")
    ]);
    PROD_CACHE = (productos || []).map(p => ({ ...p, id: Number(p.id), nombre: p.nombre || "", codigo: p.codigo || "", marca: p.marca || "", categoria: p.categoria || "", costo: Number(p.costo || 0), precio: Number(p.precio || 0), stock: Number(p.stock || 0), esInsumo: false }));
    INSUMOS_CACHE = (insumos || []).map(i => ({ ...i, id: Number(i.id), nombre: i.nombre || "", codigo: i.codigo || `INS-${i.id}`, marca: "", categoria: "Insumo", costo: Number(i.costo_promedio || 0), precio: Number(i.costo_promedio || 0), stock: Number(i.stock || 0), unidad: i.unidad || "Unidad", esInsumo: true }));
    window.listaProductosPOS = [...PROD_CACHE];
    window.listaInsumosPOS = [...INSUMOS_CACHE];
    window.modoSeleccion = 'productos';
    posFiltrados = [...window.listaProductosPOS];
    posPagina = 1;
    aplicarPaginaPOS();
    actualizarBadge();
    const tabProd = document.getElementById("tabProductos");
    const tabIns = document.getElementById("tabInsumos");
    if (tabProd) { tabProd.classList.add("btn-primary"); tabProd.classList.remove("btn-secondary"); }
    if (tabIns) { tabIns.classList.remove("btn-primary"); tabIns.classList.add("btn-secondary"); }
  } catch (err) {
    console.error("❌ Error cargando productos/insumos:", err);
    grid.innerHTML = `<p style="color:#ef4444;font-size:13px;grid-column:1/-1;text-align:center;padding:20px 0;">Error al cargar.</p>`;
  }
}

function actualizarBadge() {
  const badge = document.getElementById("badge-total-productos");
  if (!badge) return;
  const lista = window.modoSeleccion === 'insumos' ? window.listaInsumosPOS : window.listaProductosPOS;
  const total = lista.length;
  const label = window.modoSeleccion === 'insumos' ? (total === 1 ? 'insumo' : 'insumos') : (total === 1 ? 'producto' : 'productos');
  badge.textContent = `${total} ${label}`;
}

document.addEventListener("DOMContentLoaded", () => {
  const tabProd = document.getElementById("tabProductos");
  const tabIns = document.getElementById("tabInsumos");
  if (tabProd) {
    tabProd.addEventListener("click", () => {
      window.modoSeleccion = "productos";
      tabProd.classList.add("btn-primary"); tabProd.classList.remove("btn-secondary");
      tabIns.classList.remove("btn-primary"); tabIns.classList.add("btn-secondary");
      posFiltrados = [...window.listaProductosPOS];
      posPagina = 1;
      aplicarPaginaPOS();
      actualizarBadge();
    });
  }
  if (tabIns) {
    tabIns.addEventListener("click", () => {
      window.modoSeleccion = "insumos";
      tabIns.classList.add("btn-primary"); tabIns.classList.remove("btn-secondary");
      tabProd.classList.remove("btn-primary"); tabProd.classList.add("btn-secondary");
      posFiltrados = [...window.listaInsumosPOS];
      posPagina = 1;
      aplicarPaginaPOS();
      actualizarBadge();
    });
  }
});
window.cargarProductosModalPP = cargarProductosModalPP;

/* ================== FETCH HELPERS ================== */
async function jget(url) {
  const r = await fetch(API + url, { credentials: "include", cache: "no-store" });
  if (r.status === 401) {
    localStorage.removeItem("auth");
    localStorage.removeItem("adminAuth");
    location.href = "login.html";
    return [];
  }
  if (!r.ok) throw new Error(await r.text());
  return await r.json();
}

async function jpost(url, body = {}) {
  const r = await fetch(API + url, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
  if (r.status === 401) {
    localStorage.removeItem("auth");
    localStorage.removeItem("adminAuth");
    location.href = "login.html";
    return null;
  }
  const data = await r.json().catch(() => ({}));
  if (!r.ok) {
    const err = new Error(data.msg || data.error || "Error en el servidor");
    err.detalle = data.detalle || null;
    err.code = data.code || null;
    err.original = data;
    throw err;
  }
  return data;
}

async function jput(url, body = {}) {
  const r = await fetch(API + url, {
    method: "PUT",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
  if (r.status === 401) {
    localStorage.removeItem("auth");
    localStorage.removeItem("adminAuth");
    location.href = "login.html";
    return null;
  }
  const data = await r.json().catch(() => ({}));
  if (!r.ok) {
    const err = new Error(data.msg || data.error || "Error en el servidor");
    err.detalle = data.detalle || null;
    err.code = data.code || null;
    throw err;
  }
  return data;
}

async function jdel(url) {
  const r = await fetch(API + url, { method: "DELETE", credentials: "include" });
  if (r.status === 401) {
    localStorage.removeItem("auth");
    localStorage.removeItem("adminAuth");
    location.href = "login.html";
    return null;
  }
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(data.msg || data.error || "Error en el servidor");
  return data;
}

async function cargarVentasResumen() {
  const ventas = await jget("/ventas");
  const hoyYMD = hoyLocal();
  const mesYMD = hoyYMD.slice(0, 7);
  let totalHoy = 0, totalMes = 0, totalAnho = 0;
  for (const v of ventas) {
    const fRaw = (v.fecha || v.created_at || "").toString();
    const fYMD = toYMD(fRaw);
    const t = Number(v.total_pyg ?? v.total ?? 0);
    if (!fYMD) continue;
    if (fYMD.slice(0, 4) === hoyYMD.slice(0, 4)) totalAnho += t;
    if (fYMD.slice(0, 7) === mesYMD) totalMes += t;
    if (fYMD === hoyYMD) totalHoy += t;
  }
  const setTxt = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = "Gs. " + money(val); };
  setTxt("dash-ventas-hoy", totalHoy);
  setTxt("dash-ventas-mes", totalMes);
  setTxt("dash-ventas-anho", totalAnho);
  setTxt("kpi-ventas-mes", totalMes);
  setTxt("kpi-ventas-anho", totalAnho);
}

function gv(...selectors) {
  for (const sel of selectors) {
    const el = qs(sel);
    if (el) return (el.value || "").trim();
  }
  return "";
}

/* ================== PAGINACIÓN Y EXPORTS ================== */
function paginateRows(rows, page, perPage) {
  const total = rows.length;
  const pages = Math.max(1, Math.ceil(total / perPage));
  const p = Math.min(Math.max(1, page), pages);
  const start = (p - 1) * perPage;
  const end = start + perPage;
  return { page: p, pages, slice: rows.slice(start, end), total };
}

function renderPagination(containerSel, state, onChange) {
  const cont = document.querySelector(containerSel);
  if (!cont) return;
  const old = cont.querySelector(".pagination-app");
  if (old) old.remove();
  const el = document.createElement("div");
  el.className = "actions pagination-app";
  el.style.margin = ".75rem 0";
  el.innerHTML = `
    <button class="btn secondary" ${state.page <= 1 ? "disabled" : ""} data-act="prev">« Anterior</button>
    <span class="badge">Página ${state.page} / ${state.pages}</span>
    <button class="btn secondary" ${state.page >= state.pages ? "disabled" : ""} data-act="next">Siguiente »</button>
    <select class="input" style="width:90px" data-act="per">
      <option ${state.perPage == 10 ? "selected" : ""}>10</option>
      <option ${state.perPage == 25 ? "selected" : ""}>25</option>
      <option ${state.perPage == 50 ? "selected" : ""}>50</option>
    </select>
  `;
  el.onclick = (e) => {
    const act = e.target.getAttribute("data-act");
    if (act === "prev") onChange(state.page - 1, state.perPage);
    if (act === "next") onChange(state.page + 1, state.perPage);
  };
  el.querySelector('[data-act="per"]').addEventListener("change", ev => {
    onChange(1, Number(ev.target.value));
  });
  cont.appendChild(el);
}

function exportTableCSV(tableSel, filename) {
  const table = document.querySelector(tableSel);
  if (!table) return alert("Tabla no encontrada");
  let csv = [];
  for (const row of table.querySelectorAll("tr")) {
    let cols = [...row.children].map(td => '"' + td.innerText.replaceAll('"', '""') + '"');
    csv.push(cols.join(","));
  }
  const empresaNombreLimpio = typeof limpiarNombreArchivo === "function" ? limpiarNombreArchivo(EMPRESA_NOMBRE || "empresa") : "empresa";
  const blob = new Blob([csv.join("\n")], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename || `${empresaNombreLimpio}_export.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

function printTableAsPDF(containerSel, title) {
  const cont = document.querySelector(containerSel);
  if (!cont) return alert("Contenido no encontrado");
  const empresaNombre = typeof EMPRESA_NOMBRE !== "undefined" ? EMPRESA_NOMBRE : "Mi Empresa";
  const empresaColor = typeof EMPRESA_COLOR !== "undefined" ? EMPRESA_COLOR : "#2563eb";
  const w = window.open("", "_blank");
  w.document.write(`
    <!doctype html>
    <html>
      <head><meta charset="utf-8"><title>${escapeHtml(title || "Reporte")}</title>
      <style>
        body { font-family: system-ui, Arial, sans-serif; padding: 20px; color: #111827; }
        h1 { font-size: 20px; margin-bottom: 4px; color: ${empresaColor}; }
        .empresa { font-size: 13px; color: #64748b; margin-bottom: 14px; }
        table { width: 100%; border-collapse: collapse; }
        th, td { padding: 6px; border: 1px solid #ddd; text-align: left; font-size: 12px; }
        th { background: #f3f4f6; }
      </style>
    </head>
    <body>
      <h1>${escapeHtml(title || "Reporte")}</h1>
      <div class="empresa">${escapeHtml(empresaNombre)}</div>
      ${cont.innerHTML}
    </body>
    </html>
  `);
  w.document.close();
  w.focus();
  w.print();
  setTimeout(() => w.close(), 500);
}

/* ================== UI PRO ================== */
function toast(msg, type = "info") {
  document.querySelectorAll(".toast-pro").forEach(t => t.remove());
  const config = {
    success: { bg: "#f0fdf4", border: "#22c55e", text: "#166534", icon: `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="color:#22c55e"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>`, title: "¡Éxito!" },
    error: { bg: "#fee2e2", border: "#ef4444", text: "#991b1b", icon: `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="color:#ef4444"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>`, title: "Error" },
    info: { bg: "#eff6ff", border: "#3b82f6", text: "#1e40af", icon: `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="color:#3b82f6"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>`, title: "Información" }
  };
  const cfg = config[type] || config.info;
  const el = document.createElement("div");
  el.className = "toast-pro";
  el.innerHTML = `
    <div style="display:flex;align-items:center;gap:12px;width:100%;">
      <div style="width:44px;height:44px;min-width:44px;background:${cfg.bg};border-radius:10px;display:flex;align-items:center;justify-content:center;border:1.5px solid ${cfg.border};">${cfg.icon}</div>
      <div style="flex:1;min-width:0;">
        <div style="font-weight:700;font-size:.95rem;color:${cfg.text};margin-bottom:2px;">${cfg.title}</div>
        <div style="font-size:.85rem;color:#475569;opacity:.9;word-break:break-word;">${msg}</div>
      </div>
      <button onclick="this.closest('.toast-pro').remove()" style="background:none;border:none;cursor:pointer;padding:4px;margin-left:4px;flex-shrink:0;display:flex;align-items:center;justify-content:center;color:#94a3b8;transition:color .15s;" onmouseover="this.style.color='#475569'" onmouseout="this.style.color='#94a3b8'"><svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></button>
    </div>
  `;
  Object.assign(el.style, {
    position: "fixed", top: "1.5rem", right: "1.5rem", background: "#ffffff", padding: "1rem 1.25rem",
    border: `1px solid ${cfg.border}`, borderLeft: `4px solid ${cfg.border}`, borderRadius: "12px",
    boxShadow: "0 8px 30px rgba(0,0,0,.12)", zIndex: "99999", minWidth: "300px", maxWidth: "420px",
    opacity: "0", transform: "translateX(40px)", transition: "opacity .3s ease, transform .3s ease",
    fontFamily: "system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif"
  });
  document.body.appendChild(el);
  requestAnimationFrame(() => { el.style.opacity = "1"; el.style.transform = "translateX(0)"; });
  setTimeout(() => { el.style.opacity = "0"; el.style.transform = "translateX(40px)"; setTimeout(() => el.remove(), 350); }, 3500);
}

async function withLoading(btn, fn) {
  if (!btn) return fn();
  const old = btn.innerHTML;
  btn.disabled = true;
  btn.innerHTML = '<span class="spinner"></span>';
  try { return await fn(); } finally { btn.disabled = false; btn.innerHTML = old; }
}

function renderSkeleton(rows = 6) {
  return `<table class="table"><thead><tr><th>ID</th><th>Fecha</th><th>Proveedor</th><th>Estado</th><th>Total Estimado</th><th>Acciones</th></tr></thead><tbody>${Array.from({ length: rows }).map(() => `<tr class="skeleton"><td style="width:60px"></td><td></td><td></td><td></td><td></td><td style="width:280px"></td></tr>`).join("")}</tbody></table>`;
}

/* ================== DASHBOARD KPIs ================== */
async function cargarKpis() {
  try {
    aplicarPersonalizacionEmpresa();
    const [ventasRes, comprasRes, productosRes, cuentasRes] = await Promise.allSettled([
      jget("/ventas"), jget("/compras"), jget("/productos"), jget("/cuentas-pagar")
    ]);
    const ventas = ventasRes.status === "fulfilled" && Array.isArray(ventasRes.value) ? ventasRes.value : [];
    const compras = comprasRes.status === "fulfilled" && Array.isArray(comprasRes.value) ? comprasRes.value : [];
    const productos = productosRes.status === "fulfilled" && Array.isArray(productosRes.value) ? productosRes.value : [];
    const cuentas = cuentasRes.status === "fulfilled" && Array.isArray(cuentasRes.value) ? cuentasRes.value : [];

    const hoy = new Date();
    const MES = hoy.toLocaleString("es-ES", { month: "long" });
    const ANHO = hoy.getFullYear();
    const hoyStr = toYMD(hoy);
    const mesActual = hoyStr.slice(0, 7);

    const setText = (selector, value) => { const el = qs(selector); if (el) el.textContent = value; };
    const totalVenta = (v) => Number(v.total_pyg ?? v.total ?? 0);
    const totalCompra = (c) => Number(c.total_pyg ?? c.total ?? 0);
    const totalCuenta = (c) => Number(c.monto_pyg ?? c.monto ?? c.total ?? 0);
    const fechaCuenta = (c) => c.fecha_pago || c.pagado_en || c.fecha || c.vencimiento || c.created_at || "";
    const esMismoMes = (fecha) => { const ymd = toYMD(fecha); return ymd && ymd.slice(0, 7) === mesActual; };
    const esMismoAnho = (fecha) => { const ymd = toYMD(fecha); return ymd && ymd.slice(0, 4) === String(ANHO); };
    const esMismoDia = (fecha) => { const ymd = toYMD(fecha); return ymd === hoyStr; };

    const ventasMes = ventas.filter(v => esMismoMes(v.fecha));
    const ventasAnho = ventas.filter(v => esMismoAnho(v.fecha));
    const ventasDia = ventas.filter(v => esMismoDia(v.fecha));
    const comprasMes = compras.filter(c => esMismoMes(c.fecha));
    const comprasAnho = compras.filter(c => esMismoAnho(c.fecha));
    const comprasDia = compras.filter(c => esMismoDia(c.fecha));
    const cuentasPagadas = cuentas.filter(c => String(c.estado || "").toLowerCase() === "pagado");
    const cuentasDia = cuentasPagadas.filter(c => esMismoDia(fechaCuenta(c)));
    const cuentasMes = cuentasPagadas.filter(c => esMismoMes(fechaCuenta(c)));
    const cuentasAnho = cuentasPagadas.filter(c => esMismoAnho(fechaCuenta(c)));

    const totalVentasDia = ventasDia.reduce((acc, v) => acc + totalVenta(v), 0);
    const totalVentasMes = ventasMes.reduce((acc, v) => acc + totalVenta(v), 0);
    const totalVentasAnho = ventasAnho.reduce((acc, v) => acc + totalVenta(v), 0);
    const totalComprasDia = comprasDia.reduce((acc, c) => acc + totalCompra(c), 0);
    const totalComprasMes = comprasMes.reduce((acc, c) => acc + totalCompra(c), 0);
    const totalComprasAnho = comprasAnho.reduce((acc, c) => acc + totalCompra(c), 0);
    const totalCuentasDia = cuentasDia.reduce((acc, c) => acc + totalCuenta(c), 0);
    const totalCuentasMes = cuentasMes.reduce((acc, c) => acc + totalCuenta(c), 0);
    const totalCuentasAnho = cuentasAnho.reduce((acc, c) => acc + totalCuenta(c), 0);
    const totalEgresosDia = totalComprasDia + totalCuentasDia;
    const totalEgresosMes = totalComprasMes + totalCuentasMes;
    const totalEgresosAnho = totalComprasAnho + totalCuentasAnho;
    const stockProductos = productos.length;
    const stockTotalUnidades = productos.reduce((acc, p) => acc + Number(p.stock || 0), 0);
    const productosBajoStock = productos.filter(p => { const stock = Number(p.stock || 0); const stockMin = Number(p.stock_min || 0); return stockMin > 0 ? stock <= stockMin : stock <= 3; });
    const margenMes = totalVentasMes - totalEgresosMes;

    setText("#kpi-ventas-mes-title", `${MES} ${ANHO}`);
    setText("#kpi-compras-mes-title", `${MES} ${ANHO}`);
    setText("#kpi-ventas-mes", "Gs. " + money(totalVentasMes));
    setText("#kpi-compras-mes", "Gs. " + money(totalComprasMes));
    setText("#kpi-ventas-anho", "Gs. " + money(totalVentasAnho));
    setText("#kpi-compras-anho", "Gs. " + money(totalComprasAnho));
    setText("#kpi-productos", String(stockProductos));
    setText("#kpi-stock-restante", String(stockTotalUnidades) + " unidades");
    setText("#kpi-egresos-dia", "Gs. " + money(totalEgresosDia));
    setText("#kpi-egresos-mes", "Gs. " + money(totalEgresosMes));
    setText("#kpi-egresos-anho", "Gs. " + money(totalEgresosAnho));
    setText("#kpi-margen-mes", "Gs. " + money(margenMes));
    setText("#kpi-stock-bajo", String(productosBajoStock.length));

    const listaStockCritico = qs("#listaStockCritico");
    if (listaStockCritico) {
      if (!productosBajoStock.length) {
        listaStockCritico.innerHTML = `<div class="stock-item"><div class="stock-item-left"><strong>Sin alertas</strong><span>No hay productos con stock bajo</span></div><div class="stock-badge ok">OK</div></div>`;
      } else {
        listaStockCritico.innerHTML = productosBajoStock.slice(0, 6).map(p => `
          <div class="stock-item">
            <div class="stock-item-left"><strong>${escapeHtml(p.nombre || "Sin nombre")}</strong><span>${escapeHtml(p.categoria || "Sin categoría")}</span></div>
            <div class="stock-badge ${Number(p.stock || 0) <= 0 ? "" : "warn"}">${Number(p.stock || 0)}</div>
          </div>
        `).join("");
      }
    }
    await renderGraficoVentasCompras();
  } catch (err) { console.error("Error cargando KPIs:", err); }
}

async function renderGraficoVentasCompras() {
  try {
    const [ventas, compras] = await Promise.all([jget("/ventas"), jget("/compras")]);
    const canvas = document.getElementById("chartVentasComprasCanvas");
    if (!canvas) return;
    const mesesLabels = ["Ene","Feb","Mar","Abr","May","Jun","Jul","Ago","Sep","Oct","Nov","Dic"];
    const ventasPorMes = new Array(12).fill(0);
    const comprasPorMes = new Array(12).fill(0);
    const anhoActual = new Date().getFullYear();
    ventas.forEach(v => { const fecha = new Date(v.fecha); if (isNaN(fecha) || fecha.getFullYear() !== anhoActual) return; const mes = fecha.getMonth(); ventasPorMes[mes] += Number(v.total_pyg ?? v.total ?? 0); });
    compras.forEach(c => { const fecha = new Date(c.fecha); if (isNaN(fecha) || fecha.getFullYear() !== anhoActual) return; const mes = fecha.getMonth(); comprasPorMes[mes] += Number(c.total_pyg ?? c.total ?? 0); });
    if (chartVentasComprasInstance) chartVentasComprasInstance.destroy();
    chartVentasComprasInstance = new Chart(canvas, {
      type: "bar",
      data: {
        labels: mesesLabels,
        datasets: [
          { label: "Ventas", data: ventasPorMes, borderWidth: 1, borderRadius: 8, backgroundColor: EMPRESA_COLOR || "#2563eb" },
          { label: "Compras", data: comprasPorMes, borderWidth: 1, borderRadius: 8, backgroundColor: "rgba(22, 163, 74, 0.75)" }
        ]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        interaction: { mode: "index", intersect: false },
        plugins: {
          legend: { position: "top" },
          tooltip: { callbacks: { label: function(context) { return `${context.dataset.label}: Gs. ${money(context.raw)}`; } } }
        },
        scales: { y: { beginAtZero: true, ticks: { callback: function(value) { return "Gs. " + money(value); } } } }
      }
    });
  } catch (err) { console.error("Error renderizando gráfico ventas vs compras:", err); }
}

let clientesOriginal = [];
let clientesFiltrados = [];
let clientesPaginaActual = 1;
let clientesPorPagina = 8;

/* ============================================
   CARGAR CLIENTES DESDE EL SERVIDOR
============================================ */
async function listarClientes() {
  try {
    aplicarPersonalizacionEmpresa();
    const data = await jget("/clientes");
    clientesOriginal = Array.isArray(data) ? data : [];
    clientesFiltrados = [...clientesOriginal];
    clientesPaginaActual = 1;
    renderClientesTabla();
  } catch (err) { console.error("Error cargando clientes:", err); toast("Error cargando clientes", "error"); }
}

function renderClientesTabla() {
  const tbody = document.getElementById("tabla-clientes");
  const pag = document.getElementById("clientes-paginacion");
  if (!tbody) return;
  tbody.innerHTML = "";
  if (pag) pag.innerHTML = "";
  if (!clientesFiltrados.length) {
    tbody.innerHTML = `<tr><td colspan="9" style="text-align:center;padding:1rem;">No se encontraron clientes para esta empresa.</td></tr>`;
    return;
  }
  const inicio = (clientesPaginaActual - 1) * clientesPorPagina;
  const fin = inicio + clientesPorPagina;
  const pageData = clientesFiltrados.slice(inicio, fin);
  pageData.forEach(cli => {
    const nombreCompleto = `${cli.nombre || ""} ${cli.apellido || ""}`.trim();
    const estadoTexto = cli.estado === true || cli.estado === "activo" || cli.estado === "pagado" ? "Activo" : cli.estado === false || cli.estado === "inactivo" ? "Inactivo" : cli.estado || "Pendiente";
    const estadoClase = cli.estado === true || cli.estado === "activo" || cli.estado === "pagado" ? "pagado" : "pendiente";
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${cli.id}</td>
      <td>${escapeHtml(nombreCompleto || "-")}</td>
      <td>${escapeHtml(cli.ci || "")}</td>
      <td>${escapeHtml(cli.telefono || "")}</td>
      <td>${escapeHtml(cli.pais || "")}</td>
      <td>${escapeHtml(cli.ciudad || "")}</td>
      <td>${escapeHtml(cli.direccion || "")}</td>
      <td><span class="estado-badge ${estadoClase}">${escapeHtml(estadoTexto)}</span></td>
      <td style="text-align:center;">
        <button class="btn-icon edit" onclick="abrirEditarCliente(${Number(cli.id)})"><i class="fa fa-pen"></i></button>
        <button class="btn-icon delete" onclick="eliminarCliente(${Number(cli.id)})"><i class="fa fa-trash"></i></button>
      </td>
    `;
    tbody.appendChild(tr);
  });
  renderPaginacionClientes();
}

function renderPaginacionClientes() {
  const div = document.getElementById("clientes-paginacion");
  if (!div) return;
  div.innerHTML = "";
  const total = Math.ceil(clientesFiltrados.length / clientesPorPagina);
  if (total <= 1) return;
  div.innerHTML += `<button class="pag-btn" onclick="cambiarPaginaClientes(${clientesPaginaActual - 1})" ${clientesPaginaActual === 1 ? "disabled" : ""}>‹</button>`;
  for (let i = 1; i <= total; i++) {
    div.innerHTML += `<button class="pag-btn ${i === clientesPaginaActual ? "active" : ""}" onclick="cambiarPaginaClientes(${i})">${i}</button>`;
  }
  div.innerHTML += `<button class="pag-btn" onclick="cambiarPaginaClientes(${clientesPaginaActual + 1})" ${clientesPaginaActual === total ? "disabled" : ""}>›</button>`;
}

function cambiarPaginaClientes(nueva) {
  const total = Math.ceil(clientesFiltrados.length / clientesPorPagina);
  if (nueva < 1 || nueva > total) return;
  clientesPaginaActual = nueva;
  renderClientesTabla();
}

function filtrarClientes(q = "") {
  q = String(q || "").toLowerCase().trim();
  clientesFiltrados = clientesOriginal.filter(c => {
    const nombreCompleto = `${c.nombre || ""} ${c.apellido || ""}`.toLowerCase();
    return nombreCompleto.includes(q) || String(c.ci || "").toLowerCase().includes(q) || String(c.telefono || "").toLowerCase().includes(q) || String(c.pais || "").toLowerCase().includes(q) || String(c.ciudad || "").toLowerCase().includes(q) || String(c.direccion || "").toLowerCase().includes(q);
  });
  clientesPaginaActual = 1;
  renderClientesTabla();
}

async function guardarCliente() {
  const body = {
    nombre: gv("#c_nombre"),
    apellido: gv("#c_apellido"),
    ci: gv("#c_ci"),
    telefono: gv("#c_tel"),
    pais: gv("#c_country"),
    ciudad: gv("#c_city"),
    direccion: gv("#c_dir"),
    estado: gv("#c_status") || "activo"
  };
  if (!body.nombre) return alert("El nombre es obligatorio.");
  if (!body.ci) return alert("El CI es obligatorio.");
  try {
    await jpost("/clientes", body);
    closeModal("modalCliente");
    toast("Cliente guardado correctamente", "success");
    listarClientes();
  } catch (err) { console.error(err); alert("No se pudo guardar el cliente."); }
}

function abrirEditarCliente(id) {
  const cli = clientesOriginal.find(c => Number(c.id) === Number(id));
  if (!cli) return;
  qs("#cli_edit_id").value = cli.id;
  qs("#ce_nombre").value = cli.nombre || "";
  qs("#ce_apellido").value = cli.apellido || "";
  qs("#ce_ci").value = cli.ci || "";
  qs("#ce_tel").value = cli.telefono || "";
  qs("#ce_country").value = cli.pais || "";
  qs("#ce_city").value = cli.ciudad || "";
  qs("#ce_dir").value = cli.direccion || "";
  qs("#ce_status").value = cli.estado || "activo";
  openModal("modalClienteEdit");
}

async function actualizarCliente() {
  const id = qs("#cli_edit_id")?.value;
  const body = {
    nombre: gv("#ce_nombre"),
    apellido: gv("#ce_apellido"),
    ci: gv("#ce_ci"),
    telefono: gv("#ce_tel"),
    pais: gv("#ce_country"),
    ciudad: gv("#ce_city"),
    direccion: gv("#ce_dir"),
    estado: gv("#ce_status") || "activo"
  };
  if (!id) return alert("ID de cliente inválido.");
  if (!body.nombre) return alert("El nombre es obligatorio.");
  if (!body.ci) return alert("El CI es obligatorio.");
  try {
    await jput("/clientes/" + id, body);
    closeModal("modalClienteEdit");
    toast("Cliente actualizado correctamente", "success");
    listarClientes();
  } catch (err) { console.error(err); alert("No se pudo actualizar el cliente."); }
}

function eliminarCliente(id) {
  document.getElementById("delete_cliente_id").value = id;
  openModal("modalEliminarCliente");
}

async function confirmarEliminarCliente() {
  const id = document.getElementById("delete_cliente_id").value;
  if (!id) return;
  try {
    await jdel("/clientes/" + id);
    closeModal("modalEliminarCliente");
    toast("Cliente eliminado correctamente", "success");
    listarClientes();
  } catch (err) { console.error(err); alert("No se pudo eliminar."); }
}

/* ============================================
   USUARIOS DEL SISTEMA
============================================ */
let USERS_CACHE = [];
let USERS_FILTER = [];
let USERS_PG = { page: 1, perPage: 10 };

async function listarUsers() {
  try {
    const data = await jget("/api/usuarios");
    USERS_CACHE = Array.isArray(data) ? data : [];
    USERS_FILTER = [...USERS_CACHE];
    USERS_PG.page = 1;
    renderUsers();
  } catch (err) { console.error("Error cargando usuarios:", err); toast("Error cargando usuarios", "error"); }
}

function filtrarUsers(q = "") {
  q = String(q || "").toLowerCase().trim();
  USERS_FILTER = USERS_CACHE.filter(u =>
    String(u.usuario || u.username || "").toLowerCase().includes(q) ||
    String(u.nombre || "").toLowerCase().includes(q) ||
    String(u.email || "").toLowerCase().includes(q) ||
    String(u.rol || u.role || "").toLowerCase().includes(q)
  );
  USERS_PG.page = 1;
  renderUsers();
}

function renderUsers() {
  const tabla = qs("#tabla-users");
  if (!tabla) return;
  const { page, perPage } = USERS_PG;
  const pg = paginateRows(USERS_FILTER, page, perPage);
  const rows = pg.slice.map(u => {
    const username = u.usuario || u.username || "";
    const nombre = u.nombre || "";
    const email = u.email || "";
    const rol = u.rol || u.role || "usuario";
    const activo = u.activo !== false && u.is_active !== false;
    return `<tr><td>${escapeHtml(nombre || "-")}</td><td>${escapeHtml(username || "-")}</td><td>${escapeHtml(email || "")}</td><td><span class="badge">${escapeHtml(rol)}</span></td><td>${activo ? '<span class="badge" style="background:#d1fae5;color:#065f46">Activo</span>' : '<span class="badge" style="background:#fee2e2;color:#991b1b">Inactivo</span>'}</td><td class="actions"><button class="btn secondary" onclick="abrirEditarUser(${Number(u.id)})">Editar</button><button class="btn ghost" onclick="eliminarUser(${Number(u.id)})">Eliminar</button></td></tr>`;
  }).join("");
  tabla.innerHTML = `<table class="table"><thead><tr><th>Nombre</th><th>Usuario</th><th>Email</th><th>Rol</th><th>Estado</th><th>Acción</th></tr></thead><tbody>${rows || `<tr><td colspan="6" style="text-align:center;padding:1rem;">No hay usuarios registrados para esta empresa.</td></tr>`}</tbody></table>`;
  renderPagination("#tabla-users", { page: pg.page, pages: pg.pages, perPage: USERS_PG.perPage }, (p, pp) => { USERS_PG.page = p; USERS_PG.perPage = pp; renderUsers(); });
}

async function guardarUser() {
  const body = {
    nombre: gv("#u_nombre") || gv("#u_username"),
    usuario: gv("#u_usuario") || gv("#u_username"),
    email: gv("#u_email"),
    password: gv("#u_password"),
    rol: gv("#u_rol") || gv("#u_role") || "usuario",
    activo: gv("#u_activo") === "true" || gv("#u_activo") === "activo"
  };
  if (!body.usuario) return alert("El usuario es obligatorio.");
  if (!body.password) return alert("La contraseña es obligatoria.");
  try {
    await jpost("/api/usuarios", body);
    closeModal("modalUser");
    toast("Usuario creado correctamente", "success");
    listarUsers();
  } catch (err) { console.error(err); alert("No se pudo guardar el usuario."); }
}

function abrirEditarUser(id) {
  const u = USERS_CACHE.find(x => Number(x.id) === Number(id));
  if (!u) return;
  const username = u.usuario || u.username || "";
  const rol = u.rol || u.role || "usuario";
  const activo = u.activo !== false && u.is_active !== false;
  if (qs("#ue_id")) qs("#ue_id").value = u.id;
  if (qs("#ue_nombre")) qs("#ue_nombre").value = u.nombre || "";
  if (qs("#ue_usuario")) qs("#ue_usuario").value = username;
  if (qs("#ue_username")) qs("#ue_username").value = username;
  if (qs("#ue_email")) qs("#ue_email").value = u.email || "";
  if (qs("#ue_role")) qs("#ue_role").value = rol;
  if (qs("#ue_rol")) qs("#ue_rol").value = rol;
  if (qs("#ue_activo")) qs("#ue_activo").value = String(activo);
  openModal("modalUserEdit");
}

async function actualizarUser() {
  const id = Number(qs("#ue_id")?.value || 0);
  const body = {
    nombre: gv("#ue_nombre") || gv("#ue_username") || gv("#ue_usuario"),
    usuario: gv("#ue_usuario") || gv("#ue_username"),
    email: gv("#ue_email"),
    rol: gv("#ue_rol") || gv("#ue_role") || "usuario",
    activo: gv("#ue_activo") === "true" || gv("#ue_activo") === "activo"
  };
  const pass = gv("#ue_password");
  if (pass) body.password = pass;
  if (!id) return alert("ID de usuario inválido.");
  if (!body.usuario) return alert("El usuario es obligatorio.");
  try {
    await jput("/api/usuarios/" + id, body);
    closeModal("modalUserEdit");
    toast("Usuario actualizado correctamente", "success");
    listarUsers();
  } catch (err) { console.error(err); alert("No se pudo actualizar el usuario."); }
}

async function eliminarUser(id) {
  if (!confirm("¿Eliminar usuario?")) return;
  try {
    await jdel("/api/usuarios/" + id);
    toast("Usuario eliminado correctamente", "success");
    listarUsers();
  } catch (err) { console.error(err); alert("No se pudo eliminar el usuario."); }
}

/* ================== PROVEEDORES ================== */
let PROV_CACHE = [];
let PROV_FILTER = [];
let provPaginaActual = 1;
let provPorPagina = 8;
let proveedoresOriginal = [];
let proveedoresFiltrados = [];
let PROV_PAGE = 1;
const PROV_PER_PAGE = 8;

async function listarProveedores() {
  try {
    aplicarPersonalizacionEmpresa();
    const data = await jget("/proveedores");
    proveedoresOriginal = (Array.isArray(data) ? data : []).map(p => ({ ...p, id: Number(p.id), nombre: p.nombre || "", ruc: p.ruc || "", contacto: p.contacto || "", email: p.email || "", telefono: p.telefono || "", pais: p.pais || "", ciudad: p.ciudad || "", direccion: p.direccion || "", estado: p.estado === false ? false : true }));
    proveedoresFiltrados = [...proveedoresOriginal];
    provPaginaActual = 1;
    PROV_CACHE = [...proveedoresOriginal];
    PROV_FILTER = [...proveedoresFiltrados];
    renderProveedoresTabla();
  } catch (err) { console.error("Error cargando proveedores:", err); toast("Error cargando proveedores", "error"); }
}

function filtrarProveedores(q = "") {
  q = String(q || "").toLowerCase().trim();
  proveedoresFiltrados = proveedoresOriginal.filter(p =>
    String(p.nombre || "").toLowerCase().includes(q) ||
    String(p.ruc || "").toLowerCase().includes(q) ||
    String(p.contacto || "").toLowerCase().includes(q) ||
    String(p.email || "").toLowerCase().includes(q) ||
    String(p.telefono || "").toLowerCase().includes(q) ||
    String(p.pais || "").toLowerCase().includes(q) ||
    String(p.ciudad || "").toLowerCase().includes(q) ||
    String(p.direccion || "").toLowerCase().includes(q)
  );
  provPaginaActual = 1;
  renderProveedoresTabla();
}

function renderProveedoresTabla() {
  const tbody = document.getElementById("tabla-proveedores");
  const pag = document.getElementById("proveedores-paginacion");
  if (!tbody || !pag) return;
  tbody.innerHTML = "";
  pag.innerHTML = "";
  if (!proveedoresFiltrados.length) {
    tbody.innerHTML = `<tr><td colspan="11" style="text-align:center;padding:1rem;">No se encontraron proveedores para esta empresa.</td></tr>`;
    return;
  }
  const inicio = (provPaginaActual - 1) * provPorPagina;
  const fin = inicio + provPorPagina;
  const pageData = proveedoresFiltrados.slice(inicio, fin);
  pageData.forEach(p => {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td class="fw-semibold">#${Number(p.id)}</td>
      <td>${escapeHtml(p.nombre || "—")}</td>
      <td>${escapeHtml(p.ruc || "—")}</td>
      <td>${escapeHtml(p.contacto || "—")}</td>
      <td><span style="font-size:.92rem">${escapeHtml(p.email || "—")}</span></td>
      <td>${escapeHtml(p.telefono || "—")}</td>
      <td>${escapeHtml(p.pais || "—")}</td>
      <td>${escapeHtml(p.ciudad || "—")}</td>
      <td><div class="text-truncate" style="max-width:220px" title="${escapeHtml(p.direccion || "")}">${escapeHtml(p.direccion || "—")}</div></td>
      <td>${p.estado ? '<span class="badge bg-success">Activo</span>' : '<span class="badge bg-secondary">Inactivo</span>'}</td>
      <td class="text-center"><div style="display:flex;gap:6px;justify-content:center;"><button class="btn btn-primary btn-sm" onclick="abrirEditarProveedor(${Number(p.id)})" title="Editar proveedor"><i class="fa fa-pen"></i></button><button class="btn btn-danger btn-sm" onclick="eliminarProveedor(${Number(p.id)})" title="Eliminar proveedor"><i class="fa fa-trash"></i></button></div></td>
    `;
    tbody.appendChild(tr);
  });
  renderPaginacionProveedores();
}

function renderPaginacionProveedores() {
  const div = document.getElementById("proveedores-paginacion");
  if (!div) return;
  div.innerHTML = "";
  const total = Math.ceil(proveedoresFiltrados.length / provPorPagina);
  if (total <= 1) return;
  div.innerHTML += `<button class="pag-btn" onclick="cambiarPaginaProveedores(${provPaginaActual - 1})" ${provPaginaActual === 1 ? "disabled" : ""}>‹</button>`;
  for (let i = 1; i <= total; i++) {
    div.innerHTML += `<button class="pag-btn ${i === provPaginaActual ? "active" : ""}" onclick="cambiarPaginaProveedores(${i})">${i}</button>`;
  }
  div.innerHTML += `<button class="pag-btn" onclick="cambiarPaginaProveedores(${provPaginaActual + 1})" ${provPaginaActual === total ? "disabled" : ""}>›</button>`;
}

function cambiarPaginaProveedores(nueva) {
  const total = Math.ceil(proveedoresFiltrados.length / provPorPagina);
  if (nueva < 1 || nueva > total) return;
  provPaginaActual = nueva;
  renderProveedoresTabla();
}

async function guardarProveedor() {
  const body = {
    nombre: gv("#p_nombre"),
    ruc: gv("#p_ruc"),
    contacto: gv("#p_contacto"),
    email: gv("#p_email"),
    telefono: gv("#p_tel"),
    pais: gv("#p_pais"),
    ciudad: gv("#p_ciudad"),
    direccion: gv("#p_dir"),
    estado: gv("#p_estado") !== "Inactivo"
  };
  try {
    if (!body.nombre) return alert("El nombre es obligatorio");
    if (!body.ruc) return alert("El RUC es obligatorio");
    if (!body.email) return alert("El email es obligatorio");
    await jpost("/proveedores", body);
    closeModal("modalProveedor");
    toast("Proveedor guardado correctamente", "success");
    listarProveedores();
    document.querySelector("#p_nombre").value = "";
    document.querySelector("#p_ruc").value = "";
    document.querySelector("#p_contacto").value = "";
    document.querySelector("#p_email").value = "";
    document.querySelector("#p_tel").value = "";
    document.querySelector("#p_pais").value = "Paraguay";
    document.querySelector("#p_ciudad").value = "";
    document.querySelector("#p_dir").value = "";
    document.querySelector("#p_estado").value = "Activo";
  } catch (e) { console.error(e); alert("No se pudo guardar el proveedor.\n" + e.message); }
}

function abrirEditarProveedor(id) {
  const _id = Number(id);
  const p = (proveedoresOriginal || []).find(x => Number(x.id) === _id);
  if (!p) { alert("Proveedor no encontrado"); return; }
  const set = (sel, val) => { const el = qs(sel); if (el) el.value = val ?? ""; };
  set("#prov_edit_id", p.id);
  set("#pe_nombre", p.nombre);
  set("#pe_ruc", p.ruc);
  set("#pe_contacto", p.contacto);
  set("#pe_email", p.email);
  set("#pe_tel", p.telefono);
  set("#pe_pais", p.pais);
  set("#pe_ciudad", p.ciudad);
  set("#pe_dir", p.direccion);
  const est = p.estado === false || String(p.estado).toLowerCase() === "inactivo" ? "Inactivo" : "Activo";
  set("#pe_estado", est);
  openModal("modalProveedorEdit");
}

async function actualizarProveedor() {
  const id = Number(gv("#prov_edit_id"));
  const body = {
    nombre: gv("#pe_nombre"),
    ruc: gv("#pe_ruc"),
    contacto: gv("#pe_contacto"),
    email: gv("#pe_email"),
    telefono: gv("#pe_tel"),
    pais: gv("#pe_pais"),
    ciudad: gv("#pe_ciudad"),
    direccion: gv("#pe_dir"),
    estado: gv("#pe_estado") !== "Inactivo"
  };
  try {
    if (!id) return alert("ID inválido");
    if (!body.nombre) return alert("El nombre es obligatorio");
    if (!body.ruc) return alert("El RUC es obligatorio");
    if (!body.email) return alert("El email es obligatorio");
    await jput("/proveedores/" + id, body);
    closeModal("modalProveedorEdit");
    toast("Proveedor actualizado correctamente", "success");
    listarProveedores();
  } catch (e) { console.error(e); alert("No se pudo actualizar el proveedor.\n" + e.message); }
}

function eliminarProveedor(id) {
  document.getElementById("delete_proveedor_id").value = id;
  openModal("modalEliminarProveedor");
}

async function confirmarEliminarProveedor() {
  const id = document.getElementById("delete_proveedor_id").value;
  if (!id) return;
  try {
    await jdel("/proveedores/" + id);
    closeModal("modalEliminarProveedor");
    toast("Proveedor eliminado correctamente", "success");
    listarProveedores();
  } catch (e) { console.error(e); alert("No se pudo eliminar.\n" + e.message); }
}

/* ================== PRODUCTOS ================== */
async function listarProductos() {
  try {
    aplicarPersonalizacionEmpresa();
    const data = await jget("/productos");
    PROD_CACHE = (Array.isArray(data) ? data : []).map(p => ({
      ...p,
      id: Number(p.id),
      nombre: p.nombre || "",
      codigo: p.codigo || "",
      marca: p.marca || "",
      categoria: p.categoria || "",
      categoria_id: p.categoria_id ?? null,
      costo: Number(p.costo || p.cost || 0),
      precio: Number(p.precio || 0),
      stock: Number(p.stock || 0),
      descripcion: p.descripcion || "",
      imagen_base64: p.imagen_base64 || "",
      imagen: p.imagen || "",
      stock_min: Number(p.stock_min || 0)
    }));
    PROD_CACHE_FILTER = [...PROD_CACHE];
    const sel = qs("#prodCatFilter");
    if (sel && Array.isArray(CAT_CACHE) && CAT_CACHE.length) {
      sel.innerHTML = '<option value="">Todas las categorías</option>' + CAT_CACHE.map(c => `<option value="${Number(c.id)}">${escapeHtml(c.nombre || "")}</option>`).join("");
    }
    renderProductos(PROD_CACHE_FILTER);
  } catch (err) { console.error("Error cargando productos:", err); toast("Error cargando productos", "error"); }
}

function toggleLowStock() {
  ONLY_LOW_STOCK = !ONLY_LOW_STOCK;
  const b = qs("#btnLowStock");
  if (b) b.classList.toggle("ghost", !ONLY_LOW_STOCK);
  filtrarProductos(qs("#prodSearch")?.value || "");
}

function filtrarProductos(q = "") {
  q = String(q || "").toLowerCase().trim();
  PROD_CACHE_FILTER = PROD_CACHE.filter(p => {
    const matchText = String(p.codigo || "").toLowerCase().includes(q) || String(p.nombre || "").toLowerCase().includes(q) || String(p.marca || "").toLowerCase().includes(q) || String(p.categoria || "").toLowerCase().includes(q);
    const stock = Number(p.stock || 0);
    const stockMin = Number(p.stock_min || 0);
    const isLow = stockMin > 0 ? stock <= stockMin : stock <= 3;
    return matchText && (!ONLY_LOW_STOCK || isLow);
  });
  productosPaginaActual = 1;
  renderProductos(PROD_CACHE_FILTER);
}

function pct(costo, precio) {
  const c = Number(costo || 0);
  const p = Number(precio || 0);
  if (!isFinite(c) || !isFinite(p) || p <= 0) return "—";
  return Math.round(((p - c) / p) * 100);
}

function renderProductos(list) {
  const cont = qs("#tabla-productos");
  if (!cont) return;
  const per = Number(qs("#prodEntries")?.value || productosPorPagina);
  const totalPaginas = Math.ceil(list.length / per) || 1;
  if (productosPaginaActual > totalPaginas) productosPaginaActual = totalPaginas;
  const inicio = (productosPaginaActual - 1) * per;
  const fin = inicio + per;
  const productosPagina = list.slice(inicio, fin);
  if (!productosPagina.length) {
    cont.innerHTML = `<div style="padding:1rem;text-align:center;color:#64748b;">No se encontraron productos para esta empresa.</div>`;
    renderPaginacionProductos(list, per);
    return;
  }
  const rows = productosPagina.map(p => {
    const catName = (CAT_CACHE.find(c => Number(c.id) === Number(p.categoria_id)) || {}).nombre || p.categoria || "-";
    const img = p.imagen_base64 || p.imagen || "img/no-image.png";
    const costo = p.costo ?? p.cost ?? null;
    const stock = Number(p.stock || 0);
    const stockMin = Number(p.stock_min || 0);
    const isLow = stockMin > 0 ? stock <= stockMin : stock <= 3;
    return `<tr data-id="${Number(p.id)}"><td><input type="checkbox" aria-label="Seleccionar fila"></td><td style="text-align:center;">${Number(p.id)}</td><td style="text-align:center;"><img src="${escapeHtml(img)}" alt="Imagen del producto" onerror="this.src='img/no-image.png'" style="width:45px;height:45px;border-radius:6px;object-fit:cover;"></td><td>${escapeHtml(p.nombre || "-")}</td><td>${escapeHtml(p.codigo || "-")}</td><td>${escapeHtml(catName || "-")}</td><td>Gs. ${money(p.precio)}</td><td>${escapeHtml(p.marca || "-")}</td><td>${costo != null ? "Gs. " + money(costo) : "—"}</td><td>${stock}${isLow ? ' <span class="badge low">Bajo</span>' : ""}</td><td style="display:flex; gap:.4rem;"><button class="btn-circle btn-edit" title="Editar" onclick="abrirEditar(${Number(p.id)})"><i class="fa fa-pen"></i></button><button class="btn-circle btn-del" title="Eliminar" onclick="eliminarProducto(${Number(p.id)})"><i class="fa fa-trash"></i></button></td></tr>`;
  }).join("");
  cont.innerHTML = `<table class="table posdash"><thead><tr><th style="width:34px;"></th><th>ID</th><th>Imagen</th><th>Producto</th><th>Código</th><th>Categoría</th><th>Precio</th><th>Marca</th><th>Costo</th><th>Cantidad</th><th>Acciones</th></tr></thead><tbody>${rows}</tbody></table>`;
  renderPaginacionProductos(list, per);
}

function renderPaginacionProductos(list, per) {
  const contenedor = document.getElementById("productos-paginacion");
  if (!contenedor) return;
  const totalPaginas = Math.ceil(list.length / per) || 1;
  contenedor.innerHTML = "";
  if (totalPaginas <= 1) return;
  contenedor.innerHTML += `<button class="pag-btn" onclick="cambiarPaginaProductos(${productosPaginaActual - 1})" ${productosPaginaActual === 1 ? "disabled" : ""}>‹</button>`;
  for (let i = 1; i <= totalPaginas; i++) {
    contenedor.innerHTML += `<button class="pag-btn ${i === productosPaginaActual ? "active" : ""}" onclick="cambiarPaginaProductos(${i})">${i}</button>`;
  }
  contenedor.innerHTML += `<button class="pag-btn" onclick="cambiarPaginaProductos(${productosPaginaActual + 1})" ${productosPaginaActual === totalPaginas ? "disabled" : ""}>›</button>`;
}

function cambiarPaginaProductos(nueva) {
  const per = Number(qs("#prodEntries")?.value || productosPorPagina);
  const totalPaginas = Math.ceil(PROD_CACHE_FILTER.length / per) || 1;
  if (nueva < 1 || nueva > totalPaginas) return;
  productosPaginaActual = nueva;
  renderProductos(PROD_CACHE_FILTER);
}

function eliminarProducto(id) {
  document.getElementById("delete_producto_id").value = id;
  openModal("modalEliminarProducto");
}

async function confirmarEliminarProducto() {
  const id = document.getElementById("delete_producto_id").value;
  if (!id) return;
  try {
    await jdel("/productos/" + id);
    closeModal("modalEliminarProducto");
    toast("Producto eliminado correctamente", "success");
    listarProductos();
    cargarKpis();
  } catch (err) { alert("⚠️ Error al eliminar: " + err.message); }
}

function resetNuevoProducto() {
  ["#pr_codigo","#pr_nombre","#pr_marca","#pr_precio","#pr_costo","#pr_stock","#pr_cat","#pr_desc"].forEach(sel => { const el = qs(sel); if (el) el.value = ""; });
  const file = qs("#pr_img"); if (file) file.value = "";
  const prev = qs("#pr_img_preview"); if (prev) prev.src = "img/no-image.png";
}

function abrirNuevoProducto() {
  resetNuevoProducto();
  openModal("modalProducto");
}

async function guardarProducto(e) {
  try {
    e?.preventDefault?.();
    const btn = qs("#btnGuardarProd");
    btn?.setAttribute("disabled", "true");
    let img = "";
    const f = qs("#pr_img")?.files?.[0];
    if (f) img = await readFileAsDataUrl(f);
    const rawCat = gv("#pr_cat");
    const categoria_id = /^\d+$/.test(rawCat) ? Number(rawCat) : null;
    const categoria = categoria_id ? null : (rawCat || null);
    const codigo = gv("#pr_codigo");
    const nombre = gv("#pr_nombre");
    const nombreFinal = (nombre || "").trim() || (codigo || "").trim() || "";
    const costo = Number(String(gv("#pr_costo") || "").replace(/\D/g, "")) || 0;
    const precio = Number(String(gv("#pr_precio") || "").replace(/\D/g, "")) || 0;
    const body = { codigo, nombre: nombreFinal, descripcion: gv("#pr_desc"), marca: gv("#pr_marca"), categoria_id, categoria, costo, precio, stock: Number(gv("#pr_stock") || 0), imagen_base64: img || null };
    if (!body.nombre) return alert("El nombre o código del producto es obligatorio.");
    await jpost("/productos", body);
    resetNuevoProducto();
    closeModal("modalProducto");
    toast("Producto guardado correctamente", "success");
    listarProductos();
    cargarKpis();
  } catch (e) { console.error(e); alert("No se pudo guardar el producto.\n" + e.message); } finally { const btn = qs("#btnGuardarProd"); btn?.removeAttribute("disabled"); }
}

function abrirEditar(id) {
  const p = PROD_CACHE.find(x => Number(x.id) === Number(id));
  if (!p) { alert("Producto no encontrado"); return; }
  const set = (sel, val) => { const el = qs(sel); if (el) el.value = val ?? ""; };
  set("#edit_id", p.id);
  set("#ed_codigo", p.codigo);
  set("#ed_nombre", p.nombre);
  set("#ed_marca", p.marca);
  set("#ed_desc", p.descripcion);
  let catName = p.categoria || "";
  if (!catName && p.categoria_id && Array.isArray(CAT_CACHE)) {
    const c = CAT_CACHE.find(cc => Number(cc.id) === Number(p.categoria_id));
    if (c) catName = c.nombre || "";
  }
  set("#ed_cat", catName);
  const edCatSelect = qs("#ed_cat_select");
  if (edCatSelect && p.categoria_id) { edCatSelect.value = String(p.categoria_id); }
  set("#ed_precio", Number(p.precio || 0));
  set("#ed_costo", Number(p.costo || 0));
  set("#ed_stock", Number(p.stock || 0));
  const file = qs("#ed_img"); if (file) file.value = "";
  const prev = qs("#ed_img_preview"); if (prev) prev.src = p.imagen_base64 || p.imagen || "img/no-image.png";
  openModal("modalProductoEdit");
}

(function bindEditImgPreview() {
  const input = qs("#ed_img");
  if (!input) return;
  input.addEventListener("change", (e) => {
    const f = e.target.files?.[0];
    if (!f) return;
    const url = URL.createObjectURL(f);
    const prev = qs("#ed_img_preview");
    if (prev) prev.src = url;
  });
})();

async function actualizarProducto() {
  const id = Number(qs("#edit_id")?.value || 0);
  if (!id) return alert("ID inválido.");
  let img = "";
  const f = qs("#ed_img")?.files?.[0];
  if (f) img = await readFileAsDataUrl(f);
  const rawCatEd = gv("#ed_cat_select") || gv("#ed_cat");
  const categoria_id = /^\d+$/.test(rawCatEd) ? Number(rawCatEd) : null;
  const categoria = categoria_id ? null : (rawCatEd || null);
  const costo = Number(String(gv("#ed_costo") || "").replace(/\D/g, "")) || 0;
  const precio = Number(String(gv("#ed_precio") || "").replace(/\D/g, "")) || 0;
  const body = { codigo: gv("#ed_codigo"), nombre: gv("#ed_nombre"), descripcion: gv("#ed_desc"), marca: gv("#ed_marca"), categoria_id, categoria, costo, precio, stock: Number(gv("#ed_stock") || 0) };
  if (img) body.imagen_base64 = img;
  try {
    await jput("/productos/" + id, body);
    closeModal("modalProductoEdit");
    toast("Producto actualizado correctamente", "success");
    listarProductos();
    cargarKpis();
  } catch (err) { console.error(err); alert("No se pudo actualizar el producto.\n" + err.message); }
}

/* ================== CATEGORÍAS ================== */
let CAT_CACHE = [];
let CAT_FILTER = [];
let categoriasPaginaActual = 1;
const categoriasPorPagina = 8;

async function listarCategorias() {
  try {
    aplicarPersonalizacionEmpresa();
    const data = await jget("/categorias");
    CAT_CACHE = (Array.isArray(data) ? data : []).map(c => ({ ...c, id: Number(c.id), codigo: c.codigo || "", nombre: c.nombre || "", descripcion: c.descripcion || "", imagen_base64: c.imagen_base64 || c.imagen || "" }));
    CAT_FILTER = [...CAT_CACHE];
    categoriasPaginaActual = 1;
    renderCategorias(CAT_FILTER);
    const opts = CAT_CACHE.map(c => `<option value="${Number(c.id)}">${escapeHtml(c.nombre || "")}</option>`).join("");
    const prCat = qs("#pr_cat");
    if (prCat) prCat.innerHTML = `<option value="">(sin categoría)</option>` + opts;
    const edCat = qs("#ed_cat_select");
    if (edCat) edCat.innerHTML = `<option value="">(sin categoría)</option>` + opts;
  } catch (err) { console.error("Error cargando categorías:", err); toast("Error cargando categorías", "error"); }
}

function filtrarCategorias(q = "") {
  q = String(q || "").toLowerCase().trim();
  CAT_FILTER = CAT_CACHE.filter(c => String(c.nombre || "").toLowerCase().includes(q) || String(c.codigo || "").toLowerCase().includes(q) || String(c.descripcion || "").toLowerCase().includes(q));
  categoriasPaginaActual = 1;
  renderCategorias(CAT_FILTER);
}

function renderCategorias(list) {
  const cont = qs("#tabla-categorias");
  if (!cont) return;
  const inicio = (categoriasPaginaActual - 1) * categoriasPorPagina;
  const fin = inicio + categoriasPorPagina;
  const categoriasPagina = (list || []).slice(inicio, fin);
  const rows = categoriasPagina.map(c => {
    const imgSrc = c.imagen_base64 || "";
    const imgHtml = imgSrc ? `<img src="${escapeHtml(imgSrc)}" alt="${escapeHtml(c.nombre || "Categoría")}" onerror="this.src='img/no-image.png'" style="width:38px;height:38px;border-radius:.5rem;object-fit:cover;">` : `<div style="width:38px;height:38px;border-radius:.5rem;background:#f3f4f6;border:1px solid #e5e7eb"></div>`;
    return `<tr data-id="${Number(c.id)}"><td class="text-center align-middle">${Number(c.id)}</td><td class="text-center align-middle">${imgHtml}</td><td class="align-middle">${escapeHtml((c.codigo ?? "").toString().trim() || "—")}</td><td class="align-middle">${escapeHtml(c.nombre || "—")}</td><td class="align-middle">${escapeHtml(c.descripcion || "—")}</td><td class="text-center align-middle"><div class="btn-group"><button class="btn btn-sm btn-light-primary me-1" title="Editar" onclick="abrirEditarCategoria(${Number(c.id)})" style="background-color:#e0e7ff;color:${EMPRESA_COLOR || "#2563eb"};border-radius:50%;width:40px;height:40px;display:inline-flex;align-items:center;justify-content:center;"><i class="fa-solid fa-pen"></i></button><button class="btn btn-sm btn-light-danger" title="Eliminar" onclick="eliminarCategoria(${Number(c.id)})" style="background-color:#fee2e2;color:#dc2626;border-radius:50%;width:40px;height:40px;display:inline-flex;align-items:center;justify-content:center;"><i class="fa-solid fa-trash"></i></button></div></td></tr>`;
  }).join("");
  cont.innerHTML = `<table class="table align-middle"><thead><tr><th class="text-center" style="width:70px;">ID</th><th class="text-center" style="width:90px;">Imagen</th><th>Código</th><th>Categoría</th><th>Descripción</th><th class="text-center">Acción</th></tr></thead><tbody>${rows || '<tr><td colspan="6" class="text-center text-muted py-3">Sin categorías para esta empresa</td></tr>'}</tbody></table>`;
  renderPaginacionCategorias(list || []);
}

function renderPaginacionCategorias(list) {
  const div = document.getElementById("categorias-paginacion");
  if (!div) return;
  div.innerHTML = "";
  const total = Math.ceil((list || []).length / categoriasPorPagina);
  if (total <= 1) return;
  div.innerHTML += `<button class="pag-btn" onclick="cambiarPaginaCategorias(${categoriasPaginaActual - 1})" ${categoriasPaginaActual === 1 ? "disabled" : ""}>‹</button>`;
  for (let i = 1; i <= total; i++) {
    div.innerHTML += `<button class="pag-btn ${i === categoriasPaginaActual ? "active" : ""}" onclick="cambiarPaginaCategorias(${i})">${i}</button>`;
  }
  div.innerHTML += `<button class="pag-btn" onclick="cambiarPaginaCategorias(${categoriasPaginaActual + 1})" ${categoriasPaginaActual === total ? "disabled" : ""}>›</button>`;
}

function cambiarPaginaCategorias(nueva) {
  const total = Math.ceil(CAT_FILTER.length / categoriasPorPagina) || 1;
  if (nueva < 1 || nueva > total) return;
  categoriasPaginaActual = nueva;
  renderCategorias(CAT_FILTER);
}

function readFileAsDataUrl(file) {
  return new Promise((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(r.result);
    r.onerror = rej;
    r.readAsDataURL(file);
  });
}

async function guardarCategoria() {
  try {
    let img = "";
    const f = qs("#cat_img")?.files?.[0];
    if (f) img = await readFileAsDataUrl(f);
    const body = { nombre: gv("#cat_nombre"), codigo: gv("#cat_codigo"), descripcion: gv("#cat_desc"), imagen_base64: img || null };
    if (!body.nombre) return alert("El nombre de la categoría es obligatorio.");
    await jpost("/categorias", body);
    closeModal("modalCategoria");
    toast("Categoría guardada correctamente", "success");
    listarCategorias();
  } catch (err) { console.error(err); alert("No se pudo guardar la categoría.\n" + err.message); }
}

function abrirEditarCategoria(id) {
  const c = CAT_CACHE.find(x => Number(x.id) === Number(id));
  if (!c) return alert("Categoría no encontrada");
  qs("#cat_edit_id").value = c.id;
  qs("#cat_ed_nombre").value = c.nombre || "";
  qs("#cat_ed_codigo").value = c.codigo || "";
  const desc = qs("#cat_ed_desc"); if (desc) desc.value = c.descripcion || "";
  const prev = qs("#cat_ed_preview");
  const src = c.imagen_base64 || c.imagen || "";
  if (prev) {
    if (src) { prev.src = src; prev.style.display = "block"; } else { prev.src = ""; prev.style.display = "none"; }
  }
  const file = qs("#cat_ed_img"); if (file) file.value = "";
  openModal("modalCategoriaEdit");
}

(function bindCatEditPreview() {
  const input = qs("#cat_ed_img");
  if (!input) return;
  input.addEventListener("change", e => {
    const f = e.target.files?.[0];
    if (!f) return;
    const url = URL.createObjectURL(f);
    const prev = qs("#cat_ed_preview");
    if (prev) { prev.src = url; prev.style.display = "block"; }
  });
})();

async function actualizarCategoria() {
  try {
    const id = Number(qs("#cat_edit_id")?.value || 0);
    if (!id) return alert("ID inválido.");
    let img = "";
    const f = qs("#cat_ed_img")?.files?.[0];
    if (f) img = await readFileAsDataUrl(f);
    const body = { nombre: gv("#cat_ed_nombre"), codigo: gv("#cat_ed_codigo"), descripcion: gv("#cat_ed_desc") };
    if (!body.nombre) return alert("El nombre de la categoría es obligatorio.");
    if (img) body.imagen_base64 = img;
    await jput("/categorias/" + id, body);
    closeModal("modalCategoriaEdit");
    toast("Categoría actualizada correctamente", "success");
    listarCategorias();
  } catch (err) { console.error(err); alert("No se pudo actualizar la categoría.\n" + err.message); }
}

function eliminarCategoria(id) {
  document.getElementById("delete_categoria_id").value = id;
  openModal("modalEliminarCategoria");
}

async function confirmarEliminarCategoria() {
  const id = document.getElementById("delete_categoria_id").value;
  if (!id) return;
  try {
    await jdel("/categorias/" + id);
    closeModal("modalEliminarCategoria");
    toast("Categoría eliminada correctamente", "success");
    listarCategorias();
  } catch (err) { console.error(err); alert("No se pudo eliminar la categoría.\n" + err.message); }
}

/* ================== COMPRAS ================== */
async function listarCompras() {
  try {
    const data = await jget("/compras");
    const compras = Array.isArray(data) ? data : [];
    const rows = compras.map(c => `<tr><td>${Number(c.id)}</td><td>${fmtDate(c.fecha)}</td><td>${escapeHtml(c.productos || c.nombres_productos || "-")}</td><td>Gs. ${money(c.total_pyg ?? c.total ?? 0)}</td><td>${escapeHtml(c.proveedor_nombre || "-")}</td><td>${escapeHtml(c.proveedor_ruc || "-")}</td></tr>`).join("");
    const tabla = document.getElementById("tabla-compras");
    if (!tabla) return;
    tabla.innerHTML = `<table class="table"><thead><tr><th>ID</th><th>Fecha</th><th>Productos</th><th>Total</th><th>Proveedor</th><th>RUC</th></tr></thead><tbody>${rows || '<tr><td colspan="6" style="text-align:center;padding:1rem;">Sin compras para esta empresa</td></tr>'}</tbody></table>`;
  } catch (err) { console.error("Error cargando compras:", err); toast("Error cargando compras", "error"); }
}

function obtenerTotalesPorFecha(lista, campoFecha, campoTotal) {
  const hoy = new Date();
  const añoActual = hoy.getFullYear();
  const mesActual = hoy.getMonth() + 1;
  let totalAnual = 0, totalMensual = 0;
  lista.forEach(item => {
    const fecha = new Date(item[campoFecha]);
    if (isNaN(fecha)) return;
    const año = fecha.getFullYear();
    const mes = fecha.getMonth() + 1;
    const monto = Number(item.total_pyg ?? item[campoTotal] ?? 0);
    if (año === añoActual) { totalAnual += monto; if (mes === mesActual) totalMensual += monto; }
  });
  return { totalAnual, totalMensual };
}

async function renderDashboard() {
  try {
    const [ventas, compras, productos] = await Promise.all([jget("/ventas"), jget("/compras"), jget("/productos")]);
    const totV = obtenerTotalesPorFecha(ventas || [], "fecha", "total");
    const totC = obtenerTotalesPorFecha(compras || [], "fecha", "total");
    const stockTotal = (productos || []).reduce((acc, p) => acc + (Number(p.stock) || 0), 0);
    const kpiVentas = document.getElementById("kpi-ventas");
    const kpiCompras = document.getElementById("kpi-compras");
    const kpiProductos = document.getElementById("kpi-productos");
    if (kpiVentas) kpiVentas.innerHTML = `Año: Gs. ${money(totV.totalAnual)}<br>Mes: Gs. ${money(totV.totalMensual)}`;
    if (kpiCompras) kpiCompras.innerHTML = `Año: Gs. ${money(totC.totalAnual)}<br>Mes: Gs. ${money(totC.totalMensual)}`;
    if (kpiProductos) kpiProductos.innerText = stockTotal;
  } catch (err) { console.error("Error renderizando dashboard:", err); }
}

/* ================== PEDIDOS ================== */
function closeModalSelProducto() { closeModal("modalSelProducto"); }

async function eliminarPedidoConfirmado() {
  const id = document.getElementById("delete_pedido_id")?.value;
  try {
    const data = await jdel(`/api/pedidos/${id}`);
    if (!data?.ok) { alert("Error: " + (data?.msg || "No se pudo eliminar")); return; }
    closeModal("modalEliminarPedido");
    toast("Pedido eliminado correctamente", "success");
    listarPedidos();
  } catch (err) { console.error("Error eliminando pedido:", err); alert("No se pudo eliminar el pedido."); }
}

function eliminarPedido(id) {
  const input = document.getElementById("delete_pedido_id");
  if (input) input.value = id;
  openModal("modalEliminarPedido");
}

async function recibirPedido(id) {
  if (!confirm("¿Marcar pedido como recibido?")) return;
  try {
    await jput(`/api/pedidos/${id}/recibir`, {});
    toast("Pedido marcado como recibido", "success");
    listarPedidos();
  } catch (e) { console.error("Error al marcar como recibido:", e); alert("No se pudo marcar como recibido."); }
}

async function marcarComoRecibido(id) { return recibirPedido(id); }

async function exportarPDF_Listado() {
  const emp = typeof getEmpresaActualPDF === "function" ? getEmpresaActualPDF() : { nombre: EMPRESA_NOMBRE || "Mi Empresa", logo: EMPRESA_LOGO || "img/logo2.png", color: EMPRESA_COLOR || "#2563eb", direccion: empresa?.direccion || "", ruc: empresa?.ruc || "", telefono: empresa?.telefono || "", email: empresa?.email || "" };
  try { logoConsorcio = await cargarLogoBase64(emp.logo); logoSpynet = await cargarLogoBase64(emp.logo); } catch (e) { console.warn("No se pudieron cargar los logos:", e); }
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({ compression: "FAST", unit: "mm", format: "a4" });
  let pedidos = [];
  try { pedidos = await jget("/api/pedidos"); } catch (e) { console.error("Error cargando pedidos:", e); alert("No se pudieron cargar los pedidos."); return; }
  const pageW = doc.internal.pageSize.getWidth();
  const cx = pageW / 2;
  const colorPrincipal = typeof hexToRgbArray === "function" ? hexToRgbArray(emp.color) : [37, 99, 235];
  try { if (logoConsorcio) doc.addImage(logoConsorcio, imgType(logoConsorcio), 10, 8, 32, 18); if (logoSpynet) doc.addImage(logoSpynet, imgType(logoSpynet), pageW - 10 - 28, 8, 28, 18); } catch (e) { console.warn("Error addImage logos:", e); }
  doc.setFont("times", "bold").setFontSize(22).text(emp.nombre || "Mi Empresa", cx, 14, { align: "center" });
  doc.setFont("helvetica", "normal").setFontSize(10);
  if (emp.ruc) doc.text(`RUC: ${emp.ruc}`, cx, 20, { align: "center" });
  if (emp.direccion) doc.text(emp.direccion, cx, emp.ruc ? 25 : 20, { align: "center" });
  const contacto = [emp.telefono ? `Tel: ${emp.telefono}` : "", emp.email || ""].filter(Boolean).join(" | ");
  if (contacto) { doc.setFontSize(9); doc.text(contacto, cx, emp.direccion ? 30 : 25, { align: "center" }); }
  doc.setLineWidth(0.4).line(10, 45, pageW - 10, 45);
  doc.setFont("helvetica", "bold").setFontSize(14).text("Listado de Pedidos a Proveedor", 10, 54);
  const rows = (pedidos || []).map(p => {
    const productos = p.items?.length ? p.items.map(i => i.producto_nombre || "—").join(", ") : "—";
    const categorias = p.items?.length ? p.items.map(i => i.categoria_nombre || "—").join(", ") : "—";
    const cantidad_items = p.items?.reduce((a, i) => a + Number(i.cantidad || 0), 0) || 0;
    return [p.id, p.proveedor_nombre || "—", productos, categorias, p.fecha_pedido ? String(p.fecha_pedido).slice(0, 10) : "—", p.fecha_recepcion ? String(p.fecha_recepcion).slice(0, 10) : "Sin recibir", cantidad_items, "Gs. " + money(p.subtotal), "Gs. " + money(p.iva), "Gs. " + money(p.total)];
  });
  doc.autoTable({
    startY: 60,
    theme: "striped",
    head: [["ID","Proveedor","Productos","Categorías","Fecha Pedido","Recepción","Cant.","Subtotal","IVA","Total"]],
    body: rows,
    headStyles: { fillColor: colorPrincipal, textColor: 255, fontSize: 9, halign: "center" },
    styles: { fontSize: 8, cellPadding: 1.5, overflow: "linebreak" },
    margin: { left: 10, right: 10 }
  });
  const hoy = hoyLocal();
  const nombreArchivo = `Lista_de_Pedidos_${limpiarNombreArchivo(emp.nombre || "Empresa")}_${hoy}.pdf`;
  doc.save(nombreArchivo);
}

async function imgToDataURL(url) {
  const res = await fetch(url, { credentials: "include", cache: "no-store" });
  const blob = await res.blob();
  return await new Promise((resolve) => { const r = new FileReader(); r.onload = () => resolve(r.result); r.readAsDataURL(blob); });
}

async function exportarPDF_Pedido() {
  const id = document.getElementById("pp_id")?.innerText?.trim();
  if (!id) return alert("No se encontró el ID del pedido.");
  let p = null;
  try { p = await jget(`/api/pedidos/${id}`); } catch (err) { console.error("Error cargando pedido:", err); return alert("No se pudo cargar el pedido."); }
  if (!p) return alert("No se encontró el pedido.");
  const emp = typeof getEmpresaActualPDF === "function" ? getEmpresaActualPDF() : { nombre: EMPRESA_NOMBRE || "Mi Empresa", logo: EMPRESA_LOGO || "img/logo2.png", color: EMPRESA_COLOR || "#2563eb", direccion: empresa?.direccion || "", ruc: empresa?.ruc || "", telefono: empresa?.telefono || "", email: empresa?.email || "" };
  try { logoConsorcio = await cargarLogoBase64(emp.logo); logoSpynet = await cargarLogoBase64(emp.logo); } catch (e) { console.warn("No se pudo cargar logo:", e); }
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({ compression: "FAST", unit: "mm", format: "a4" });
  const pageW = doc.internal.pageSize.getWidth();
  const cx = pageW / 2;
  try { if (logoConsorcio) doc.addImage(logoConsorcio, imgType(logoConsorcio), 10, 8, 32, 18); if (logoSpynet) doc.addImage(logoSpynet, imgType(logoSpynet), pageW - 38, 8, 28, 18); } catch (e) { console.warn("Error agregando logo:", e); }
  doc.setFont("times", "bold").setFontSize(20).text(emp.nombre || "Mi Empresa", cx, 14, { align: "center" });
  doc.setFont("helvetica", "normal").setFontSize(9);
  if (emp.ruc) doc.text(`RUC: ${emp.ruc}`, cx, 20, { align: "center" });
  if (emp.direccion) doc.text(emp.direccion, cx, emp.ruc ? 25 : 20, { align: "center" });
  const contacto = [emp.telefono ? `Tel: ${emp.telefono}` : "", emp.email || ""].filter(Boolean).join(" | ");
  if (contacto) doc.text(contacto, cx, emp.direccion ? 30 : 25, { align: "center" });
  doc.setLineWidth(0.4).line(10, 42, pageW - 10, 42);
  doc.setFont("helvetica", "bold").setFontSize(14).text(`Pedido a Proveedor #${p.id}`, 14, 52);
  doc.autoTable({
    head: [["Dato","Valor"]],
    body: [
      ["Proveedor", p.proveedor_nombre || "—"],
      ["Fecha Pedido", p.fecha || p.fecha_pedido ? String(p.fecha || p.fecha_pedido).slice(0, 10) : "—"],
      ["Fecha Recepción", p.fecha_recepcion ? String(p.fecha_recepcion).slice(0, 10) : "Sin recibir"],
      ["Subtotal", "Gs. " + money(p.subtotal || 0)],
      ["IVA", "Gs. " + money(p.iva || 0)],
      ["Total", "Gs. " + money(p.total || 0)]
    ],
    startY: 58
  });
  const rows = (p.items || []).map(i => [
    i.producto_nombre || i.producto || "—",
    Number(i.cantidad || 0),
    i.unidad || "unidad",
    "Gs. " + money(i.precio_unit || i.costo_estimado || i.precio || 0),
    "Gs. " + money(i.total || i.subtotal || 0)
  ]);
  doc.autoTable({
    head: [["Producto","Cantidad","Unidad","Precio","Subtotal"]],
    body: rows,
    startY: doc.lastAutoTable.finalY + 10
  });
  doc.save(`Pedido_${limpiarNombreArchivo(emp.nombre)}_${p.id}.pdf`);
}

async function eliminarProductoDeLista(id, btn) {
  if (!confirm("¿Seguro que deseas eliminar este producto?")) return;
  try {
    await jdel(`/productos/${id}`);
    btn?.closest("tr")?.remove();
    toast("Producto eliminado correctamente", "success");
    listarProductos();
    cargarKpis();
  } catch (e) { alert("Error al eliminar producto."); console.error(e); }
}

async function cargarProveedoresEnSelect() {
  const select = document.getElementById("pp_proveedor");
  if (!select) return;
  select.innerHTML = `<option value="">Cargando proveedores...</option>`;
  try {
    const proveedores = await jget("/proveedores");
    if (!Array.isArray(proveedores) || !proveedores.length) { select.innerHTML = `<option value="">No hay proveedores para esta empresa</option>`; return; }
    select.innerHTML = `<option value="">Seleccionar proveedor</option>`;
    proveedores.forEach(p => { const opt = document.createElement("option"); opt.value = p.id; opt.textContent = p.nombre || "Sin nombre"; select.appendChild(opt); });
  } catch (err) { console.error("Error cargando proveedores:", err); select.innerHTML = `<option value="">Error al cargar</option>`; }
}

/* ================== FORMAS DE PAGO ================== */
function normalizarFormaPago(v) {
  let nombre = (v.forma_pago_nombre || v.forma_pago || v.metodo || v.forma || "").toString().trim();
  const banco = (v.banco_nombre || "").toString().trim();
  if (nombre.toLowerCase().includes("otro banco") && banco && !nombre.includes("(")) { nombre += ` (${banco})`; }
  return nombre || "Sin especificar";
}

function detectarTipoGeneral(fpNombre) {
  const s = (fpNombre || "").toLowerCase();
  if (s.includes("efect")) return "efectivo";
  return "transferencia";
}

async function listarFP() {
  const fEl = document.querySelector("#fechaCaja");
  const fecha = (fEl && fEl.value && fEl.value.trim()) ? fEl.value.trim() : toYMD(new Date());
  const yyyy_mm = fecha.slice(0, 7);
  let ventas = [];
  try { ventas = await jget("/ventas"); console.table(ventas); } catch (e) { console.error("Error cargando ventas:", e); return; }
  let diaE = 0, diaT = 0, mesE = 0, mesT = 0;
  const diaPorForma = {}, mesPorForma = {};
  for (const v of ventas) {
    const f = (v.fecha || v.created_at || "").toString();
    const total = Number(v.total_pyg ?? v.total ?? 0);
    const fp = normalizarFormaPago(v);
    const tipo = detectarTipoGeneral(fp);
    if (sameDay(f, fecha)) {
      if (tipo === "efectivo") diaE += total; else diaT += total;
      diaPorForma[fp] = (diaPorForma[fp] || 0) + total;
    }
    if (sameMonth(f, yyyy_mm)) {
      if (tipo === "efectivo") mesE += total; else mesT += total;
      mesPorForma[fp] = (mesPorForma[fp] || 0) + total;
    }
  }
  const setTxt = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = "Gs. " + money(val); };
  setTxt("fp-dia-efectivo", diaE);
  setTxt("fp-dia-transferencia", diaT);
  setTxt("fp-dia-total", diaE + diaT);
  setTxt("fp-mes-efectivo", mesE);
  setTxt("fp-mes-transferencia", mesT);
  setTxt("fp-mes-total", mesE + mesT);
  const cont = document.getElementById("fp-detalle");
  if (!cont) return;
  const keys = Array.from(new Set([...Object.keys(diaPorForma), ...Object.keys(mesPorForma)])).sort();
  if (!keys.length) {
    cont.innerHTML = `<div class="text-muted" style="padding:.75rem;">Sin ventas pagadas para esta fecha.</div>`;
  } else {
    cont.innerHTML = `<div class="card" style="padding:1rem;"><h4 style="margin:0 0 .75rem 0;">Detalle por forma / banco</h4><div style="overflow:auto;"><table class="table" style="min-width:520px;"><thead><tr><th>Forma / Banco</th><th style="text-align:right;">Hoy</th><th style="text-align:right;">Mes</th></tr></thead><tbody>${keys.map(k => `<tr><td>${escapeHtml(k)}</td><td style="text-align:right;">Gs. ${money(diaPorForma[k] || 0)}</td><td style="text-align:right;">Gs. ${money(mesPorForma[k] || 0)}</td></tr>`).join("")}</tbody></table></div></div>`;
  }
  const tbodyMov = document.getElementById("fp-tbody-mov");
  if (tbodyMov) {
    FP_MOV_CACHE = (ventas || []).filter(v => (v.nro_comprobante || "").toString().trim() !== "").sort((a, b) => new Date(b.fecha || b.created_at) - new Date(a.fecha || a.created_at));
    fpMovPaginaActual = 1;
    renderMovimientosComprobante();
  }
}

function renderMovimientosComprobante() {
  const tbodyMov = document.getElementById("fp-tbody-mov");
  if (!tbodyMov) return;
  const inicio = (fpMovPaginaActual - 1) * fpMovPorPagina;
  const fin = inicio + fpMovPorPagina;
  const pagina = FP_MOV_CACHE.slice(inicio, fin);
  if (!pagina.length) {
    tbodyMov.innerHTML = `<tr><td colspan="6" style="padding:10px; text-align:center; color:#6b7280;">No hay movimientos con comprobante.</td></tr>`;
    renderPaginacionMovimientosComprobante();
    return;
  }
  tbodyMov.innerHTML = pagina.map(v => `<tr style="border-top:1px solid #e5e7eb;"><td style="padding:10px;">${v.id ?? "—"}</td><td style="padding:10px;">${typeof fmtDate === "function" ? fmtDate(v.fecha || v.created_at) : (String(v.fecha || v.created_at || "").slice(0, 10) || "—")}</td><td style="padding:10px;">${escapeHtml(v.cliente_nombre || "Consumidor Final")}</td><td style="padding:10px;">${escapeHtml(normalizarFormaPago(v))}</td><td style="padding:10px;"><b>${escapeHtml(v.nro_comprobante || "—")}</b></td><td style="padding:10px; text-align:right;">Gs. ${money(v.total_pyg ?? v.total ?? 0)}</td></tr>`).join("");
  renderPaginacionMovimientosComprobante();
}

function renderPaginacionMovimientosComprobante() {
  const div = document.getElementById("fp-mov-paginacion");
  if (!div) return;
  const total = Math.ceil(FP_MOV_CACHE.length / fpMovPorPagina);
  div.innerHTML = "";
  if (total <= 1) return;
  div.innerHTML += `<button class="pag-btn" onclick="cambiarPaginaMovComprobante(${fpMovPaginaActual - 1})" ${fpMovPaginaActual === 1 ? "disabled" : ""}>‹</button>`;
  for (let i = 1; i <= total; i++) {
    div.innerHTML += `<button class="pag-btn ${i === fpMovPaginaActual ? "active" : ""}" onclick="cambiarPaginaMovComprobante(${i})">${i}</button>`;
  }
  div.innerHTML += `<button class="pag-btn" onclick="cambiarPaginaMovComprobante(${fpMovPaginaActual + 1})" ${fpMovPaginaActual === total ? "disabled" : ""}>›</button>`;
}

function cambiarPaginaMovComprobante(nueva) {
  const total = Math.ceil(FP_MOV_CACHE.length / fpMovPorPagina);
  if (nueva < 1 || nueva > total) return;
  fpMovPaginaActual = nueva;
  renderMovimientosComprobante();
}

async function crearFP() {
  const nombre = prompt("Nombre de la forma de pago");
  if (!nombre) return;
  try {
    await jpost("/formas_pago", { nombre: nombre.trim() });
    toast("Forma de pago creada correctamente", "success");
    listarFP();
  } catch (err) { console.error(err); alert("No se pudo crear la forma de pago."); }
}

/* ================== BRAND LOGO ================== */
(function applyBrandLogo() {
  const saved = localStorage.getItem("brandLogo");
  if (!saved) return;
  const tb = document.querySelector(".topbar div:last-child");
  if (!tb) return;
  if (tb.querySelector(".brand-logo-dynamic")) return;
  const img = document.createElement("img");
  img.src = saved;
  img.alt = "Logo";
  img.className = "brand-logo-dynamic";
  Object.assign(img.style, { height: "28px", borderRadius: "8px", marginLeft: "8px", objectFit: "contain" });
  tb.appendChild(img);
})();

/* ================== COMPRAS ================== */
let compraItems = [];
window.productoSeleccionado = window.productoSeleccionado || null;

function abrirNuevaCompra() {
  cargarProveedoresEnSelectCompra();
  openModal("modalNuevaCompra");
  const fecha = document.getElementById("c_fecha");
  const factura = document.getElementById("c_factura");
  if (fecha) fecha.value = toYMD(new Date());
  if (factura) factura.value = "";
  compraItems = [];
  renderItemsCompra();
  recalcularCompra();
}

async function cargarProductosParaCompra() {
  const cont = document.getElementById("tablaSelProductosCompra");
  if (!cont) return;
  cont.innerHTML = `<tr><td colspan="6" style="padding:12px;color:#6b7280;">Cargando productos...</td></tr>`;
  try {
    const productos = await jget("/productos");
    if (!Array.isArray(productos) || !productos.length) { cont.innerHTML = `<tr><td colspan="6" style="padding:12px;color:#6b7280;">No hay productos.</td></tr>`; return; }
    cont.innerHTML = "";
    productos.forEach(p => {
      const tr = document.createElement("tr");
      tr.innerHTML = `<td>${escapeHtml(p.nombre || "")}</td><td>${escapeHtml(p.marca || "-")}</td><td>${escapeHtml(p.categoria || "-")}</td><td style="text-align:right;">Gs. ${money(p.costo || 0)}</td><td style="text-align:center;">${Number(p.stock || 0)}</td><td style="text-align:center;"><button class="btn" onclick="agregarProductoCompra(${Number(p.id)}, ${JSON.stringify(p.nombre || "")}, ${Number(p.costo || 0)})"><i class="fa fa-plus"></i></button></td>`;
      cont.appendChild(tr);
    });
  } catch (err) { console.error("Error cargando productos:", err); cont.innerHTML = `<tr><td colspan="6" style="padding:12px;color:#ef4444;">Error al cargar productos.</td></tr>`; }
}

function filtrarProductosCompra() {
  const q = (document.getElementById("buscarProdCompra")?.value || "").toLowerCase();
  document.querySelectorAll("#tablaSelProductosCompra tr").forEach(fila => {
    const txt = fila.innerText.toLowerCase();
    fila.style.display = txt.includes(q) ? "" : "none";
  });
}

function agregarProductoCompra(id, nombre, costo) {
  const existente = compraItems.find(x => Number(x.producto_id) === Number(id));
  if (existente) { existente.cantidad += 1; existente.subtotal = existente.cantidad * existente.costo; } else { compraItems.push({ producto_id: Number(id), producto_nombre: nombre || "", cantidad: 1, costo: Number(costo || 0), subtotal: Number(costo || 0) }); }
  closeModal("modalSelProductoCompra");
  renderItemsCompra();
  recalcularCompra();
}

function renderItemsCompra() {
  const tbody = document.getElementById("compra_items");
  if (!tbody) return;
  tbody.innerHTML = "";
  if (!compraItems.length) { tbody.innerHTML = `<tr><td colspan="5" style="padding:12px;text-align:center;color:#6b7280;">No hay productos agregados.</td></tr>`; return; }
  compraItems.forEach((item, i) => {
    const tr = document.createElement("tr");
    tr.innerHTML = `<td>${escapeHtml(item.producto_nombre)}</td><td style="width:110px;"><input class="input" type="number" min="1" value="${item.cantidad}" onchange="updateCantidadCompra(${i}, this.value)"></td><td style="width:140px;"><input class="input" type="number" min="0" step="0.01" value="${item.costo}" onchange="updateCostoCompra(${i}, this.value)"></td><td style="text-align:right;">Gs. ${money(item.subtotal)}</td><td style="text-align:center;"><button class="btn secondary" onclick="eliminarItemCompra(${i})"><i class="fa fa-trash"></i></button></td>`;
    tbody.appendChild(tr);
  });
}

function updateCantidadCompra(i, val) {
  compraItems[i].cantidad = Number(val || 1);
  compraItems[i].subtotal = compraItems[i].cantidad * compraItems[i].costo;
  renderItemsCompra();
  recalcularCompra();
}

function updateCostoCompra(i, val) {
  compraItems[i].costo = Number(val || 0);
  compraItems[i].subtotal = compraItems[i].cantidad * compraItems[i].costo;
  renderItemsCompra();
  recalcularCompra();
}

function eliminarItemCompra(i) {
  if (!confirm("¿Eliminar este producto?")) return;
  compraItems.splice(i, 1);
  renderItemsCompra();
  recalcularCompra();
}

function recalcularCompra() {
  subtotalCompra = compraItems.reduce((a, i) => a + Number(i.subtotal || 0), 0);
  ivaCompra = subtotalCompra * 0.10;
  totalCompra = subtotalCompra + ivaCompra;
  const setTxt = (id, val) => { const el = document.getElementById(id); if (el) el.innerText = money(val); };
  setTxt("c_subtotal", subtotalCompra);
  setTxt("c_iva", ivaCompra);
  setTxt("c_total", totalCompra);
}

async function guardarCompra() {
  if (!compraItems.length) return alert("No hay productos en la compra.");
  const proveedorId = Number(document.getElementById("c_proveedor")?.value || 0);
  if (!proveedorId) return alert("Seleccione un proveedor.");
  const compra = { proveedor_id: proveedorId, fecha: document.getElementById("c_fecha")?.value || null, factura: document.getElementById("c_factura")?.value || "", items: compraItems.map(i => ({ producto_id: Number(i.producto_id), cantidad: Number(i.cantidad), costo: Number(i.costo), subtotal: Number(i.cantidad) * Number(i.costo) })) };
  try {
    const data = await jpost("/compras", compra);
    console.log("Compra registrada:", data);
    toast("Compra registrada correctamente", "success");
    closeModal("modalNuevaCompra");
    listarCompras();
    listarProductos();
    if (typeof cargarKpis === "function") cargarKpis();
  } catch (err) { console.error(err); alert("Error al guardar la compra."); }
}

function seleccionarProductoCompra(prod) {
  productoSeleccionado = prod;
  document.getElementById("c_buscar_producto").value = prod.nombre || "";
  document.getElementById("c_producto_id").value = prod.id || "";
  document.getElementById("c_costo").value = prod.costo || 0;
  document.getElementById("c_lista_productos").innerHTML = "";
}

function agregarItemCompra() {
  if (!productoSeleccionado) { alert("Debe seleccionar un producto."); return; }
  const cantidad = Number(document.getElementById("c_cantidad")?.value || 1);
  const costo = Number(document.getElementById("c_costo")?.value || 0);
  compraItems.push({ producto_id: productoSeleccionado.id, producto_nombre: productoSeleccionado.nombre, cantidad, costo, subtotal: cantidad * costo });
  renderItemsCompra();
  recalcularCompra();
  limpiarCamposProducto();
}

async function cargarProveedoresEnSelectCompra() {
  const select = document.getElementById("c_proveedor");
  if (!select) return;
  select.innerHTML = `<option value="">Cargando proveedores...</option>`;
  try {
    const proveedores = await jget("/proveedores");
    if (!Array.isArray(proveedores) || !proveedores.length) { select.innerHTML = `<option value="">No hay proveedores para esta empresa</option>`; return; }
    select.innerHTML = `<option value="">Seleccionar proveedor</option>`;
    proveedores.forEach(p => { const opt = document.createElement("option"); opt.value = p.id; opt.textContent = p.nombre || "Sin nombre"; select.appendChild(opt); });
  } catch (err) { console.error("Error cargando proveedores:", err); select.innerHTML = `<option value="">Error al cargar</option>`; }
}

async function cargarProductosPedido(buscar = "") {
  try {
    const productos = await jget(`/productos${buscar ? `?buscar=${encodeURIComponent(buscar)}` : ""}`);
    const tbody = document.getElementById("tablaSelProductosPedido");
    if (!tbody) return;
    tbody.innerHTML = "";
    if (!Array.isArray(productos) || !productos.length) { tbody.innerHTML = `<tr><td colspan="6" style="padding:12px;text-align:center;color:#64748b;">No hay productos para esta empresa.</td></tr>`; return; }
    productos.forEach(p => {
      const tr = document.createElement("tr");
      tr.innerHTML = `<td>${escapeHtml(p.nombre || "")}</td><td>${escapeHtml(p.marca || "-")}</td><td>${escapeHtml(p.categoria || "-")}</td><td>Gs. ${money(p.costo || 0)}</td><td>${Number(p.stock || 0)}</td><td><button class="btn btn-primary" onclick="seleccionarProductoPP(${Number(p.id)})">Seleccionar</button></td>`;
      tbody.appendChild(tr);
    });
  } catch (e) { console.error("Error cargando productos:", e); }
}

async function cargarProveedoresPedido() {
  const sel = document.getElementById("pp_proveedor");
  if (!sel) return console.error("No existe #pp_proveedor");
  sel.innerHTML = `<option value="">Cargando proveedores...</option>`;
  try {
    const data = await jget("/proveedores");
    if (!Array.isArray(data) || !data.length) { sel.innerHTML = `<option value="">No hay proveedores para esta empresa</option>`; return; }
    sel.innerHTML = `<option value="">Seleccione un proveedor</option>`;
    data.forEach(p => { const opt = document.createElement("option"); opt.value = p.id; opt.textContent = `${p.nombre || "Sin nombre"} — ${p.ruc || ""}`; sel.appendChild(opt); });
  } catch (err) { console.error("Error cargando proveedores:", err); sel.innerHTML = `<option value="">Error al cargar</option>`; }
}

function cargarProductosSelectPP() {
  const sel = document.getElementById("pp_producto_select");
  if (!sel) return;
  sel.innerHTML = `<option value="">Seleccione un producto...</option>`;
  PROD_CACHE.forEach(p => {
    const opt = document.createElement("option");
    opt.value = p.id;
    opt.dataset.nombre = p.nombre || "";
    opt.dataset.costo = Number(p.costo || 0);
    opt.textContent = `${p.nombre || "Sin nombre"} — ${p.marca || "-"} (Gs. ${money(p.costo || 0)})`;
    sel.appendChild(opt);
  });
}

function seleccionarProductoPPDesdeSelect() {
  const sel = document.getElementById("pp_producto_select");
  if (!sel || !sel.value) return;
  seleccionarProductoPP(Number(sel.value));
  sel.value = "";
}

function editarPP_Campo(i, campo, valor) {
  const items = Array.isArray(window.pp_items) ? window.pp_items : (window.pp_items = []);
  if (!items[i]) return;
  if (campo === 'cantidad') {
    valor = Number(valor) || 0;
    items[i].cantidad = valor;
    const unidad = items[i].unidad || 'unidad';
    const unidadBase = unidadBaseDe(unidad);
    const factor = obtenerFactorConversion(unidad, unidadBase);
    items[i].cantidad_base = valor * factor;
  }
  if (campo === 'costo') {
    valor = Number(String(valor).replace(/\D/g, '')) || 0;
    items[i].costo = valor;
  }
  const cantBase = items[i].cantidad_base || 0;
  const costo = items[i].costo || 0;
  items[i].subtotal = cantBase * costo;
  renderPP_Items();
}

async function listarPedidosProveedor() {
  try { await listarPedidos(); } catch (err) { console.error("Error listando pedidos:", err); }
}

if (window.location.hash === "#lista_pedidos") { listarPedidosProveedor(); }

function editarPP_Item(i) {
  const row = qs("#pp_items")?.children?.[i];
  if (!row) return;
  row.classList.add("editing");
  setTimeout(() => row.classList.remove("editing"), 600);
}

function eliminarPP_Item(i) {
  const items = Array.isArray(window.pp_items) ? window.pp_items : (window.pp_items = []);
  items.splice(i, 1);
  renderPP_Items();
}

function calcularTotalesPP() {
  const items = Array.isArray(window.pp_items) ? window.pp_items : (window.pp_items = []);
  const subtotal = items.reduce((acc, x) => acc + (x.subtotal || 0), 0);
  const iva = 0;
  const total = subtotal + iva;
  document.querySelectorAll("#pp_subtotal").forEach(el => { el.textContent = fmtPYG(subtotal); });
  document.querySelectorAll("#pp_iva").forEach(el => { el.textContent = fmtPYG(iva); });
  document.querySelectorAll("#pp_total").forEach(el => { el.textContent = fmtPYG(total); });
}

let _guardando = false;

async function guardarPedido(enviar = false) {
  if (_guardando) return;
  _guardando = true;
  const items = Array.isArray(window.pp_items) ? window.pp_items : (window.pp_items = []);
  if (!items.length) { _guardando = false; return alert("Debe agregar al menos un producto."); }
  const proveedor_id = qs("#pp_proveedor")?.value;
  const fecha_pedido = qs("#pp_fecha")?.value;
  if (!proveedor_id) { _guardando = false; return alert("Seleccione un proveedor."); }
  if (!fecha_pedido) { _guardando = false; return alert("Seleccione la fecha del pedido."); }
  const pedido = {
    proveedor_id: Number(proveedor_id),
    fecha_pedido,
    observacion: "",
    enviar_email: !!enviar,
    items: items.map(i => ({ producto_id: Number(i.producto_id || i.id), descripcion: i.unidad || "", cantidad: Number(i.cantidad) || 0, precio_unit: Number(i.costo) || 0 }))
  };
  try {
    const resp = await jpost("/api/pedidos", pedido);
    toast(enviar ? "Pedido guardado y enviado correctamente" : "Pedido guardado correctamente", "success");
    console.log("Pedido creado:", resp);
    window.pp_items = [];
    renderPP_Items();
    history.pushState(null, "", "#lista_pedidos");
    listarPedidos();
  } catch (err) { console.error(err); toast("Error al guardar el pedido.", "error"); } finally { _guardando = false; }
}

function openModalPP() {
  const modal = document.getElementById("modalSelProducto");
  if (!modal) return console.error("No existe #modalSelProducto");
  modal.style.display = "flex";
  modal.classList.add("show");
  listarProductos().then(() => renderProductosPedidoModal(PROD_CACHE)).catch(err => { console.error("Error listarProductos:", err); const tbody = document.getElementById("tablaSelProductos"); if (tbody) tbody.innerHTML = `<tr><td colspan="6" style="padding:12px;color:#ef4444">Error cargando productos</td></tr>`; });
}
window.openModalPP = openModalPP;

function seleccionarProductoPP(id) {
  let p;
  if (window.modoSeleccion === "insumos") {
    p = (window.listaInsumosPOS || []).find(x => Number(x.id) === Number(id));
  } else {
    p = (window.listaProductosPOS || []).find(x => Number(x.id) === Number(id));
  }
  if (!p) return;
  window.PP_PRODUCTO_ACTUAL = p;
  closeModal("modalSelProducto");
  const elNombre = document.getElementById("pp_edit_nombre");
  const elCantidad = document.getElementById("pp_edit_cantidad");
  const elCosto = document.getElementById("pp_edit_costo");
  if (elNombre) elNombre.value = p.nombre || "";
  if (elCantidad) elCantidad.value = 1;
  const costo = p.esInsumo ? (p.costo || 0) : (p.precio || p.costo || 0);
  if (elCosto) elCosto.value = formatearMilesVal(costo);
  const esInsumo = p.esInsumo || false;
  const insumoControls = document.getElementById("insumo_controls");
  const campoUnidadProducto = document.getElementById("campo_unidad_producto");
  if (esInsumo) {
    insumoControls.style.display = "block";
    if (campoUnidadProducto) campoUnidadProducto.style.display = "none";
    const unidadSelect = document.getElementById("pp_edit_unidad_select");
    if (unidadSelect) { if (p.unidad) unidadSelect.value = p.unidad; else unidadSelect.value = "Kg"; }
  } else {
    insumoControls.style.display = "none";
    if (campoUnidadProducto) campoUnidadProducto.style.display = "block";
    const elUnidad = document.getElementById("pp_edit_unidad");
    if (elUnidad) elUnidad.value = p.unidad || "unidad";
  }
  openModal("modalEditarPP");
}
window.seleccionarProductoPP = seleccionarProductoPP;

function setCantidadInsumo(factor) {
  const cantidadInput = document.getElementById("pp_edit_cantidad");
  const unidadSelect = document.getElementById("pp_edit_unidad_select");
  if (!cantidadInput || !unidadSelect) return;
  const unidad = unidadSelect.value;
  let cantidadBase = 1;
  if (unidad === "g" || unidad === "ml") { cantidadBase = 1000; }
  const cantidad = factor * cantidadBase;
  cantidadInput.value = cantidad.toFixed(2);
}

function agregarProductoAlPedido() {
  const p = window.PP_PRODUCTO_ACTUAL || null;
  if (!p) return alert("No hay producto seleccionado");
  const cantidad = Number(document.getElementById("pp_edit_cantidad")?.value || 0);
  const unidad   = (document.getElementById("pp_edit_unidad")?.value || "unidad").trim();
  const costoTxt = (document.getElementById("pp_edit_costo")?.value || "").trim();
  const costo    = Number(costoTxt.replace(/\D/g, "")) || 0;
  if (cantidad <= 0) return alert("Ingresá una cantidad válida");
  if (costo    <= 0) return alert("Ingresá un costo válido");
  if (!Array.isArray(window.pp_items)) window.pp_items = [];
  const item = {
    id:               p.id,
    producto_id:      p.id,
    nombre:           p.nombre || "",
    producto_nombre:  p.nombre || "",
    categoria_nombre: p.categoria || p.categoria_nombre || "Sin categoría",
    cantidad,
    unidad,
    costo,
    precio_unit:      costo,
    costo_estimado:   costo,
    subtotal:         cantidad * costo,
    total:            cantidad * costo
  };
  const idx = window.pp_items.findIndex(x => Number(x.id || x.producto_id) === Number(item.id));
  if (idx >= 0) window.pp_items[idx] = item; else window.pp_items.push(item);
  pp_items = window.pp_items;
  if (typeof renderPP_Items === "function") renderPP_Items();
  closeModal("modalEditarPP");
}
window.agregarProductoAlPedido = agregarProductoAlPedido;

const POS_POR_PAGINA = 6;
let posPagina    = 1;
let posFiltrados = [];

function aplicarPaginaPOS() {
  const desde = (posPagina - 1) * POS_POR_PAGINA;
  const slice  = posFiltrados.slice(desde, desde + POS_POR_PAGINA);
  renderizarProductosPOS(slice);
  renderizarPaginacionPOS(posFiltrados.length);
}

function renderizarProductosPOS(productos) {
  const grid = document.getElementById("tablaSelProductos");
  if (!grid) return;
  if (!productos.length) { grid.innerHTML = `<p style="color:#aaa;font-size:13px;grid-column:1/-1;text-align:center;padding:20px 0;">Sin resultados</p>`; return; }
  grid.innerHTML = productos.map(p => {
    const esInsumo = p.esInsumo || false;
    const sku = p.codigo || p.id || "";
    const nombre = p.nombre || "";
    const detalle = esInsumo ? (p.unidad || "Unidad") : (p.marca || "");
    const precio = esInsumo ? (p.costo || 0) : (p.precio || 0);
    return `<div class="card-producto-pos"><div class="card-top-pos"><span class="card-sku-pos">${sku}</span><span class="stock-badge-pos ${p.stock > 0 ? 'stock-ok-pos' : 'stock-no-pos'}">${p.stock > 0 ? `Stock: ${p.stock}` : "Sin stock"}</span></div><div class="card-nombre-pos">${nombre}</div><div class="card-marca-pos">${detalle}</div><div class="card-precio-pos">${money(precio)}</div><button class="btn-seleccionar-pos" type="button" onclick="seleccionarProductoPP(${p.id})"><i class="ti ti-circle-plus"></i> Seleccionar</button></div>`;
  }).join("");
}

function renderizarPaginacionPOS(total) {
  const totalPags = Math.ceil(total / POS_POR_PAGINA) || 1;
  const desde = (posPagina - 1) * POS_POR_PAGINA;
  const info = document.getElementById("pag-info-productos");
  if (info) {
    const tipo = window.modoSeleccion === 'insumos' ? 'insumos' : 'productos';
    info.textContent = `Mostrando ${desde + 1}–${Math.min(desde + POS_POR_PAGINA, total)} de ${total} ${tipo}`;
  }
  let html = `<button class="pag-btn-pos" onclick="irPaginaPOS(${posPagina - 1})" ${posPagina === 1 ? "disabled" : ""}><i class="ti ti-chevron-left"></i></button>`;
  for (let i = 1; i <= totalPags; i++) {
    if (totalPags <= 5 || i === 1 || i === totalPags || Math.abs(i - posPagina) <= 1) {
      html += `<button class="pag-btn-pos ${i === posPagina ? "activo" : ""}" onclick="irPaginaPOS(${i})">${i}</button>`;
    } else if (Math.abs(i - posPagina) === 2) {
      html += `<span style="font-size:12px;color:#bbb;padding:0 2px">…</span>`;
    }
  }
  html += `<button class="pag-btn-pos" onclick="irPaginaPOS(${posPagina + 1})" ${posPagina === totalPags ? "disabled" : ""}><i class="ti ti-chevron-right"></i></button>`;
  const btns = document.getElementById("pag-btns-productos");
  if (btns) btns.innerHTML = html;
}

function irPaginaPOS(n) {
  const totalPags = Math.ceil(posFiltrados.length / POS_POR_PAGINA) || 1;
  if (n < 1 || n > totalPags) return;
  posPagina = n;
  aplicarPaginaPOS();
}
window.irPaginaPOS = irPaginaPOS;

function agregarItemPedido() { agregarProductoAlPedido(); }
function renderItemsPedido() { renderPP_Items(); }
function actualizarTotalesPedido() { calcularTotalesPP(); }

function renderProductosPedidoModal(lista) {
  const cont = document.getElementById("tablaSelProductos");
  if (!cont) return;
  cont.innerHTML = "";
  if (!Array.isArray(lista) || lista.length === 0) { cont.innerHTML = `<div style="grid-column:1/-1;text-align:center;padding:40px;color:#64748b;">No hay productos disponibles.</div>`; return; }
  lista.forEach(p => {
    const nombreProducto = p.nombre_producto || p.producto_nombre || p.producto || p.descripcion || p.nombre || "-";
    const stock = Number(p.stock ?? 0);
    cont.innerHTML += `<div class="card-producto-pos"><div class="card-top-pos"><span class="card-sku-pos">${escapeHtml(p.codigo || p.id || "-")}</span><span class="stock-badge-pos ${stock > 0 ? "stock-ok-pos" : "stock-no-pos"}">${stock > 0 ? `Stock: ${stock}` : "Sin stock"}</span></div><div class="card-nombre-pos">${escapeHtml(nombreProducto)}</div><div class="card-marca-pos">${escapeHtml(p.marca || "-")}</div><div class="card-precio-pos">Gs. ${money(p.costo || 0)}</div><button class="btn-seleccionar-pos" onclick="seleccionarProductoPP(${Number(p.id)})"><i class="ti ti-circle-check"></i>Seleccionar</button></div>`;
  });
}

function renderPP_Items() {
  const tbody = document.getElementById("pp_items");
  if (!tbody) return;
  const items = Array.isArray(window.pp_items) ? window.pp_items : (window.pp_items = []);
  tbody.innerHTML = "";
  if (!items.length) { tbody.innerHTML = `<tr><td colspan="5" style="text-align:center;padding:12px;color:#64748b;">No hay productos agregados al pedido.</td></tr>`; calcularTotalesPP(); return; }
  items.forEach((it, i) => {
    tbody.innerHTML += `<tr><td>${escapeHtml(it.nombre || it.producto_nombre || "-")}</td><td><input type="number" min="1" step="any" value="${Number(it.cantidad || 0)}" onchange="editarPP_Campo(${i}, 'cantidad', this.value)" class="pp-cell"></td><td><input type="text" value="${money(it.costo || 0)}" onchange="editarPP_Campo(${i}, 'costo', this.value)" class="pp-cell"></td><td>${fmtPYG(it.subtotal || 0)}</td><td><button class="pp-del" onclick="eliminarPP_Item(${i})"><i class="fa fa-trash"></i></button></td></tr>`;
  });
  calcularTotalesPP();
}

function filtrarProductosModalPP() {
  const q = (document.getElementById("buscarProductoPedido")?.value || "").toLowerCase().trim();
  let lista;
  if (window.modoSeleccion === "insumos") { lista = window.listaInsumosPOS || []; } else { lista = window.listaProductosPOS || []; }
  posFiltrados = lista.filter(p => p.nombre.toLowerCase().includes(q) || (p.marca || "").toLowerCase().includes(q) || (p.codigo || "").toString().includes(q));
  posPagina = 1;
  aplicarPaginaPOS();
}
window.filtrarProductosModalPP = filtrarProductosModalPP;

function formatearMilesVal(n) { return Number(n).toLocaleString("es-PY"); }

function cargarSelectProductosPedido(lista) {
  const sel = document.getElementById("selectProductoPedido");
  if (!sel) return;
  sel.innerHTML = `<option value="">Seleccionar producto...</option>`;
  (lista || []).forEach(p => { sel.innerHTML += `<option value="${Number(p.id)}">${escapeHtml(p.nombre || "-")} — ${escapeHtml(p.marca || "")} (${escapeHtml(p.codigo || "Sin código")})</option>`; });
}

function editarProductoPP(id) {
  const p = (PROD_CACHE || []).find(x => Number(x.id) === Number(id));
  if (!p) return;
  window.PP_PRODUCTO_ACTUAL = p;
  const set = (id, val) => { const el = document.getElementById(id); if (el) el.value = val ?? ""; };
  set("pp_edit_nombre", p.nombre || "");
  set("pp_edit_cantidad", 1);
  set("pp_edit_unidad", "unidad");
  set("pp_edit_costo", Number(p.costo || 0));
  const lista = document.getElementById("modalPP_lista");
  const editar = document.getElementById("modalPP_editar");
  if (lista) lista.style.display = "none";
  if (editar) editar.style.display = "block";
}

function cancelarEditProductoPP() {
  const editar = document.getElementById("modalPP_editar");
  const lista = document.getElementById("modalPP_lista");
  if (editar) editar.style.display = "none";
  if (lista) lista.style.display = "block";
}

function guardarProductoAListaPP() {
  const p = window.PP_PRODUCTO_ACTUAL;
  if (!p) return alert("No hay producto seleccionado");
  if (!Array.isArray(window.pp_items)) window.pp_items = [];
  const cantidadInput = document.getElementById("pp_edit_cantidad");
  const cantidad = parseFloat(cantidadInput?.value) || 0;
  if (cantidad <= 0) return alert("Cantidad debe ser mayor a 0");
  let unidad;
  const esInsumo = p.esInsumo || false;
  if (esInsumo) {
    const unidadSelect = document.getElementById("pp_edit_unidad_select");
    unidad = unidadSelect ? unidadSelect.value : "Kg";
  } else {
    const unidadInput = document.getElementById("pp_edit_unidad");
    unidad = unidadInput ? unidadInput.value.trim() : "unidad";
    if (!unidad) unidad = "unidad";
  }
  const costoTxt = document.getElementById("pp_edit_costo")?.value || "0";
  const costo = parseFloat(costoTxt.replace(/\./g, "").replace(/\D/g, "")) || 0;
  if (costo <= 0) return alert("Costo debe ser mayor a 0");
  const unidadBase = unidadBaseDe(unidad);
  const factor = obtenerFactorConversion(unidad, unidadBase);
  const cantidadBase = cantidad * factor;
  const subtotal = cantidadBase * costo;
  const item = {
    id: Number(p.id),
    producto_id: Number(p.id),
    nombre: p.nombre || "",
    producto_nombre: p.nombre || "",
    categoria_nombre: p.categoria || (esInsumo ? "Insumo" : "Sin categoría"),
    cantidad: cantidad,
    unidad: unidad,
    cantidad_base: cantidadBase,
    unidad_base: unidadBase,
    costo: costo,
    subtotal: subtotal,
    total: subtotal,
    esInsumo: esInsumo
  };
  const idx = window.pp_items.findIndex(x => Number(x.producto_id || x.id) === Number(item.producto_id) && x.esInsumo === item.esInsumo);
  if (idx >= 0) window.pp_items[idx] = item; else window.pp_items.push(item);
  renderPP_Items();
  closeModal("modalEditarPP");
}
window.guardarProductoAListaPP = guardarProductoAListaPP;

function formatearMilesPY(input) {
  let valor = String(input.value || "").replace(/\./g, "").replace(/\D/g, "");
  if (!valor) { input.value = ""; return; }
  input.value = Number(valor).toLocaleString("es-PY");
}

function cargarSelectModalPP() {
  const sel = document.getElementById("pp_select_producto");
  if (!sel) return;
  sel.innerHTML = `<option value="">Seleccione un producto...</option>` + (PROD_CACHE || []).map(p => `<option value="${Number(p.id)}">${escapeHtml(p.nombre || "-")} — ${escapeHtml(p.marca || "")} (${escapeHtml(p.codigo || "-")})</option>`).join("");
}

function onSelectProductoPP() {
  const id = document.getElementById("pp_select_producto")?.value;
  if (!id) { const editar = document.getElementById("modalPP_editar"); if (editar) editar.style.display = "none"; return; }
  const p = (PROD_CACHE || []).find(x => Number(x.id) === Number(id));
  if (!p) return;
  window.PP_PRODUCTO_ACTUAL = p;
  const set = (id, val) => { const el = document.getElementById(id); if (el) el.value = val ?? ""; };
  set("pp_edit_nombre", p.nombre || "");
  set("pp_edit_cantidad", 1);
  set("pp_edit_unidad", "unidad");
  set("pp_edit_costo", Number(p.costo || 0));
  const editar = document.getElementById("modalPP_editar");
  if (editar) editar.style.display = "block";
}

async function cargarLogoBase64(path) {
  const img = await fetch(path, { credentials: "include", cache: "no-store" });
  const blob = await img.blob();
  return new Promise(resolve => { const reader = new FileReader(); reader.onloadend = () => resolve(reader.result); reader.readAsDataURL(blob); });
}

async function cargarDashboardKpis() {
  try {
    const ventas = await jget("/ventas");
    const hoyYMD = hoyLocal();
    const mesYMD = hoyYMD.slice(0, 7);
    const ventasHoy = ventas.filter(v => toYMD(v.fecha || v.created_at) === hoyYMD);
    const totalHoy = ventasHoy.reduce((a, v) => a + Number(v.total_pyg ?? v.total ?? 0), 0);
    const ventasMes = ventas.filter(v => { const ymd = toYMD(v.fecha || v.created_at); return ymd && ymd.slice(0, 7) === mesYMD; });
    const totalMes = ventasMes.reduce((a, v) => a + Number(v.total_pyg ?? v.total ?? 0), 0);
    const elHoy = qs("#dash-ventas-hoy");
    const elMes = qs("#dash-ventas-mes");
    if (elHoy) elHoy.textContent = "Gs. " + money(totalHoy);
    if (elMes) elMes.textContent = "Gs. " + money(totalMes);
  } catch (err) { console.error("Error cargando KPIs dashboard:", err); }
}

async function cargarVentasComparadas() {
  try {
    const ventas = await jget("/ventas");
    const hoyYMD = hoyLocal(); // "2026-08-22" (zona Paraguay)
    // Construir fecha a mediodía para evitar cambios de zona horaria
    const hoyDate = new Date(hoyYMD + 'T12:00:00');
    const ayerDate = new Date(hoyDate);
    ayerDate.setDate(ayerDate.getDate() - 1);
    const ayerYMD = toYMD(ayerDate);

    let totalHoy = 0, totalAyer = 0;
    ventas.forEach(v => {
      const fecha = toYMD(v.fecha || v.created_at);
      const total = Number(v.total_pyg ?? v.total ?? 0);
      if (fecha === hoyYMD) totalHoy += total;
      if (fecha === ayerYMD) totalAyer += total;
    });
    actualizarGraficoDashboard(totalAyer, totalHoy);
  } catch (err) {
    console.error("Error cargando ventas comparadas:", err);
    actualizarGraficoDashboard(0, 0);
  }
}

async function filtrarVentasPorRango() {
  const desde = document.getElementById("filtro-desde")?.value;
  const hasta = document.getElementById("filtro-hasta")?.value;
  const resultado = document.getElementById("resultado-filtro");
  if (!desde || !hasta) return;
  try {
    const ventas = await jget("/ventas");
    const filtradas = ventas.filter(v => { const fecha = toYMD(v.fecha || v.created_at); return fecha >= desde && fecha <= hasta; });
    const total = filtradas.reduce((a, v) => a + Number(v.total_pyg ?? v.total ?? 0), 0);
    if (resultado) resultado.textContent = `Gs. ${money(total)}`;
  } catch (err) { console.error("Error filtrando ventas:", err); }
}

async function cargarFormasPago() {
  try {
    const formas = await jget("/formas-pago");
    const select = document.getElementById("formaPagoSelect");
    if (!select) return;
    select.innerHTML = (formas || []).map(f => `<option value="${Number(f.id)}">${escapeHtml(f.nombre || "")}</option>`).join("");
  } catch (err) { console.error("Error cargando formas de pago:", err); }
}

/* ================== EXPORTS GLOBALES ================== */
window.exportClientesCSV = () => exportTableCSV("#tabla-clientes table", "clientes.csv");
window.exportProductosCSV = () => exportTableCSV("#tabla-productos table", "productos.csv");
window.exportProveedoresCSV = () => exportTableCSV("#tabla-proveedores table", "proveedores.csv");
window.exportComprasCSV = () => exportTableCSV("#tabla-compras table", "compras.csv");
window.exportarPDF_Listado = exportarPDF_Listado;
window.exportarPDF_Pedido = exportarPDF_Pedido;

/* ================== NAVEGACIÓN ================== */
window.addEventListener("hashchange", () => {
  show(location.hash || "#accesos");
  if (location.hash === "#compras" && typeof cargarComprasLista === "function") cargarComprasLista();
});

window.addEventListener("load", async () => {
  try { await initPDF(); } catch (e) { console.warn("No cargó logos:", e); }
  show(location.hash || "#accesos");
  if (location.hash === "#compras") { if (typeof cargarComprasLista === "function") cargarComprasLista(); if (typeof verificarCaja === "function") verificarCaja(); }
});

function toggleSidebar() {
  const sidebar = document.querySelector(".sidebar");
  if (!sidebar) { alert("No se encontró .sidebar"); return; }
  sidebar.classList.toggle("open");
  sidebar.style.transform = sidebar.classList.contains("open") ? "translateX(0)" : "translateX(-110%)";
}

function toggleMenu() {
  const sidebar = document.querySelector(".sidebar");
  if (sidebar) sidebar.classList.toggle("open");
}

document.querySelectorAll(".sidebar a[data-link]").forEach(a => {
  a.addEventListener("click", () => {
    if (window.innerWidth <= 950) {
      document.querySelector(".sidebar")?.classList.remove("open");
      document.body.classList.remove("sidebar-open");
    }
  });
});

/* ================== CAJA ================== */
async function abrirCaja(tipoParam) {
  try {
    const tipo = (tipoParam || "efectivo").toLowerCase().trim();
    const fechaEl = document.getElementById(tipo === "efectivo" ? "fechaCajaEfectivo" : "fechaCajaTransferencia");
    const fecha = (fechaEl?.value || "").trim();
    const saldoGs = Number((document.getElementById(tipo === "efectivo" ? "saldoGs" : "saldoGsTransferencia")?.value || "0").replace(/\D/g, "")) || 0;
    const saldoUs = parseFloat((document.getElementById(tipo === "efectivo" ? "saldoUs" : "saldoUsTransferencia")?.value || "0").replace(",", ".")) || 0;
    const saldoRs = parseFloat((document.getElementById(tipo === "efectivo" ? "saldoRs" : "saldoRsTransferencia")?.value || "0").replace(",", ".")) || 0;
    if (!fecha) { alert("Seleccione una fecha"); return; }
    const data = await jpost("/caja/abrir", { tipo, fecha, saldo_gs: saldoGs, saldo_us: saldoUs, saldo_rs: saldoRs });
    const id = data?.caja?.id ?? data?.data?.caja?.id ?? data?.id ?? data?.caja_id ?? data?.cajaId ?? null;
    window.cajasActuales = window.cajasActuales || { efectivo: null, transferencia: null };
    if (id) { window.cajasActuales[tipo] = data.caja || { id, tipo, fecha, saldo_gs: saldoGs, saldo_us: saldoUs, saldo_rs: saldoRs }; } else {
      if (typeof verificarCaja === "function") await verificarCaja();
      if (window.cajaActual?.id) window.cajasActuales[tipo] = window.cajaActual;
      if (!window.cajasActuales[tipo]?.id) { alert("La caja se abrió, pero no se pudo obtener el ID."); console.error("Respuesta /caja/abrir:", data); return; }
    }
    window.cajaActual = window.cajasActuales[tipo];
    const estadoEl = document.getElementById(tipo === "efectivo" ? "estadoCajaEfectivo" : "estadoCajaTransferencia");
    if (estadoEl) {
      const label = tipo === "efectivo" ? "Efectivo" : "Transferencia";
      estadoEl.innerHTML = `Caja ABIERTA (${label})<br>Saldo GS: ${saldoGs.toLocaleString("es-PY")}<br>Saldo US: ${saldoUs.toLocaleString("es-PY", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}<br>Saldo RS: ${saldoRs.toLocaleString("es-PY", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
    }
    toast(`Caja ${tipo === "efectivo" ? "Efectivo" : "Transferencia"} abierta`, "success");
    if (typeof cargarRecaudacionFecha === "function") cargarRecaudacionFecha();
    if (typeof verificarCaja === "function") await verificarCaja();
  } catch (err) { console.error("abrirCaja:", err); alert("Error al abrir caja."); }
}

function formatearNumeroMoneda(valor, decimales = 2) {
  return Number(valor || 0).toLocaleString("es-PY", { minimumFractionDigits: decimales, maximumFractionDigits: decimales });
}

function obtenerSaldoCaja(caja, campoNuevo, campoViejo = null) {
  if (!caja) return 0;
  if (caja[campoNuevo] != null) return Number(caja[campoNuevo] || 0);
  if (campoViejo && caja[campoViejo] != null) return Number(caja[campoViejo] || 0);
  return 0;
}

function pintarEstadoCaja(idElemento, label, caja, saldoNetoGs) {
  const el = document.getElementById(idElemento);
  if (!el) return;
  if (!caja?.id) { el.innerHTML = "Caja CERRADA"; return; }
  const saldoGs = saldoNetoGs != null ? Number(saldoNetoGs) : Number(caja.saldo_actual_gs ?? caja.saldo_gs ?? caja.saldo_inicial ?? 0);
  const CAMBIO_USD = 6350, CAMBIO_BRL = 1255;
  const saldoUs = saldoGs / CAMBIO_USD;
  const saldoRs = saldoGs / CAMBIO_BRL;
  el.innerHTML = `Caja ABIERTA (${label})<br>Saldo GS: ${Number(saldoGs).toLocaleString("es-PY")}<br>Saldo US: ${formatearNumeroMoneda(saldoUs)}<br>Saldo RS: ${formatearNumeroMoneda(saldoRs)}`;
}

// 🔥 NUEVA FUNCIÓN CERRAR CAJA (REESCRITA)
async function cerrarCaja(tipoParam) {
  try {
    const tipo = (tipoParam || "efectivo").toLowerCase().trim();

    // 1. Obtener el estado real de la caja desde el servidor (sin depender de fecha)
    const estado = await jget(`/caja/abierta?tipo=${tipo}`);
    if (!estado.abierta || !estado.caja?.id) {
      alert(`No hay caja abierta de tipo "${tipo}".`);
      return;
    }

    const id = estado.caja.id;

    // 2. Cerrar usando el endpoint con ID (más fiable)
    const data = await jpost(`/caja/cerrar/${id}`, {});
    if (!data?.ok) {
      throw new Error(data?.msg || "Error al cerrar la caja");
    }

    // 3. Limpiar variables locales
    window.cajasActuales = window.cajasActuales || {};
    window.cajasActuales[tipo] = null;
    if (window.cajaActual?.id === id) window.cajaActual = null;

    // 4. Actualizar UI
    const estadoEl = document.getElementById(
      tipo === "efectivo" ? "estadoCajaEfectivo" : "estadoCajaTransferencia"
    );
    if (estadoEl) estadoEl.innerHTML = "Caja CERRADA";

    toast(`Caja ${tipo === "efectivo" ? "Efectivo" : "Transferencia"} cerrada`, "success");

    // 5. Refrescar resúmenes
    if (typeof cargarRecaudacionFecha === "function") await cargarRecaudacionFecha();
    if (typeof verificarCaja === "function") await verificarCaja();

  } catch (err) {
    console.error("cerrarCaja:", err);
    alert("Error al cerrar caja: " + err.message);
  }
}

document.addEventListener("DOMContentLoaded", () => {
  if (typeof cargarRecaudacionFecha === "function") cargarRecaudacionFecha();
  const f = document.getElementById("fechaCaja");
  if (f) f.addEventListener("change", cargarRecaudacionFecha);
  if (typeof verificarCaja === "function") verificarCaja();
});

function detectarFormaPago(v) {
  const fp = (v.forma_pago || v.metodo || "").toString().toLowerCase();
  if (fp.includes("efect")) return "efectivo";
  if (fp.includes("transf")) return "transferencia";
  if (Number(v.forma_pago_id) === 2) return "efectivo";
  if (Number(v.forma_pago_id) === 3) return "transferencia";
  return "otro";
}

function toYMD(x) {
  if (!x) return "";
  if (x instanceof Date) { return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, "0")}-${String(x.getDate()).padStart(2, "0")}`; }
  const s = String(x).trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  const m = s.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (m) return `${m[3]}-${m[2]}-${m[1]}`;
  const d = new Date(s);
  if (!isNaN(d)) { return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; }
  return "";
}

function sameDay(dateStr, ymd) {
  return toYMD(dateStr) === toYMD(ymd);
}

function sameMonth(dateStr, yyyy_mm) {
  const ymd = toYMD(dateStr);
  return ymd && ymd.slice(0, 7) === String(yyyy_mm).slice(0, 7);
}

async function cargarRecaudacionFecha() {
  try {
    const fecha = (document.getElementById("fechaCajaEfectivo")?.value || "").trim() ||
                  (document.getElementById("fechaCajaTransferencia")?.value || "").trim() ||
                  hoyLocal();
    const dia = await jget(`/caja/resumen-dia?fecha=${encodeURIComponent(fecha)}`);
    const mes = await jget(`/caja/resumen-mes?fecha=${encodeURIComponent(fecha)}`);
    const setText = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = "Gs. " + money(Number(val || 0)); };
    setText("dia-ingreso-efectivo", dia.ingreso_efectivo);
    setText("dia-egreso-efectivo", dia.egreso_efectivo);
    setText("dia-efectivo", dia.saldo_efectivo);
    setText("dia-ingreso-transferencia", dia.ingreso_transferencia);
    setText("dia-egreso-transferencia", dia.egreso_transferencia);
    setText("dia-transferencia", dia.saldo_transferencia);
    setText("dia-total", dia.saldo_total);
    setText("mes-ingreso-efectivo", mes.ingreso_efectivo);
    setText("mes-egreso-efectivo", mes.egreso_efectivo);
    setText("mes-efectivo", mes.saldo_efectivo);
    setText("mes-ingreso-transferencia", mes.ingreso_transferencia);
    setText("mes-egreso-transferencia", mes.egreso_transferencia);
    setText("mes-transferencia", mes.saldo_transferencia);
    setText("mes-total", mes.saldo_total);
    console.log("RESUMEN DIA:", dia);
    console.log("RESUMEN MES:", mes);
  } catch (e) { console.error("Error recaudación:", e); }
}

async function cargarFormasPagoResumen() {
  try {
    const ventas = await jget("/ventas");
    const hoy = hoyLocal();
    const mes = hoy.slice(0, 7);
    let diaE = 0, diaT = 0, mesE = 0, mesT = 0;
    ventas.forEach(v => {
      const fecha = toYMD(v.fecha || v.created_at);
      const total = Number(v.total_pyg ?? v.total ?? 0);
      const metodo = (v.forma_pago || v.forma_pago_nombre || v.metodo || "").toLowerCase();
      const esEfectivo = metodo.includes("efect") || Number(v.forma_pago_id) === 2;
      const esTransfer = metodo.includes("transf") || Number(v.forma_pago_id) === 3;
      if (fecha === hoy) { if (esEfectivo) diaE += total; if (esTransfer) diaT += total; }
      if (fecha.slice(0, 7) === mes) { if (esEfectivo) mesE += total; if (esTransfer) mesT += total; }
    });
    const setText = (id, val) => { const el = qs("#" + id); if (el) el.textContent = "Gs. " + money(val); };
    setText("fp-dia-efectivo", diaE);
    setText("fp-dia-transferencia", diaT);
    setText("fp-dia-total", diaE + diaT);
    setText("fp-mes-efectivo", mesE);
    setText("fp-mes-transferencia", mesT);
    setText("fp-mes-total", mesE + mesT);
  } catch (e) { console.error("Error formas de pago:", e); }
}

function _setHTML(id, html) { const el = document.getElementById(id); if (el) el.innerHTML = html; }
function _getVal(id) { const el = document.getElementById(id); return el ? String(el.value || "").trim() : ""; }

async function verificarCaja() {
  try {
    console.log("verificarCaja ejecutándose");
    const fecha = document.getElementById("fechaCajaEfectivo")?.value || document.getElementById("fechaCajaTransferencia")?.value || hoyLocal();
    console.log("fecha:", fecha);
    const [eData, tData, diaResumen] = await Promise.all([
      jget(`/caja/abierta?tipo=efectivo&fecha=${encodeURIComponent(fecha)}`),
      jget(`/caja/abierta?tipo=transferencia&fecha=${encodeURIComponent(fecha)}`),
      jget(`/caja/resumen-dia?fecha=${encodeURIComponent(fecha)}`).catch(() => null)
    ]);
    const cajaE = eData?.caja || null;
    const cajaT = tData?.caja || null;
    window.cajasActuales = { efectivo: cajaE, transferencia: cajaT };
    window.cajaActual = cajaE?.id ? cajaE : (cajaT?.id ? cajaT : null);
    if (typeof pintarEstadoCaja === "function") {
      pintarEstadoCaja("estadoCajaEfectivo", "Efectivo", cajaE, diaResumen?.saldo_efectivo);
      pintarEstadoCaja("estadoCajaTransferencia", "Transferencia", cajaT, diaResumen?.saldo_transferencia);
    } else { console.error("❌ pintarEstadoCaja no existe"); }
    const estadoCajaViejo = document.getElementById("estadoCaja");
    if (estadoCajaViejo) {
      const totalGs = Number(diaResumen?.saldo_total ?? 0);
      const totalUs = totalGs / 6350;
      const totalRs = totalGs / 1255;
      estadoCajaViejo.innerHTML = `Saldo total del día<br>GS: ${Number(totalGs).toLocaleString("es-PY")}<br>US: ${formatearNumeroMoneda(totalUs)}<br>RS: ${formatearNumeroMoneda(totalRs)}`;
    }
    console.log("verificarCaja OK");
  } catch (e) { console.error("Error verificando caja:", e); }
}

(function bindCajaEventos() {
  const bind = (el) => {
    if (!el) return;
    if (el.dataset.bound === "1") return;
    el.dataset.bound = "1";
    el.addEventListener("change", async () => {
      await cargarRecaudacionFecha();
      await verificarCaja();
      if (location.hash === "#formas-pago" && typeof listarFP === "function") listarFP();
    });
  };
  bind(document.getElementById("fechaCajaEfectivo"));
  bind(document.getElementById("fechaCajaTransferencia"));
  bind(document.getElementById("fechaCaja"));
  verificarCaja();
})();

/* ================== LOGOUT ================== */
function closeAllModals() {
  document.querySelectorAll(".modal").forEach(m => { m.style.display = "none"; m.classList.remove("show"); });
  document.body.classList.remove("modal-open");
}

function logout(e) {
  if (e && e.preventDefault) e.preventDefault();
  if (e && e.stopPropagation) e.stopPropagation();
  closeAllModals();
  const modal = document.getElementById("logoutModal");
  if (!modal) { console.error("No existe #logoutModal en el HTML"); return alert("No existe el modal #logoutModal"); }
  modal.style.display = "flex";
  modal.classList.add("show");
}

function closeLogoutModal() {
  const modal = document.getElementById("logoutModal");
  if (modal) { modal.classList.remove("show"); modal.style.display = "none"; }
}

/* ================== CUENTAS A PAGAR ================== */
async function cargarCuentasPagar(page = cuentasPagarPagina) {
  try {
    const url = `/cuentas-pagar?page=${page}&limit=${cuentasPagarPorPagina}`;
    const resp = await jget(url);
    cuentasPagar = resp.data || [];
    cuentasPagarTotal = resp.total || 0;
    cuentasPagarTotalPages = resp.totalPages || 0;
    cuentasPagarPagina = resp.page || 1;
    cuentasPagarFiltradas = [...cuentasPagar];
    renderCuentasPagar(cuentasPagarFiltradas);
  } catch (err) {
    console.error("Error cargando cuentas a pagar:", err);
    alert("No se pudieron cargar las cuentas a pagar.");
  }
}

function renderCuentasPagar(lista = cuentasPagar) {
  const tbody = document.getElementById("tabla-cuentas-pagar");
  if (!tbody) return;
  const data = Array.isArray(lista) ? lista : [];
  if (!data.length) {
    tbody.innerHTML = `<tr><td colspan="7" style="text-align:center">No hay cuentas a pagar para esta empresa.</td></tr>`;
    renderPaginacionCuentasPagar(); 
    return;
  }
  const nfDecimal = (n) => Number(n || 0).toLocaleString("es-PY", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const renderMontoCuenta = (item) => {
    const moneda = String(item.moneda || "PYG").toUpperCase();
    const montoPyg = Number(item.monto_pyg ?? item.monto ?? 0);
    const montoMoneda = Number(item.monto_moneda || 0);
    if (moneda === "USD") return `<div style="font-weight:700;">US$ ${nfDecimal(montoMoneda)}</div><div style="font-size:.82rem; color:#6b7280;">Gs. ${money(montoPyg)}</div>`;
    if (moneda === "BRL") return `<div style="font-weight:700;">R$ ${nfDecimal(montoMoneda)}</div><div style="font-size:.82rem; color:#6b7280;">Gs. ${money(montoPyg)}</div>`;
    return `<div style="font-weight:700;">Gs. ${money(montoPyg)}</div>`;
  };
  tbody.innerHTML = data.map(item => {
    const estado = String(item.estado || "pendiente").toLowerCase();
    const fechaPago = item.fecha_pago ? toYMD(item.fecha_pago) : "-";
    const tipoCaja = item.caja_tipo || item.tipo_caja || item.caja || "-";
    return `<tr><td>${Number(item.id)}</td><td>${escapeHtml(item.proveedor || "")}</td><td>${escapeHtml(item.concepto || "")}</td><td>${renderMontoCuenta(item)}</td><td>${item.vencimiento ? toYMD(item.vencimiento) : "-"}</td><td>${estado === "pagado" ? '<span class="badge bg-success">Pagado</span>' : '<span class="badge bg-warning text-dark">Pendiente</span>'}</td><td><div class="acciones-tabla">${estado !== "pagado" ? `<button class="btn btn-sm btn-success" onclick="pagarCuentaPagar(${Number(item.id)})">Pagar</button>` : ""}<button class="btn-icon edit" title="Editar" onclick="editarCuentaPagar(${Number(item.id)})"><i class="fa fa-pen"></i></button><button class="btn-icon delete" title="Eliminar" onclick="eliminarCuentaPagar(${Number(item.id)})"><i class="fa fa-trash"></i></button></div>${estado === "pagado" ? `<div style="margin-top:.35rem; font-size:.82rem; color:#6b7280;">Pago: ${escapeHtml(fechaPago)} | Caja: ${escapeHtml(tipoCaja)}</div>` : ""}</td></tr>`;
  }).join("");

  renderPaginacionCuentasPagar(); 
}

function renderPaginacionCuentasPagar() {
  const div = document.getElementById("cuentas-pagar-paginacion");
  if (!div) return;
  div.innerHTML = "";
  if (cuentasPagarTotalPages <= 1) return;

  div.innerHTML += `<button class="pag-btn" onclick="cambiarPaginaCuentasPagar(${cuentasPagarPagina - 1})" ${cuentasPagarPagina === 1 ? "disabled" : ""}>‹</button>`;
  for (let i = 1; i <= cuentasPagarTotalPages; i++) {
    div.innerHTML += `<button class="pag-btn ${i === cuentasPagarPagina ? "active" : ""}" onclick="cambiarPaginaCuentasPagar(${i})">${i}</button>`;
  }
  div.innerHTML += `<button class="pag-btn" onclick="cambiarPaginaCuentasPagar(${cuentasPagarPagina + 1})" ${cuentasPagarPagina === cuentasPagarTotalPages ? "disabled" : ""}>›</button>`;
}

function cambiarPaginaCuentasPagar(nueva) {
  if (nueva < 1 || nueva > cuentasPagarTotalPages) return;
  cuentasPagarPagina = nueva;
  cargarCuentasPagar(nueva);
}
async function pagarCuentaPagar(id) {
  const item = cuentasPagar.find(x => Number(x.id) === Number(id));
  if (!item) return alert("Cuenta no encontrada.");
  if (String(item.estado || "").toLowerCase() === "pagado") { alert("Esta cuenta ya fue pagada."); return; }
  const tipoCaja = prompt("¿Desde qué caja se pagó? Escriba: efectivo o transferencia", "efectivo");
  if (!tipoCaja) return;
  const tipo = tipoCaja.toLowerCase().trim();
  if (tipo !== "efectivo" && tipo !== "transferencia") { alert("Debe escribir exactamente: efectivo o transferencia"); return; }
  const body = {
    proveedor: item.proveedor || "",
    factura: item.factura || "",
    concepto: item.concepto || "",
    moneda: item.moneda || "PYG",
    tipo_cambio: Number(item.tipo_cambio || 1),
    monto_moneda: Number(item.monto_moneda ?? item.monto ?? 0),
    monto_pyg: Number(item.monto_pyg ?? item.monto ?? 0),
    monto: Number(item.monto_pyg ?? item.monto ?? 0),
    vencimiento: item.vencimiento ? toYMD(item.vencimiento) : null,
    estado: "pagado",
    fecha_pago: hoyLocal(),
    caja_tipo: tipo
  };
  try {
    await jput("/cuentas-pagar/" + id, body);
    await cargarCuentasPagar();
    if (typeof cargarRecaudacionFecha === "function") await cargarRecaudacionFecha();
    if (typeof verificarCaja === "function") await verificarCaja();
    toast(`Cuenta pagada desde caja ${tipo}`, "success");
  } catch (err) { console.error("Error pagando cuenta:", err); alert("No se pudo marcar la cuenta como pagada."); }
}

async function guardarCuentaPagar() {
  const id = Number(document.getElementById("cp_id")?.value || 0);
  const proveedor = document.getElementById("cp_proveedor")?.value.trim();
  const factura = document.getElementById("cp_factura")?.value.trim() || "";
  const concepto = document.getElementById("cp_concepto")?.value.trim();
  const moneda = String(document.getElementById("cp_moneda")?.value || "PYG").toUpperCase();
  const tipoCambio = Number(document.getElementById("cp_tipo_cambio")?.value || 1);
  const montoGsTexto = document.getElementById("cp_monto_gs")?.value.trim() || "0";
  const vencimiento = document.getElementById("cp_vencimiento")?.value || null;
  const estado = document.getElementById("cp_estado")?.value || "pendiente";
  const montoPyg = Number(String(montoGsTexto).replace(/\./g, "").replace(/,/g, "")) || 0;
  if (!proveedor || !concepto || !montoPyg) return alert("Complete proveedor, concepto y monto.");
  if (moneda !== "PYG" && (!tipoCambio || tipoCambio <= 0)) return alert("Ingrese un tipo de cambio válido.");
  const montoMoneda = moneda === "PYG" ? montoPyg : montoPyg / tipoCambio;
  const body = { proveedor, factura, concepto, moneda, tipo_cambio: tipoCambio, monto: montoPyg, monto_pyg: montoPyg, monto_moneda: montoMoneda, vencimiento, estado, fecha_pago: estado === "pagado" ? hoyLocal() : null, caja_tipo: estado === "pagado" ? "efectivo" : null };
  try {
    if (id) await jput("/cuentas-pagar/" + id, body); else await jpost("/cuentas-pagar", body);
    closeModal("modalCuentaPagar");
    ["cp_id","cp_proveedor","cp_factura","cp_concepto","cp_monto_gs","cp_vencimiento"].forEach(id => { const el = document.getElementById(id); if (el) el.value = ""; });
    if (document.getElementById("cp_moneda")) document.getElementById("cp_moneda").value = "PYG";
    if (document.getElementById("cp_tipo_cambio")) document.getElementById("cp_tipo_cambio").value = 1;
    if (document.getElementById("cp_estado")) document.getElementById("cp_estado").value = "pendiente";
    if (typeof toggleMonedaCuentaPagar === "function") await toggleMonedaCuentaPagar();
    await cargarCuentasPagar();
    toast("Cuenta guardada correctamente", "success");
  } catch (err) { console.error("Error guardando cuenta:", err); alert("No se pudo guardar la cuenta a pagar:\n" + err.message); }
}

function filtrarCuentasPagar(texto) {
  const t = String(texto || "").toLowerCase().trim();
  cuentasPagarFiltradas = cuentasPagar.filter(item =>
    String(item.proveedor || "").toLowerCase().includes(t) ||
    String(item.concepto || "").toLowerCase().includes(t) ||
    String(item.estado || "").toLowerCase().includes(t) ||
    String(item.factura || "").toLowerCase().includes(t)
  );
  cuentasPagarPagina = 1;
  renderCuentasPagar(cuentasPagarFiltradas);
}

async function confirmarEliminarCuentaPagar() {
  if (cuentaPagarAEliminar == null) return;
  try {
    await jdel("/cuentas-pagar/" + cuentaPagarAEliminar);
    cuentaPagarAEliminar = null;
    closeModal("modalEliminarCuentaPagar");
    await cargarCuentasPagar();
    toast("Cuenta eliminada correctamente", "success");
  } catch (err) { console.error("Error eliminando cuenta:", err); alert("No se pudo eliminar la cuenta."); }
}

async function toggleMonedaCuentaPagar() {
  const moneda = String(document.getElementById("cp_moneda")?.value || "PYG").toUpperCase();
  const input = document.getElementById("cp_tipo_cambio");
  const wrap = document.getElementById("wrap_cp_tipo_cambio");
  if (!input || !wrap) return;
  let tipoCambio = 1;
  if (moneda === "PYG") { wrap.style.display = "none"; tipoCambio = 1; } else {
    wrap.style.display = "block";
    try {
      const data = await jget("/config/monedas?ts=" + Date.now());
      const monedas = Array.isArray(data) ? data : Array.isArray(data.monedas) ? data.monedas : [];
      const encontrada = monedas.find(m => String(m.moneda || m.codigo || "").toUpperCase() === moneda);
      tipoCambio = Number(encontrada?.tipo_cambio || encontrada?.valor || encontrada?.cambio || 1);
    } catch (e) { console.error("Error cargando tipo de cambio:", e); }
  }
  input.value = tipoCambio;
  input.disabled = false;
  input.readOnly = true;
  input.tabIndex = -1;
  input.style.background = "#f1f5f9";
  input.style.cursor = "not-allowed";
  input.style.color = "#475569";
  input.style.opacity = "1";
  if (typeof actualizarResumenCuentaPagar === "function") actualizarResumenCuentaPagar();
}

document.addEventListener("change", (e) => {
  if (e.target.id === "cp_moneda") { toggleMonedaCuentaPagar(); }
});

async function descargarInformeCajaPDF() {
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF("p", "mm", "a4");
  const fechaISO = hoyLocal();
  const fechaHora = new Date().toLocaleString("es-PY");
  const usuario = window.USUARIO_ACTUAL?.nombre || window.USUARIO_ACTUAL?.usuario || "Usuario";
  const emp = typeof getEmpresaActualPDF === "function" ? getEmpresaActualPDF() : { nombre: EMPRESA_NOMBRE || "Mi Empresa", logo: EMPRESA_LOGO || "img/logo2.png", color: EMPRESA_COLOR || "#2563eb", direccion: empresa?.direccion || "", ruc: empresa?.ruc || "", telefono: empresa?.telefono || "", email: empresa?.email || "" };
  function fmtGs(n) { return "Gs. " + Number(n || 0).toLocaleString("es-PY"); }
  function onlyDate(v) { return toYMD(v); }
  function sameMonthPDF(fecha, ref) { return String(fecha || "").slice(0, 7) === String(ref || "").slice(0, 7); }
  let compras = [], cuentas = [], ventas = [];
  try {
    const [rCompras, rCuentas, rVentas] = await Promise.all([jget("/compras"), jget("/cuentas-pagar"), jget("/ventas")]);
    compras = Array.isArray(rCompras) ? rCompras : [];
    cuentas = Array.isArray(rCuentas) ? rCuentas : [];
    ventas = Array.isArray(rVentas) ? rVentas : [];
  } catch (e) { console.error("Error cargando datos del PDF:", e); }
  const hoy = fechaISO;
  const ventasDia = ventas.filter(v => onlyDate(v.fecha || v.created_at) === hoy);
  const ventasMes = ventas.filter(v => sameMonthPDF(onlyDate(v.fecha || v.created_at), hoy));
  const comprasDia = compras.filter(c => onlyDate(c.fecha) === hoy);
  const comprasMes = compras.filter(c => sameMonthPDF(onlyDate(c.fecha), hoy));
  const cuentasDia = cuentas.filter(c => { const estado = String(c.estado || "").toLowerCase(); const fechaPago = onlyDate(c.fecha_pago || c.pagado_en || c.fecha || ""); return estado === "pagado" && fechaPago === hoy; });
  const cuentasMes = cuentas.filter(c => { const estado = String(c.estado || "").toLowerCase(); const fechaPago = onlyDate(c.fecha_pago || c.pagado_en || c.fecha || ""); return estado === "pagado" && sameMonthPDF(fechaPago, hoy); });
  const resumenDia = { ventas: ventasDia.reduce((a, b) => a + Number(b.total_pyg ?? b.total ?? 0), 0), compras: comprasDia.reduce((a, b) => a + Number(b.total_pyg ?? b.total ?? 0), 0), cuentas: cuentasDia.reduce((a, b) => a + Number(b.monto_pyg ?? b.monto ?? 0), 0) };
  const resumenMes = { ventas: ventasMes.reduce((a, b) => a + Number(b.total_pyg ?? b.total ?? 0), 0), compras: comprasMes.reduce((a, b) => a + Number(b.total_pyg ?? b.total ?? 0), 0), cuentas: cuentasMes.reduce((a, b) => a + Number(b.monto_pyg ?? b.monto ?? 0), 0) };
  async function cargarImagen(url) { try { return await cargarLogoBase64(url); } catch { return null; } }
  const logo = await cargarImagen(emp.logo || "img/logo2.png");
  function dibujarEncabezado(yBase = 10) {
    if (logo) { try { doc.addImage(logo, imgType(logo), 10, yBase, 30, 22); doc.addImage(logo, imgType(logo), 170, yBase, 28, 22); } catch {} }
    doc.setFont("helvetica", "bold").setFontSize(18).text(emp.nombre || "Mi Empresa", 105, yBase + 10, { align: "center" });
    doc.setFont("helvetica", "normal").setFontSize(9);
    if (emp.ruc) doc.text(`RUC: ${emp.ruc}`, 105, yBase + 17, { align: "center" });
    if (emp.direccion) doc.text(emp.direccion, 105, yBase + 23, { align: "center" });
    const contacto = [emp.telefono ? `Tel: ${emp.telefono}` : "", emp.email || ""].filter(Boolean).join(" | ");
    if (contacto) doc.text(contacto, 105, yBase + 29, { align: "center" });
    doc.setDrawColor(0).line(10, yBase + 38, 200, yBase + 38);
  }
  dibujarEncabezado(8);
  doc.setFontSize(16).text("Informe de Caja", 14, 58);
  doc.setFontSize(10).text(`Fecha de emisión: ${fechaHora}`, 14, 65).text(`Generado por: ${usuario}`, 14, 71);
  doc.autoTable({
    startY: 80,
    head: [["Resumen del Día","Monto"]],
    body: [["Ventas del Día", fmtGs(resumenDia.ventas)], ["Compras del Día", fmtGs(resumenDia.compras)], ["Cuentas Pagadas del Día", fmtGs(resumenDia.cuentas)], ["Saldo del Día", fmtGs(resumenDia.ventas - resumenDia.compras - resumenDia.cuentas)]],
    theme: "grid",
    headStyles: { fillColor: [37, 99, 235] },
    styles: { fontSize: 9 }
  });
  doc.autoTable({
    startY: doc.lastAutoTable.finalY + 8,
    head: [["Resumen del Mes","Monto"]],
    body: [["Ventas del Mes", fmtGs(resumenMes.ventas)], ["Compras del Mes", fmtGs(resumenMes.compras)], ["Cuentas Pagadas del Mes", fmtGs(resumenMes.cuentas)], ["Saldo del Mes", fmtGs(resumenMes.ventas - resumenMes.compras - resumenMes.cuentas)]],
    theme: "grid",
    headStyles: { fillColor: [22, 163, 74] },
    styles: { fontSize: 9 }
  });
  doc.addPage();
  dibujarEncabezado(8);
  doc.setFontSize(14).text("Detalle de Ventas del Día", 14, 58);
  doc.autoTable({
    startY: 63,
    head: [["Fecha","Cliente","Forma de pago","Productos","Total"]],
    body: ventasDia.length ? ventasDia.map(v => [onlyDate(v.fecha || v.created_at), v.cliente_nombre || "Consumidor Final", v.forma_pago_nombre || "-", v.productos || "-", fmtGs(v.total_pyg ?? v.total ?? 0)]) : [["-","Sin ventas registradas","-","-","Gs. 0"]],
    theme: "grid",
    headStyles: { fillColor: [37, 99, 235] },
    styles: { fontSize: 8.5 }
  });
  doc.setFontSize(14).text("Detalle de Compras del Día", 14, doc.lastAutoTable.finalY + 12);
  doc.autoTable({
    startY: doc.lastAutoTable.finalY + 16,
    head: [["Fecha","Proveedor","Factura","Tipo pago","Productos","Total"]],
    body: comprasDia.length ? comprasDia.map(c => [onlyDate(c.fecha), c.proveedor_nombre || "-", c.factura || "-", c.tipo_pago || "-", c.detalle_productos || c.productos || "-", fmtGs(c.total_pyg ?? c.total ?? 0)]) : [["-","Sin compras registradas","-","-","-","Gs. 0"]],
    theme: "grid",
    headStyles: { fillColor: [22, 163, 74] },
    styles: { fontSize: 8.5 }
  });
  doc.setFontSize(14).text("Detalle de Cuentas Pagadas del Día", 14, doc.lastAutoTable.finalY + 12);
  doc.autoTable({
    startY: doc.lastAutoTable.finalY + 16,
    head: [["Pago","Proveedor","Concepto","Vencimiento","Caja","Monto"]],
    body: cuentasDia.length ? cuentasDia.map(c => [onlyDate(c.fecha_pago || c.pagado_en || c.fecha), c.proveedor || "-", c.concepto || "-", onlyDate(c.vencimiento), c.caja_tipo || c.caja || "-", fmtGs(c.monto_pyg ?? c.monto ?? 0)]) : [["-","Sin cuentas pagadas","-","-","-","Gs. 0"]],
    theme: "grid",
    headStyles: { fillColor: [220, 38, 38] },
    styles: { fontSize: 8.5 }
  });
  doc.addPage();
  dibujarEncabezado(8);
  doc.setFontSize(14).text("Detalle de Ventas del Mes", 14, 58);
  doc.autoTable({
    startY: 63,
    head: [["Fecha","Cliente","Forma de pago","Productos","Total"]],
    body: ventasMes.length ? ventasMes.map(v => [onlyDate(v.fecha || v.created_at), v.cliente_nombre || "Consumidor Final", v.forma_pago_nombre || "-", v.productos || "-", fmtGs(v.total_pyg ?? v.total ?? 0)]) : [["-","Sin ventas registradas","-","-","Gs. 0"]],
    theme: "grid",
    headStyles: { fillColor: [37, 99, 235] },
    styles: { fontSize: 8.5 }
  });
  doc.setFontSize(14).text("Detalle de Compras del Mes", 14, doc.lastAutoTable.finalY + 12);
  doc.autoTable({
    startY: doc.lastAutoTable.finalY + 16,
    head: [["Fecha","Proveedor","Factura","Tipo pago","Productos","Total"]],
    body: comprasMes.length ? comprasMes.map(c => [onlyDate(c.fecha), c.proveedor_nombre || "-", c.factura || "-", c.tipo_pago || "-", c.detalle_productos || c.productos || "-", fmtGs(c.total_pyg ?? c.total ?? 0)]) : [["-","Sin compras registradas","-","-","-","Gs. 0"]],
    theme: "grid",
    headStyles: { fillColor: [22, 163, 74] },
    styles: { fontSize: 8.5 }
  });
  doc.setFontSize(14).text("Detalle de Cuentas Pagadas del Mes", 14, doc.lastAutoTable.finalY + 12);
  doc.autoTable({
    startY: doc.lastAutoTable.finalY + 16,
    head: [["Pago","Proveedor","Concepto","Vencimiento","Caja","Monto"]],
    body: cuentasMes.length ? cuentasMes.map(c => [onlyDate(c.fecha_pago || c.pagado_en || c.fecha), c.proveedor || "-", c.concepto || "-", onlyDate(c.vencimiento), c.caja_tipo || c.caja || "-", fmtGs(c.monto_pyg ?? c.monto ?? 0)]) : [["-","Sin cuentas pagadas","-","-","-","Gs. 0"]],
    theme: "grid",
    headStyles: { fillColor: [220, 38, 38] },
    styles: { fontSize: 8.5 }
  });
  const totalPages = doc.internal.getNumberOfPages();
  for (let i = 1; i <= totalPages; i++) {
    doc.setPage(i);
    doc.setFontSize(8);
    doc.setTextColor(100);
    doc.text(`Documento generado automáticamente • Empresa: ${emp.nombre || "Mi Empresa"} • Usuario: ${usuario} • Página ${i}/${totalPages}`, 105, 290, { align: "center" });
  }
  doc.save(`informe_caja_${limpiarNombreArchivo(emp.nombre || "empresa")}_${fechaISO}.pdf`);
}

async function confirmLogout() {
  try { await jpost("/logout", {}); } catch {}
  localStorage.removeItem("auth");
  localStorage.removeItem("authUser");
  sessionStorage.removeItem("authUser");
  window.location.href = "login.html";
}

let LAST_HASH = "#accesos";

window.addEventListener("hashchange", () => {
  if (location.hash === "#logout") { logout(); history.replaceState(null, "", LAST_HASH); return; }
  LAST_HASH = location.hash || "#accesos";
  show(LAST_HASH);
});

window.USUARIO_ACTUAL = window.USUARIO_ACTUAL || null;

async function mostrarUsuarioLogueado() {
  try {
    const data = await jget("/me");
    const user = data?.user || data || {};
    const nombre = user.nombre || user.usuario || user.username || "Usuario";
    let genero = user.genero || null;
    if (!genero) {
      const femeninos = ['yessica','jessica','maria','ana','laura','andrea','carolina','patricia','claudia','monica','gabriela','daniela','valentina','sofia','camila','fernanda','natalia','alejandra','paola','diana','rosa','elena','isabel','lucia','sara','paula','angela','adriana','lorena','marcela','veronica','sandra','silvia','beatriz','nora','gloria','martha','luz','carmen','teresa','miriam','susana','graciela','viviana','romina','noelia','melisa','vanesa','florencia','agustina','micaela','brenda','cecilia','cristina','fabiola','karina','liliana','marta','norma','pilar','rebeca','rocio','silvana','sonia','wendy','julia','fatima','alicia','cynthia','marlene','zunilda','ramona','catalina','petrona'];
      const primerNombre = nombre.trim().split(' ')[0].toLowerCase();
      genero = femeninos.includes(primerNombre) ? 'F' : 'M';
    }
    window.USUARIO_ACTUAL = user;
    setAvatarUsuario(nombre, genero);
  } catch (err) { console.error("Error obteniendo usuario:", err); setAvatarUsuario("Usuario", "M"); }
}

function setAvatarUsuario(nombreCompleto, genero) {
  const nombre = (nombreCompleto || 'Usuario').trim();
  const femeninos = ['yessica','jessica','maria','ana','laura','andrea','carolina','patricia','claudia','monica','gabriela','daniela','valentina','sofia','camila','fernanda','natalia','alejandra','paola','diana','rosa','elena','isabel','lucia','sara','paula','angela','adriana','lorena','marcela','veronica','sandra','silvia','beatriz','nora','gloria','martha','luz','carmen','teresa','miriam','susana','graciela','viviana','romina','noelia','melisa','vanesa','florencia','agustina','micaela','brenda','cecilia','cristina','fabiola','karina','liliana','marta','norma','pilar','rebeca','rocio','silvana','sonia','wendy','julia','fatima','alicia'];
  const primerNombre = nombre.trim().split(' ')[0].toLowerCase();
  const esMujer = genero === 'F' || (!genero && femeninos.includes(primerNombre));
  const label = document.getElementById('usuarioSidebarNombre');
  if (label) label.textContent = nombre.toUpperCase();
  const img = document.getElementById('avatarImg');
  if (!img) return;
  const old = img.parentElement.querySelector('.avatar-fallback');
  if (old) old.remove();
  img.style.display = 'block';
  const seed = encodeURIComponent(nombre.split(' ')[0].toLowerCase());
  img.src = esMujer ? `https://api.dicebear.com/9.x/personas/svg?seed=${seed}&eyes=open,happy&hair=buns,long,pigtails,wavy&backgroundColor=ffd5dc` : `https://api.dicebear.com/9.x/personas/svg?seed=${seed}&eyes=open,serious&hair=bald,short,buzz&backgroundColor=bde0fe`;
  img.onerror = function() {
    this.style.display = 'none';
    const iniciales = nombre.split(' ').filter(Boolean).slice(0,2).map(p => p[0].toUpperCase()).join('');
    const fb = document.createElement('div');
    fb.className = 'avatar-fallback';
    fb.style.cssText = `width:100%;height:100%;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:13px;font-weight:700;background:${esMujer ? '#fce7f3' : '#dbeafe'};color:${esMujer ? '#be185d' : '#1d4ed8'};`;
    fb.textContent = iniciales;
    this.parentElement.appendChild(fb);
  };
}

function fmtMonedaCuenta(moneda, valor) {
  const n = Number(valor || 0);
  const m = String(moneda || "PYG").toUpperCase();
  if (m === "USD") return "US$ " + n.toLocaleString("es-PY", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  if (m === "BRL") return "R$ " + n.toLocaleString("es-PY", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return "Gs. " + n.toLocaleString("es-PY");
}

function actualizarResumenCuentaPagar() {
  const moneda = String(document.getElementById("cp_moneda")?.value || "PYG").toUpperCase();
  const tipoCambio = Number(document.getElementById("cp_tipo_cambio")?.value || 1);
  const montoGsTexto = document.getElementById("cp_monto_gs")?.value || "0";
  const montoGs = Number(String(montoGsTexto).replace(/\./g, "").replace(/,/g, "")) || 0;
  const montoConvertido = moneda === "USD" || moneda === "BRL" ? (tipoCambio > 0 ? montoGs / tipoCambio : 0) : montoGs;
  const elPyg = document.getElementById("cp_resumen_pyg");
  const elMoneda = document.getElementById("cp_resumen_moneda");
  if (elPyg) elPyg.textContent = "Gs. " + montoGs.toLocaleString("es-PY");
  if (elMoneda) elMoneda.textContent = fmtMonedaCuenta(moneda, montoConvertido);
}

function abrirNuevaCuentaPagar() {
  const setVal = (id, val) => { const el = document.getElementById(id); if (el) el.value = val; };
  const titulo = document.getElementById("cp_titulo_modal");
  if (titulo) titulo.textContent = "Nueva Cuenta a Pagar";
  setVal("cp_id", "");
  setVal("cp_proveedor", "");
  setVal("cp_factura", "");
  setVal("cp_concepto", "");
  setVal("cp_moneda", "PYG");
  setVal("cp_tipo_cambio", 1);
  setVal("cp_monto_gs", "");
  setVal("cp_vencimiento", "");
  setVal("cp_estado", "pendiente");
  toggleMonedaCuentaPagar();
  openModal("modalCuentaPagar");
}

function editarCuentaPagar(id) {
  const item = cuentasPagar.find(x => Number(x.id) === Number(id));
  if (!item) return;
  const setVal = (id, val) => { const el = document.getElementById(id); if (el) el.value = val ?? ""; };
  const titulo = document.getElementById("cp_titulo_modal");
  if (titulo) titulo.textContent = "Editar Cuenta a Pagar";
  setVal("cp_id", item.id);
  setVal("cp_proveedor", item.proveedor || "");
  setVal("cp_factura", item.factura || "");
  setVal("cp_concepto", item.concepto || "");
  setVal("cp_moneda", item.moneda || "PYG");
  setVal("cp_tipo_cambio", item.tipo_cambio || 1);
  setVal("cp_monto_gs", Number(item.monto_pyg ?? item.monto ?? 0).toLocaleString("es-PY"));
  setVal("cp_vencimiento", item.vencimiento ? toYMD(item.vencimiento) : "");
  setVal("cp_estado", item.estado || "pendiente");
  toggleMonedaCuentaPagar();
  openModal("modalCuentaPagar");
}

function eliminarCuentaPagar(id) {
  cuentaPagarAEliminar = Number(id);
  openModal("modalEliminarCuentaPagar");
}

function actualizarGraficoDashboard(ayer, hoy) {
  const max = Math.max(Number(ayer || 0), Number(hoy || 0), 1);
  const pctAyer = (Number(ayer || 0) / max) * 100;
  const pctHoy = (Number(hoy || 0) / max) * 100;
  const ayerTexto = document.getElementById("ayer-texto");
  const hoyTexto = document.getElementById("hoy-texto");
  const barAyer = document.getElementById("bar-ayer");
  const barHoy = document.getElementById("bar-hoy");
  if (ayerTexto) ayerTexto.innerText = "Gs. " + money(ayer || 0);
  if (hoyTexto) hoyTexto.innerText = "Gs. " + money(hoy || 0);
  if (barAyer) barAyer.style.width = pctAyer + "%";
  if (barHoy) barHoy.style.width = pctHoy + "%";
}

let productosPaginaActual = 1;
const productosPorPagina = 8;
let productosFiltrados = [];

function renderPaginacionProductos(lista) {
  const contenedor = document.getElementById("productos-paginacion");
  if (!contenedor) return;
  const totalPaginas = Math.ceil((lista || []).length / productosPorPagina) || 1;
  contenedor.innerHTML = "";
  if (totalPaginas <= 1) return;
  for (let i = 1; i <= totalPaginas; i++) {
    const btn = document.createElement("button");
    btn.textContent = i;
    btn.className = "pag-btn";
    if (i === productosPaginaActual) btn.classList.add("active");
    btn.onclick = () => { productosPaginaActual = i; renderProductos(lista); };
    contenedor.appendChild(btn);
  }
}

function cancelarPedido() {
  window.pp_items = [];
  window.PP_PRODUCTO_ACTUAL = null;
  const proveedor = document.getElementById("pp_proveedor");
  const fecha = document.getElementById("pp_fecha");
  const fechaRecepcion = document.getElementById("pp_fecha_recepcion");
  if (proveedor) proveedor.value = "";
  if (fecha) fecha.value = "";
  if (fechaRecepcion) fechaRecepcion.value = "";
  renderPP_Items();
}

async function cargarNotificaciones() {
  const notifCount = document.getElementById("notifCount");
  const notifDropdown = document.getElementById("notifDropdown");
  if (!notifCount || !notifDropdown) return;
  try {
    const data = await jget("/api/notificaciones");
    const alertas = Array.isArray(data.alertas) ? data.alertas : [];
    notifCount.textContent = alertas.length;
    notifDropdown.innerHTML = `<h4>Notificaciones</h4>${alertas.length ? alertas.map(a => `<div class="notif-item"><strong>${escapeHtml(a.titulo || "")}</strong><p>${escapeHtml(a.mensaje || "")}</p></div>`).join("") : `<p class="notif-empty">No hay notificaciones nuevas</p>`}`;
  } catch (err) { console.error("Error cargando notificaciones:", err); }
}

cargarNotificaciones();
setInterval(cargarNotificaciones, 30000);

const btnNotificaciones = document.getElementById("btnNotificaciones");
const notifDropdown = document.getElementById("notifDropdown");
if (btnNotificaciones && notifDropdown) {
  btnNotificaciones.addEventListener("click", () => { notifDropdown.classList.toggle("hidden"); });
}

window.cancelarPedido = cancelarPedido;

window.addEventListener("load", async () => {
  try { await initPDF(); } catch (e) { console.warn("No cargó logos:", e); }
  await mostrarUsuarioLogueado();
  LAST_HASH = location.hash || "#accesos";
  show(LAST_HASH);
  if (typeof cargarKpis === "function") cargarKpis();
  if (LAST_HASH === "#accesos") cargarVentasComparadas();
});

window.addEventListener("hashchange", () => { show(location.hash || "#accesos"); });

window.logout = logout;
window.closeLogoutModal = closeLogoutModal;
window.confirmLogout = confirmLogout;

window.abrirCaja = abrirCaja;
window.cerrarCaja = cerrarCaja;
window.verificarCaja = verificarCaja;
window.cargarRecaudacionFecha = cargarRecaudacionFecha;

window.abrirModalSelProducto = abrirModalSelProducto;
window.filtrarProductosModalPP = filtrarProductosModalPP;
window.closeModalSelProducto = closeModalSelProducto;

document.addEventListener("DOMContentLoaded", () => {
  const modalIds = ["modalVenta","modalPago","modalNuevaCompra","modalEditarCompra","logoutModal"];
  modalIds.forEach((id) => {
    const el = document.getElementById(id);
    if (el && el.parentElement !== document.body) { document.body.appendChild(el); }
  });
});

async function cargarVentas() {
  try {
    const ventas = await jget("/ventas");
    const tbody = document.getElementById("tablaVentas");
    if (!tbody) return;
    if (!Array.isArray(ventas) || !ventas.length) { tbody.innerHTML = `<tr><td colspan="7" style="text-align:center;padding:12px;">No hay ventas registradas para esta empresa.</td></tr>`; return; }
    tbody.innerHTML = ventas.map(v => `<tr><td>${v.id}</td><td>${toYMD(v.fecha)}</td><td>${escapeHtml(v.cliente_nombre || "Consumidor Final")}</td><td>${escapeHtml(v.productos || "-")}</td><td>${escapeHtml(v.forma_pago_nombre || "-")}</td><td>Gs. ${money(v.total_pyg ?? v.total ?? 0)}</td><td>${escapeHtml(v.estado_pago || "-")}</td></tr>`).join("");
  } catch (err) { console.error("Error cargando ventas:", err); }
}

function nuevaVenta() {
  if (typeof openModal === "function") openModal("modalVenta");
  else { const modal = document.getElementById("modalVenta"); if (modal) modal.style.display = "flex"; }
}

function toggleNavGroup(btn) {
  const items = btn.nextElementSibling;
  const isOpen = items.classList.contains('open');
  items.classList.toggle('open');
  btn.classList.toggle('open');
}

/* ============================================
   INSUMOS - Catálogo (con API)
   ============================================ */
let insumos = [];

async function listarInsumos() {
  try {
    insumos = await jget("/insumos") || [];
    const tbody = document.getElementById("tabla-insumos");
    if (!tbody) return;
    tbody.innerHTML = "";
    if (insumos.length === 0) { tbody.innerHTML = `<tr><td colspan="6" style="text-align:center;padding:30px;color:#64748b"><div class="empty-state" style="border:none;background:transparent;padding:0"><svg class="icon"><use href="#icon-box"/></svg><strong>No hay insumos cargados todavía</strong><p>Hacé clic en "Agregar Insumo" para crear el primero.</p></div></td></tr>`; renderResumenInsumos(); return; }
    insumos.forEach(i => {
      const bajoMinimo = (i.stock ?? 0) <= (i.stock_min ?? 0);
      const tr = document.createElement("tr");
      tr.innerHTML = `<td>${i.id}</td><td>${i.nombre}</td><td>${i.unidad}</td><td class="${bajoMinimo ? 'stock-low' : 'stock-ok'}">${(i.stock ?? 0)} ${i.unidad}</td><td>${(i.stock_min ?? 0)} ${i.unidad}</td><td><button class="action-icon-btn edit" onclick="editarInsumo(${i.id})" title="Editar"><svg class="icon icon-sm"><use href="#icon-edit"/></svg></button><button class="action-icon-btn delete" onclick="eliminarInsumo(${i.id})" title="Eliminar"><svg class="icon icon-sm"><use href="#icon-trash"/></svg></button></td>`;
      tbody.appendChild(tr);
    });
    await renderResumenInsumos();
  } catch (err) { console.error("Error listando insumos:", err); toast("Error al cargar insumos", "error"); }
}

function filtrarInsumos(texto) {
  const t = texto.trim().toLowerCase();
  const tbody = document.getElementById("tabla-insumos");
  const filas = tbody.querySelectorAll("tr");
  if (insumos.length === 0) return;
  insumos.forEach((insumo, idx) => {
    const coincide = insumo.nombre.toLowerCase().includes(t);
    if (filas[idx]) filas[idx].style.display = coincide ? "" : "none";
  });
}

function abrirNuevoInsumo() {
  document.getElementById("insumo_id").value = "";
  document.getElementById("insumo_nombre").value = "";
  document.getElementById("insumo_unidad").value = "Kg";
  document.getElementById("insumo_stock").value = "0";
  document.getElementById("insumo_stock_min").value = "0";
  document.getElementById("insumo_costo_promedio").value = "0";
  document.getElementById("insumo_titulo").innerHTML = `<svg class="icon"><use href="#icon-box"/></svg> Nuevo Insumo`;
  renderStockRapido();
  openModal("modalInsumo");
}

function renderStockRapido() {
  const unidad = document.getElementById("insumo_unidad").value;
  const cont = document.getElementById("stock_rapido_botones");
  cont.innerHTML = "";
  const esPeso = unidad === "Kg" || unidad === "g";
  const esVolumen = unidad === "L" || unidad === "ml";
  if (!esPeso && !esVolumen) return;
  const base = (unidad === "g") ? 1000 : (unidad === "ml") ? 1000 : 1;
  const opciones = [{ label: "¼", valor: base * 0.25 }, { label: "½", valor: base * 0.5 }, { label: "1", valor: base * 1 }, { label: "5", valor: base * 5 }];
  opciones.forEach(op => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "btn";
    btn.style.cssText = "padding:4px 12px;font-size:0.8rem;background:#e2e8f0;color:#334155";
    btn.textContent = `${op.label} ${unidad === "g" || unidad === "ml" ? (unidad === "g" ? "Kg" : "L") : unidad}`;
    btn.onclick = () => { document.getElementById("insumo_stock").value = op.valor; };
    cont.appendChild(btn);
  });
}

function marcarStockManual() {}

async function editarInsumo(id) {
  const insumo = insumos.find(i => i.id === id);
  if (!insumo) return;
  document.getElementById("insumo_id").value = insumo.id;
  document.getElementById("insumo_nombre").value = insumo.nombre;
  document.getElementById("insumo_unidad").value = insumo.unidad;
  document.getElementById("insumo_stock").value = insumo.stock ?? 0;
  document.getElementById("insumo_stock_min").value = insumo.stock_min ?? 0;
  document.getElementById("insumo_costo_promedio").value = insumo.costo_promedio ?? 0;
  document.getElementById("insumo_titulo").innerHTML = `<svg class="icon"><use href="#icon-edit"/></svg> Editar Insumo`;
  renderStockRapido();
  openModal("modalInsumo");
}

async function guardarInsumo() {
  const id = document.getElementById("insumo_id").value;
  const nombre = document.getElementById("insumo_nombre").value.trim();
  const unidad = document.getElementById("insumo_unidad").value;
  const stock = parseFloat(document.getElementById("insumo_stock").value) || 0;
  const stock_min = parseFloat(document.getElementById("insumo_stock_min").value) || 0;
  const costo_promedio = parseFloat(document.getElementById("insumo_costo_promedio").value) || 0;
  if (!nombre) return toast("Ingresá un nombre para el insumo", "error");
  const body = { nombre, unidad, stock, stock_min, costo_promedio };
  try {
    if (id) { await jput("/insumos/" + id, body); toast("Insumo actualizado", "success"); } else { await jpost("/insumos", body); toast("Insumo creado", "success"); }
    closeModal("modalInsumo");
    await listarInsumos();
  } catch (err) { console.error("Error guardando insumo:", err); const msg = err.detalle || err.message || "Error al guardar insumo"; toast(msg, "error"); }
}

let insumoAEliminar = null;

function eliminarInsumo(id) {
  insumoAEliminar = id;
  openModal("modalEliminarInsumo");
}

async function confirmarEliminarInsumo() {
  if (!insumoAEliminar) return;
  try {
    await jdel("/insumos/" + insumoAEliminar);
    toast("Insumo eliminado", "success");
    closeModal("modalEliminarInsumo");
    await listarInsumos();
  } catch (err) { console.error("Error eliminando insumo:", err); toast("Error al eliminar insumo", "error"); }
  insumoAEliminar = null;
}

/* ============================================
   COMPRAS DE INSUMOS (con API)
   ============================================ */
async function abrirCompraInsumo() {
  try {
    const insumosApi = await jget("/insumos") || [];
    const sel = document.getElementById("ci_insumo_id");
    const emptyState = document.getElementById("ci_empty_state");
    const formFields = document.getElementById("ci_form_fields");
    const formActions = document.getElementById("ci_form_actions");
    if (insumosApi.length === 0) {
      emptyState.classList.remove("hidden");
      formFields.classList.add("hidden");
      formActions.classList.add("hidden");
      openModal("modalCompraInsumo");
      return;
    }
    emptyState.classList.add("hidden");
    formFields.classList.remove("hidden");
    formActions.classList.remove("hidden");
    sel.innerHTML = `<option value="">Seleccionar insumo...</option>`;
    insumosApi.forEach(i => { const opt = document.createElement("option"); opt.value = i.id; opt.textContent = `${i.nombre} (${i.unidad})`; sel.appendChild(opt); });
    document.getElementById("ci_unidad_base").value = "";
    document.getElementById("ci_cantidad").value = "1000";
    document.getElementById("ci_precio_por_100g").value = "600";
    document.getElementById("ci_precio_por_kilo").value = "";
    document.getElementById("ci_precio_total").value = "";
    document.getElementById("ci_fecha").value = hoyLocal();
    document.getElementById("ci_proveedor_id").value = "";
    document.getElementById("ci_ruc_mostrado").value = "";
    await cargarProveedoresEnSelectCompraInsumo();
    calcularTotalCompraInsumo();
    renderCompraRapido();
    openModal("modalCompraInsumo");
  } catch (err) { console.error("Error al abrir compra de insumo:", err); toast("Error al cargar datos", "error"); }
}

async function guardarCompraInsumo() {
  const btn = document.querySelector('#modalCompraInsumo .btn-green, #modalCompraInsumo .btn-primary');
  if (btn && btn.disabled) return;
  const insumo_id = Number(document.getElementById("ci_insumo_id").value);
  if (!insumo_id) { if (btn) btn.disabled = false; return toast("Seleccioná un insumo.", "error"); }
  const cantidad = parseFloat(document.getElementById("ci_cantidad").value) || 0;
  if (cantidad <= 0) { if (btn) btn.disabled = false; return toast("Cantidad debe ser mayor a 0.", "error"); }
  const precioTotal = parseFloat(document.getElementById("ci_precio_total").value) || 0;
  if (precioTotal <= 0) { if (btn) btn.disabled = false; return toast("Error: precio total no calculado. Verificá los datos.", "error"); }
  const fecha = document.getElementById("ci_fecha").value || hoyLocal();
  const unidadCompra = document.getElementById("ci_unidad_compra").value;
  const insumo = insumos.find(i => i.id === insumo_id);
  if (!insumo) { if (btn) btn.disabled = false; return toast("Insumo no encontrado.", "error"); }
  const factor = obtenerFactorConversion(unidadCompra, insumo.unidad);
  const cantidadBase = cantidad * factor;
  const precioUnitarioBase = cantidadBase > 0 ? precioTotal / cantidadBase : 0;
  const proveedor_id = Number(document.getElementById("ci_proveedor_id").value);
  if (!proveedor_id) { if (btn) btn.disabled = false; return toast("Seleccioná un proveedor.", "error"); }
  const selectProveedor = document.getElementById("ci_proveedor_id");
  const proveedorNombre = selectProveedor.options[selectProveedor.selectedIndex]?.text || "Sin proveedor";
  const proveedorRuc = selectProveedor.options[selectProveedor.selectedIndex]?.dataset?.ruc || "";
  if (btn) { btn.disabled = true; btn.textContent = "Guardando..."; }
  const factura = document.getElementById("ci_factura").value.trim() || "S/F";
  console.log("FACTURA CAPTURADA:", factura);
  const compraData = {
    insumo_id,
    cantidad: cantidadBase,
    unidad: insumo.unidad,
    cantidad_compra: cantidad,
    unidad_compra: unidadCompra,
    precio_total: precioTotal,
    precio_unitario_base: precioUnitarioBase,
    precio_por_100g: parseFloat(document.getElementById("ci_precio_por_100g").value) || 0,
    fecha,
    proveedor_id,
    proveedor: proveedorNombre,
    proveedor_ruc: proveedorRuc,
    factura: factura
  };
  try {
    await jpost("/compras-insumo", compraData);
    try {
      const productos = await jget("/productos");
      let producto = productos.find(p => p.nombre.toLowerCase() === "compra de insumos");
      if (!producto) {
        producto = await jpost("/productos", {
          codigo: "INS-000",
          nombre: "Compra de Insumos",
          descripcion: "Producto genérico para registrar compras de insumos",
          marca: "",
          categoria: "Insumos",
          costo: 0,
          precio: 0,
          stock: 0,
          imagen_base64: null
        });
      }
      await jpost("/compras", {
        proveedor_id: proveedor_id,
        fecha: fecha,
        factura: factura,
        calcular_iva: false,
        items: [{ producto_id: producto.id, cantidad: cantidadBase, costo: precioUnitarioBase, subtotal: precioTotal }]
      });
    } catch (err) { console.warn("No se pudo registrar la compra en egresos:", err); }
    toast("Compra de insumo registrada", "success");
    closeModal("modalCompraInsumo");
    await listarInsumos();
    if (typeof cargarRecaudacionFecha === "function") await cargarRecaudacionFecha();
    if (typeof verificarCaja === "function") await verificarCaja();
  } catch (err) { console.error("Error guardando compra de insumo:", err); const msg = err.detalle || err.message || "Error al registrar compra"; toast(msg, "error"); } finally { if (btn) { btn.disabled = false; btn.textContent = "Registrar compra"; } }
}

/* ============================================
   USOS DE INSUMOS (con API)
   ============================================ */
async function abrirUsoInsumo() {
  try {
    const insumosApi = await jget("/insumos") || [];
    const overlay = document.getElementById("drawerOverlay");
    const drawer = document.getElementById("drawerUsoInsumo");
    const sel = document.getElementById("uso_insumo_id");
    const emptyState = document.getElementById("uso_empty_state");
    const formFields = document.getElementById("uso_form_fields");
    const formActions = document.getElementById("uso_form_actions");
    overlay.classList.remove("hidden");
    drawer.classList.remove("hidden");
    requestAnimationFrame(() => { drawer.classList.add("open"); });
    if (insumosApi.length === 0) { emptyState.classList.remove("hidden"); formFields.classList.add("hidden"); formActions.classList.add("hidden"); return; }
    emptyState.classList.add("hidden");
    formFields.classList.remove("hidden");
    formActions.classList.remove("hidden");
    sel.innerHTML = `<option value="">Seleccionar insumo...</option>`;
    insumosApi.forEach(i => { const opt = document.createElement("option"); opt.value = i.id; opt.textContent = `${i.nombre} (stock: ${i.stock ?? 0} ${i.unidad})`; sel.appendChild(opt); });
    if (insumosApi.length > 0) sel.value = insumosApi[0].id;
    document.getElementById("uso_cantidad").value = "100";
    document.getElementById("uso_fecha").value = hoyLocal();
    document.getElementById("uso_motivo").value = "";
    document.getElementById("uso_stock_actual").textContent = "";
    document.getElementById("uso_rapido_botones").innerHTML = "";
    actualizarUnidadUso();
  } catch (err) { console.error("Error al abrir uso de insumo:", err); toast("Error al cargar datos", "error"); }
}

function cerrarDrawerUsoInsumo() {
  const overlay = document.getElementById("drawerOverlay");
  const drawer = document.getElementById("drawerUsoInsumo");
  drawer.classList.remove("open");
  setTimeout(() => { overlay.classList.add("hidden"); drawer.classList.add("hidden"); }, 300);
}

async function guardarUsoInsumo() {
  const insumo_id = Number(document.getElementById("uso_insumo_id").value);
  if (!insumo_id) return toast("Seleccioná un insumo.", "error");
  const cantidadUso = parseFloat(document.getElementById("uso_cantidad").value) || 0;
  if (cantidadUso <= 0) return toast("La cantidad debe ser mayor a 0.", "error");
  const fecha = document.getElementById("uso_fecha").value || hoyLocal();
  const motivo = document.getElementById("uso_motivo").value.trim() || "";
  const unidadUso = document.getElementById("uso_unidad_compra").value;
  const insumo = insumos.find(i => i.id === insumo_id);
  if (!insumo) return toast("Insumo no encontrado.", "error");
  const factor = obtenerFactorConversion(unidadUso, insumo.unidad);
  const cantidadBase = cantidadUso * factor;
  const costoPromedio = insumo.costo_promedio || 0;
  const costoUso = cantidadBase * costoPromedio;
  const usoData = {
    insumo_id,
    cantidad: cantidadBase,
    unidad: insumo.unidad,
    cantidad_usada: cantidadUso,
    unidad_usada: unidadUso,
    costo: costoUso,
    costo_promedio: costoPromedio,
    motivo,
    fecha
  };
  try {
    await jpost("/usos-insumo", usoData);
    toast(`Uso registrado. Costo: Gs. ${costoUso.toFixed(2)}`, "success");
    cerrarDrawerUsoInsumo();
    await listarInsumos();
  } catch (err) { console.error("Error guardando uso de insumo:", err); toast("Error al registrar uso", "error"); }
}

/* ============================================
   RESUMEN DE CONSUMO (con API)
   ============================================ */
const DIAS_SEMANA = ["Domingo","Lunes","Martes","Miércoles","Jueves","Viernes","Sábado"];

function formatGs(numero) { return `Gs. ${Math.round(numero).toLocaleString("es-PY")}`; }

function fechaISOaDate(fechaStr) { const [y,m,d] = fechaStr.split("-").map(Number); return new Date(y, m-1, d); }

function nombreDia(fechaStr) { return DIAS_SEMANA[fechaISOaDate(fechaStr).getDay()]; }

function sumarDias(fechaStr, dias) {
  const d = fechaISOaDate(fechaStr);
  d.setDate(d.getDate() + dias);
  const mes = String(d.getMonth() + 1).padStart(2,"0");
  const dia = String(d.getDate()).padStart(2,"0");
  return `${d.getFullYear()}-${mes}-${dia}`;
}

function setRangoResumen(tipo) {
  const hoy = hoyLocal();
  const diaSemanaHoy = fechaISOaDate(hoy).getDay();
  const diffLunes = diaSemanaHoy === 0 ? -6 : 1 - diaSemanaHoy;
  const lunes = sumarDias(hoy, diffLunes);
  const domingo = sumarDias(lunes, 6);
  const sabado = sumarDias(lunes, 5);
  let desde, hasta;
  if (tipo === "hoy") { desde = hoy; hasta = hoy; }
  else if (tipo === "semana") { desde = lunes; hasta = domingo; }
  else if (tipo === "finde") { desde = sabado; hasta = domingo; }
  else if (tipo === "mes") {
    const d = fechaISOaDate(hoy);
    desde = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-01`;
    const ultimoDia = new Date(d.getFullYear(), d.getMonth()+1, 0).getDate();
    hasta = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(ultimoDia).padStart(2,"0")}`;
  }
  document.getElementById("resumen_desde").value = desde;
  document.getElementById("resumen_hasta").value = hasta;
  renderResumenInsumos();
}

let resumenDiasPagina = 1;
let resumenDetallePagina = 1;
const RESUMEN_DIAS_POR_PAGINA = 7;
const RESUMEN_DETALLE_POR_PAGINA = 10;

function renderPaginacion(contenedorId, totalItems, porPagina, paginaActual, onCambiar) {
  const cont = document.getElementById(contenedorId);
  if (!cont) return;
  const totalPaginas = Math.max(1, Math.ceil(totalItems / porPagina));
  cont.innerHTML = `<button ${paginaActual <= 1 ? "disabled" : ""} id="${contenedorId}-prev">← Anterior</button><span>Página ${paginaActual} de ${totalPaginas}</span><button ${paginaActual >= totalPaginas ? "disabled" : ""} id="${contenedorId}-next">Siguiente →</button>`;
  const prevBtn = document.getElementById(`${contenedorId}-prev`);
  const nextBtn = document.getElementById(`${contenedorId}-next`);
  if (prevBtn) prevBtn.onclick = () => onCambiar(paginaActual - 1);
  if (nextBtn) nextBtn.onclick = () => onCambiar(paginaActual + 1);
}

async function renderResumenInsumos(resetPaginas = true) {
  const desdeEl = document.getElementById("resumen_desde");
  const hastaEl = document.getElementById("resumen_hasta");
  if (!desdeEl || !hastaEl) return;
  if (resetPaginas) { resumenDiasPagina = 1; resumenDetallePagina = 1; }
  if (!desdeEl.value || !hastaEl.value) { setRangoResumen("semana"); return; }
  const desde = desdeEl.value;
  const hasta = hastaEl.value;
  try {
    const [usosApi, comprasApi] = await Promise.all([jget("/usos-insumo") || [], jget("/compras-insumo") || []]);
    const usos = usosApi;
    const compras = comprasApi;
    const usosEnRango = usos.filter(u => u.fecha >= desde && u.fecha <= hasta);
    const usosConCosto = usosEnRango.map(u => {
      const insumo = insumos.find(i => i.id === u.insumo_id);
      return { ...u, nombreInsumo: insumo ? insumo.nombre : `#${u.insumo_id}`, costo: u.costo || 0 };
    });
    const totalGastado = usosConCosto.reduce((s, u) => s + u.costo, 0);
    const diasConConsumo = new Set(usosEnRango.map(u => u.fecha)).size;
    const totalesPorInsumo = {};
    usosEnRango.forEach(u => { totalesPorInsumo[u.insumo_id] = (totalesPorInsumo[u.insumo_id] || 0) + u.cantidad; });
    let insumoTopNombre = "—";
    let maxCantidad = 0;
    Object.entries(totalesPorInsumo).forEach(([id, cant]) => {
      if (cant > maxCantidad) { maxCantidad = cant; const insumo = insumos.find(i => i.id === Number(id)); insumoTopNombre = insumo ? `${insumo.nombre} (${cant.toFixed(2)} ${insumo.unidad})` : `#${id}`; }
    });
    document.getElementById("kpi-total-gastado").textContent = formatGs(totalGastado);
    document.getElementById("kpi-insumo-top").textContent = insumoTopNombre;
    document.getElementById("kpi-dias-consumo").textContent = diasConConsumo;
    const diasDelRango = [];
    let cursor = desde;
    while (cursor <= hasta) { diasDelRango.push(cursor); cursor = sumarDias(cursor, 1); }
    diasDelRango.reverse();
    const filasDias = diasDelRango.map(fecha => {
      const usosDia = usosConCosto.filter(u => u.fecha === fecha);
      const cantidadTotal = usosDia.reduce((s, u) => s + u.cantidad, 0);
      const gastoTotal = usosDia.reduce((s, u) => s + u.costo, 0);
      return { fecha, dia: nombreDia(fecha), cantidadTotal, gastoTotal, tieneUsos: usosDia.length > 0 };
    });
    const totalPaginasDias = Math.max(1, Math.ceil(filasDias.length / RESUMEN_DIAS_POR_PAGINA));
    if (resumenDiasPagina > totalPaginasDias) resumenDiasPagina = totalPaginasDias;
    const inicioD = (resumenDiasPagina - 1) * RESUMEN_DIAS_POR_PAGINA;
    const paginaDias = filasDias.slice(inicioD, inicioD + RESUMEN_DIAS_POR_PAGINA);
    const tbodyDias = document.getElementById("resumen-dias-tbody");
    tbodyDias.innerHTML = paginaDias.length ? paginaDias.map(f => `<tr style="${f.tieneUsos ? "" : "color:#94a3b8"}"><td>${f.dia}</td><td>${f.fecha.split("-").reverse().join("/")}</td><td>${f.tieneUsos ? f.cantidadTotal.toFixed(2) : "—"}</td><td>${f.tieneUsos ? formatGs(f.gastoTotal) : "Sin consumo"}</td></tr>`).join("") : `<tr><td colspan="4" style="text-align:center;color:#94a3b8">Sin datos en este rango</td></tr>`;
    renderPaginacion("resumen-dias-paginacion", filasDias.length, RESUMEN_DIAS_POR_PAGINA, resumenDiasPagina, (nuevaPagina) => { resumenDiasPagina = nuevaPagina; renderResumenInsumos(false); });
    const detalleOrdenado = [...usosConCosto].sort((a,b) => (a.fecha < b.fecha ? 1 : -1));
    const totalPaginasDetalle = Math.max(1, Math.ceil(detalleOrdenado.length / RESUMEN_DETALLE_POR_PAGINA));
    if (resumenDetallePagina > totalPaginasDetalle) resumenDetallePagina = totalPaginasDetalle;
    const inicioDet = (resumenDetallePagina - 1) * RESUMEN_DETALLE_POR_PAGINA;
    const paginaDetalle = detalleOrdenado.slice(inicioDet, inicioDet + RESUMEN_DETALLE_POR_PAGINA);
    const tbodyDetalle = document.getElementById("resumen-detalle-tbody");
    tbodyDetalle.innerHTML = paginaDetalle.length ? paginaDetalle.map(u => `<tr><td>${u.fecha.split("-").reverse().join("/")}</td><td>${nombreDia(u.fecha)}</td><td>${u.nombreInsumo}</td><td>${u.cantidad.toFixed(2)} ${u.unidad}</td><td>${formatGs(u.costo)}</td><td>${u.motivo || "—"}</td></tr>`).join("") : `<tr><td colspan="6" style="text-align:center;color:#94a3b8">Sin usos registrados en este rango</td></tr>`;
    renderPaginacion("resumen-detalle-paginacion", detalleOrdenado.length, RESUMEN_DETALLE_POR_PAGINA, resumenDetallePagina, (nuevaPagina) => { resumenDetallePagina = nuevaPagina; renderResumenInsumos(false); });
  } catch (err) { console.error("Error renderizando resumen de insumos:", err); toast("Error al cargar resumen", "error"); }
}

/* ============================================
   PROVEEDORES PARA COMPRA DE INSUMO
   ============================================ */
async function cargarProveedoresEnSelectCompraInsumo() {
  const select = document.getElementById("ci_proveedor_id");
  if (!select) return;
  select.innerHTML = `<option value="">Cargando proveedores...</option>`;
  try {
    const proveedores = await jget("/proveedores");
    if (!Array.isArray(proveedores) || !proveedores.length) { select.innerHTML = `<option value="">No hay proveedores</option>`; return; }
    select.innerHTML = `<option value="">Seleccionar proveedor</option>`;
    proveedores.forEach(p => {
      const opt = document.createElement("option");
      opt.value = p.id;
      opt.textContent = p.nombre || "Sin nombre";
      opt.dataset.ruc = p.ruc || "";
      select.appendChild(opt);
    });
    select.addEventListener("change", function() {
      const ruc = this.options[this.selectedIndex]?.dataset?.ruc || "";
      document.getElementById("ci_ruc_mostrado").value = ruc;
      document.getElementById("proveedor_ruc").value = ruc;
    });
  } catch (err) { console.error("Error cargando proveedores:", err); select.innerHTML = `<option value="">Error al cargar</option>`; }
}

/* ============================================
   HISTORIAL DE COMPRAS (con API)
   ============================================ */
let historialPagina = 1;
const HISTORIAL_POR_PAGINA = 10;
let historialCompras = [];

async function verHistorialComprasInsumo() {
  try {
    historialCompras = await jget("/compras-insumo") || [];
    historialPagina = 1;
    document.getElementById("filtroHistorialCompras").value = "";
    renderHistorialCompras();
    openModal("modalHistorialComprasInsumo");
  } catch (err) { console.error("Error cargando historial:", err); toast("Error al cargar historial", "error"); }
}

function renderHistorialCompras() {
  const tbody = document.getElementById("tablaHistorialCompras");
  const paginacion = document.getElementById("paginacionHistorialCompras");
  if (!tbody) return;
  const filtro = document.getElementById("filtroHistorialCompras")?.value?.toLowerCase() || "";
  let datosFiltrados = historialCompras.filter(c =>
    (c.proveedor || "").toLowerCase().includes(filtro) ||
    (c.insumo_nombre || "").toLowerCase().includes(filtro) ||
    (c.proveedor_ruc || "").toLowerCase().includes(filtro)
  );
  datosFiltrados.sort((a,b) => (a.fecha < b.fecha ? 1 : -1));
  const totalItems = datosFiltrados.length;
  const totalPaginas = Math.max(1, Math.ceil(totalItems / HISTORIAL_POR_PAGINA));
  if (historialPagina > totalPaginas) historialPagina = totalPaginas;
  const inicio = (historialPagina - 1) * HISTORIAL_POR_PAGINA;
  const pagina = datosFiltrados.slice(inicio, inicio + HISTORIAL_POR_PAGINA);
  if (!pagina.length) {
    tbody.innerHTML = `<tr><td colspan="9" style="text-align:center; padding:20px; color:#6b7280;">No hay compras registradas.</td></tr>`;
  } else {
    tbody.innerHTML = pagina.map(c => `<tr><td>${c.id}</td><td>${c.fecha || "-"}</td><td><strong>${c.proveedor || "Sin proveedor"}</strong></td><td>${c.proveedor_ruc || "-"}</td><td>${c.insumo_nombre || `#${c.insumo_id}`}</td><td>${c.cantidad_compra || c.cantidad} ${c.unidad_compra || c.unidad || ""}</td><td>${c.unidad || "-"}</td><td>Gs. ${Number(c.precio_unitario_base || 0).toLocaleString("es-PY")}</td><td><strong>Gs. ${Number(c.precio_total || 0).toLocaleString("es-PY")}</strong></td></tr>`).join("");
  }
  if (paginacion) {
    paginacion.innerHTML = "";
    if (totalPaginas > 1) {
      paginacion.innerHTML = `<button ${historialPagina === 1 ? "disabled" : ""} onclick="cambiarPaginaHistorial(${historialPagina - 1})">‹ Anterior</button><span>Página ${historialPagina} de ${totalPaginas}</span><button ${historialPagina === totalPaginas ? "disabled" : ""} onclick="cambiarPaginaHistorial(${historialPagina + 1})">Siguiente ›</button>`;
    }
  }
}

function cambiarPaginaHistorial(nuevaPagina) {
  const totalItems = historialCompras.length;
  const totalPaginas = Math.max(1, Math.ceil(totalItems / HISTORIAL_POR_PAGINA));
  if (nuevaPagina < 1 || nuevaPagina > totalPaginas) return;
  historialPagina = nuevaPagina;
  renderHistorialCompras();
}

function filtrarHistorialCompras() {
  historialPagina = 1;
  renderHistorialCompras();
}

/* ============================================
   FUNCIONES AUXILIARES
   ============================================ */
function obtenerFactorConversion(unidadOrigen, unidadDestino) {
  const aBase = { 'Kg': 1000, 'g': 1, 'L': 1000, 'ml': 1, 'Unidad': 1 };
  const factorOrigen = aBase[unidadOrigen] || 1;
  const factorDestino = aBase[unidadDestino] || 1;
  return factorOrigen / factorDestino;
}

function unidadBaseDe(unidad) {
  if (unidad === "Kg" || unidad === "g") return "Kg";
  if (unidad === "L" || unidad === "ml") return "L";
  return "Unidad";
}

function renderCompraRapido() {
  const unidadBase = document.getElementById("ci_unidad_base").value;
  const cont = document.getElementById("ci_rapido_botones");
  if (!cont) return;
  cont.innerHTML = "";
  const esPeso = unidadBase === "Kg" || unidadBase === "g";
  const esVolumen = unidadBase === "L" || unidadBase === "ml";
  if (!esPeso && !esVolumen) return;
  const base = (unidadBase === "g" || unidadBase === "ml") ? 1000 : 1;
  const opciones = [{ label: "¼", valor: base * 0.25 }, { label: "½", valor: base * 0.5 }, { label: "1", valor: base * 1 }, { label: "5", valor: base * 5 }];
  const unidadMostrar = (unidadBase === "g" || unidadBase === "ml") ? (unidadBase === "g" ? "Kg" : "L") : unidadBase;
  opciones.forEach(op => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "btn";
    btn.style.cssText = "padding:4px 12px;font-size:0.8rem;background:#e2e8f0;color:#334155";
    btn.textContent = `${op.label} ${unidadMostrar}`;
    btn.onclick = () => { document.getElementById("ci_cantidad").value = op.valor; calcularTotalCompraInsumo(); };
    cont.appendChild(btn);
  });
}

function renderUsoRapido(unidad) {
  const cont = document.getElementById("uso_rapido_botones");
  if (!cont) return;
  cont.innerHTML = "";
  const esPeso = unidad === "Kg" || unidad === "g";
  const esVolumen = unidad === "L" || unidad === "ml";
  if (!esPeso && !esVolumen) return;
  const base = (unidad === "g" || unidad === "ml") ? 1000 : 1;
  const opciones = [{ label: "¼", valor: base * 0.25 }, { label: "½", valor: base * 0.5 }, { label: "1", valor: base * 1 }];
  const unidadMostrar = (unidad === "g" || unidad === "ml") ? (unidad === "g" ? "Kg" : "L") : unidad;
  opciones.forEach(op => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "btn";
    btn.style.cssText = "padding:4px 12px;font-size:0.8rem;background:#e2e8f0;color:#334155";
    btn.textContent = `${op.label} ${unidadMostrar}`;
    btn.onclick = () => { document.getElementById("uso_cantidad").value = op.valor; calcularCostoUso(); };
    cont.appendChild(btn);
  });
}

function actualizarUnidadCompraInsumo() {
  const insumo_id = Number(document.getElementById("ci_insumo_id").value);
  const insumo = insumos.find(i => i.id === insumo_id);
  const unidadBase = insumo ? insumo.unidad : "";
  document.getElementById("ci_unidad_base").value = unidadBase;
  const select = document.getElementById("ci_unidad_compra");
  if (unidadBase && select.querySelector(`option[value="${unidadBase}"]`)) { select.value = unidadBase; } else { select.value = "g"; }
  calcularTotalCompraInsumo();
  renderCompraRapido();
}

function actualizarUnidadUso() {
  const sel = document.getElementById("uso_insumo_id");
  const id = Number(sel.value);
  const insumo = insumos.find(i => i.id === id);
  document.getElementById("uso_unidad_base").value = insumo ? insumo.unidad : "";
  document.getElementById("uso_stock_actual").textContent = insumo ? `Stock actual: ${insumo.stock ?? 0} ${insumo.unidad}` : "";
  renderUsoRapido(insumo ? insumo.unidad : "");
  calcularCostoUso();
}

function calcularCostoUso() {
  const insumo_id = Number(document.getElementById("uso_insumo_id").value);
  const cantidadUso = parseFloat(document.getElementById("uso_cantidad").value) || 0;
  const unidadUso = document.getElementById("uso_unidad_compra").value;
  const refEl = document.getElementById("uso_costo_referencia");
  const insumo = insumos.find(i => i.id === insumo_id);
  if (!insumo || cantidadUso <= 0) {
    document.getElementById("uso_costo_estimado").textContent = "Gs. 0";
    if (refEl) refEl.textContent = "";
    return;
  }
  let costoPromedio = insumo.costo_promedio || 0;
  if (costoPromedio === 0) {
    if (refEl) { refEl.innerHTML = `⚠️ "${insumo.nombre}" no tiene costo cargado. Editalo y completá "Costo de referencia", o registrá una Compra para este insumo.`; refEl.style.color = "#dc2626"; }
  } else {
    const factor = obtenerFactorConversion(unidadUso, insumo.unidad);
    const cantidadBase = cantidadUso * factor;
    const costoEstimado = cantidadBase * costoPromedio;
    document.getElementById("uso_costo_estimado").textContent = "Gs. " + Math.round(costoEstimado).toLocaleString("es-PY");
    if (refEl) { refEl.textContent = `Calculado con costo promedio: Gs. ${Math.round(costoPromedio).toLocaleString("es-PY")} por ${insumo.unidad}`; refEl.style.color = "#94a3b8"; }
  }
}

function calcularTotalCompraInsumo() {
  const cantidad = parseFloat(document.getElementById("ci_cantidad").value) || 0;
  const precioPor100g = parseFloat(document.getElementById("ci_precio_por_100g").value) || 0;
  const unidadCompra = document.getElementById("ci_unidad_compra").value;
  const unidadBase = document.getElementById("ci_unidad_base").value || "Kg";
  if (cantidad <= 0 || precioPor100g <= 0) { document.getElementById("ci_precio_por_kilo").value = ""; document.getElementById("ci_precio_total").value = ""; return; }
  let cantidadEnGramos = cantidad;
  if (unidadCompra === "Kg") cantidadEnGramos = cantidad * 1000;
  else if (unidadCompra === "g") cantidadEnGramos = cantidad;
  else if (unidadCompra === "L") cantidadEnGramos = cantidad * 1000;
  else if (unidadCompra === "ml") cantidadEnGramos = cantidad;
  else cantidadEnGramos = cantidad;
  const cantidadEn100g = cantidadEnGramos / 100;
  const precioTotal = cantidadEn100g * precioPor100g;
  const precioPorKg = precioPor100g * 10;
  document.getElementById("ci_precio_por_kilo").value = precioPorKg.toFixed(2);
  document.getElementById("ci_precio_total").value = precioTotal.toFixed(2);
}

document.addEventListener("DOMContentLoaded", () => {
  if (document.getElementById("tabla-insumos")) { listarInsumos(); }
});

window.cargarVentas = cargarVentas;
window.nuevaVenta = nuevaVenta;