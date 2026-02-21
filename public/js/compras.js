let compraItems = [];
let editCompraItems = [];
let productoSeleccionado = null;
let compraAEliminar = null;

/*************************************************
 *  HELPERS
 *************************************************/
function numberFormat(n) {
  return new Intl.NumberFormat("es-PY").format(Number(n || 0));
}

function formatFecha(f) {
  if (!f) return "";
  return new Date(f).toISOString().slice(0, 10);
}

// --- util dinero PY ---
function parsePYMoney(v) {
  return Number(String(v || "").replace(/\./g, "").replace(/,/g, "").trim() || 0);
}
function numberFormat(n) {
  return new Intl.NumberFormat("es-PY").format(Number(n || 0));
}
function attachMoneyFormatterById(id) {
  const el = document.getElementById(id);
  if (!el) return;
  if (el.dataset.moneyBound === "1") return;
  el.dataset.moneyBound = "1";
  el.addEventListener("input", () => {
    const n = parsePYMoney(el.value);
    el.value = numberFormat(n);
  });
}
/*************************************************
 *  ✅ NUEVO: AUTOCOMPLETAR PRÓXIMA FACTURA POR PROVEEDOR
 *************************************************/
async function setProximaFacturaCompra() {
  const selProv = document.getElementById("c_proveedor");
  const inputFactura = document.getElementById("c_factura");

  if (!selProv || !inputFactura) return;

  const proveedorId = selProv.value;
  if (!proveedorId) return;

  try {
    const res = await fetch(
      `/compras/proxima-factura?proveedor_id=${encodeURIComponent(proveedorId)}`,
      { credentials: "include" }
    );

    if (!res.ok) {
      const txt = await res.text();
      console.error("Error /compras/proxima-factura:", res.status, txt);
      return;
    }

    const data = await res.json();

    if (!inputFactura.value.trim()) {
      inputFactura.value = data.factura || data.proxima_factura || "";
    }
  } catch (err) {
    console.error("Error setProximaFacturaCompra:", err);
  }
}

/*************************************************
 *  LISTAR COMPRAS (TABLA PRINCIPAL)
 *************************************************/
async function cargarComprasLista() {
  try {
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

    document.getElementById("tabla-compras").innerHTML = `
      <table class="table">
        <thead>
          <tr>
            <th>ID</th>
            <th>Fecha</th>
            <th>Productos</th>
            <th>Categoría</th>
            <th>Total</th>
            <th>Proveedor</th>
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

async function editarCompra(id) {
  await cargarProductosEditarCompra();
  attachMoneyFormatterById("edit_c_costo");

  // 1) Traer compra
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

  document.getElementById("edit_compra_id").value = id;

  // 2) Cargar proveedores
  const provRes = await fetch("/proveedores", { credentials: "include" });
  if (!provRes.ok) {
    console.error("Error /proveedores:", provRes.status, await provRes.text());
    return alert("No se pudieron cargar proveedores");
  }
  const proveedores = await provRes.json();

  const selProv = document.getElementById("edit_compra_proveedor");
  selProv.innerHTML = "";
  proveedores.forEach((p) => {
    const op = document.createElement("option");
    op.value = p.id;
    op.textContent = `${p.nombre} — ${p.ruc}`;
    if (Number(p.id) === Number(data.proveedor_id)) op.selected = true;
    selProv.appendChild(op);
  });

  // 3) Cargar productos para el combo del modal (si existe)
  await cargarProductosEditarCompra();

  // 4) Cargar campos cabecera
  document.getElementById("edit_compra_fecha").value = String(data.fecha || "").slice(0, 10);
  document.getElementById("edit_compra_factura").value = data.factura || "";

  // 5) Items actuales
  editCompraItems = (data.items || []).map((it) => ({
    producto_id: it.producto_id,
    producto_nombre: it.producto_nombre,
    cantidad: Number(it.cantidad || 0),
    costo: Number(it.costo || 0),
    subtotal: Number(it.subtotal || (Number(it.cantidad || 0) * Number(it.costo || 0))),
  }));

  renderItemsEditarCompra();
  openModal("modalEditarCompra");
}

async function guardarEdicionCompra() {
  const id = Number(document.getElementById("edit_compra_id").value);

  const body = {
    proveedor_id: Number(document.getElementById("edit_compra_proveedor").value),
    fecha: document.getElementById("edit_compra_fecha").value,
    factura: document.getElementById("edit_compra_factura").value,
    items: editCompraItems,
  };

  const res = await fetch(`/compras/${id}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify(body),
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
  tbody.innerHTML = "";

  let subtotal = 0;

  editCompraItems.forEach((it, idx) => {
    subtotal += it.subtotal;

    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${it.producto_nombre}</td>
      <td style="text-align:center;">${it.cantidad}</td>
      <td>${numberFormat(it.costo)}</td>
      <td>${numberFormat(it.subtotal)}</td>
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

  const iva = Math.round(subtotal * 0.1);
  const total = subtotal + iva;

  const elTotal = document.getElementById("edit_compra_total");
  if (elTotal) elTotal.textContent = numberFormat(total);
}

async function eliminarCompra(id) {
  if (!confirm("¿Seguro que desea eliminar esta compra?")) return;

  const res = await fetch(`/compras/${id}`, {
    method: "DELETE",
    credentials: "include",
  });

  const data = await res.json();
  if (!data.ok) return alert("Error: " + data.msg);

  alert("Compra eliminada ✔");
  cargarComprasLista();
}

/*************************************************
 *  CARGAR PROVEEDORES (Nueva Compra)
 *************************************************/
async function cargarProveedoresCompra() {
  try {
    const res = await fetch("/proveedores", { credentials: "include" });
    const data = await res.json();

    const sel = document.getElementById("c_proveedor");
    sel.innerHTML = "<option value=''>Seleccione proveedor…</option>";

    sel.onchange = setProximaFacturaCompra;

    data.forEach((p) => {
      const op = document.createElement("option");
      op.value = p.id;
      op.textContent = `${p.nombre} — ${p.ruc}`;
      sel.appendChild(op);
    });
  } catch (err) {
    console.error("Error cargando proveedores:", err);
  }
}

/*************************************************
 *  NUEVA COMPRA
 *************************************************/
function abrirNuevaCompra() {
  // ✅ enganchar formato dinero en costo
  attachMoneyFormatterById("c_costo");

  cargarProveedoresCompra();
  openModal("modalNuevaCompra");

  document.getElementById("c_fecha").value = "";
  document.getElementById("c_factura").value = "";
  document.getElementById("c_proveedor").value = "";

  compraItems = [];
  productoSeleccionado = null;

  renderItemsCompra();

  setTimeout(() => setProximaFacturaCompra(), 50);
}

/*************************************************
 *  AGREGAR PRODUCTO
 *************************************************/
function agregarItemCompra() {
  if (!productoSeleccionado) {
    return alert("Debe seleccionar un producto de la lista.");
  }

  const cantidad = Number(document.getElementById("c_cantidad").value);
  const costo = parsePYMoney(document.getElementById("c_costo").value); // ✅ parse con puntos

  if (cantidad <= 0) return alert("Cantidad inválida.");
  if (costo <= 0) return alert("Costo inválido.");

  compraItems.push({
    producto_id: productoSeleccionado.id,
    producto_nombre: productoSeleccionado.nombre,
    cantidad,
    costo,
    subtotal: cantidad * costo,
  });

  // Reset
  document.getElementById("c_buscar_producto").value = "";
  document.getElementById("c_cantidad").value = 1;
  document.getElementById("c_costo").value = "0";
  productoSeleccionado = null;

  renderItemsCompra();
}

/*************************************************
 *  EDITAR ÍTEM (NUEVA COMPRA)
 *************************************************/
function editarItemCompra(i) {
  const it = compraItems[i];

  document.getElementById("c_buscar_producto").value = it.producto_nombre;
  document.getElementById("c_cantidad").value = it.cantidad;
  document.getElementById("c_costo").value = numberFormat(it.costo); // ✅ formateado

  productoSeleccionado = { id: it.producto_id, nombre: it.producto_nombre };

  compraItems.splice(i, 1);
  renderItemsCompra();
}

/*************************************************
 *  BORRAR ÍTEM (NUEVA COMPRA)
 *************************************************/
function borrarItemCompra(i) {
  if (!confirm("¿Desea eliminar este producto?")) return;
  compraItems.splice(i, 1);
  renderItemsCompra();
}

/*************************************************
 *  RENDERIZAR TABLA DE ÍTEMS (NUEVA COMPRA)
 *************************************************/
function renderItemsCompra() {
  const tbody = document.getElementById("c_items");
  tbody.innerHTML = "";

  let subtotal = 0;

  compraItems.forEach((it, idx) => {
    subtotal += it.subtotal;

    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${it.producto_nombre}</td>
      <td>${it.cantidad}</td>
      <td>${numberFormat(it.costo)}</td>
      <td>${numberFormat(it.subtotal)}</td>
      <td>
        <button class="btn btn-warning btn-sm" onclick="editarItemCompra(${idx})">✏️</button>
        <button class="btn btn-danger btn-sm" onclick="borrarItemCompra(${idx})">🗑️</button>
      </td>
    `;
    tbody.appendChild(tr);
  });

  const iva = Math.round(subtotal * 0.1);
  const total = subtotal + iva;

  document.getElementById("c_subtotal").textContent = numberFormat(subtotal);
  document.getElementById("c_iva").textContent = numberFormat(iva);
  document.getElementById("c_total").textContent = numberFormat(total);
}

/*************************************************
 *  GUARDAR COMPRA
 *************************************************/
async function guardarCompra() {
  const proveedor_id = Number(document.getElementById("c_proveedor").value);
  const fecha = document.getElementById("c_fecha").value;
  const factura = document.getElementById("c_factura").value;

  if (!proveedor_id) return alert("Seleccione proveedor.");
  if (!fecha) return alert("Ingrese fecha.");
  if (!compraItems.length) return alert("Agregue productos.");

  const body = {
    proveedor_id,
    fecha,
    factura,
    items: compraItems,
  };

  try {
    const res = await fetch("/compras", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify(body),
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

/*************************************************
 *  DETALLE DE COMPRA
 *************************************************/
async function verCompraDetalle(id) {
  try {
    const res = await fetch(`/compras/${id}`, { credentials: "include" });
    const data = await res.json();

    document.getElementById("v_id").textContent = data.id;
    document.getElementById("v_fecha").textContent = formatFecha(data.fecha);
    document.getElementById("v_proveedor").textContent = data.proveedor_nombre;
    document.getElementById("v_ruc").textContent = data.proveedor_ruc;
    document.getElementById("v_factura").textContent = data.factura;
    document.getElementById("v_total").textContent = numberFormat(data.total);

    const tbody = document.getElementById("v_items");
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

    openModal("modalVerCompra");
  } catch (err) {
    console.error("Error:", err);
  }
}

/*************************************************
 *  AUTOCOMPLETAR PRODUCTOS (NUEVA COMPRA)
 *************************************************/
async function autocompletarProductoCompra(texto) {
  const lista = document.getElementById("c_lista_productos");

  if (!texto || texto.trim().length < 1) {
    lista.innerHTML = "";
    productoSeleccionado = null;
    return;
  }

  try {
    const res = await fetch("/productos?buscar=" + encodeURIComponent(texto.trim()), {
      credentials: "include",
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

      // ✅ Mostrar NOMBRE (CÓDIGO) cuando exista
      const label =
        (codigo && nombre && codigo !== nombre)
          ? `${nombre} (${codigo})`
          : (nombre || codigo || "SIN NOMBRE");

      item.textContent = `${categoria} — [${marca}] ${label}`;

      item.onclick = () => {
        document.getElementById("c_buscar_producto").value = nombre || codigo || "";
        document.getElementById("c_costo").value = numberFormat(p.costo || 0); // ✅ formateado

        productoSeleccionado = {
          id: p.id,
          nombre: nombre || codigo || "SIN NOMBRE",
          costo: p.costo,
          categoria: p.categoria || null,
          marca: p.marca || null,
          codigo: p.codigo || null,
        };

        lista.innerHTML = "";
      };

      lista.appendChild(item);
    });
  } catch (err) {
    console.error("Error en autocomplete:", err);
  }
}

async function filtrarCompras() {
  const texto = document.getElementById("f_compra_buscar").value.toLowerCase();
  const proveedor = document.getElementById("f_compra_proveedor")?.value;
  const estado = document.getElementById("f_compra_estado")?.value;
  const desde = document.getElementById("f_compra_desde").value;
  const hasta = document.getElementById("f_compra_hasta").value;

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
  if (desde) data = data.filter((c) => c.fecha.slice(0, 10) >= desde);
  if (hasta) data = data.filter((c) => c.fecha.slice(0, 10) <= hasta);

  renderTablaCompras(data);
}

function renderTablaCompras(data) {
  const tbody = document.getElementById("tablaCompras");
  tbody.innerHTML = "";

  data.forEach((c) => {
    const productos = c.productos || "-";
    const categorias = c.categorias || "-";

    const tr = document.createElement("tr");

    tr.innerHTML = `
      <td>${c.id}</td>
      <td>${formatFecha(c.fecha)}</td>
      <td>${productos}</td>
      <td>${categorias}</td>
      <td><b>Gs. ${numberFormat(c.total)}</b></td>
      <td>${c.proveedor_nombre || "-"}</td>
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

function confirmarEliminarCompra(id) {
  document.getElementById("delete_compra_id").value = id;
  openModal("modalEliminarCompra");
}

async function eliminarCompraConfirmada() {
  const id = document.getElementById("delete_compra_id").value;

  const res = await fetch(`/compras/${id}`, {
    method: "DELETE",
    credentials: "include",
  });

  const data = await res.json();

  if (!data.ok) {
    alert("Error: " + data.msg);
    return;
  }

  closeModal("modalEliminarCompra");
  cargarComprasLista();
}

/*************************************************
 *  CARGAR PRODUCTOS (EDITAR COMPRA)
 *************************************************/
async function cargarProductosEditarCompra() {
  const sel = document.getElementById("edit_c_producto"); // ✅ este es tu ID real
  if (!sel) return;

  const res = await fetch("/productos", { credentials: "include" });
  if (!res.ok) {
    console.error("No se pudo cargar /productos", res.status, await res.text());
    return;
  }

  const productos = await res.json();
  sel.innerHTML = `<option value="">Seleccione producto…</option>`;

  productos.forEach((p) => {
    const categoria = (p.categoria || "Sin categoría").trim();
    const marca = (p.marca || "Sin marca").trim();
    const codigo = (p.codigo || "").trim();
    const nombre = (p.nombre || "").trim();

    // ✅ mostrar nombre (codigo)
    const label = (nombre && codigo && nombre !== codigo)
      ? `${categoria} — [${marca}] ${nombre} (${codigo})`
      : `${categoria} — [${marca}] ${nombre || codigo || "SIN NOMBRE"}`;

    const op = document.createElement("option");
    op.value = p.id;
    op.textContent = label;

    // guardamos nombre/codigo para mostrar luego
    op.dataset.nombre = (nombre || codigo || "SIN NOMBRE");
    sel.appendChild(op);
  });
}
function onChangeProductoEditarCompra() {
  const sel = document.getElementById("edit_c_producto");
  const costoInput = document.getElementById("edit_c_costo");
  if (!sel || !costoInput) return;
  // si querés, acá podés buscar costo del producto vía fetch /productos/:id
  // por ahora no tocamos para no romper nada
}

function agregarProductoEditarCompra() {
  const sel = document.getElementById("edit_c_producto");
  const inpCant = document.getElementById("edit_c_cantidad");
  const inpCosto = document.getElementById("edit_c_costo");

  if (!sel || !inpCant || !inpCosto) return alert("Faltan campos del editor.");

  const producto_id = Number(sel.value);
  if (!producto_id) return alert("Seleccione un producto.");

  const cantidad = Number(inpCant.value || 0);
  const costo = parsePYMoney(inpCosto.value);

  if (cantidad <= 0) return alert("Cantidad inválida.");
  if (costo <= 0) return alert("Costo inválido.");

  const producto_nombre = sel.options[sel.selectedIndex]?.dataset?.nombre
    || sel.options[sel.selectedIndex]?.textContent
    || "SIN NOMBRE";

  const subtotal = cantidad * costo;

  // si ya existe el producto en la lista, lo actualizamos
  const idx = editCompraItems.findIndex(x => Number(x.producto_id) === producto_id);
  if (idx >= 0) {
    editCompraItems[idx] = { producto_id, producto_nombre, cantidad, costo, subtotal };
  } else {
    editCompraItems.push({ producto_id, producto_nombre, cantidad, costo, subtotal });
  }

  // reset
  sel.value = "";
  inpCant.value = 1;
  inpCosto.value = "0";
  if (inpCosto.type !== "number") inpCosto.value = numberFormat(0);

  renderItemsEditarCompra();
}

function editarItemEditarCompra(idx) {
  const it = editCompraItems[idx];
  if (!it) return;

  const sel = document.getElementById("edit_c_producto");
  const inpCant = document.getElementById("edit_c_cantidad");
  const inpCosto = document.getElementById("edit_c_costo");

  sel.value = String(it.producto_id);
  inpCant.value = it.cantidad;
  inpCosto.value = numberFormat(it.costo);

  // sacamos para que al "Añadir / Actualizar" vuelva a entrar actualizado
  editCompraItems.splice(idx, 1);
  renderItemsEditarCompra();
}

// ✅ Borrar item
function borrarItemEditarCompra(idx) {
  if (!confirm("¿Eliminar este producto?")) return;
  editCompraItems.splice(idx, 1);
  renderItemsEditarCompra();
}

// ✅ Render tabla editar
function renderItemsEditarCompra() {
  const tbody = document.getElementById("edit_compra_items");
  tbody.innerHTML = "";

  let subtotal = 0;

  editCompraItems.forEach((it, idx) => {
    subtotal += it.subtotal;

    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${it.producto_nombre}</td>
      <td style="text-align:center;">${it.cantidad}</td>
      <td>${numberFormat(it.costo)}</td>
      <td>${numberFormat(it.subtotal)}</td>
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

  const iva = Math.round(subtotal * 0.1);
  const total = subtotal + iva;

  document.getElementById("edit_compra_total").textContent = numberFormat(total);
}
/*************************************************
 *  AUTO EJECUCIÓN INICIAL
 *************************************************/
if (document.getElementById("tabla-compras")) {
  // ✅ formato dinero en nueva compra si existe el input en el DOM
  attachMoneyFormatterById("c_costo");
  cargarComprasLista();
}