/* =====================================================================
   VENTA POR KILO (carnicería, fiambrería, verdulería) — js/carniceria.js
   ---------------------------------------------------------------------
   Complemento: se carga DESPUÉS de app.js, compras.js y ventas.js.
   Los productos por "Unidad" siguen funcionando exactamente igual.
   Solo cambia el comportamiento de los productos marcados "Kilo":
   - Al venderlos se pide el peso (o el monto en Gs.).
   - El precio del producto es el precio por kg.
   - El stock y las cantidades aceptan gramos (ej: 1,250 kg).
   ===================================================================== */
(function () {
  const KG = "kg";
  let mapaUnidades = {};          // id de producto -> "kg" | "unidad"
  let productoKgActual = null;    // producto por kilo elegido en la venta
  let modoKg = "peso";            // "peso" | "monto" (lo último que escribió el cajero)

  /* ---------- Utilidades ---------- */
  const nfKg = (n) => new Intl.NumberFormat("es-PY", {
    minimumFractionDigits: 3, maximumFractionDigits: 3
  }).format(Number(n || 0));
  const nfGsKg = (n) => new Intl.NumberFormat("es-PY").format(Math.round(Number(n || 0)));
  const soloDigitos = (v) => Number(String(v || "").replace(/\D/g, "")) || 0;
  const esKg = (id) => mapaUnidades[Number(id)] === KG;

  let servidorListo = null;       // null = no se sabe, true/false según /productos/unidades

  const AVISO_SERVIDOR = "La venta por kilo todavía no está activa en el servidor.\n\n" +
    "Pegá el bloque de server-carniceria.js en server.js (antes de CONSUMO INTERNO) " +
    "y reiniciá el servidor. En la terminal tiene que aparecer: Venta por kilo lista";

  async function cargarUnidades() {
    try {
      const r = await fetch("/productos/unidades", { credentials: "include", cache: "no-store" });
      servidorListo = r.ok;
      if (!r.ok) {
        console.warn("Venta por kilo: /productos/unidades respondió", r.status, "- falta el bloque del servidor o reiniciarlo");
        return;
      }
      const data = await r.json();
      const nuevo = {};
      (Array.isArray(data) ? data : []).forEach(x => { nuevo[Number(x.id)] = x.unidad_venta || "unidad"; });
      mapaUnidades = nuevo;
    } catch (e) {
      console.warn("Venta por kilo: no se pudieron cargar las unidades", e);
    }
  }

  async function guardarUnidad(id, unidad, stock) {
    if (!id) return;
    try {
      const r = await fetch(`/productos/${id}/unidad`, {
        method: "PUT",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          unidad_venta: unidad === KG ? KG : "unidad",
          stock: stock === "" || stock == null ? null : Number(stock)
        })
      });
      if (r.status === 404) alert(AVISO_SERVIDOR);
    } catch (e) {
      console.warn("Venta por kilo: no se pudo guardar la unidad", e);
    }
  }

  function modalVisible(id) {
    const el = document.getElementById(id);
    return !!el && el.style.display !== "none" && el.style.display !== "";
  }

  /* =====================================================================
     PRODUCTOS: campo "Se vende por"
     ===================================================================== */
  function cambiarUnidadProductoForm(pre) {
    const unidad = document.getElementById(`${pre}_unidad`)?.value;
    const lblPrecio = document.getElementById(`lbl_${pre}_precio`);
    const lblStock = document.getElementById(`lbl_${pre}_stock`);
    const stock = document.getElementById(`${pre}_stock`);
    const porKg = unidad === KG;
    if (porKg && servidorListo === false) alert(AVISO_SERVIDOR);
    if (lblPrecio) lblPrecio.textContent = porKg ? "Precio por kg (Gs.)" : "Precio (Gs.)";
    if (lblStock) lblStock.textContent = porKg ? "Stock (kg)" : "Cantidad";
    if (stock) {
      stock.step = porKg ? "0.001" : "1";
      stock.placeholder = porKg ? "Ej: 12,500" : "0";
    }
  }
  window.cambiarUnidadProductoForm = cambiarUnidadProductoForm;

  // Al guardar un producto nuevo, se guarda también si es por kilo
  if (typeof window.jpost === "function") {
    const jpostOriginal = window.jpost;
    window.jpost = async function (url, body = {}) {
      const esAltaProducto = url === "/productos" && modalVisible("modalProducto");
      const data = await jpostOriginal(url, body);
      if (esAltaProducto && data && data.id) {
        const unidad = document.getElementById("pr_unidad")?.value || "unidad";
        if (unidad === KG) {
          await guardarUnidad(data.id, unidad, document.getElementById("pr_stock")?.value);
        }
        await cargarUnidades();
        const sel = document.getElementById("pr_unidad");
        if (sel) { sel.value = "unidad"; cambiarUnidadProductoForm("pr"); }
      }
      return data;
    };
  }

  // Al editar un producto, se guarda la unidad y el stock con decimales
  if (typeof window.jput === "function") {
    const jputOriginal = window.jput;
    window.jput = async function (url, body = {}) {
      const m = String(url).match(/^\/productos\/(\d+)$/);
      const data = await jputOriginal(url, body);
      if (m && modalVisible("modalProductoEdit")) {
        await guardarUnidad(
          Number(m[1]),
          document.getElementById("ed_unidad")?.value || "unidad",
          document.getElementById("ed_stock")?.value
        );
        await cargarUnidades();
      }
      return data;
    };
  }

  // Al abrir "Editar producto", mostrar si es por kilo
  if (typeof window.abrirEditar === "function") {
    const abrirEditarOriginal = window.abrirEditar;
    window.abrirEditar = function (id) {
      abrirEditarOriginal(id);
      const sel = document.getElementById("ed_unidad");
      if (sel) sel.value = esKg(id) ? KG : "unidad";
      cambiarUnidadProductoForm("ed");
    };
  }

  // Al abrir "Nuevo producto", arrancar en Unidad
  if (typeof window.abrirNuevoProducto === "function") {
    const abrirNuevoOriginal = window.abrirNuevoProducto;
    window.abrirNuevoProducto = function () {
      abrirNuevoOriginal();
      const sel = document.getElementById("pr_unidad");
      if (sel) sel.value = "unidad";
      cambiarUnidadProductoForm("pr");
    };
  }

  // En la lista de productos, mostrar "kg" en precio y stock
  if (typeof window.renderProductos === "function") {
    const renderProductosOriginal = window.renderProductos;
    window.renderProductos = function (list) {
      renderProductosOriginal(list);
      document.querySelectorAll("#tabla-productos tr[data-id]").forEach(tr => {
        if (!esKg(tr.dataset.id)) return;
        const celdas = tr.children;
        const precio = celdas[6];
        const stock = celdas[9];
        if (precio && !precio.dataset.kg) {
          precio.dataset.kg = "1";
          precio.insertAdjacentHTML("beforeend", ' <small style="color:#9a3412;font-weight:600;">/kg</small>');
        }
        if (stock && stock.firstChild && stock.firstChild.nodeType === 3 && !stock.dataset.kg) {
          stock.dataset.kg = "1";
          stock.firstChild.textContent = `${nfKg(stock.firstChild.textContent)} kg`;
        }
      });
    };
  }

  /* =====================================================================
     VENTAS: pedir peso o monto para productos por kilo
     ===================================================================== */
  function mostrarPanelKg(prod) {
    productoKgActual = prod;
    modoKg = "peso";

    const panel = document.getElementById("kgPanel");
    const lblCant = document.getElementById("lblCantidadManualVenta");
    const lblPrecio = document.getElementById("lblPrecioManualVenta");
    const cant = document.getElementById("cantidadManualVenta");
    const precio = document.getElementById("precioManualVenta");
    const monto = document.getElementById("kgMontoVenta");

    if (panel) panel.style.display = "block";
    if (lblCant) lblCant.textContent = "Peso (kg)";
    if (lblPrecio) lblPrecio.textContent = "Precio por kg";
    if (cant) {
      cant.min = "0";
      cant.step = "0.001";
      cant.value = "";
      cant.placeholder = "Ej: 1,250";
      setTimeout(() => cant.focus(), 0);
    }
    if (precio) precio.value = `${nfGsKg(prod.precio)} /kg`;
    if (monto) monto.value = "";
    actualizarResumenKg();
  }

  function ocultarPanelKg() {
    productoKgActual = null;
    const panel = document.getElementById("kgPanel");
    const lblCant = document.getElementById("lblCantidadManualVenta");
    const lblPrecio = document.getElementById("lblPrecioManualVenta");
    const cant = document.getElementById("cantidadManualVenta");
    const monto = document.getElementById("kgMontoVenta");
    const resumen = document.getElementById("kgResumen");

    if (panel) panel.style.display = "none";
    if (lblCant) lblCant.textContent = "Cantidad";
    if (lblPrecio) lblPrecio.textContent = "Precio";
    if (cant) { cant.min = "1"; cant.step = "1"; cant.placeholder = ""; }
    if (monto) monto.value = "";
    if (resumen) resumen.textContent = "";
  }

  function actualizarResumenKg() {
    const resumen = document.getElementById("kgResumen");
    if (!resumen || !productoKgActual) return;
    const kg = Number(document.getElementById("cantidadManualVenta")?.value || 0);
    const monto = soloDigitos(document.getElementById("kgMontoVenta")?.value);

    if (modoKg === "monto" && monto > 0) {
      resumen.textContent = `Gs. ${nfGsKg(monto)} = ${nfKg(kg)} kg de ${productoKgActual.nombre}`;
    } else if (kg > 0) {
      resumen.textContent = `${nfKg(kg)} kg × Gs. ${nfGsKg(productoKgActual.precio)} = Gs. ${nfGsKg(kg * productoKgActual.precio)}`;
    } else {
      resumen.textContent = "";
    }
  }

  function kgRapido(kg) {
    if (!productoKgActual) return;
    modoKg = "peso";
    const cant = document.getElementById("cantidadManualVenta");
    const monto = document.getElementById("kgMontoVenta");
    if (cant) cant.value = kg;
    if (monto) monto.value = "";
    actualizarResumenKg();
  }
  window.kgRapido = kgRapido;

  document.addEventListener("input", (e) => {
    if (!productoKgActual) return;

    if (e.target.id === "cantidadManualVenta") {
      modoKg = "peso";
      const monto = document.getElementById("kgMontoVenta");
      if (monto) monto.value = "";
      actualizarResumenKg();
    }

    if (e.target.id === "kgMontoVenta") {
      modoKg = "monto";
      const montoNum = soloDigitos(e.target.value);
      e.target.value = montoNum ? montoNum.toLocaleString("es-PY") : "";
      const cant = document.getElementById("cantidadManualVenta");
      if (cant) {
        cant.value = montoNum && productoKgActual.precio > 0
          ? (montoNum / productoKgActual.precio).toFixed(3)
          : "";
      }
      actualizarResumenKg();
    }
  });

  // Enter en peso o monto = agregar
  document.addEventListener("keydown", (e) => {
    if (!productoKgActual || e.key !== "Enter") return;
    if (e.target.id === "cantidadManualVenta" || e.target.id === "kgMontoVenta") {
      e.preventDefault();
      window.agregarProductoManualVenta();
    }
  });

  // Elegir producto en "Agregar manualmente"
  if (typeof window.seleccionarProductoManualVenta === "function") {
    const seleccionarOriginal = window.seleccionarProductoManualVenta;
    window.seleccionarProductoManualVenta = function (id, nombre, precio) {
      seleccionarOriginal(id, nombre, precio);
      if (esKg(id)) {
        mostrarPanelKg({ id: Number(id), nombre, precio: Number(precio || 0) });
      } else {
        ocultarPanelKg();
        const cant = document.getElementById("cantidadManualVenta");
        if (cant && !cant.value) cant.value = 1;
      }
    };
  }

  // Agregar a la venta
  if (typeof window.agregarProductoManualVenta === "function") {
    const agregarOriginal = window.agregarProductoManualVenta;
    window.agregarProductoManualVenta = function () {
      if (!productoKgActual) return agregarOriginal();

      const kg = Number(document.getElementById("cantidadManualVenta")?.value || 0);
      const monto = soloDigitos(document.getElementById("kgMontoVenta")?.value);
      if (!(kg > 0)) {
        alert("Ingresá el peso en kg o el monto en Gs.");
        return;
      }

      const peso = Math.round(kg * 1000) / 1000;
      const subtotal = modoKg === "monto" && monto > 0
        ? monto
        : Math.round(peso * productoKgActual.precio);

      ventaItems.push({
        producto_id: productoKgActual.id,
        nombre: productoKgActual.nombre,
        precio: productoKgActual.precio,
        cantidad: peso,
        subtotal,
        unidad: KG
      });

      renderItemsVenta();

      const buscar = document.getElementById("buscarProductoManual");
      const precio = document.getElementById("precioManualVenta");
      const cant = document.getElementById("cantidadManualVenta");
      if (buscar) buscar.value = "";
      if (precio) precio.value = "";
      ocultarPanelKg();
      if (cant) cant.value = 1;
      if (typeof productoManualSeleccionado !== "undefined") productoManualSeleccionado = null;
      document.getElementById("barcodeVenta")?.focus();
    };
  }

  // Lista de la venta: mostrar "1,250 kg"
  if (typeof window.renderItemsVenta === "function") {
    const renderItemsOriginal = window.renderItemsVenta;
    window.renderItemsVenta = function () {
      renderItemsOriginal();
      const filas = document.querySelectorAll("#v_items tr");
      (ventaItems || []).forEach((it, i) => {
        if (it.unidad !== KG && !esKg(it.producto_id)) return;
        const celda = filas[i]?.children?.[1];
        if (celda) celda.textContent = `${nfKg(it.cantidad)} kg`;
      });
    };
  }

  // Escáner: un producto por kilo no suma "1", pide el peso
  if (typeof window.agregarProductoDesdeBarcode === "function") {
    const barcodeOriginal = window.agregarProductoDesdeBarcode;
    window.agregarProductoDesdeBarcode = function (producto) {
      if (producto && esKg(producto.id)) {
        window.seleccionarProductoManualVenta(producto.id, producto.nombre, Number(producto.precio || 0));
        const buscar = document.getElementById("buscarProductoManual");
        if (buscar) buscar.value = producto.nombre || "";
        return;
      }
      return barcodeOriginal(producto);
    };
  }

  // Abrir venta / reiniciar: cargar unidades y esconder el panel
  if (typeof window.nuevaVenta === "function") {
    const nuevaVentaOriginal = window.nuevaVenta;
    window.nuevaVenta = async function () {
      await cargarUnidades();
      ocultarPanelKg();
      return nuevaVentaOriginal();
    };
  }
  if (typeof window.iniciarPOS === "function") {
    const iniciarPOSOriginal = window.iniciarPOS;
    window.iniciarPOS = function () {
      ocultarPanelKg();
      return iniciarPOSOriginal();
    };
  }

  /* =====================================================================
     EDITAR VENTA: permitir cantidades con decimales (kg)
     La versión original quitaba los puntos (1.250 -> 1250).
     ===================================================================== */
  if (typeof window.abrirEditarVenta === "function") {
    const abrirEditarVentaOriginal = window.abrirEditarVenta;
    window.abrirEditarVenta = async function (id) {
      await abrirEditarVentaOriginal(id);
      document.querySelectorAll("#edit_items .edit-cant").forEach(inp => {
        inp.min = "0";
        inp.step = "any";
      });
    };
  }

  window.guardarEdicionVenta = async function () {
    const id = document.getElementById("edit_venta_id").value;
    const aNumeroGs = (v) => Number(String(v || "0").replace(/\./g, "").replace(/,/g, "."));

    const items = [];
    document.querySelectorAll("#edit_items tr").forEach(tr => {
      const cantEl = tr.querySelector(".edit-cant");
      const precioEl = tr.querySelector(".edit-precio");
      const producto_id = Number(cantEl?.dataset?.productoId || 0);
      const cantidad = Number(String(cantEl?.value || "0").replace(",", "."));
      const precio_unitario = aNumeroGs(precioEl?.value || 0);
      if (producto_id && cantidad > 0 && precio_unitario >= 0) {
        items.push({ producto_id, cantidad, precio_unitario });
      }
    });

    if (items.length === 0) {
      alert("❌ La venta debe tener al menos 1 producto");
      return;
    }

    const total = Math.round(items.reduce((a, it) => a + it.cantidad * it.precio_unitario, 0));
    const moneda = document.getElementById("edit_moneda")?.value || "PYG";
    const tipoCambio = Number(document.getElementById("edit_tipo_cambio")?.value || 1);
    const total_moneda = (moneda !== "PYG" && tipoCambio > 0) ? total / tipoCambio : total;

    const body = {
      fecha: document.getElementById("edit_fecha").value,
      forma_pago_id: Number(document.getElementById("edit_forma_pago").value),
      estado_pago: document.getElementById("edit_estado").value,
      moneda,
      tipo_cambio: tipoCambio,
      total,
      total_pyg: total,
      total_moneda,
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
      if (typeof window.cargarVentas === "function") await window.cargarVentas();
    } catch (err) {
      console.error(err);
      alert("❌ Error al guardar cambios");
    }
  };

  /* ---------- Inicio ---------- */
  document.addEventListener("DOMContentLoaded", async () => {
    await cargarUnidades();
    if (location.hash === "#productos" && typeof window.listarProductos === "function") window.listarProductos();
  });
  window.addEventListener("hashchange", () => {
    if (location.hash === "#productos") cargarUnidades().then(() => {
      if (typeof window.listarProductos === "function") window.listarProductos();
    });
  });
  window.cargarUnidadesProductos = cargarUnidades;
})();