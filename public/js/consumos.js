/* =====================================================================
   CONSUMO INTERNO (uso propio) — public/js/consumos.js
   ===================================================================== */

let consumoProductoSel = null;
let consumoBuscarTimer = null;

function fmtGsConsumo(n) {
  return "Gs. " + new Intl.NumberFormat("es-PY").format(Math.round(Number(n || 0)));
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
        <strong style="color:#111827;">${p.nombre || "-"}</strong><br>
        <small style="color:#6b7280;">Código: ${p.codigo || "-"} | Stock: ${Number(p.stock || 0)}</small>
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
    costo: Number(p.costo || 0)
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
  const costoTotal = cant * consumoProductoSel.costo;

  info.style.display = "block";
  info.innerHTML = `
    Stock disponible: <strong>${consumoProductoSel.stock}</strong>
    &nbsp;|&nbsp; Costo de lo que se descuenta: <strong>${fmtGsConsumo(costoTotal)}</strong>
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

    if (typeof mostrarToastAccion === "function") {
      mostrarToastAccion("Consumo registrado");
    } else {
      alert("Consumo registrado");
    }

    limpiarFormConsumo();
    await cargarConsumos();
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

/* ---------- Historial ---------- */
async function cargarConsumos() {
  const tbody = document.getElementById("tablaConsumos");
  if (!tbody) return;

  try {
    const res = await fetch("/consumos", { credentials: "include" });
    const rows = await res.json();

    tbody.innerHTML = "";
    let totalCosto = 0;

    if (!Array.isArray(rows) || !rows.length) {
      tbody.innerHTML = `
        <tr><td colspan="7" style="text-align:center;padding:32px;color:#6b7280;">
          Todavía no hay consumos registrados.
        </td></tr>`;
    } else {
      rows.forEach(c => {
        totalCosto += Number(c.costo_total || 0);
        const tr = document.createElement("tr");
        tr.innerHTML = `
          <td style="padding:12px;white-space:nowrap;color:#374151;">${fmtFechaConsumo(c.fecha)}</td>
          <td style="padding:12px;font-weight:600;color:#111827;">${c.producto_nombre || "-"}</td>
          <td style="padding:12px;text-align:center;">${Number(c.cantidad)}</td>
          <td style="padding:12px;text-align:right;">${fmtGsConsumo(c.costo_total)}</td>
          <td style="padding:12px;color:#4b5563;">${c.motivo || "-"}</td>
          <td style="padding:12px;color:#4b5563;">${c.usuario_nombre || "-"}</td>
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
    }

    const lblTotal = document.getElementById("consumoTotalCosto");
    if (lblTotal) lblTotal.textContent = fmtGsConsumo(totalCosto);
  } catch (err) {
    console.error("Error cargando consumos:", err);
  }
}

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
    await cargarConsumos();
  } catch (err) {
    console.error(err);
    alert("Error eliminando consumo");
  }
}

/* ---------- Eventos ---------- */
document.addEventListener("input", e => {
  if (e.target.id === "consumoBuscar") buscarProductoConsumo(e.target.value);
  if (e.target.id === "consumoCantidad") actualizarInfoProductoConsumo();
});

function enConsumoPage() {
  return (location.hash || "").toLowerCase().includes("consumo");
}

document.addEventListener("DOMContentLoaded", () => {
  if (enConsumoPage()) cargarConsumos();
});

window.addEventListener("hashchange", () => {
  if (enConsumoPage()) cargarConsumos();
});

window.registrarConsumoInterno = registrarConsumoInterno;
window.cargarConsumos = cargarConsumos;
window.eliminarConsumo = eliminarConsumo;
window.limpiarFormConsumo = limpiarFormConsumo;