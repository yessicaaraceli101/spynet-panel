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

/*************************************************
 *  LISTAR COMPRAS (TABLA PRINCIPAL)
 *************************************************/
async function cargarComprasLista() {
  try {
    const res = await fetch("/compras", { credentials: "include" });

    // ✅ Si no está autorizado, volver a login
    if (res.status === 401) {
      alert("Sesión expirada. Inicie sesión de nuevo.");
      location.href = "/login.html"; // o la ruta que uses
      return;
    }

    // ✅ Si es otro error
    if (!res.ok) {
      const txt = await res.text();
      console.error("Error /compras:", res.status, txt);
      return;
    }

    const data = await res.json();

    // ✅ Asegurar que sea array
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
    const res = await fetch(`/compras/${id}`, { credentials: "include" });
    const data = await res.json();

    document.getElementById("edit_compra_id").value = id;

    const provRes = await fetch("/proveedores", { credentials: "include" });
    const proveedores = await provRes.json();

    const sel = document.getElementById("edit_compra_proveedor");
    sel.innerHTML = "";

    proveedores.forEach(p => {
        const op = document.createElement("option");
        op.value = p.id;
        op.textContent = `${p.nombre} — ${p.ruc}`;
        if (p.id === data.proveedor_id) op.selected = true;
        sel.appendChild(op);
    });

    document.getElementById("edit_compra_fecha").value = data.fecha.slice(0, 10);
    document.getElementById("edit_compra_factura").value = data.factura;

    editCompraItems = data.items.map(it => ({
        producto_id: it.producto_id,
        producto_nombre: it.producto_nombre,
        cantidad: it.cantidad,
        costo: it.costo,
        subtotal: it.subtotal
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
        items: editCompraItems
    };

    const res = await fetch(`/compras/${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(body)
    });

    const data = await res.json();
    if (!data.ok) return alert("Error: " + data.msg);

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

    document.getElementById("edit_compra_total").textContent = numberFormat(total);
}

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

/*************************************************
 *  CARGAR PROVEEDORES
 *************************************************/
async function cargarProveedoresCompra() {
    try {
        const res = await fetch("/proveedores", { credentials: "include" });
        const data = await res.json();

        const sel = document.getElementById("c_proveedor");
        sel.innerHTML = "<option value=''>Seleccione proveedor…</option>";

        data.forEach(p => {
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
    cargarProveedoresCompra();
    openModal("modalNuevaCompra");

    document.getElementById("c_fecha").value = "";
    document.getElementById("c_factura").value = "";
    document.getElementById("c_proveedor").value = "";

    compraItems = [];
    productoSeleccionado = null;

    renderItemsCompra();
}

/*************************************************
 *  AGREGAR PRODUCTO
 *************************************************/
function agregarItemCompra() {
    if (!productoSeleccionado) {
        return alert("Debe seleccionar un producto de la lista.");
    }

    const cantidad = Number(document.getElementById("c_cantidad").value);
    const costo = Number(document.getElementById("c_costo").value);

    if (cantidad <= 0) return alert("Cantidad inválida.");
    if (costo <= 0) return alert("Costo inválido.");

    compraItems.push({
        producto_id: productoSeleccionado.id,
        producto_nombre: productoSeleccionado.nombre,
        cantidad,
        costo,
        subtotal: cantidad * costo
    });

    // Reset de campos
    document.getElementById("c_buscar_producto").value = "";
    document.getElementById("c_cantidad").value = 1;
    document.getElementById("c_costo").value = 0;
    productoSeleccionado = null;

    renderItemsCompra();
}

/*************************************************
 *  EDITAR ÍTEM
 *************************************************/
function editarItemCompra(i) {
    const it = compraItems[i];

    document.getElementById("c_buscar_producto").value = it.producto_nombre;
    document.getElementById("c_cantidad").value = it.cantidad;
    document.getElementById("c_costo").value = it.costo;

    productoSeleccionado = { id: it.producto_id, nombre: it.producto_nombre };

    compraItems.splice(i, 1);
    renderItemsCompra();
}

/*************************************************
 *  BORRAR ÍTEM
 *************************************************/
function borrarItemCompra(i) {
    if (!confirm("¿Desea eliminar este producto?")) return;
    compraItems.splice(i, 1);
    renderItemsCompra();
}

/*************************************************
 *  RENDERIZAR TABLA DE ÍTEMS
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

        data.items.forEach(it => {
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
 *  AUTOCOMPLETAR PRODUCTOS
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
        credentials: "include"
        });
        if (!res.ok) return;

        const data = await res.json();

        lista.innerHTML = "";
        productoSeleccionado = null;

        if (!data.length) {
            lista.innerHTML = `<div class="autocomplete-item">Sin resultados</div>`;
            return;
        }

        data.forEach(p => {
            const item = document.createElement("div");
            item.className = "autocomplete-item";
            item.textContent = `${p.nombre} ${p.marca ? "— " + p.marca : ""}`;

            item.onclick = () => {
                document.getElementById("c_buscar_producto").value = p.nombre;
                document.getElementById("c_costo").value = p.costo || 0;

                productoSeleccionado = {
                    id: p.id,
                    nombre: p.nombre,
                    costo: p.costo
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
    const proveedor = document.getElementById("f_compra_proveedor").value;
    const estado = document.getElementById("f_compra_estado").value;
    const desde = document.getElementById("f_compra_desde").value;
    const hasta = document.getElementById("f_compra_hasta").value;

    const res = await fetch("/compras", { credentials:"include" });
    let data = await res.json();

    if (texto.trim()) {
        data = data.filter(c =>
            (c.proveedor_nombre || "").toLowerCase().includes(texto) ||
            (c.factura || "").toLowerCase().includes(texto) ||
            (c.productos || "").toLowerCase().includes(texto) ||
            (c.categorias || "").toLowerCase().includes(texto)
        );
    }

    if (proveedor) data = data.filter(c => c.proveedor_id == proveedor);
    if (estado) data = data.filter(c => c.estado == estado);
    if (desde) data = data.filter(c => c.fecha.slice(0,10) >= desde);
    if (hasta) data = data.filter(c => c.fecha.slice(0,10) <= hasta);

    renderTablaCompras(data);
}
function renderTablaCompras(data) {
    const tbody = document.getElementById("tablaCompras");
    tbody.innerHTML = "";

    data.forEach(c => {
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
/*************************************************
 *  AUTO EJECUCIÓN INICIAL
 *************************************************/
if (document.getElementById("tabla-compras")) {
    cargarComprasLista();
}