const API = "http://localhost:4000"; // mismo host

// LOGOS EN BASE64
let logoConsorcio = "";
let logoSpynet = "";
let cajaAbierta = false;
let cajaActual = null;

async function initPDF() {
  logoConsorcio = await cargarLogoBase64("img/logo1.jpg");
  logoSpynet    = await cargarLogoBase64("img/logo2.png");
}

const empresa = {
    nombre: "SPYnet Proyectos e Infraestructuras",
    direccion: "Av. Principal 123, Valenzuela - Paraguay",
    ruc: "80012345-6",
    telefono: "(0971) 555-555",
    email: "consorciospynet@gmail.com"
};

let PROD_CACHE = [];
let PROD_CACHE_FILTER = [];
let ONLY_LOW_STOCK = false;


// ====== COMPRAS ======  
let subtotalCompra = 0;
let ivaCompra = 0;
let totalCompra = 0;
        
let pp_item_edit_index = -1;
let PP_PRODUCTO_ACTUAL = null;
let pp_items = [];;

// ================== AUTENTICACIÓN ==================
function mustAuth() {
  if (localStorage.getItem('auth') !== 'ok') { location.href = 'login.html'; }
}
mustAuth();

// ================== UTILIDADES BÁSICAS ==================
function qs(s) { return document.querySelector(s) }
function qsa(s) { return [...document.querySelectorAll(s)] }

// ===== Helper para formatear fechas =====
function fmtDate(d) {
    if (!d) return "-";
    const f = new Date(d);
    if (isNaN(f)) return "-";
    return f.toISOString().slice(0, 10);
}

async function listarPedidos() {
  const tabla = document.getElementById("tabla_pedidos");

  tabla.innerHTML = `
    <tr>
      <td colspan="11" class="text-center py-3 text-muted">Cargando...</td>
    </tr>
  `;

  try {
    const pedidos = await jget("/api/pedidos");

    if (!pedidos.length) {
      tabla.innerHTML = `
        <tr>
          <td colspan="11" class="text-center py-3 text-muted">
            No hay pedidos registrados.
          </td>
        </tr>
      `;
      return;
    }

    tabla.innerHTML = "";

    pedidos.forEach(p => {
      const items = Array.isArray(p.items) ? p.items : [];

      // Productos (máx 2 visibles, resto "+N")
      const prodArr = items.map(i => i.producto_nombre || "¿?").filter(Boolean);
      const prodVis = prodArr.slice(0, 2);
      const prodExtra = prodArr.length - prodVis.length;

      const productosHtml = prodArr.length
        ? `
          <div class="text-truncate" style="max-width:320px" title="${prodArr.join(", ")}">
            ${prodVis.join(", ")}${prodExtra > 0 ? ` <span class="badge bg-secondary">+${prodExtra}</span>` : ""}
          </div>
        `
        : `<span class="text-muted">—</span>`;

      // Categorías únicas
      const catArr = [...new Set(items.map(i => i.categoria_nombre || "Sin categoría"))];
      const categoriasHtml = catArr.length
        ? `<div class="text-truncate" style="max-width:220px" title="${catArr.join(", ")}">${catArr.join(", ")}</div>`
        : `<span class="text-muted">—</span>`;

      const cantidad_items = items.reduce((a, i) => a + Number(i.cantidad || 0), 0) || 0;

      const recibido = !!p.fecha_recepcion;
      const estadoHtml = recibido
        ? `<span class="badge bg-success">Recibido</span>`
        : `<span class="badge bg-warning text-dark">Pendiente</span>`;

      const tr = document.createElement("tr");
      tr.innerHTML = `
        <td class="fw-semibold">#${p.id}</td>

        <td>${p.proveedor_nombre || "—"}</td>

        <td>${productosHtml}</td>

        <td>${categoriasHtml}</td>

        <td>${fmtDate(p.fecha_pedido)}</td>

        <td>
          <div class="d-flex flex-column gap-1">
            <span>${p.fecha_recepcion ? fmtDate(p.fecha_recepcion) : "—"}</span>
            ${estadoHtml}
          </div>
        </td>

        <td class="text-center">${cantidad_items}</td>

        <td class="text-end">Gs. ${money(p.subtotal)}</td>
        <td class="text-end">Gs. ${money(p.iva)}</td>
        <td class="text-end fw-semibold">Gs. ${money(p.total)}</td>

        <td class="text-center">
          <button class="btn btn-danger btn-sm" onclick="eliminarPedido(${p.id})" title="Eliminar pedido">
            <i class="fa-solid fa-trash"></i>
          </button>
        </td>
      `;

      tabla.appendChild(tr);
    });

  } catch (err) {
    console.error(err);
    tabla.innerHTML = `
      <tr>
        <td colspan="11" class="text-center py-3 text-danger">
          Error cargando pedidos.
        </td>
      </tr>
    `;
  }
}
function confirmarEliminarPedido(id) {
    if (!confirm("¿Está seguro de eliminar este pedido?")) return;
    eliminarPedido(id);
}

// Formato de dinero (Gs. 12.345)
function money(v) {
  const n = Number(v || 0);
  return n.toLocaleString('es-PY', { minimumFractionDigits: 0 });
}
// Formato pro con Intl (se usa en Pedidos)
const fmtPYG = (n) =>
  new Intl.NumberFormat('es-PY', { style: 'currency', currency: 'PYG', maximumFractionDigits: 0 }).format(Number(n || 0));
const fmtDateTime = (d) =>
  new Date(d).toLocaleString('es-PY', { dateStyle: 'short', timeStyle: 'short' });

// Evita XSS al inyectar strings
const escapeHtml = (str) =>
  (str ?? '')
    .toString()
    .replace(/[&<>"'`=\/]/g, (s) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;', '/': '&#x2F;', '`': '&#x60;', '=': '&#x3D;' }[s]));

// ===== Navegación de secciones =====
function show(hash) {

  qsa('section.view').forEach(sec => sec.classList.add('hidden'));

  const el = qs(hash || '#dashboard');
  if (el) el.classList.remove('hidden');

  qsa('.nav a[data-link]').forEach(a =>
    a.classList.toggle('active', a.getAttribute('href') === hash)
  );

  if (hash === '#dashboard') cargarVentasResumen();
  if (hash === '#ventas') cargarVentas();
  if (hash === '#clientes') listarClientes();
  if (hash === '#productos') listarProductos();
  if (hash === '#proveedores') listarProveedores();
if (hash === '#categorias') listarCategorias();
if (hash === '#lista_pedidos') {
  listarPedidos();
}
if (hash === '#pedidos') {
  cargarProveedoresPedido();
}

  if (hash === '#caja') {
    const f = document.getElementById("fechaCaja");
    if (f && !f.value) f.value = toYMD(new Date());
    verificarCaja();
    cargarRecaudacionFecha();
  }

  if (hash === '#formas-pago') {
    listarFP(); // 👈 único responsable
  }
}
function logout() {
    // Cierra cualquier modal abierto antes
    closeAllModals();

    // Abre el modal de confirmación de cierre de sesión
    document.getElementById("logoutModal").style.display = "flex";
}

function closeLogoutModal() {
    // Cierra solamente el modal de logout
    document.getElementById("logoutModal").style.display = "none";
}

function confirmLogout() {
    // Eliminar autenticación
    localStorage.removeItem("auth");

    // Redirigir a login
    window.location.href = "login.html";
}

function closeAllModals() {
    // Cierra TODOS los modales del sistema
    document.querySelectorAll(".modal").forEach(m => {
        m.style.display = "none";
    });
}

function esDelMesActual(fecha) {
    const f = new Date(fecha);
    const hoy = new Date();

    return (
        f.getMonth() === hoy.getMonth() &&
        f.getFullYear() === hoy.getFullYear()
    );
}

function nav(hash) {
    location.hash = hash;
    show(hash);
}
// ================== MODALES ==================
function openModal(id){
  const el = document.getElementById(id);
  if(!el) return console.error("Modal no encontrado:", id);

  // compatibilidad con modales con display:none
  el.style.display = "flex";
  el.classList.add("show");
  document.body.classList.add("modal-open");
}

function closeModal(id){
  const el = document.getElementById(id);
  if(!el) return console.error("Modal no encontrado:", id);

  el.classList.remove("show");
  el.style.display = "none";
  document.body.classList.remove("modal-open");
}

window.openModal = openModal;
window.closeModal = closeModal;
async function abrirModalSelProducto(){
  openModal('modalSelProducto');

  // ✅ Cargar productos y llenar PROD_CACHE (importante)
  await listarProductos(); // esto debe llenar PROD_CACHE

  // ✅ Render del modal
  renderProductosPedidoModal(PROD_CACHE);
}
window.seleccionarProductoPP = seleccionarProductoPP;

function agregarProductoAlPedido() {
  const p = window.PP_PRODUCTO_ACTUAL || null;
  if (!p) return alert("No hay producto seleccionado");

  const cantidad = Number(document.getElementById("pp_edit_cantidad")?.value || 0);
  const unidad   = (document.getElementById("pp_edit_unidad")?.value || "unidad").trim();
  const costoTxt = (document.getElementById("pp_edit_costo")?.value || "").trim();
  const costo    = Number(costoTxt.replace(/\D/g, "")) || 0;

  if (cantidad <= 0 || costo <= 0) return alert("Cantidad o costo inválido");

  // ✅ Asegurar array global
  if (!Array.isArray(window.pp_items)) window.pp_items = [];

  const item = {
    id: p.id,
    nombre: p.nombre || "",
    cantidad,
    unidad,
    costo,
    subtotal: cantidad * costo
  };

  // si ya existe, actualizar
  const idx = window.pp_items.findIndex(x => Number(x.id) === Number(item.id));
  if (idx >= 0) window.pp_items[idx] = item;
  else window.pp_items.push(item);

  if (typeof renderPP_Items === "function") renderPP_Items();

  closeModal("modalEditarPP");
}
window.agregarProductoAlPedido = agregarProductoAlPedido;

async function cargarProductosModalPP(){
  const tbody = document.getElementById("tablaSelProductos");
  if(!tbody) return console.error("❌ No existe #tablaSelProductos");

  tbody.innerHTML = `
    <tr><td colspan="6" style="padding:12px;color:#6b7280">Cargando...</td></tr>
  `;

  try {
    // 👇 USÁ el endpoint que realmente funciona en tu backend
    // si tus productos se cargan con /productos, dejá este:
    const data = await jget("/productos"); // <-- CAMBIO CLAVE (antes /api/productos)

    if(!Array.isArray(data)) throw new Error("Respuesta inválida /productos");

    // ✅ LLENAR EL CACHE GLOBAL QUE USA seleccionarProductoPP()
    PROD_CACHE = (data || []).map(p => ({
      ...p,
      id: Number(p.id),
      nombre: p.nombre || "",
      marca: p.marca || "",
      categoria: p.categoria || "",
      costo: Number(p.costo || 0),
      stock: Number(p.stock || 0),
    }));

    if(!PROD_CACHE.length){
      tbody.innerHTML = `<tr><td colspan="6" style="padding:12px;color:#6b7280">No hay productos.</td></tr>`;
      return;
    }

    renderProductosPedidoModal(PROD_CACHE);

  } catch (err) {
    console.error("❌ Error cargando productos:", err);
    tbody.innerHTML = `<tr><td colspan="6" style="padding:12px;color:#ef4444">Error al cargar productos.</td></tr>`;
  }
}

// ================== FETCH HELPERS (cookies) ==================
async function jget(url) {
  const r = await fetch(API + url, { credentials: 'include' });
  if (!r.ok) throw new Error(await r.text());
  return await r.json();
}

async function cargarVentasResumen() {
  const ventas = await jget("/ventas");
  const hoyYMD = toYMD(new Date());
  const mesYMD = hoyYMD.slice(0, 7);

  let totalHoy = 0;
  let totalMes = 0;
  let totalAnho = 0;

  for (const v of ventas) {
    const fRaw = (v.fecha || v.created_at || "").toString();
    const fYMD = toYMD(fRaw);
    const t = Number(v.total || 0);

    if (!fYMD) continue;

    // año
    if (fYMD.slice(0, 4) === hoyYMD.slice(0, 4)) {
      totalAnho += t;
    }

    // mes
    if (fYMD.slice(0, 7) === mesYMD) {
      totalMes += t;
    }

    // hoy
    if (fYMD === hoyYMD) {
      totalHoy += t;
    }
  }

  const setTxt = (id, val) => {
    const el = document.getElementById(id);
    if (el) el.textContent = "Gs. " + money(val);
  };

  setTxt("dash-ventas-hoy", totalHoy);
  setTxt("dash-ventas-mes", totalMes);
  setTxt("dash-ventas-anho", totalAnho);
}

async function jpost(url, data) {
  const r = await fetch(API + url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
    credentials: 'include'
  });
  if (!r.ok) throw new Error(await r.text());
  return await r.json();
}
async function jput(url, data) {
  const r = await fetch(API + url, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
    credentials: 'include'
  });
  if (!r.ok) throw new Error(await r.text());
  return await r.json();
}
async function jdel(url) {
  const r = await fetch(API + url, { method: 'DELETE', credentials: 'include' });
  if (!r.ok) throw new Error(await r.text());
  return await r.json();
}

// Toma el value del primer selector que exista
function gv(...selectors) {
  for (const sel of selectors) { const el = qs(sel); if (el) return (el.value || '').trim(); }
  return '';
}

// ================== PAGINACIÓN Y EXPORTS ==================
function paginateRows(rows, page, perPage) {
  const total = rows.length, pages = Math.max(1, Math.ceil(total / perPage));
  const p = Math.min(Math.max(1, page), pages);
  const start = (p - 1) * perPage, end = start + perPage;
  return { page: p, pages, slice: rows.slice(start, end), total };
}
function renderPagination(containerSel, state, onChange) {
  const el = document.createElement('div');
  el.className = 'actions'; el.style.margin = '.75rem 0';
  el.innerHTML = `
    <button class="btn secondary" ${state.page <= 1 ? 'disabled' : ''} data-act="prev">« Prev</button>
    <span class="badge">Página ${state.page} / ${state.pages}</span>
    <button class="btn secondary" ${state.page >= state.pages ? 'disabled' : ''} data-act="next">Next »</button>
    <select class="input" style="width:90px" data-act="per">
      <option ${state.perPage == 10 ? 'selected' : ''}>10</option>
      <option ${state.perPage == 25 ? 'selected' : ''}>25</option>
      <option ${state.perPage == 50 ? 'selected' : ''}>50</option>
    </select>`;
  el.onclick = (e) => {
    const act = e.target.getAttribute('data-act');
    if (act === 'prev') onChange(state.page - 1, state.perPage);
    if (act === 'next') onChange(state.page + 1, state.perPage);
  };
  el.querySelector('[data-act="per"]').addEventListener('change', ev => onChange(1, Number(ev.target.value)));
  const cont = document.querySelector(containerSel);
  if (cont) { cont.appendChild(el); }
}
function exportTableCSV(tableSel, filename) {
  const table = document.querySelector(tableSel); if (!table) return alert('Tabla no encontrada');
  let csv = []; for (const row of table.querySelectorAll('tr')) {
    let cols = [...row.children].map(td => '"' + td.innerText.replaceAll('"', '""') + '"');
    csv.push(cols.join(','));
  }
  const blob = new Blob([csv.join('\n')], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a'); a.href = url; a.download = filename || 'export.csv'; a.click(); URL.revokeObjectURL(url);
}
function printTableAsPDF(containerSel, title) {
  const cont = document.querySelector(containerSel); if (!cont) return alert('Contenido no encontrado');
  const w = window.open('', '_blank');
  w.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>${title || 'Reporte'}</title>
  <style>body{font-family:system-ui;padding:20px} h1{font-size:18px;margin-bottom:10px}
  table{width:100%;border-collapse:collapse} th,td{padding:6px;border:1px solid #ddd;text-align:left} th{background:#f3f4f6}</style>
  </head><body><h1>${title || 'Reporte'}</h1>${cont.innerHTML}</body></html>`);
  w.document.close(); w.focus(); w.print(); setTimeout(() => w.close(), 500);
}

// ================== UI PRO (Toast, Loading, Skeleton) ==================
function toast(msg, type = 'info') {
  const el = document.createElement('div');
  el.className = `toast ${type}`;
  el.textContent = msg;
  Object.assign(el.style, {
    position: 'fixed', right: '1rem', bottom: '1rem', padding: '.75rem 1rem',
    background: type === 'error' ? '#c0392b' : type === 'success' ? '#2ecc71' : '#34495e',
    color: '#fff', borderRadius: '10px', boxShadow: '0 6px 20px rgba(0,0,0,.25)', zIndex: 9999, opacity: 0,
    transition: 'opacity .15s ease'
  });
  document.body.appendChild(el);
  requestAnimationFrame(() => (el.style.opacity = 1));
  setTimeout(() => { el.style.opacity = 0; setTimeout(() => el.remove(), 200); }, 3000);
}
async function withLoading(btn, fn) {
  if (!btn) return fn();
  const old = btn.innerHTML;
  btn.disabled = true;
  btn.innerHTML = '<span class="spinner"></span>';
  try { return await fn(); }
  finally { btn.disabled = false; btn.innerHTML = old; }
}
function renderSkeleton(rows = 6) {
  return `
    <table class="table">
      <thead>
        <tr><th>ID</th><th>Fecha</th><th>Proveedor</th><th>Estado</th><th>Total Estimado</th><th>Acciones</th></tr>
      </thead>
      <tbody>
        ${Array.from({ length: rows }).map(() => `
          <tr class="skeleton">
            <td style="width:60px"></td><td></td><td></td><td></td><td></td><td style="width:280px"></td>
          </tr>`).join('')}
      </tbody>
    </table>`;
}

// ================== DASHBOARD KPIs ==================
async function cargarKpis() {
    const [ventas, compras, productos] = await Promise.all([
        jget('/ventas'),
        jget('/compras'),
        jget('/productos')
    ]);

    const hoy = new Date();
    const MES = hoy.toLocaleString("es-ES", { month: "long" });
    const ANHO = hoy.getFullYear();

    // Filtrado
    const ventasMes = ventas.filter(v => esDelMesActual(v.fecha));
    const comprasMes = compras.filter(c => esDelMesActual(c.fecha));

    const ventasAnho = ventas.filter(v => new Date(v.fecha).getFullYear() === ANHO);
    const comprasAnho = compras.filter(c => new Date(c.fecha).getFullYear() === ANHO);

    // Totales
    const totalVentasMes = ventasMes.reduce((a, v) => a + Number(v.total || 0), 0);
    const totalComprasMes = comprasMes.reduce((a, c) => a + Number(c.total || 0), 0);

    const totalVentasAnho = ventasAnho.reduce((a, v) => a + Number(v.total || 0), 0);
    const totalComprasAnho = comprasAnho.reduce((a, c) => a + Number(c.total || 0), 0);

    // Stock
    const stockTotal = productos.length;

    // Render
    qs("#kpi-ventas-mes-title").textContent = `${MES} ${ANHO}`;
    qs("#kpi-compras-mes-title").textContent = `${MES} ${ANHO}`;
    qs("#kpi-stock-mes-title").textContent = `${MES} ${ANHO}`;

    qs("#kpi-ventas-mes").textContent = "Gs. " + money(totalVentasMes);
    qs("#kpi-compras-mes").textContent = "Gs. " + money(totalComprasMes);

    qs("#kpi-ventas-anho").textContent = "Gs. " + money(totalVentasAnho);
    qs("#kpi-compras-anho").textContent = "Gs. " + money(totalComprasAnho);

    qs("#kpi-productos").textContent = stockTotal;
}

let clientesOriginal = [];   // lista completa desde el servidor
let clientesFiltrados = [];  // lista filtrada
let clientesPaginaActual = 1;
let clientesPorPagina = 8;

/* ============================================
      CARGAR CLIENTES DESDE EL SERVIDOR
============================================ */
async function listarClientes() {
    try {
        const data = await jget("/clientes");

        clientesOriginal = data;
        clientesFiltrados = [...clientesOriginal];

        clientesPaginaActual = 1;
        renderClientesTabla();

    } catch (err) {
        console.error("Error cargando clientes:", err);
    }
}

/* ============================================
      RENDER TABLA + PAGINACIÓN
============================================ */
function renderClientesTabla() {
    const tbody = document.getElementById("tabla-clientes");
    const pag = document.getElementById("clientes-paginacion");

    if (!tbody) return;

    tbody.innerHTML = "";
    pag.innerHTML = "";

    if (!clientesFiltrados.length) {
        tbody.innerHTML = `
            <tr><td colspan="9" style="text-align:center;padding:1rem;">
                No se encontraron clientes.
            </td></tr>`;
        return;
    }

    const inicio = (clientesPaginaActual - 1) * clientesPorPagina;
    const fin = inicio + clientesPorPagina;

    const pageData = clientesFiltrados.slice(inicio, fin);

    pageData.forEach(cli => {
        const tr = document.createElement("tr");

        tr.innerHTML = `
            <td>${cli.id}</td>
            <td>${cli.nombre} ${cli.apellido || ""}</td>
            <td>${cli.ci || ""}</td>
            <td>${cli.telefono || ""}</td>
            <td>${cli.pais || ""}</td>
            <td>${cli.ciudad || ""}</td>
            <td>${cli.direccion || ""}</td>

            <td>
                <span class="estado-badge ${cli.estado}">
                ${cli.estado === "pagado" ? "Pagado" : "Pendiente de pago"}
                </span>
            </td>

            <td style="text-align:center;">
                <button class="btn-icon edit" onclick="abrirEditarCliente(${cli.id})">
                    <i class="fa fa-pen"></i>
                </button>
                <button class="btn-icon delete" onclick="eliminarCliente(${cli.id})">
                    <i class="fa fa-trash"></i>
                </button>
            </td>
        `;

        tbody.appendChild(tr);
    });

    renderPaginacionClientes();
}

/* ============================================
      PAGINACIÓN
============================================ */
function renderPaginacionClientes() {
    const div = document.getElementById("clientes-paginacion");
    div.innerHTML = "";

    const total = Math.ceil(clientesFiltrados.length / clientesPorPagina);

    if (total <= 1) return;

    div.innerHTML += `
        <button class="pag-btn" onclick="cambiarPaginaClientes(${clientesPaginaActual - 1})"
            ${clientesPaginaActual === 1 ? "disabled" : ""}>‹</button>
    `;

    for (let i = 1; i <= total; i++) {
        div.innerHTML += `
            <button class="pag-btn ${i === clientesPaginaActual ? "active" : ""}"
                onclick="cambiarPaginaClientes(${i})">${i}</button>
        `;
    }

    div.innerHTML += `
        <button class="pag-btn" onclick="cambiarPaginaClientes(${clientesPaginaActual + 1})"
            ${clientesPaginaActual === total ? "disabled" : ""}>›</button>
    `;
}

function cambiarPaginaClientes(nueva) {
    const total = Math.ceil(clientesFiltrados.length / clientesPorPagina);
    if (nueva < 1 || nueva > total) return;

    clientesPaginaActual = nueva;
    renderClientesTabla();
}

/* ============================================
      FILTRO DE CLIENTES
============================================ */
function filtrarClientes(q) {
    q = q.toLowerCase();

    clientesFiltrados = clientesOriginal.filter(c =>
        (c.nombre + " " + (c.apellido || "")).toLowerCase().includes(q) ||
        (c.ci || "").toLowerCase().includes(q) ||
        (c.telefono || "").toLowerCase().includes(q) ||
        (c.pais || "").toLowerCase().includes(q) ||
        (c.ciudad || "").toLowerCase().includes(q) ||
        (c.direccion || "").toLowerCase().includes(q)
    );

    clientesPaginaActual = 1;
    renderClientesTabla();
}

/* ============================================
      NUEVO CLIENTE
============================================ */
async function guardarCliente() {
    const body = {
        nombre: gv("#c_nombre"),
        apellido: gv("#c_apellido"),
        ci: gv("#c_ci"),
        telefono: gv("#c_tel"),
        pais: gv("#c_country"),
        ciudad: gv("#c_city"),
        direccion: gv("#c_dir"),
        estado: gv("#c_status")
    };

    if (!body.ci) return alert("El CI es obligatorio.");

    try {
        await jpost("/clientes", body);

        closeModal("modalCliente");
        listarClientes();

    } catch (err) {
        console.error(err);
        alert("No se pudo guardar el cliente.");
    }
}

/* ============================================
      EDITAR CLIENTE
============================================ */
function abrirEditarCliente(id) {
    const cli = clientesOriginal.find(c => c.id === id);
    if (!cli) return;

    qs("#cli_edit_id").value = cli.id;
    qs("#ce_nombre").value = cli.nombre;
    qs("#ce_apellido").value = cli.apellido;
    qs("#ce_ci").value = cli.ci;
    qs("#ce_tel").value = cli.telefono;
    qs("#ce_country").value = cli.pais;
    qs("#ce_city").value = cli.ciudad;
    qs("#ce_dir").value = cli.direccion;
    qs("#ce_status").value = cli.estado || "pendiente"

    openModal("modalClienteEdit");
}

async function actualizarCliente() {
    const id = qs("#cli_edit_id").value;

    const body = {
        nombre: gv("#ce_nombre"),
        apellido: gv("#ce_apellido"),
        ci: gv("#ce_ci"),
        telefono: gv("#ce_tel"),
        pais: gv("#ce_country"),
        ciudad: gv("#ce_city"),
        direccion: gv("#ce_dir"),
        estado: gv("#ce_status")
    };

    if (!body.ci) return alert("El CI es obligatorio.");

    try {
        await jput("/clientes/" + id, body);

        closeModal("modalClienteEdit");
        listarClientes();

    } catch (err) {
        console.error(err);
        alert("No se pudo actualizar el cliente.");
    }
}

/* ============================================
      ELIMINAR CLIENTE
============================================ */
async function eliminarCliente(id) {
    if (!confirm("¿Eliminar cliente?")) return;

    try {
        await jdel("/clientes/" + id);
        listarClientes();

    } catch (err) {
        console.error(err);
        alert("No se pudo eliminar.");
    }
}

// ================== USERS ==================
let USERS_CACHE = [], USERS_FILTER = [], USERS_PG = { page: 1, perPage: 10 };
async function listarUsers() {
  const data = await jget('/users');
  USERS_CACHE = data; USERS_FILTER = data; renderUsers();
}
function filtrarUsers(q) {
  q = (q || '').toLowerCase();
  USERS_FILTER = USERS_CACHE.filter(u =>
    (u.username || '').toLowerCase().includes(q) ||
    (u.email || '').toLowerCase().includes(q) ||
    (u.role || '').toLowerCase().includes(q)
  );
  USERS_PG.page = 1; renderUsers();
}
function renderUsers() {
  const { page, perPage } = USERS_PG;
  const pg = paginateRows(USERS_FILTER, page, perPage);
  const rows = pg.slice.map(u => `<tr>
    <td>${u.username}</td><td>${u.email || ''}</td><td><span class="badge">${u.role}</span></td>
    <td>${u.is_active ? '<span class="badge" style="background:#d1fae5;color:#065f46">Activo</span>' : '<span class="badge" style="background:#fee2e2;color:#991b1b">Inactivo</span>'}</td>
    <td class="actions">
      <button class="btn secondary" onclick="abrirEditarUser(${u.id})">Editar</button>
      <button class="btn ghost" onclick="eliminarUser(${u.id})">Eliminar</button>
    </td>
  </tr>`).join('');
  qs('#tabla-users').innerHTML = `<table class="table"><thead><tr>
    <th>Username</th><th>Email</th><th>Rol</th><th>Estado</th><th>Acción</th>
  </tr></thead><tbody>${rows}</tbody></table>`;
  renderPagination('#tabla-users', { page: pg.page, pages: pg.pages, perPage: USERS_PG.perPage }, (p, pp) => { USERS_PG.page = p; USERS_PG.perPage = pp; renderUsers(); });
}
async function guardarUser() {
  const body = {
    username: gv('#u_username'), email: gv('#u_email'),
    password: gv('#u_password'), role: gv('#u_role'),
    is_active: gv('#u_activo') === 'true'
  };
  await jpost('/users', body);
  closeModal('modalUser'); listarUsers();
}
function abrirEditarUser(id) {
  const u = USERS_CACHE.find(x => x.id === id); if (!u) return;
  qs('#ue_id').value = u.id;
  qs('#ue_username').value = u.username || '';
  qs('#ue_email').value = u.email || '';
  qs('#ue_role').value = u.role || 'consulta';
  qs('#ue_activo').value = String(!!u.is_active);
  openModal('modalUserEdit');
}
async function actualizarUser() {
  const id = Number(qs('#ue_id').value);
  const body = {
    username: gv('#ue_username'), email: gv('#ue_email'),
    role: gv('#ue_role'), is_active: gv('#ue_activo') === 'true'
  };
  const pass = gv('#ue_password'); if (pass) body.password = pass;
  await jput('/users/' + id, body);
  closeModal('modalUserEdit'); listarUsers();
}
async function eliminarUser(id) { if (!confirm('¿Eliminar usuario?')) return; await jdel('/users/' + id); listarUsers(); }

// ================== PROVEEDORES ==================
let PROV_CACHE = [], PROV_FILTER = [];
let provPaginaActual = 1;
let provPorPagina = 8;
let proveedoresOriginal = [];
let proveedoresFiltrados = [];
let PROV_PAGE = 1;
const PROV_PER_PAGE = 8;
async function listarProveedores() {
  const data = await jget('/proveedores');

  proveedoresOriginal = (data || []).map(p => ({
    ...p,
    id: Number(p.id),
    pais: p.pais || "",
    ciudad: p.ciudad || "",
    estado: (p.estado === false ? false : true)
  }));

  proveedoresFiltrados = [...proveedoresOriginal];
  provPaginaActual = 1;
  PROV_CACHE = [...proveedoresOriginal];
  PROV_FILTER = [...proveedoresFiltrados];

  renderProveedoresTabla();
}

function filtrarProveedores(q) {
  q = (q || "").toLowerCase();

  proveedoresFiltrados = proveedoresOriginal.filter(p =>
    (p.nombre || "").toLowerCase().includes(q) ||
    (p.ruc || "").toLowerCase().includes(q) ||
    (p.contacto || "").toLowerCase().includes(q) ||
    (p.telefono || "").toLowerCase().includes(q) ||
    (p.ciudad || "").toLowerCase().includes(q)
  );

  provPaginaActual = 1;
  renderProveedoresTabla();
}
function renderProveedoresTabla() {
    const tbody = document.getElementById("tabla-proveedores");
    const pag = document.getElementById("proveedores-paginacion");

    tbody.innerHTML = "";
    pag.innerHTML = "";

    if (!proveedoresFiltrados.length) {
        tbody.innerHTML = `
            <tr><td colspan="10" style="text-align:center;padding:1rem;">
                No se encontraron proveedores.
            </td></tr>`;
        return;
    }

    const inicio = (provPaginaActual - 1) * provPorPagina;
    const fin = inicio + provPorPagina;

    const pageData = proveedoresFiltrados.slice(inicio, fin);

    pageData.forEach(p => {
        const tr = document.createElement("tr");

        tr.innerHTML = `
            <td>${p.id}</td>
            <td>${p.nombre}</td>
            <td>${p.ruc || ''}</td>
            <td>${p.contacto || ''}</td>
            <td>${p.telefono || ''}</td>
            <td>${p.pais || ''}</td>
            <td>${p.ciudad || ''}</td>
            <td>${p.direccion || ''}</td>

            <td>
                <span class="estado-badge ${p.estado ? "Activo" : "Inactivo"}">
                    ${p.estado ? "Activo" : "Inactivo"}
                </span>
            </td>

            <td class="actions text-center">
                <button class="btn-icon edit" onclick="abrirEditarProveedor(${p.id})">
                    <i class="fa fa-pen"></i>
                </button>

                <button class="btn-icon delete" onclick="eliminarProveedor(${p.id})">
                    <i class="fa fa-trash"></i>
                </button>
            </td>
        `;

        tbody.appendChild(tr);
    });

    renderPaginacionProveedores();
}
function renderPaginacionProveedores() {
    const div = document.getElementById("proveedores-paginacion");
    div.innerHTML = "";

    const total = Math.ceil(proveedoresFiltrados.length / provPorPagina);

    if (total <= 1) return;

    div.innerHTML += `
        <button class="pag-btn" onclick="cambiarPaginaProveedores(${provPaginaActual - 1})"
            ${provPaginaActual === 1 ? "disabled" : ""}>‹</button>
    `;

    for (let i = 1; i <= total; i++) {
        div.innerHTML += `
            <button class="pag-btn ${i === provPaginaActual ? "active" : ""}"
                onclick="cambiarPaginaProveedores(${i})">${i}</button>
        `;
    }

    div.innerHTML += `
        <button class="pag-btn" onclick="cambiarPaginaProveedores(${provPaginaActual + 1})"
            ${provPaginaActual === total ? "disabled" : ""}>›</button>
    `;
}
function cambiarPaginaProveedores(nueva) {
    const total = Math.ceil(proveedoresFiltrados.length / provPorPagina);
    if (nueva < 1 || nueva > total) return;

    provPaginaActual = nueva;
    renderProveedoresTabla();
}
function filtrarProveedores(q) {
    q = (q || "").toLowerCase();

    PROV_FILTER = PROV_CACHE.filter(p =>
        (p.nombre || "").toLowerCase().includes(q) ||
        (p.ruc || "").toLowerCase().includes(q) ||
        (p.contacto || "").toLowerCase().includes(q) ||
        (p.telefono || "").toLowerCase().includes(q) ||
        (p.ciudad || "").toLowerCase().includes(q)
    );

    PROV_PAGE = 1;
    renderProveedores();
}

async function guardarProveedor() {
  const body = {
    nombre: gv('#p_nombre'), ruc: gv('#p_ruc'), contacto: gv('#p_contacto'),
    telefono: gv('#p_tel'), pais: gv('#p_pais'), ciudad: gv('#p_ciudad'),
    direccion: gv('#p_dir'), estado: (gv('#p_estado') !== 'Inactivo')
  };
  try {
    if (!body.nombre) return alert('El nombre es obligatorio');
    if (!body.ruc) return alert('El RUC es obligatorio');
    await jpost('/proveedores', body);
    closeModal('modalProveedor'); listarProveedores();
  } catch (e) { console.error(e); alert('No se pudo guardar el proveedor.\n' + e.message); }
}
function abrirEditarProveedor(id) {
  const _id = Number(id);

  // ✅ usar la lista que realmente llenás en listarProveedores()
  const p = (proveedoresOriginal || []).find(x => Number(x.id) === _id);

  if (!p) { 
    alert('Proveedor no encontrado'); 
    return; 
  }

  const set = (sel, val) => { 
    const el = qs(sel); 
    if (el) el.value = (val ?? ''); 
  };

  set('#prov_edit_id', p.id);
  set('#pe_nombre', p.nombre);
  set('#pe_ruc', p.ruc);
  set('#pe_contacto', p.contacto);
  set('#pe_tel', p.telefono);
  set('#pe_pais', p.pais);
  set('#pe_ciudad', p.ciudad);
  set('#pe_dir', p.direccion);

  // ✅ soporta boolean o texto
  const est = (p.estado === false || String(p.estado).toLowerCase() === 'inactivo')
    ? 'Inactivo'
    : 'Activo';
  set('#pe_estado', est);

  openModal('modalProveedorEdit');
}
async function actualizarProveedor() {
  const id = Number(gv('#prov_edit_id'));
  const body = {
    nombre: gv('#pe_nombre'), ruc: gv('#pe_ruc'), contacto: gv('#pe_contacto'),
    telefono: gv('#pe_tel'), pais: gv('#pe_pais'), ciudad: gv('#pe_ciudad'),
    direccion: gv('#pe_dir'), estado: (gv('#pe_estado') !== 'Inactivo')
  };
  try {
    if (!id) return alert('ID inválido');
    if (!body.nombre) return alert('El nombre es obligatorio');
    if (!body.ruc) return alert('El RUC es obligatorio');
    await jput('/proveedores/' + id, body);
    closeModal('modalProveedorEdit'); listarProveedores();
  } catch (e) { console.error(e); alert('No se pudo actualizar el proveedor.\n' + e.message); }
}
async function eliminarProveedor(id) {
  if (!confirm('¿Eliminar proveedor?')) return;
  try { await jdel('/proveedores/' + id); listarProveedores(); }
  catch (e) { console.error(e); alert('No se pudo eliminar.\n' + e.message); }
}

// ================== PRODUCTOS ==================
async function listarProductos() {
  const data = await jget('/productos');

  PROD_CACHE = data.map(p => ({
    ...p,

    id: Number(p.id),

    // CAMPOS QUE NECESITA EL MODAL
    nombre: p.nombre || '',        // <-- ESTA ES LA QUE FALTABA
    marca: p.marca || '',
    categoria: p.categoria || '',
    categoria_id: p.categoria_id ?? null,
    costo: Number(p.costo || p.cost || 0), // para compras y pedidos
    precio: Number(p.precio || 0),
    stock: Number(p.stock || 0),

    descripcion: p.descripcion || '',
    imagen_base64: p.imagen_base64 || '',
    stock_min: p.stock_min ?? 0
  }));

  PROD_CACHE_FILTER = PROD_CACHE;

  const sel = qs('#prodCatFilter');
  if (sel && Array.isArray(CAT_CACHE) && CAT_CACHE.length) {
    sel.innerHTML =
      '<option value="">Todas las categorías</option>' +
      CAT_CACHE.map(c => `<option value="${c.id}">${c.nombre}</option>`).join('');
  }

  renderProductos(PROD_CACHE_FILTER);
}
function toggleLowStock() {
  ONLY_LOW_STOCK = !ONLY_LOW_STOCK;
  const b = qs('#btnLowStock');
  if (b) { b.classList.toggle('ghost', !ONLY_LOW_STOCK); }
  filtrarProductos(qs('#prodSearch')?.value || '');
}
function filtrarProductos(q) {
  q = (q || '').toLowerCase();
  PROD_CACHE_FILTER = PROD_CACHE.filter(p =>
    (p.codigo || '').toLowerCase().includes(q) ||
    (p.nombre || '').toLowerCase().includes(q) ||
    (p.marca || '').toLowerCase().includes(q) ||
    (p.categoria || '').toLowerCase().includes(q)
  );
  renderProductos(PROD_CACHE_FILTER);
}
function pct(costo, precio) {
  const c = Number(costo || 0), p = Number(precio || 0);
  if (!isFinite(c) || !isFinite(p) || p <= 0) return '—';
  return Math.round(((p - c) / p) * 100);
}
function renderProductos(list) {
  const per = Number(qs('#prodEntries')?.value || 10);
  const pg = paginateRows(list, 1, per);

  const rows = pg.slice.map(p => {
    const catName = (CAT_CACHE.find(c => c.id === p.categoria_id) || {}).nombre || p.categoria || '-';
    const img = p.imagen_base64 || p.imagen || 'img/no-image.png';
    const costo = (p.costo ?? p.cost ?? null);
    const lowCfg = Number(p.stock_min || 0) > 0;
    const isLow = lowCfg && Number(p.stock) <= Number(p.stock_min || 0);

    return `
    <tr data-id="${p.id}">
      <td><input type="checkbox" aria-label="Seleccionar fila"></td>
      <td style="text-align:center;">${p.id}</td>
      <td style="text-align:center;">
        <img src="${img}" alt="Imagen del producto" onerror="this.src='img/no-image.png'"
             style="width:45px;height:45px;border-radius:6px;object-fit:cover;">
      </td>
      <td>${p.codigo || '-'}</td>
      <td>${catName}</td>
      <td>Gs. ${money(p.precio)}</td>
      <td>${p.marca || '-'}</td>
      <td>${costo != null ? 'Gs. ' + money(costo) : '—'}</td>
      <td>${Number(p.stock || 0)}${isLow ? '<span class="badge low">Bajo</span>' : ''}</td>
      <td style="display:flex; gap:.4rem;">
        <button class="btn-circle btn-edit" title="Editar" onclick="abrirEditar(${p.id})"><i class="fa fa-pen"></i></button>
        <button class="btn-circle btn-del" title="Eliminar" onclick="eliminarProducto(${p.id})"><i class="fa fa-trash"></i></button>
      </td>
    </tr>`;
  }).join('');

  qs('#tabla-productos').innerHTML = `
    <table class="table posdash">
      <thead>
        <tr>
          <th style="width:34px;"></th>
          <th>ID</th>
          <th>Producto</th>
          <th>Código</th>
          <th>Categoría</th>
          <th>Precio</th>
          <th>Marca</th>
          <th>Costo</th>
          <th>Cantidad</th>
          <th>Acciones</th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>`;
}
async function eliminarProducto(id) {
  if (!confirm("¿Seguro que querés eliminar este producto?")) return;
  try {
    const res = await fetch(`${API}/productos/${id}`, { method: 'DELETE', credentials: 'include' });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Error al eliminar');
    alert('Producto eliminado correctamente ✅');
    listarProductos();
  } catch (err) { alert('⚠️ Error al eliminar: ' + err.message); }
}
function resetNuevoProducto() {
  ['#pr_codigo', '#pr_nombre', '#pr_marca', '#pr_precio', '#pr_costo', '#pr_stock', '#pr_cat', '#pr_desc']
    .forEach(sel => { const el = qs(sel); if (el) el.value = ''; });
  const file = qs('#pr_img'); if (file) file.value = '';
  const prev = qs('#pr_img_preview'); if (prev) prev.src = 'img/no-image.png';
}
function abrirNuevoProducto() { resetNuevoProducto(); openModal('modalProducto'); }
async function guardarProducto(e) {
  try {
    e?.preventDefault?.();
    const btn = qs('#btnGuardarProd');
    btn?.setAttribute('disabled', 'true');

    let img = '';
    const f = qs('#pr_img')?.files?.[0];
    if (f) img = await readFileAsDataUrl(f);

    const rawCat = gv('#pr_cat');
    const categoria_id = /^\d+$/.test(rawCat) ? Number(rawCat) : null;
    const categoria = categoria_id ? null : (rawCat || null);

    const codigo = gv('#pr_codigo');
    const nombre = gv('#pr_nombre');
    const nombreFinal = (nombre || '').trim() || (codigo || '').trim() || '';

    // ✅ soporta "40.000" / "40 000" / "40,000" / "40000" -> 40000
    const costoTxt  = (gv('#pr_costo') || '');
    const precioTxt = (gv('#pr_precio') || '');

    const costo  = Number(String(costoTxt).replace(/\D/g, '')) || 0;
    const precio = Number(String(precioTxt).replace(/\D/g, '')) || 0;

    const body = {
      codigo,
      nombre: nombreFinal,
      descripcion: gv('#pr_desc'),
      marca: gv('#pr_marca'),
      categoria_id,
      categoria,
      costo,
      precio,
      stock: Number(gv('#pr_stock') || 0),
      imagen_base64: img || null
    };

    await jpost('/productos', body);
    resetNuevoProducto();
    closeModal('modalProducto');
    listarProductos();
    cargarKpis();
  } catch (e) {
    console.error(e);
    alert('No se pudo guardar el producto.\n' + e.message);
  } finally {
    const btn = qs('#btnGuardarProd');
    btn?.removeAttribute('disabled');
  }
}
function abrirEditar(id) {
  const p = PROD_CACHE.find(x => Number(x.id) === Number(id));
  if (!p) { alert('Producto no encontrado'); return; }
  const set = (sel, val) => { const el = qs(sel); if (el) el.value = (val ?? ''); };
  set('#edit_id', p.id); set('#ed_codigo', p.codigo); set('#ed_marca', p.marca);
  let catName = p.categoria || '';
  if (!catName && p.categoria_id && Array.isArray(CAT_CACHE)) {
    const c = CAT_CACHE.find(cc => Number(cc.id) === Number(p.categoria_id));
    if (c) catName = c.nombre || '';
  }
  set('#ed_cat', catName);
  set('#ed_precio', Number(p.precio || 0)); set('#ed_costo', Number(p.costo || 0)); set('#ed_stock', Number(p.stock || 0));
  const file = qs('#ed_img'); if (file) file.value = '';
  const prev = qs('#ed_img_preview');
  if (prev) prev.src = p.imagen_base64 || p.imagen || 'img/no-image.png';
  openModal('modalProductoEdit');
}
(function bindEditImgPreview() {
  const input = qs('#ed_img');
  if (!input) return;
  input.addEventListener('change', (e) => {
    const f = e.target.files?.[0]; if (!f) return;
    const url = URL.createObjectURL(f);
    const prev = qs('#ed_img_preview');
    if (prev) prev.src = url;
  });
})();
async function actualizarProducto() {
  const id = Number(qs('#edit_id').value);
  let img = '';
  const f = qs('#ed_img')?.files?.[0];
  if (f) img = await readFileAsDataUrl(f);
  const rawCatEd = gv('#ed_cat_select') || gv('#ed_cat');
  const categoria_id = /^\d+$/.test(rawCatEd) ? Number(rawCatEd) : null;
  const categoria = categoria_id ? null : (rawCatEd || null);
  const body = {
    codigo: gv('#ed_codigo'), nombre: gv('#ed_nombre'), descripcion: gv('#ed_desc'), marca: gv('#ed_marca'),
    categoria_id, categoria, costo: Number(gv('#ed_costo') || 0), precio: Number(gv('#ed_precio') || 0), stock: Number(gv('#ed_stock') || 0)
  };
  if (img) body.imagen_base64 = img;
  await jput('/productos/' + id, body);
  closeModal('modalProductoEdit'); listarProductos(); cargarKpis();
}

// ================== CATEGORÍAS ==================
let CAT_CACHE = [], CAT_FILTER = [];
async function listarCategorias() {
  const data = await jget('/categorias');
  CAT_CACHE = (data || []).map(c => ({
    ...c, id: Number(c.id), codigo: c.codigo || '', nombre: c.nombre || '',
    imagen_base64: c.imagen_base64 || c.imagen || ''
  }));
  CAT_FILTER = CAT_CACHE; renderCategorias(CAT_FILTER);

  const opts = CAT_CACHE.map(c => `<option value="${c.id}">${c.nombre}</option>`).join('');
  const prCat = qs('#pr_cat'); if (prCat) prCat.innerHTML = `<option value="">(sin categoría)</option>` + opts;
  const edCat = qs('#ed_cat_select'); if (edCat) edCat.innerHTML = `<option value="">(sin categoría)</option>` + opts;
}
function filtrarCategorias(q) {
  q = (q || '').toLowerCase();
  CAT_FILTER = CAT_CACHE.filter(c =>
    (c.nombre || '').toLowerCase().includes(q) ||
    (c.codigo || '').toLowerCase().includes(q)
  );
  renderCategorias(CAT_FILTER);
}
function renderCategorias(list) {
  const rows = (list || []).map(c => {
    const imgSrc = c.imagen_base64 || '';
    const imgHtml = imgSrc
      ? `<img src="${imgSrc}" alt="${c.nombre || 'Categoría'}" onerror="this.src='img/no-image.png'"
             style="width:38px;height:38px;border-radius:.5rem;object-fit:cover;">`
      : `<div style="width:38px;height:38px;border-radius:.5rem;background:#f3f4f6;border:1px solid #e5e7eb"></div>`;
    return `
      <tr data-id="${c.id}">
        <td class="text-center align-middle">${c.id}</td>
        <td class="text-center align-middle">${imgHtml}</td>
        <td class="align-middle">${(c.codigo ?? '').toString().trim() || '—'}</td>
        <td class="align-middle">${c.nombre || '—'}</td>
        <td class="text-center align-middle">
          <div class="btn-group">
            <button class="btn btn-sm btn-light-primary me-1" title="Editar" onclick="abrirEditarCategoria(${c.id})"
              style="background-color:#e0e7ff;color:#2563eb;border-radius:50%;width:40px;height:40px;display:inline-flex;align-items:center;justify-content:center;">
              <i class="fa-solid fa-pen"></i>
            </button>
            <button class="btn btn-sm btn-light-danger" title="Eliminar" onclick="eliminarCategoria(${c.id})"
              style="background-color:#fee2e2;color:#dc2626;border-radius:50%;width:40px;height:40px;display:inline-flex;align-items:center;justify-content:center;">
              <i class="fa-solid fa-trash"></i>
            </button>
          </div>
        </td>
      </tr>`;
  }).join('');
  qs('#tabla-categorias').innerHTML = `
    <table class="table align-middle">
      <thead>
        <tr>
          <th class="text-center" style="width:70px;">ID</th>
          <th class="text-center" style="width:90px;">Imagen</th>
          <th>Código</th>
          <th>Categoría</th>
          <th class="text-center">Acción</th>
        </tr>
      </thead>
      <tbody>${rows || '<tr><td colspan="5" class="text-center text-muted py-3">Sin categorías</td></tr>'}</tbody>
    </table>`;
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
  let img = '';
  const f = qs('#cat_img')?.files?.[0];
  if (f) img = await readFileAsDataUrl(f);
  const body = {
    nombre: gv('#cat_nombre'), codigo: gv('#cat_codigo'),
    descripcion: gv('#cat_desc'), imagen_base64: img
  };
  await jpost('/categorias', body);
  closeModal('modalCategoria'); listarCategorias();
}
function abrirEditarCategoria(id) {
  const c = CAT_CACHE.find(x => Number(x.id) === Number(id));
  if (!c) return alert('Categoría no encontrada');
  qs('#cat_edit_id').value = c.id;
  qs('#cat_ed_nombre').value = c.nombre || '';
  qs('#cat_ed_codigo').value = c.codigo || '';
  const prev = qs('#cat_ed_preview');
  const src = c.imagen_base64 || c.imagen || '';
  if (prev) { if (src) { prev.src = src; prev.style.display = 'block'; } else { prev.src = ''; prev.style.display = 'none'; } }
  const file = qs('#cat_ed_img'); if (file) file.value = '';
  openModal('modalCategoriaEdit');
}
(function bindCatEditPreview() {
  const input = qs('#cat_ed_img');
  if (!input) return;
  input.addEventListener('change', e => {
    const f = e.target.files?.[0]; if (!f) return;
    const url = URL.createObjectURL(f);
    const prev = qs('#cat_ed_preview');
    if (prev) { prev.src = url; prev.style.display = 'block'; }
  });
})();
async function actualizarCategoria() {
  const id = Number(qs('#cat_edit_id').value);
  let img = '';
  const f = qs('#cat_ed_img')?.files?.[0];
  if (f) img = await readFileAsDataUrl(f);
  const body = {
    nombre: gv('#cat_ed_nombre'), codigo: gv('#cat_ed_codigo'), descripcion: gv('#cat_ed_desc')
  };
  if (img) body.imagen_base64 = img;
  await jput('/categorias/' + id, body);
  closeModal('modalCategoriaEdit'); listarCategorias();
}
async function eliminarCategoria(id) {
  if (!confirm('¿Eliminar categoría?')) return;
  await jdel('/categorias/' + id); listarCategorias();
}

// ================== COMPRAS ==================
async function listarCompras() {
    const data = await jget('/compras');

    const rows = data.map(c => `
        <tr>
          <td>${c.id}</td>
          <td>${new Date(c.fecha).toLocaleDateString()}</td>

          <!-- productos cargados -->
          <td>${c.productos || "-"}</td>

          <!-- monto total -->
          <td>Gs. ${money(c.total)}</td>

          <!-- nombre del proveedor -->
          <td>${c.proveedor_nombre || "-"}</td>

          <!-- ruc proveedor -->
          <td>${c.proveedor_ruc || "-"}</td>
        </tr>
    `).join('');

    document.getElementById("tabla-compras").innerHTML = `
        <table class="table">
          <thead>
            <tr>
              <th>ID</th>
              <th>Fecha</th>
              <th>Productos</th>
              <th>Total</th>
              <th>Proveedor</th>
              <th>RUC</th>
            </tr>
          </thead>
          <tbody>${rows}</tbody>
        </table>
    `;
}
// CALCULAR TOTALES POR MES Y AÑO
// =====================

function obtenerTotalesPorFecha(lista, campoFecha, campoTotal) {
    const hoy = new Date();
    const añoActual = hoy.getFullYear();
    const mesActual = hoy.getMonth() + 1;

    let totalAnual = 0;
    let totalMensual = 0;

    lista.forEach(item => {
        const fecha = new Date(item[campoFecha]);
        const año = fecha.getFullYear();
        const mes = fecha.getMonth() + 1;

        if (año === añoActual) {
            totalAnual += Number(item[campoTotal] || 0);

            if (mes === mesActual) {
                totalMensual += Number(item[campoTotal] || 0);
            }
        }
    });

    return { totalAnual, totalMensual };
}

function renderDashboard() {
    const ventas = JSON.parse(localStorage.getItem("ventas")) || [];
    const compras = JSON.parse(localStorage.getItem("compras")) || [];
    const productos = JSON.parse(localStorage.getItem("productos")) || [];

    // ---- Totales ventas ----
    const totV = obtenerTotalesPorFecha(ventas, "fecha", "total");
    
    // ---- Totales compras ----
    const totC = obtenerTotalesPorFecha(compras, "fecha", "total");

    // ---- Stock total ----
    const stockTotal = productos.reduce((acc, p) => acc + (Number(p.stock) || 0), 0);

    // Mostrar en el Dashboard
    document.getElementById("kpi-ventas").innerHTML =
        `Año: Gs. ${totV.totalAnual.toLocaleString()}<br>
         Mes: Gs. ${totV.totalMensual.toLocaleString()}`;

    document.getElementById("kpi-compras").innerHTML =
        `Año: Gs. ${totC.totalAnual.toLocaleString()}<br>
         Mes: Gs. ${totC.totalMensual.toLocaleString()}`;

    document.getElementById("kpi-productos").innerText = stockTotal;
}

// =============================================================
// GUARDAR PEDIDO

function closeModalSelProducto() {
  closeModal("modalSelProducto");
}
async function eliminarPedidoConfirmado() {
    const id = document.getElementById("delete_pedido_id").value;

    try {
        const res = await fetch(`/api/pedidos/${id}`, {
            method: "DELETE",
            credentials: "include"
        });

        const data = await res.json();

        if (!data.ok) {
            alert("Error: " + data.msg);
            return;
        }

        closeModal("modalEliminarPedido");
        listarPedidos(); // Recargar tabla
    } catch (err) {
        console.error("Error eliminando pedido:", err);
        alert("No se pudo eliminar el pedido.");
    }
}
/* ============================================================
   ELIMINAR PEDIDO
   ============================================================ */
function eliminarPedido(id) {
    document.getElementById("delete_pedido_id").value = id;
    openModal("modalEliminarPedido");
}
// =============================================================

async function exportarPDF_Listado() {
  // ✅ asegurar que los logos estén cargados antes del PDF
  try {
    if (!logoConsorcio || !logoSpynet) await initPDF();
  } catch (e) {
    console.warn("⚠ No se pudieron cargar los logos:", e);
  }

  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({ compression: "FAST", unit: "mm", format: "a4" });

  // =============================
  //   CARGAR PEDIDOS DEL BACKEND
  // =============================
  let pedidos = [];
  try {
    pedidos = await jget("/api/pedidos");
  } catch (e) {
    console.error("Error cargando pedidos:", e);
    alert("No se pudieron cargar los pedidos.");
    return;
  }

  // =============================
  //   ENCABEZADO (2 LOGOS + TEXTO CENTRADO)
  // =============================
  const pageW = doc.internal.pageSize.getWidth();
  const cx = pageW / 2;

  // Logos (ajustá tamaños si querés)
  try {
    if (logoConsorcio) doc.addImage(logoConsorcio, imgType(logoConsorcio), 10, 8, 32, 18);
    if (logoSpynet)    doc.addImage(logoSpynet,    imgType(logoSpynet),    pageW - 10 - 28, 8, 28, 18);
  } catch (e) {
    console.warn("⚠ Error addImage logos:", e);
  }

  // Texto centrado (entre los logos)
  doc.setFont("times", "bold");
  doc.setFontSize(22);
  doc.text("Consorcio Spy E.A.S.", cx, 14, { align: "center" });

  doc.setFont("helvetica", "normal");
  doc.setFontSize(10.5);
  doc.text("Servicio de Internet (Telecomunicaciones)", cx, 20, { align: "center" });

  doc.setFontSize(8.5);
  doc.text("Comercio al por menor de equipos de telecomunicaciones", cx, 24.5, { align: "center" });
  doc.text("Instalaciones eléctricas, electromecánicas y electrónicas", cx, 28.5, { align: "center" });

  doc.setFont("helvetica", "bold");
  doc.setFontSize(11.5);
  doc.text("Calle, Tte Eligio Montania - Valenzuela", cx, 35, { align: "center" });

  doc.setFont("helvetica", "bold");
  doc.setFontSize(10.5);
  doc.text("Cordillera - Paraguay", cx, 40, { align: "center" });

  // Línea separadora
  doc.setLineWidth(0.4);
  doc.line(10, 45, pageW - 10, 45);

  // =============================
  //   TÍTULO DEL REPORTE
  // =============================
  doc.setFont("helvetica", "bold");
  doc.setFontSize(14);
  doc.text("Listado de Pedidos a Proveedor", 10, 54);

  // =============================
  //   FILAS PARA LA TABLA
  // =============================
  const rows = pedidos.map(p => {
    const productos = p.items?.length ? p.items.map(i => i.producto_nombre).join(", ") : "—";
    const categorias = p.items?.length ? p.items.map(i => i.categoria_nombre).join(", ") : "—";
    const cantidad_items = p.items?.reduce((a, i) => a + Number(i.cantidad || 0), 0) || 0;

    return [
      p.id,
      p.proveedor_nombre || "—",
      productos,
      categorias,
      p.fecha_pedido ? p.fecha_pedido.slice(0, 10) : "—",
      p.fecha_recepcion ? p.fecha_recepcion.slice(0, 10) : "Sin recibir",
      cantidad_items,
      "Gs. " + Number(p.subtotal || 0).toLocaleString(),
      "Gs. " + Number(p.iva || 0).toLocaleString(),
      "Gs. " + Number(p.total || 0).toLocaleString()
    ];
  });

  // =============================
  //   TABLA
  // =============================
  doc.autoTable({
    startY: 60,                 // 👈 arranca debajo del encabezado
    theme: "striped",
    head: [[
      "ID", "Proveedor", "Producto", "Categoría", "Fecha Pedido",
      "Recepción", "Cant.", "Subtotal", "IVA", "Total"
    ]],
    body: rows,
    headStyles: {
      fillColor: [41, 128, 185],
      textColor: 255,
      fontSize: 9,
      halign: "center"
    },
    styles: {
      fontSize: 8,
      cellPadding: 1.5,
      overflow: "linebreak"
    },
    tableWidth: "wrap",
    columnStyles: {
      0: { cellWidth: 10, halign: "center" },
      1: { cellWidth: 30 },
      2: { cellWidth: 25 },
      3: { cellWidth: 22 },
      4: { cellWidth: 20, halign: "center" },
      5: { cellWidth: 20, halign: "center" },
      6: { cellWidth: 12, halign: "center" },
      7: { cellWidth: 20, halign: "right" },
      8: { cellWidth: 20, halign: "right" },
      9: { cellWidth: 20, halign: "right" }
    },
    margin: { left: 10, right: 10 }
  });

  doc.save("Lista_de_Pedidos.pdf");
}
async function imgToDataURL(url) {
  const res = await fetch(url);
  const blob = await res.blob();
  return await new Promise((resolve) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result); // data:image/...base64
    r.readAsDataURL(blob);
  });
}
function imgType(dataUrl){
  return dataUrl.startsWith("data:image/png") ? "PNG" : "JPEG";
}

async function exportarPDF_Pedido() {
    const id = document.getElementById("pp_id").innerText;
    const pedidos = JSON.parse(localStorage.getItem("pedidos")) || [];
    const p = pedidos.find(x => x.id == id);
    if (!p) return alert("No se encontró el pedido");

    const { jsPDF } = window.jspdf;
    const doc = new jsPDF();

    doc.addImage(logoConsorcio, "PNG", 10, 5, 35, 35)
    doc.addImage(logoSpynet, "PNG", 160, 5, 35, 20);

    doc.setFontSize(14);
    doc.text(`Pedido a Proveedor #${p.id}`, 14, 35);

    doc.autoTable({
        head: [["Dato", "Valor"]],
        body: [
            ["Proveedor", p.proveedor],
            ["Fecha Pedido", p.fecha],
            ["Fecha Recepción", p.fechaRecepcion],
            ["Subtotal", p.subtotal],
            ["IVA", p.iva],
            ["Total", p.total],
        ],
        startY: 45
    });

    const rows = p.items.map(i => [
        i.producto, i.cantidad, i.unidad, i.precio, i.subtotal
    ]);

    doc.autoTable({
        head: [["Producto", "Cantidad", "Unidad", "Precio", "Subtotal"]],
        body: rows,
        startY: doc.lastAutoTable.finalY + 10
    });

    doc.save(`Pedido_${p.id}.pdf`);
}

function imgToBase64(url) {
    return new Promise((resolve) => {
        const img = new Image();
        img.crossOrigin = "Anonymous";
        img.onload = function () {
            const canvas = document.createElement("canvas");
            canvas.width = this.width;
            canvas.height = this.height;

            const ctx = canvas.getContext("2d");
            ctx.drawImage(this, 0, 0);

            resolve(canvas.toDataURL("image/png"));
        };
        img.src = url;
    });
}

async function eliminarProductoDeLista(id, btn) {

    if (!confirm("¿Seguro que deseas eliminar este producto?")) {
        return;
    }

    try {
        await jdel(`/productos/${id}`);

        btn.closest("tr").remove();

        alert("Producto eliminado correctamente.");
    } catch (e) {
        alert("Error al eliminar producto.");
        console.error(e);
    }
}

async function cargarProveedoresEnSelect() {

  const select = document.getElementById("pp_proveedor");

  // Mostrar estado mientras carga
  select.innerHTML = `<option value="">Cargando proveedores...</option>`;

  try {
      // Cargar desde el backend real
      const proveedores = await jget("/proveedores");

      // Si no hay proveedores
      if (!proveedores.length) {
          select.innerHTML = `<option value="">(No hay proveedores cargados)</option>`;
          return;
      }

      // Llenar correctamente
      select.innerHTML = `<option value="">Seleccionar proveedor</option>`;

      proveedores.forEach(p => {
          const opt = document.createElement("option");
          opt.value = p.id;           // ID real
          opt.textContent = p.nombre; // Nombre que ve el usuario
          select.appendChild(opt);
      });

  } catch (err) {
      console.error("Error cargando proveedores:", err);
      select.innerHTML = `<option value="">Error al cargar</option>`;
  }
}
// ================== FORMAS DE PAGO ==================

function normalizarFormaPago(v) {
  // intenta varias columnas posibles
  const fp =
    (v.forma_pago || v.metodo || v.forma_pago_nombre || v.forma || "")
      .toString()
      .trim();

  return fp || "Sin especificar";
}

function detectarTipoGeneral(fpNombre) {
  const s = (fpNombre || "").toLowerCase();

  // todo lo que NO sea "efectivo" lo tomamos como transferencia
  // (así Ueno, BNF, QR, Mango, etc. suman en Transferencia)
  if (s.includes("efect")) return "efectivo";

  // si querés que "débito/crédito" cuenten como transferencia también, ya queda así
  return "transferencia";
}

async function listarFP() {
  const fEl = document.querySelector("#fechaCaja");
  const fecha = (fEl && fEl.value && fEl.value.trim())
    ? fEl.value.trim()
    : toYMD(new Date());

  const yyyy_mm = fecha.slice(0, 7);

  let ventas = [];
  try {
    ventas = await jget("/ventas");
  } catch (e) {
    console.error("Error cargando ventas:", e);
    return;
  }

  // acumuladores
  let diaE = 0, diaT = 0, mesE = 0, mesT = 0;
  const diaPorForma = {};
  const mesPorForma = {};

  for (const v of ventas) {
    const f = (v.fecha || v.created_at || "").toString();
    const total = Number(v.total || 0);

    const fp = normalizarFormaPago(v);
    const tipo = detectarTipoGeneral(fp);

    // por día
    if (sameDay(f, fecha)) {
      if (tipo === "efectivo") diaE += total;
      else diaT += total;

      diaPorForma[fp] = (diaPorForma[fp] || 0) + total;
    }

    // por mes
    if (sameMonth(f, yyyy_mm)) {
      if (tipo === "efectivo") mesE += total;
      else mesT += total;

      mesPorForma[fp] = (mesPorForma[fp] || 0) + total;
    }
  }

  // ✅ pintar los 3 cards fijos (tus IDs)
  const setTxt = (id, val) => {
    const el = document.getElementById(id);
    if (el) el.textContent = "Gs. " + money(val);
  };

  setTxt("fp-dia-efectivo", diaE);
  setTxt("fp-dia-transferencia", diaT);
  setTxt("fp-dia-total", diaE + diaT);

  setTxt("fp-mes-efectivo", mesE);
  setTxt("fp-mes-transferencia", mesT);
  setTxt("fp-mes-total", mesE + mesT);

  // ✅ detalle por banco/forma abajo
  const cont = document.getElementById("fp-detalle");
  if (!cont) return;

  const keys = Array.from(
    new Set([...Object.keys(diaPorForma), ...Object.keys(mesPorForma)])
  ).sort();

  if (!keys.length) {
    cont.innerHTML = `<div class="text-muted" style="padding:.75rem;">Sin ventas pagadas para esta fecha.</div>`;
  } else {
    cont.innerHTML = `
      <div class="card" style="padding:1rem;">
        <h4 style="margin:0 0 .75rem 0;">🏦 Detalle por forma / banco</h4>

        <div style="overflow:auto;">
          <table class="table" style="min-width:520px;">
            <thead>
              <tr>
                <th>Forma / Banco</th>
                <th style="text-align:right;">Hoy</th>
                <th style="text-align:right;">Mes</th>
              </tr>
            </thead>
            <tbody>
              ${keys.map(k => `
                <tr>
                  <td>${escapeHtml(k)}</td>
                  <td style="text-align:right;">Gs. ${money(diaPorForma[k] || 0)}</td>
                  <td style="text-align:right;">Gs. ${money(mesPorForma[k] || 0)}</td>
                </tr>
              `).join("")}
            </tbody>
          </table>
        </div>
      </div>
    `;
  }

  // ===============================
  // ✅ NUEVO: movimientos con comprobante
  // ===============================
  const tbodyMov = document.getElementById("fp-tbody-mov");
  if (tbodyMov) {
    const conComp = (ventas || [])
      .filter(v => (v.nro_comprobante || "").toString().trim() !== "")
      .sort((a, b) => new Date(b.fecha || b.created_at) - new Date(a.fecha || a.created_at))
      .slice(0, 20);

    if (!conComp.length) {
      tbodyMov.innerHTML = `
        <tr>
          <td colspan="6" style="padding:10px; text-align:center; color:#6b7280;">
            No hay movimientos con comprobante.
          </td>
        </tr>
      `;
    } else {
      tbodyMov.innerHTML = conComp.map(v => `
        <tr style="border-top:1px solid #e5e7eb;">
          <td style="padding:10px;">${v.id ?? "—"}</td>
          <td style="padding:10px;">
            ${(typeof fmtDate === "function")
              ? fmtDate(v.fecha)
              : (String(v.fecha || v.created_at || "").slice(0, 10) || "—")}
          </td>
          <td style="padding:10px;">${escapeHtml(v.cliente_nombre || "Consumidor Final")}</td>
          <td style="padding:10px;">${escapeHtml(normalizarFormaPago(v))}</td>
          <td style="padding:10px;"><b>${escapeHtml(v.nro_comprobante || "—")}</b></td>
          <td style="padding:10px; text-align:right;">Gs. ${money(v.total || 0)}</td>
        </tr>
      `).join("");
    }
  }
}

async function crearFP() {
  const nombre = prompt('Nombre de la forma de pago');
  if (!nombre) return;
  await jpost('/formas_pago', { nombre });
  listarFP();
}

// ================== BRAND LOGO ==================
(function applyBrandLogo() {
  const saved = localStorage.getItem('brandLogo');
  if (!saved) return;
  const tb = document.querySelector('.topbar div:last-child');
  if (tb) { const img = document.createElement('img'); img.src = saved; img.alt = 'Logo'; img.style.height = '28px'; img.style.borderRadius = '8px'; img.style.marginLeft = '8px'; tb.appendChild(img); }
})();

function abrirNuevaCompra() {
  cargarProveedoresEnSelectCompra();
  openModal('modalNuevaCompra');

  document.getElementById("c_fecha").value = "";
  document.getElementById("c_factura").value = "";

  compraItems = [];
  renderItemsCompra();
  recalcularCompra();
}

async function cargarProductosParaCompra() {
  const productos = await jget("/productos");
  const cont = document.getElementById("tablaSelProductosCompra");

  cont.innerHTML = "";

  productos.forEach(p => {
    const tr = document.createElement("tr");

    tr.innerHTML = `
      <td>${p.nombre}</td>
      <td>${p.marca || "-"}</td>
      <td>${p.categoria || "-"}</td>
      <td>${Number(p.costo || 0)}</td>
      <td>${Number(p.stock || 0)}</td>
      <td>
          <button class="btn" onclick="agregarProductoCompra(${p.id}, '${p.nombre}', ${Number(p.costo || 0)})">
              <i class="fa fa-plus"></i>
          </button>
      </td>
    `;

    cont.appendChild(tr);
  });
}
function filtrarProductosCompra() {
  const q = document.getElementById("buscarProdCompra").value.toLowerCase();

  document.querySelectorAll("#tablaSelProductosCompra tr").forEach(fila => {
    const prod = fila.children[0].innerText.toLowerCase();
    fila.style.display = prod.includes(q) ? "" : "none";
  });
}
function agregarProductoCompra(id, nombre, costo) {
  compraItems.push({
    producto_id: id,
    producto_nombre: nombre,
    cantidad: 1,
    costo: costo,
    subtotal: costo
  });

  closeModal("modalSelProductoCompra");
  renderItemsCompra();
  recalcularCompra();
}
function renderItemsCompra() {
  const tbody = document.getElementById("compra_items");
  tbody.innerHTML = "";

  compraItems.forEach((item, i) => {
    const tr = document.createElement("tr");

    tr.innerHTML = `
      <td>${item.producto_nombre}</td>
      <td>
        <input class="input" type="number" min="1" value="${item.cantidad}"
               onchange="updateCantidadCompra(${i}, this.value)">
      </td>
      <td>
        <input class="input" type="number" step="0.01" min="0" value="${item.costo}"
               onchange="updateCostoCompra(${i}, this.value)">
      </td>
      <td>${item.subtotal.toFixed(2)}</td>
      <td>
        <button class="btn secondary" onclick="eliminarItemCompra(${i})">
          <i class="fa fa-trash"></i>
        </button>
      </td>
    `;

    tbody.appendChild(tr);
  });
}

function updateCantidadCompra(i, val) {
  compraItems[i].cantidad = Number(val);
  compraItems[i].subtotal = compraItems[i].cantidad * compraItems[i].costo;
  renderItemsCompra();
  recalcularCompra();
}

function updateCostoCompra(i, val) {
  compraItems[i].costo = Number(val);
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
  subtotalCompra = compraItems.reduce((a, i) => a + i.subtotal, 0);
  ivaCompra = subtotalCompra * 0.10;
  totalCompra = subtotalCompra + ivaCompra;

  document.getElementById("c_subtotal").innerText = subtotalCompra.toFixed(2);
  document.getElementById("c_iva").innerText = ivaCompra.toFixed(2);
  document.getElementById("c_total").innerText = totalCompra.toFixed(2);
}

async function guardarCompra() {

  if (!compraItems.length) return alert("No hay productos en la compra.");
  if (!document.getElementById("c_proveedor").value) return alert("Seleccione un proveedor.");

  const compra = {
    proveedor_id: Number(document.getElementById("c_proveedor").value),
    fecha: document.getElementById("c_fecha").value,
    factura: document.getElementById("c_factura").value,
    items: compraItems.map(i => ({
        producto_id: i.producto_id,
        cantidad: Number(i.cantidad),
        costo: Number(i.costo),
        subtotal: Number(i.cantidad) * Number(i.costo)   // ← IMPORTANTE
    }))
  };

  try {
    const res = await fetch(`${API}/compras`, {
      method: "POST",
      headers: {"Content-Type": "application/json"},
      credentials: "include",
      body: JSON.stringify(compra)
    });

    const data = await res.json();

    if (!res.ok || !data.ok) {
        console.error(data);
        return alert("Error al registrar compra: " + (data.msg || "Error desconocido"));
    }

    alert("Compra registrada correctamente ✔");

    closeModal("modalNuevaCompra");
    listarCompras();
    listarProductos();
    cargarKpis();

  } catch (err) {
    console.error(err);
    alert("Error al guardar la compra.");
  }
}
function seleccionarProductoCompra(prod) {
    document.getElementById("c_buscar_producto").value = prod.nombre;
    document.getElementById("c_producto_id").value = prod.id;  // ← NECESARIO
    document.getElementById("c_costo").value = prod.costo || 0;

    document.getElementById("c_lista_productos").innerHTML = "";
}
function agregarItemCompra() {
    if (!productoSeleccionado) {
        alert("Debe seleccionar un producto de la lista.");
        return;
    }

    const cantidad = Number(document.getElementById("c_cantidad").value);
    const costo = Number(document.getElementById("c_costo").value);

    compraItems.push({
        producto_id: productoSeleccionado.id,
        producto_nombre: productoSeleccionado.nombre,
        cantidad,
        costo,
        subtotal: cantidad * costo
    });

    renderItemsCompra();
    limpiarCamposProducto();
}
async function cargarProveedoresEnSelectCompra() {
  const select = document.getElementById("c_proveedor");
  select.innerHTML = `<option value="">Cargando proveedores...</option>`;

  try {
    const proveedores = await jget("/proveedores");

    select.innerHTML = `<option value="">Seleccionar proveedor</option>`;

    proveedores.forEach(p => {
      const opt = document.createElement("option");
      opt.value = p.id;
      opt.textContent = p.nombre;
      select.appendChild(opt);
    });

  } catch (err) {
    console.error("Error cargando proveedores:", err);
    select.innerHTML = `<option value="">Error al cargar</option>`;
  }
}


async function cargarProductosPedido(buscar = "") {
  try {
    const res = await fetch(`/productos${buscar ? `?buscar=${buscar}` : ""}`, {
      credentials: "include",
    });
    const productos = await res.json();

    const tbody = document.getElementById("tablaSelProductosPedido");
    tbody.innerHTML = "";

    productos.forEach(p => {
      const tr = document.createElement("tr");
      tr.innerHTML = `
        <td>${p.nombre}</td>
        <td>${p.marca || "-"}</td>
        <td>${p.categoria || "-"}</td>
        <td>${p.costo}</td>
        <td>${p.stock}</td>
        <td>
          <button class="btn btn-primary" onclick="agregarProductoPedido(${p.id})">
            Seleccionar
          </button>
        </td>
      `;
      tbody.appendChild(tr);
    });

  } catch (e) {
    console.error("Error cargando productos:", e);
  }
}



async function cargarProveedoresPedido() {
  const sel = document.getElementById("pp_proveedor");
  if (!sel) return console.error("❌ No existe #pp_proveedor");

  sel.innerHTML = `<option value="">Cargando proveedores...</option>`;

  try {
    console.log("➡️ llamando a /proveedores ...");
    const data = await jget("/proveedores");
    console.log("✅ respuesta /proveedores:", data);

    if (!Array.isArray(data)) {
      sel.innerHTML = `<option value="">(Respuesta inválida)</option>`;
      return console.error("❌ /proveedores no devolvió array:", data);
    }

    if (!data.length) {
      sel.innerHTML = `<option value="">(No hay proveedores)</option>`;
      return;
    }

    sel.innerHTML = `<option value="">Seleccione un proveedor</option>`;
    data.forEach(p => {
      const opt = document.createElement("option");
      opt.value = p.id;
      opt.textContent = `${p.nombre || "Sin nombre"} — ${p.ruc || ""}`;
      sel.appendChild(opt);
    });

  } catch (err) {
    console.error("❌ Error cargando proveedores:", err);
    sel.innerHTML = `<option value="">Error al cargar</option>`;
  }
}

function cargarProductosSelectPP() {
    const sel = document.getElementById("pp_producto_select");

    sel.innerHTML = `<option value="">Seleccione un producto...</option>`;

    PROD_CACHE.forEach(p => {
        const opt = document.createElement("option");
        opt.value = p.id;
        opt.textContent = `${p.nombre} — ${p.marca} (Gs. ${money(p.costo)})`;
        sel.appendChild(opt);
    });
}

function seleccionarProductoPP() {
    const sel = document.getElementById("pp_producto_select");
    if (!sel.value) return;

    const id = Number(sel.value);
    const nombre = sel.options[sel.selectedIndex].dataset.nombre;
    const costo = Number(sel.options[sel.selectedIndex].dataset.costo);

    agregarProductoPP(id, nombre, costo);
    sel.value = "";
}

function editarPP_Campo(i, campo, valor) {
  // ✅ única fuente: window.pp_items
  const items = Array.isArray(window.pp_items) ? window.pp_items : (window.pp_items = []);
  if (!items[i]) return;

  if (campo === "cantidad") {
    valor = Number(valor) || 0;
  }

  if (campo === "costo") {
    // ✅ soporta 40.000 / 40 000 / 40,000 / 40000
    valor = Number(String(valor).replace(/\D/g, "")) || 0;
  }

  items[i][campo] = valor;
  items[i].subtotal = (Number(items[i].cantidad) || 0) * (Number(items[i].costo) || 0);

  renderPP_Items();
}

async function listarPedidosProveedor() {
    const pedidos = await jget('/api/pedidos');
    renderPedidosProveedor(pedidos);
}
if (window.location.hash === "#lista_pedidos") {
    listarPedidosProveedor();
}
function editarPP_Item(i) {
    const row = qs("#pp_items").children[i];
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

  const subtotal = items.reduce((acc, x) => {
    const cant = Number(x.cantidad) || 0;
    const costo = (typeof x.costo === "string")
      ? (Number(String(x.costo).replace(/\D/g, "")) || 0)
      : (Number(x.costo) || 0);

    const sub = cant * costo;
    x.subtotal = sub; // mantener actualizado
    return acc + sub;
  }, 0);

  const iva = Math.round(subtotal * 0.10);
  const total = subtotal + iva;

  // ✅ si tenés IDs duplicados en el HTML, esto actualiza todos
  document.querySelectorAll("#pp_subtotal").forEach(el => el.textContent = money(subtotal));
  document.querySelectorAll("#pp_iva").forEach(el => el.textContent = money(iva));
  document.querySelectorAll("#pp_total").forEach(el => el.textContent = money(total));
}

async function guardarPedido() {
  const items = Array.isArray(window.pp_items) ? window.pp_items : (window.pp_items = []);
  if (!items.length) return alert("Debe agregar al menos un producto.");

  const proveedor_id = qs("#pp_proveedor")?.value;
  const fecha_pedido = qs("#pp_fecha")?.value;

  if (!proveedor_id) return alert("Seleccione un proveedor.");
  if (!fecha_pedido) return alert("Seleccione la fecha del pedido.");

  const pedido = {
    proveedor_id: Number(proveedor_id),
    fecha_pedido,
    observacion: "",
    items: items.map(i => ({
      producto_id: Number(i.id),
      descripcion: i.unidad || "",
      cantidad: Number(i.cantidad) || 0,
      precio_unit: Number(i.costo) || 0
    }))
  };

  try {
    await jpost("/api/pedidos", pedido);
    alert("Pedido guardado correctamente ✔");

    // limpiar
    window.pp_items = [];
    renderPP_Items();

    location.hash = "#lista_pedidos";
  } catch (err) {
    console.error(err);
    alert("Error al guardar el pedido.");
  }
}

function openModalPP() {
  const modal = document.getElementById("modalSelProducto");
  if (!modal) return console.error("❌ No existe #modalSelProducto");

  // 1) abrir YA
  modal.style.display = "flex";

  // 2) cargar productos y renderizar
  listarProductos()
    .then(() => renderProductosPedidoModal(PROD_CACHE))
    .catch(err => {
      console.error("❌ Error listarProductos:", err);
      // opcional: mostrar mensaje en la tabla
      const tbody = document.getElementById("tablaSelProductos");
      if (tbody) tbody.innerHTML = `<tr><td colspan="6" style="padding:12px;color:#ef4444">Error cargando productos</td></tr>`;
    });
}

// para que onclick lo encuentre siempre
window.openModalPP = openModalPP;

function seleccionarProductoPP(id) {
  const p =
    (Array.isArray(PROD_CACHE) && PROD_CACHE.find(x => Number(x.id) === Number(id))) ||
    null;

  if (!p) {
    console.error("❌ Producto no encontrado en PROD_CACHE:", id);
    return alert("Producto no encontrado. Probá recargar productos.");
  }

  // Guardar producto actual global
  window.PP_PRODUCTO_ACTUAL = p;

  // 🟢 Soporta distintos IDs de inputs (según tu modal real)
  const setVal = (ids, val) => {
    for (const _id of ids) {
      const el = document.getElementById(_id);
      if (el) { el.value = val; return true; }
    }
    return false;
  };

  setVal(["pp_ed_id", "pp_edit_id", "pp_producto_id"], p.id);
  setVal(["pp_edit_nombre", "pp_ed_nombre", "pp_producto_nombre"], p.nombre || "");
  setVal(["pp_edit_cantidad", "pp_ed_cant", "pp_cantidad"], 1);
  setVal(["pp_edit_unidad", "pp_ed_unidad", "pp_unidad"], "unidad");
  setVal(["pp_edit_costo", "pp_ed_costo", "pp_costo"], Number(p.costo || 0));

  // Cerrar selector y abrir modal de edición (si existe)
  try { closeModal("modalSelProducto"); } catch(e) {}

  if (document.getElementById("modalEditarPP")) {
    openModal("modalEditarPP");
  } else {
    console.warn("⚠ No existe #modalEditarPP. Solo cargué los campos.");
    alert("Producto elegido ✅ (pero falta el modalEditarPP en tu HTML)");
  }
}

// asegurar global por si tu script corre en modo estricto
window.seleccionarProductoPP = seleccionarProductoPP;

function agregarItemPedido() {
    const id   = Number(document.getElementById("pp_ed_id").value);
    const cant = Number(document.getElementById("pp_ed_cant").value);
    const unidad = document.getElementById("pp_ed_unidad").value;
    const costo  = Number(document.getElementById("pp_ed_costo").value);

    if (!id || cant <= 0 || costo <= 0) {
        alert("Complete correctamente los datos del producto");
        return;
    }

    const prod = PROD_CACHE.find(p => p.id === id);
    if (!prod) return;

    // Crear item
    const item = {
        producto_id: id,
        nombre: prod.nombre,
        cantidad: cant,
        unidad: unidad,
        costo: costo,
        subtotal: cant * costo
    };

    // Guardamos en un arreglo global usado por el pedido
    PEDIDO_ITEMS.push(item);

    cerrarModalPP();
    renderItemsPedido();
    actualizarTotalesPedido();
}

function renderItemsPedido() {
    const tbody = document.getElementById("pp_items");
    tbody.innerHTML = "";

    PEDIDO_ITEMS.forEach((it, i) => {
        tbody.innerHTML += `
            <tr>
                <td>${it.nombre}</td>
                <td>${it.cantidad}</td>
                <td>${it.unidad}</td>
                <td>Gs. ${money(it.costo)}</td>
                <td>Gs. ${money(it.subtotal)}</td>
                <td>
                    <button class="btn red" onclick="eliminarItemPedido(${i})">X</button>
                </td>
            </tr>
        `;
    });
}
function actualizarTotalesPedido() {
    let subtotal = 0;

    PEDIDO_ITEMS.forEach(it => subtotal += it.subtotal);

    const iva = Math.round(subtotal * 0.10);
    const total = subtotal + iva;

    document.getElementById("pp_subtotal").innerText = money(subtotal);
    document.getElementById("pp_iva").innerText = money(iva);
    document.getElementById("pp_total").innerText = money(total);
}
function renderProductosPedidoModal(lista) {
    const tbody = document.getElementById("tablaSelProductos");
    tbody.innerHTML = "";

    lista.forEach(p => {
        tbody.innerHTML += `
        <tr>
            <td>${p.nombre}</td>
            <td>${p.marca || '-'}</td>
            <td>${p.categoria || '-'}</td>
            <td>Gs. ${money(p.costo)}</td>
            <td>${p.stock}</td>
            <td style="text-align:center;">
                <button class="btn primary" onclick="seleccionarProductoPP(${p.id})">
                Seleccionar
                </button>
            </td>
        </tr>`;
    });
}
function renderPP_Items() {
  const tbody = document.getElementById("pp_items");
  if (!tbody) return;

  // ✅ única fuente: window.pp_items
  const items = Array.isArray(window.pp_items) ? window.pp_items : (window.pp_items = []);
  tbody.innerHTML = "";

  items.forEach((it, i) => {
    tbody.innerHTML += `
      <tr>
        <td>${it.nombre}</td>

        <td>
          <input type="number" min="1" value="${it.cantidad}"
                 onchange="editarPP_Campo(${i}, 'cantidad', this.value)"
                 class="pp-cell">
        </td>

        <td>
          <input type="text" value="${money(it.costo)}"
                 onchange="editarPP_Campo(${i}, 'costo', this.value)"
                 class="pp-cell">
        </td>

        <td>Gs. ${money(it.subtotal)}</td>

        <td>
          <button class="pp-del" onclick="eliminarPP_Item(${i})">🗑</button>
        </td>
      </tr>`;
  });

  calcularTotalesPP();
}
function filtrarProductosModalPP() {
    const q = document.getElementById("buscarProductoPedido").value.toLowerCase();

    const filtrados = PROD_CACHE.filter(p =>
        p.nombre.toLowerCase().includes(q) ||
        (p.marca || '').toLowerCase().includes(q) ||
        (p.categoria || '').toLowerCase().includes(q)
    );

    renderProductosPedidoModal(filtrados);
}

function cargarSelectProductosPedido(lista) {
    const sel = document.getElementById("selectProductoPedido");
    if (!sel) return;

    sel.innerHTML = `<option value="">Seleccionar producto...</option>`;

    lista.forEach(p => {
        sel.innerHTML += `
            <option value="${p.id}">
                ${p.nombre} — ${p.marca || ''} (${p.codigo || 'Sin código'})
            </option>
        `;
    });
}
function editarProductoPP(id) {
    let p = PROD_CACHE.find(x => x.id == id);
    if (!p) return;

    pp_productoActual = p;

    document.getElementById("pp_edit_nombre").value = p.nombre;
    document.getElementById("pp_edit_cantidad").value = 1;
    document.getElementById("pp_edit_unidad").value = "unidad";
    document.getElementById("pp_edit_costo").value = p.costo;

    document.getElementById("modalPP_lista").style.display = "none";
    document.getElementById("modalPP_editar").style.display = "block";
}
function cancelarEditProductoPP() {
    document.getElementById("modalPP_editar").style.display = "none";
    document.getElementById("modalPP_lista").style.display = "block";
}
function guardarProductoAListaPP() {
  // ✅ SIEMPRE leer del global window
  const p = window.PP_PRODUCTO_ACTUAL;
  if (!p) return alert("No hay producto seleccionado");

  // ✅ asegurar array global
  if (!Array.isArray(window.pp_items)) window.pp_items = [];

  const cantidad = Number(document.getElementById("pp_edit_cantidad")?.value || 0);
  const unidad   = (document.getElementById("pp_edit_unidad")?.value || "").trim();

  // ✅ admite "40.000" / "40000" / "40 000" / "40,000" y lo convierte a 40000
  const costoTxt = (document.getElementById("pp_edit_costo")?.value || "").trim();
  const costo    = Number(costoTxt.replace(/\D/g, "")) || 0;

  if (cantidad <= 0 || costo <= 0) return alert("Cantidad o costo inválido");

  const item = {
    id: p.id,
    nombre: p.nombre || "",
    cantidad,
    unidad: unidad || "unidad",
    costo,
    costoTxt, // opcional si querés mostrar "40.000"
    subtotal: cantidad * costo
  };

  // ✅ si ya existe el producto, actualiza en vez de duplicar
  const idx = window.pp_items.findIndex(x => Number(x.id) === Number(item.id));
  if (idx >= 0) window.pp_items[idx] = item;
  else window.pp_items.push(item);

  // Render
  if (typeof renderPP_Items === "function") renderPP_Items();

  closeModal("modalEditarPP");
}

function formatearMilesPY(input){
  const raw = String(input.value || "").replace(/\D/g, "");
  input.value = raw.replace(/\B(?=(\d{3})+(?!\d))/g, ".");
}
function cargarSelectModalPP() {
    const sel = document.getElementById("pp_select_producto");

    sel.innerHTML = `<option value="">Seleccione un producto...</option>` +
        PROD_CACHE.map(p =>
            `<option value="${p.id}">${p.nombre} — ${p.marca || ""} (${p.codigo || "-"})</option>`
        ).join('');
}
function onSelectProductoPP() {
    const id = document.getElementById("pp_select_producto").value;

    if (!id) {
        document.getElementById("modalPP_editar").style.display = "none";
        return;
    }

    const p = PROD_CACHE.find(x => x.id == id);
    if (!p) return;

    window.PP_PRODUCTO_ACTUAL = p;

    // llenar formulario
    document.getElementById("pp_edit_nombre").value = p.nombre;
    document.getElementById("pp_edit_cantidad").value = 1;
    document.getElementById("pp_edit_unidad").value = "unidad";
    document.getElementById("pp_edit_costo").value = p.costo || 0;

    // mostrar form
    document.getElementById("modalPP_editar").style.display = "block";
}

async function cargarLogoBase64(path) {
    const img = await fetch(path);
    const blob = await img.blob();

    return new Promise(resolve => {
        const reader = new FileReader();
        reader.onloadend = () => resolve(reader.result);
        reader.readAsDataURL(blob);
    });
}

async function cargarDashboardKpis() {
  const ventas = await jget('/ventas');

  const hoyYMD = toYMD(new Date());
  const mesYMD = hoyYMD.slice(0, 7);

  // VENTAS HOY
  const ventasHoy = ventas.filter(v => toYMD(v.fecha || v.created_at) === hoyYMD);
  const totalHoy = ventasHoy.reduce((a, v) => a + Number(v.total || 0), 0);

  // VENTAS DEL MES
  const ventasMes = ventas.filter(v => {
    const ymd = toYMD(v.fecha || v.created_at);
    return ymd && ymd.slice(0, 7) === mesYMD;
  });
  const totalMes = ventasMes.reduce((a, v) => a + Number(v.total || 0), 0);

  // MOSTRAR
  const elHoy = qs("#dash-ventas-hoy");
  const elMes = qs("#dash-ventas-mes");
  if (elHoy) elHoy.textContent = "Gs. " + money(totalHoy);
  if (elMes) elMes.textContent = "Gs. " + money(totalMes);
}
async function filtrarVentasPorDia() {
    const fecha = qs("#filtro-dia").value;
    if (!fecha) return;

    const ventas = await jget("/ventas");

    const filtradas = ventas.filter(v => v.fecha.slice(0, 10) === fecha);

    const total = filtradas.reduce((a, v) => a + Number(v.total || 0), 0);

    qs("#resultado-filtro").textContent = `Gs. ${money(total)}`;
}

async function cargarFormasPago() {
  const res = await fetch(`/formas-pago`, { credentials: "include" });
  const formas = await res.json();

  const select = document.getElementById("formaPagoSelect");
  if (!select) return; // evita que rompa toda la página

  select.innerHTML = formas
    .map(f => `<option value="${f.id}">${f.nombre}</option>`)
    .join("");
}

// ================== EXPORTS GLOBALES ==================
window.exportClientesCSV = () => exportTableCSV('#tabla-clientes table', 'clientes.csv');
window.exportProductosCSV = () => exportTableCSV('#tabla-productos table', 'productos.csv');
window.exportProveedoresCSV = () => exportTableCSV('#tabla-proveedores table', 'proveedores.csv');
window.exportComprasCSV = () => exportTableCSV('#tabla-compras table', 'compras.csv');


window.exportarPDF_Listado = exportarPDF_Listado;
window.exportarPDF_Pedido = exportarPDF_Pedido;

// navegación principal
window.addEventListener("hashchange", () => {
    show(location.hash || "#dashboard");

});

// al cargar la página
window.addEventListener("load", () => {
    show(location.hash || "#dashboard");
});

window.addEventListener("hashchange", () => {
    const vista = location.hash;

    // Cuando entras a compras → cargar tabla siempre
    if (vista === "#compras") {
        if (typeof cargarComprasLista === "function") {
            cargarComprasLista();
        }
    }
});
window.addEventListener("load", () => {
    if (location.hash === "#compras") {
        if (typeof cargarComprasLista === "function") {
            cargarComprasLista();
            verificarCaja();
        }
    }
});

window.addEventListener("load", async () => {
  try { await initPDF(); } catch (e) { console.warn("No cargó logos:", e); }
  show(location.hash || "#dashboard");
});

function toggleSidebar() {
    document.querySelector(".sidebar").classList.toggle("open");
}

document.querySelectorAll(".sidebar a[data-link]").forEach(a => {
    a.addEventListener("click", () => {
        if (window.innerWidth <= 950) {
            document.querySelector(".sidebar").classList.remove("open");
        }
    });
});

// 🟢 ABRIR CAJA (por tipo: "efectivo" | "transferencia")
async function abrirCaja(tipoParam) {
  try {
    const tipo = (tipoParam || "efectivo").toLowerCase().trim();

    const fechaEl = document.getElementById(
      tipo === "efectivo" ? "fechaCajaEfectivo" : "fechaCajaTransferencia"
    );

    // opcional: si en algún momento ponés saldo inicial separado
    const saldoEl = document.getElementById(
      tipo === "efectivo" ? "saldoInicialCajaEfectivo" : "saldoInicialCajaTransferencia"
    );

    const fecha = (fechaEl?.value || "").trim();
    const saldoInicial = Number((saldoEl?.value || "0").replace(/\D/g, "")) || 0;

    if (!fecha) {
      alert("Seleccione una fecha");
      return;
    }

    // ✅ Tu backend espera tipo como texto, vos usabas "Efectivo"
    // Dejamos bonito para DB:
    const tipoDB = tipo === "efectivo" ? "Efectivo" : "Transferencia";

    const res = await fetch(`${API}/caja/abrir`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ tipo: tipoDB, fecha, saldo_inicial: saldoInicial })
    });

    const text = await res.text();
    let data = {};
    try { data = text ? JSON.parse(text) : {}; } catch { data = { msg: text }; }

    console.log("✅ RESPUESTA /caja/abrir:", res.status, data);

    if (!res.ok) {
      alert(data.msg || data.error || "Error al abrir caja");
      return;
    }

    const id =
      data?.caja?.id ??
      data?.data?.caja?.id ??
      data?.id ??
      data?.caja_id ??
      data?.cajaId ??
      null;

    // ✅ contenedor de cajas separadas
    window.cajasActuales = window.cajasActuales || { efectivo: null, transferencia: null };

    if (id) {
      window.cajasActuales[tipo] = data.caja || { id, tipo: tipoDB, fecha, saldo_inicial: saldoInicial };
    } else {
      // si backend no devolvió id, consultar estado
      if (typeof verificarCaja === "function") {
        await verificarCaja();
      } else if (typeof refrescarCajaAbierta === "function") {
        await refrescarCajaAbierta();
      }

      // fallback: si tu verificarCaja solo llena window.cajaActual (global),
      // lo copiamos al tipo actual
      if (window.cajaActual?.id) {
        window.cajasActuales[tipo] = window.cajaActual;
      }

      if (!window.cajasActuales[tipo] || !window.cajasActuales[tipo].id) {
        alert("La caja se abrió, pero no se pudo obtener el ID. Revisá /caja/abrir");
        console.error("Respuesta /caja/abrir:", data);
        return;
      }
    }

    // ✅ mantenemos compatibilidad con código viejo (ventas)
    // por defecto, si abrís efectivo, lo ponemos como cajaActual
    if (tipo === "efectivo") window.cajaActual = window.cajasActuales[tipo];

    const estadoEl = document.getElementById(
      tipo === "efectivo" ? "estadoCajaEfectivo" : "estadoCajaTransferencia"
    );

    if (estadoEl) {
      estadoEl.innerHTML = `🟢 Caja ABIERTA (${tipoDB}) — ${saldoInicial.toLocaleString("es-PY")} Gs.`;
    }

    alert(`Caja ${tipoDB} abierta ✅`);
    if (typeof cargarRecaudacionFecha === "function") cargarRecaudacionFecha();

  } catch (err) {
    console.error("❌ abrirCaja:", err);
    alert("Error al abrir caja (mirá consola F12).");
  }
}

// 🔴 CERRAR CAJA (por tipo: "efectivo" | "transferencia")
async function cerrarCaja(tipoParam) {
  try {
    const tipo = (tipoParam || "efectivo").toLowerCase().trim();

    window.cajasActuales = window.cajasActuales || { efectivo: null, transferencia: null };

    // si no tenemos caja para ese tipo, intentamos verificar
    if (!window.cajasActuales[tipo] || !window.cajasActuales[tipo].id) {
      if (typeof verificarCaja === "function") {
        await verificarCaja();
      } else if (typeof refrescarCajaAbierta === "function") {
        await refrescarCajaAbierta();
      }

      // compat: si verificarCaja llena window.cajaActual (global),
      // y coincide con el tipo, guardamos
      if (window.cajaActual?.id) {
        const t = (String(window.cajaActual.tipo || "").toLowerCase().includes("trans")) ? "transferencia" : "efectivo";
        window.cajasActuales[t] = window.cajaActual;
      }
    }

    if (!window.cajasActuales[tipo] || !window.cajasActuales[tipo].id) {
      alert(`No hay caja abierta para ${tipo}.`);
      return;
    }

    const id = window.cajasActuales[tipo].id;

    // a) POST /caja/cerrar/:id
    let res = await fetch(`${API}/caja/cerrar/${id}`, {
      method: "POST",
      credentials: "include"
    });

    // b) si 404, probar POST /caja/cerrar con body
    if (res.status === 404) {
      res = await fetch(`${API}/caja/cerrar`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ caja_id: id })
      });
    }

    const text = await res.text();
    let data = {};
    try { data = text ? JSON.parse(text) : {}; } catch { data = { msg: text }; }

    console.log("✅ RESPUESTA cerrar caja:", res.status, data);

    if (!res.ok) {
      alert(data.msg || data.error || "Error al cerrar caja");
      return;
    }

    // limpiar SOLO ese tipo
    window.cajasActuales[tipo] = null;

    // compat: si la global era esa, limpiamos también
    if (window.cajaActual?.id === id) window.cajaActual = null;

    const estadoEl = document.getElementById(
      tipo === "efectivo" ? "estadoCajaEfectivo" : "estadoCajaTransferencia"
    );
    if (estadoEl) estadoEl.innerHTML = "🔴 Caja CERRADA";

    alert(`Caja ${tipo === "efectivo" ? "Efectivo" : "Transferencia"} cerrada ✅`);
    if (typeof cargarRecaudacionFecha === "function") cargarRecaudacionFecha();

  } catch (e) {
    console.error("❌ cerrarCaja:", e);
    alert("Error al cerrar caja (mirá consola F12).");
  }
}

document.addEventListener("DOMContentLoaded", () => {
  cargarRecaudacionFecha();
});

const f = document.getElementById("fechaCaja");
if (f) f.addEventListener("change", cargarRecaudacionFecha);

// refrescar el saldo visible después de actualizar los totales
if (typeof verificarCaja === "function") verificarCaja();

function detectarFormaPago(v) {
  const fp = (v.forma_pago || v.metodo || "").toString().toLowerCase();
  if (fp.includes("efect")) return "efectivo";
  if (fp.includes("transf")) return "transferencia";

  if (Number(v.forma_pago_id) === 1) return "efectivo";
  if (Number(v.forma_pago_id) === 2) return "transferencia";

  return "otro";
}

function toYMD(x) {
  if (!x) return "";

  // ✅ Si ya es Date, construir local
  if (x instanceof Date) {
    return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2,'0')}-${String(x.getDate()).padStart(2,'0')}`;
  }

  const s = String(x).trim();

  // ✅ CASO CLAVE: si viene "YYYY-MM-DD" o "YYYY-MM-DDTHH..."
  // NO usar new Date(s) porque interpreta UTC y cambia el día
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);

  // dd/mm/yyyy -> yyyy-mm-dd
  const m = s.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (m) return `${m[3]}-${m[2]}-${m[1]}`;

  // fallback: intentar parseo normal
  const d = new Date(s);
  if (!isNaN(d)) {
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
  }

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
    // ✅ 1) tomar fecha del input si existe
    let fecha = (document.getElementById("fechaCaja")?.value || "").trim();

    // si viene vacío o "dd/mm/aaaa", usar fecha de cajaActual o hoy
    if (!fecha || fecha.toLowerCase() === "dd/mm/aaaa") {
      fecha =
        (window.cajaActual?.fecha ? String(window.cajaActual.fecha) : "") ||
        new Date().toISOString().slice(0, 10); // YYYY-MM-DD
    }

    // ✅ 2) pedir resumen
    const res = await fetch(`${API}/caja/resumen?fecha=${encodeURIComponent(fecha)}`, {
      credentials: "include",
    });

    const data = await res.json();
    if (!res.ok || data.ok === false) {
      console.error("Error /caja/resumen:", data);
      return;
    }

    const dia = data.dia || {};
    const mes = data.mes || {};

    // ✅ 3) helper para no romper si falta algún elemento
    const setText = (id, val) => {
      const el = document.getElementById(id);
      if (el) el.textContent = "Gs. " + money(Number(val || 0));
    };

    // Día
    setText("dia-efectivo", dia.efectivo);
    setText("dia-transferencia", dia.transferencia);
    setText("dia-total", dia.total);

    // Mes
    setText("mes-efectivo", mes.efectivo);
    setText("mes-transferencia", mes.transferencia);
    setText("mes-total", mes.total);

  } catch (e) {
    console.error("Error recaudación (resumen):", e);
  }
}
async function cargarFormasPagoResumen() {
  try {
    const ventas = await jget("/ventas");
    const hoy = new Date().toISOString().slice(0, 10);
    const mes = hoy.slice(0, 7);

    let diaE = 0, diaT = 0;
    let mesE = 0, mesT = 0;

    ventas.forEach(v => {
      const fecha = (v.fecha || "").slice(0, 10);
      const total = Number(v.total || 0);
      const metodo = (v.forma_pago || v.metodo || "").toLowerCase();

      const esEfectivo = metodo.includes("efect");
      const esTransfer = metodo.includes("transf");

      if (fecha === hoy) {
        if (esEfectivo) diaE += total;
        if (esTransfer) diaT += total;
      }

      if (fecha.startsWith(mes)) {
        if (esEfectivo) mesE += total;
        if (esTransfer) mesT += total;
      }
    });

    // Día
    qs("#fp-dia-efectivo").textContent = "Gs. " + money(diaE);
    qs("#fp-dia-transferencia").textContent = "Gs. " + money(diaT);
    qs("#fp-dia-total").textContent = "Gs. " + money(diaE + diaT);

    // Mes
    qs("#fp-mes-efectivo").textContent = "Gs. " + money(mesE);
    qs("#fp-mes-transferencia").textContent = "Gs. " + money(mesT);
    qs("#fp-mes-total").textContent = "Gs. " + money(mesE + mesT);

  } catch (e) {
    console.error("Error formas de pago:", e);
  }
}

// Helpers para setear texto sin romper si el ID no existe
function _setHTML(id, html) {
  const el = document.getElementById(id);
  if (el) el.innerHTML = html;
}
function _getVal(id) {
  const el = document.getElementById(id);
  return el ? String(el.value || "").trim() : "";
}

async function verificarCaja() {
  try {
    // ✅ leer fecha desde cualquiera de los 2 inputs (efectivo / transferencia)
    const fecha =
      _getVal("fechaCajaEfectivo") ||
      _getVal("fechaCajaTransferencia") ||
      _getVal("fechaCaja") ||
      toYMD(new Date());

    // 1) Traer cajas abiertas por tipo (tu endpoint real)
    const [eData, tData] = await Promise.all([
      fetch(`${API}/caja/abierta?tipo=efectivo`, { credentials: "include" }).then(r => r.json()),
      fetch(`${API}/caja/abierta?tipo=transferencia`, { credentials: "include" }).then(r => r.json()),
    ]);

    const cajaE = eData?.caja || null;
    const cajaT = tData?.caja || null;

    // Guardar global por si lo usás en ventas / cerrar caja
    window.cajasActuales = { efectivo: cajaE, transferencia: cajaT };

    // 2) Traer resumen del día (para calcular saldo real)
    let dia = { efectivo: 0, transferencia: 0, total: 0 };
    try {
      const r2 = await fetch(`${API}/caja/resumen?fecha=${encodeURIComponent(fecha)}`, {
        credentials: "include"
      });
      const d2 = await r2.json();
      if (r2.ok && d2?.dia) dia = d2.dia;
    } catch (e) {
      console.warn("No se pudo leer /caja/resumen:", e);
    }

    // 3) Pintar estado caja EFECTIVO
    if (cajaE?.id) {
      const saldoInicialE = Number(cajaE.saldo_inicial || 0);
      const saldoRealE = saldoInicialE + Number(dia.efectivo || 0);
      _setHTML(
        "estadoCajaEfectivo",
        `🟢 Caja ABIERTA (Efectivo) — Saldo: Gs. ${money(saldoRealE)}`
      );
    } else {
      _setHTML("estadoCajaEfectivo", "🔴 Caja CERRADA");
    }

    // 4) Pintar estado caja TRANSFERENCIA
    if (cajaT?.id) {
      const saldoInicialT = Number(cajaT.saldo_inicial || 0);
      const saldoRealT = saldoInicialT + Number(dia.transferencia || 0);
      _setHTML(
        "estadoCajaTransferencia",
        `🟢 Caja ABIERTA (Transferencia) — Saldo: Gs. ${money(saldoRealT)}`
      );
    } else {
      _setHTML("estadoCajaTransferencia", "🔴 Caja CERRADA");
    }

    // 5) Compatibilidad (si todavía tenés un #estadoCaja viejo)
    // Muestra un resumen general
    if (document.getElementById("estadoCaja")) {
      _setHTML("estadoCaja", `Saldo día total: Gs. ${money(dia.total || 0)}`);
    }

  } catch (e) {
    console.error("Error verificando caja:", e);
  }
}

// ✅ listeners para refrescar cuando cambian fechas
(function bindCajaEventos(){
  const fE = document.getElementById("fechaCajaEfectivo");
  const fT = document.getElementById("fechaCajaTransferencia");
  const f  = document.getElementById("fechaCaja"); // por si tenés uno viejo

  const bind = (el) => {
    if (!el) return;
    if (el.dataset.bound === "1") return;
    el.dataset.bound = "1";
    el.addEventListener("change", async () => {
      await cargarRecaudacionFecha();
      await verificarCaja();
      if (location.hash === "#formas-pago") listarFP();
    });
  };

  bind(fE);
  bind(fT);
  bind(f);

  // al cargar, refrescar una vez
  verificarCaja();
})();
// Para que onclick="abrirCaja()" y onclick="cerrarCaja()" funcionen siempre
window.abrirCaja = abrirCaja;
window.cerrarCaja = cerrarCaja;
window.verificarCaja = verificarCaja;
window.cargarRecaudacionFecha = cargarRecaudacionFecha;

window.abrirModalSelProducto = abrirModalSelProducto;
window.filtrarProductosModalPP = filtrarProductosModalPP;
window.closeModalSelProducto = closeModalSelProducto;