// server.js
import dotenv from "dotenv";
dotenv.config();

import express from "express";
import cors from "cors";
import pkg from "pg";
import multer from "multer";
import fs from "fs";
import path from "path";
import bcrypt from "bcryptjs";
import session from "express-session";
import PDFDocument from "pdfkit";
import { createClient } from "@supabase/supabase-js";

const { Pool } = pkg;
const EDIT_SALES_PASSWORD = process.env.EDIT_SALES_PASSWORD || "editar123";
let EDIT_SALES_HASH = null;

(async () => {
  EDIT_SALES_HASH = await bcrypt.hash(EDIT_SALES_PASSWORD, 10);
})();

const app = express();
const PORT = process.env.PORT || 4000;

app.use((req, res, next) => {
  res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, private");
  next();
});

// ✅ Logs ANTES de crear el cliente
console.log("SUPABASE_URL:", process.env.SUPABASE_URL ? "OK" : "FALTA");
console.log("SERVICE_ROLE:", process.env.SUPABASE_SERVICE_ROLE_KEY ? "OK" : "FALTA");

console.log("ENV KEYS:", Object.keys(process.env).filter(k => k.includes("SUPABASE") || k.includes("SERVICE")));
console.log("SUPABASE_URL exists:", !!process.env.SUPABASE_URL);
console.log("SUPABASE_SERVICE_ROLE_KEY exists:", !!process.env.SUPABASE_SERVICE_ROLE_KEY);
console.log("SERVICE_ROLE exists:", !!process.env.SERVICE_ROLE);

// ✅ Cortar con error claro si falta algo
if (!process.env.SUPABASE_URL) {
  throw new Error("FALTA SUPABASE_URL en .env");
}
if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
  throw new Error("FALTA SUPABASE_SERVICE_ROLE_KEY en .env");
}

// ✅ Crear cliente recién acá
const supabase = createClient(
  process.env.SUPABASE_URL.trim(),
  process.env.SUPABASE_SERVICE_ROLE_KEY.trim()
);

app.use(express.static("public"));

/* ---------------------------------- Sesión ---------------------------------- */
app.use(
  session({
    name: "sid",
    secret: process.env.SESSION_SECRET || "super_secreto_autoservice",
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      sameSite: "lax",
      secure: false, // true si usas HTTPS
      maxAge: 1000 * 60 * 60 * 8,
    },
  })
);

/* ----------------------------------- CORS ----------------------------------- */
app.use(
  cors({
    origin: true,
    credentials: true,
  })
);

/* ------------------------------ Parsers/Static ------------------------------- */
app.use(express.json({ limit: "20mb" }));
app.use(express.urlencoded({ extended: true, limit: "20mb" }));

/* ----------------------------- PostgreSQL Pool ------------------------------ */
const pool = new Pool({
  host: process.env.PGHOST,
  port: Number(process.env.PGPORT || 5432),
  user: process.env.PGUSER,
  password: process.env.PGPASSWORD,
  database: process.env.PGDATABASE,

  ssl: {
    rejectUnauthorized: false, // ✅ clave para evitar SELF_SIGNED_CERT_IN_CHAIN
  },

  max: Number(process.env.PGPOOL_MAX || 10),
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 10_000,
});
// ✅ Log de errores del pool
pool.on("error", (err) => {
  console.error("❌ Pool error:", err.message);
});

// ✅ Chequeo inicial de conexión + DB actual
(async () => {
  try {
    const client = await pool.connect();
    console.log("🟢 Conectado a PostgreSQL");
    const info = await client.query(
      "SELECT current_database() AS db, current_schema() AS schema"
    );
    console.log("📦 DB:", info.rows[0]);
    client.release();
  } catch (err) {
    console.error("❌ Error al conectar PostgreSQL:", err.message);
  }
})();
/* ------------------------------ Subida imagenes ----------------------------- */
const uploadsDir = path.join(process.cwd(), "public", "uploads");
if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, uploadsDir),
  filename: (_req, file, cb) => {
    const unique = Date.now() + "-" + Math.round(Math.random() * 1e9);
    const ext = path.extname(file.originalname || "") || ".png";
    cb(null, `prod-${unique}${ext}`);
  },
});
const upload = multer({ storage });

/** ÚNICA función para convertir dataURL base64 a archivo físico en /public/uploads */
function saveDataUrlToFile(dataUrl, prefix = "prod") {
  if (!dataUrl || !dataUrl.startsWith("data:")) return null;
  const [meta, b64] = dataUrl.split(",");
  const mime = (meta.match(/^data:(.+);base64$/) || [])[1] || "image/png";
  const ext = (mime.split("/")[1] || "png").toLowerCase();
  const fname = `${prefix}-${Date.now()}-${Math.round(Math.random() * 1e9)}.${ext}`;
  const filePath = path.join(uploadsDir, fname);
  fs.writeFileSync(filePath, Buffer.from(b64, "base64"));
  return `/uploads/${fname}`;
}

/* ------------------------------ Bootstrap admin ----------------------------- */
async function bootstrapUsuarios() {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS usuarios (
        id SERIAL PRIMARY KEY,
        usuario TEXT UNIQUE NOT NULL,
        nombre  TEXT,
        password_hash TEXT NOT NULL,
        creado_en TIMESTAMP DEFAULT NOW()
      );
    `);

    const adminUser = process.env.ADMIN_USER || "admin";
    const adminPass = process.env.ADMIN_PASS || "1234";

    const { rows } = await pool.query("SELECT 1 FROM usuarios WHERE usuario=$1", [adminUser]);
    if (rows.length === 0) {
      const hash = await bcrypt.hash(adminPass, 10);
      await pool.query(
        "INSERT INTO usuarios (usuario, nombre, password_hash) VALUES ($1,$2,$3)",
        [adminUser, "Administrador", hash]
      );
      console.log(`👤 Usuario admin creado -> ${adminUser}/${adminPass}`);
    }
  } catch (e) {
    console.error("Bootstrap usuarios:", e.message);
  }
}
bootstrapUsuarios();

/* --------------------------------- Auth/Sesión ------------------------------ */
function requireAuth(req, res, next) {
  if (req.session && req.session.user) return next();
  return res.status(401).json({ error: "No autorizado" });
}


app.get("/supabase-test", async (req, res) => {
  const table = String(req.query.table || "productos").trim();

  const { data, error } = await supabase
    .from(table)
    .select("*", { count: "exact" })
    .limit(1);

  return res.json({
    ok: !error,
    table,
    count: data ? data.length : 0,
    error: error ? { message: error.message, details: error.details, code: error.code, hint: error.hint } : null,
    sample: data || []
  });
});

app.post("/login", async (req, res) => {
  const { usuario, password } = req.body || {};
  if (!usuario || !password) return res.status(400).json({ error: "Faltan credenciales" });

  try {
    const { rows } = await pool.query(
      "SELECT id, usuario, nombre, password_hash FROM usuarios WHERE usuario=$1 LIMIT 1",
      [usuario]
    );
    if (!rows.length) return res.status(401).json({ error: "Credenciales inválidas" });

    const u = rows[0];
    const ok = await bcrypt.compare(password, u.password_hash);
    if (!ok) return res.status(401).json({ error: "Credenciales inválidas" });

    req.session.user = { id: u.id, usuario: u.usuario, nombre: u.nombre };
    res.json({ ok: true, user: req.session.user });
  } catch (e) {
    console.error("POST /login", e);
    res.status(500).json({ error: "Error en el servidor" });
  }
});

app.post("/ventas/validar-edicion", requireAuth, async (req, res) => {
  const { password } = req.body;

  if (!password) {
    return res.status(400).json({ ok: false, msg: "Contraseña requerida" });
  }

  const ok = await bcrypt.compare(password, EDIT_SALES_HASH);

  if (!ok) {
    return res.status(401).json({ ok: false, msg: "Contraseña incorrecta" });
  }

  res.json({ ok: true });
});
app.get("/me", (req, res) => {
  if (req.session && req.session.user) return res.json({ ok: true, user: req.session.user });
  return res.status(401).json({ error: "No autorizado" });
});

app.post("/logout", (req, res) => {
  req.session.destroy(() => {
    res.clearCookie("sid");
    res.json({ ok: true });
  });
});

/* ---------------------------------- Clientes -------------------------------- */
app.get("/clientes", requireAuth, async (_req, res) => {
  try {
    const result = await pool.query("SELECT * FROM clientes ORDER BY id DESC");
    res.json(result.rows);
  } catch (err) {
    console.error("GET /clientes", err.message);
    res.status(500).json({ error: "Error al listar clientes" });
  }
});

app.post("/clientes", requireAuth, async (req, res) => {
  try {
    const { nombre, apellido, ci, telefono, pais, ciudad, direccion, estado } = req.body;
    const q = `
      INSERT INTO clientes (nombre, apellido, ci, telefono, pais, ciudad, direccion, estado)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`;
    const { rows } = await pool.query(q, [nombre, apellido, ci, telefono, pais, ciudad, direccion, estado]);
    res.json({ message: "Cliente guardado correctamente", cliente: rows[0] });
  } catch (err) {
    console.error("POST /clientes", err.message);
    res.status(500).json({ error: "Error al guardar cliente" });
  }
});

app.put("/clientes/:id", requireAuth, async (req, res) => {
  try {
    const { id } = req.params;
    const { nombre, apellido, ci, telefono, pais, ciudad, direccion, estado } = req.body;
    const q = `
      UPDATE clientes
      SET nombre=$1, apellido=$2, ci=$3, telefono=$4, pais=$5, ciudad=$6, direccion=$7, estado=$8
      WHERE id=$9 RETURNING *`;
    const { rows } = await pool.query(q, [nombre, apellido, ci, telefono, pais, ciudad, direccion, estado, id]);
    res.json({ message: "Cliente actualizado correctamente", cliente: rows[0] });
  } catch (err) {
    console.error("PUT /clientes/:id", err.message);
    res.status(500).json({ error: "Error al actualizar cliente" });
  }
});

app.delete("/clientes/:id", requireAuth, async (req, res) => {
  try {
    await pool.query("DELETE FROM clientes WHERE id=$1", [req.params.id]);
    res.json({ message: "Cliente eliminado correctamente" });
  } catch (err) {
    console.error("DELETE /clientes/:id", err.message);
    res.status(500).json({ error: "Error al eliminar cliente" });
  }
});

/* -------------------------------- Proveedores ------------------------------- */
app.get("/proveedores", requireAuth, async (_req, res) => {
  try {
    const { rows } = await pool.query(
      "SELECT id, nombre, ruc, contacto, telefono, pais, ciudad, direccion, estado FROM proveedores ORDER BY id DESC"
    );
    res.json(rows);
  } catch (e) {
    console.error("GET /proveedores", e);
    res.status(500).json({ error: "Error al listar proveedores" });
  }
});

app.post("/proveedores", requireAuth, async (req, res) => {
  try {
    const { nombre = "", ruc = "", contacto = null, telefono = null, pais = null, ciudad = null, direccion = null, estado = true } = req.body || {};
    if (!nombre.trim()) return res.status(400).json({ error: "El nombre es obligatorio" });
    if (!ruc.trim())    return res.status(400).json({ error: "El RUC es obligatorio" });

    const { rows } = await pool.query(
      `INSERT INTO proveedores (nombre, ruc, contacto, telefono, pais, ciudad, direccion, estado)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
       RETURNING id, nombre, ruc, contacto, telefono, pais, ciudad, direccion, estado`,
      [nombre.trim(), ruc.trim(), contacto, telefono, pais, ciudad, direccion, !!estado]
    );
    res.status(201).json(rows[0]);
  } catch (e) {
    console.error("POST /proveedores", e);
    res.status(500).json({ error: "Error al crear proveedor" });
  }
});

app.put("/proveedores/:id", requireAuth, async (req, res) => {
  try {
    const id = Number(req.params.id);
    const { nombre = "", ruc = "", contacto = null, telefono = null, pais = null, ciudad = null, direccion = null, estado = true } = req.body || {};
    if (!id) return res.status(400).json({ error: "ID inválido" });
    if (!nombre.trim()) return res.status(400).json({ error: "El nombre es obligatorio" });
    if (!ruc.trim())    return res.status(400).json({ error: "El RUC es obligatorio" });

    const { rows } = await pool.query(
      `UPDATE proveedores
       SET nombre=$1, ruc=$2, contacto=$3, telefono=$4, pais=$5, ciudad=$6, direccion=$7, estado=$8
       WHERE id=$9
       RETURNING id, nombre, ruc, contacto, telefono, pais, ciudad, direccion, estado`,
      [nombre.trim(), ruc.trim(), contacto, telefono, pais, ciudad, direccion, !!estado, id]
    );
    if (!rows.length) return res.status(404).json({ error: "Proveedor no encontrado" });
    res.json(rows[0]);
  } catch (e) {
    console.error("PUT /proveedores/:id", e);
    res.status(500).json({ error: "Error al actualizar proveedor" });
  }
});

app.delete("/proveedores/:id", requireAuth, async (req, res) => {
  try {
    const { rowCount } = await pool.query("DELETE FROM proveedores WHERE id=$1", [Number(req.params.id)]);
    if (!rowCount) return res.status(404).json({ error: "Proveedor no encontrado" });
    res.json({ ok: true });
  } catch (e) {
    console.error("DELETE /proveedores/:id", e);
    res.status(500).json({ error: "Error al eliminar proveedor" });
  }
});

/* --------------------------------- Categorías ------------------------------- */
async function bootstrapCategorias() {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS categorias (
        id SERIAL PRIMARY KEY,
        nombre TEXT NOT NULL,
        codigo TEXT,
        descripcion TEXT,
        imagen_base64 TEXT,
        creado_en TIMESTAMP DEFAULT NOW()
      );
    `);
    await pool.query(`CREATE UNIQUE INDEX IF NOT EXISTS categorias_nombre_uk ON categorias (nombre)`);
  } catch (e) {
    console.error("Bootstrap categorias:", e.message);
  }
}
bootstrapCategorias();

/*  GET /categorias  */
app.get("/categorias", requireAuth, async (_req, res) => {
  try {
    const { rows } = await pool.query(`
      SELECT
        c.id,
        c.nombre,
        COALESCE(
          c.codigo,
          (SELECT p.codigo
             FROM productos p
            WHERE p.categoria_id = c.id
              AND p.codigo IS NOT NULL
            ORDER BY p.id DESC
            LIMIT 1)
        ) AS codigo,
        c.descripcion,
        COALESCE(
          c.imagen_base64,
          (SELECT COALESCE(p.imagen_base64, p.imagen)
             FROM productos p
            WHERE p.categoria_id = c.id
              AND (p.imagen_base64 IS NOT NULL OR p.imagen IS NOT NULL)
            ORDER BY p.id DESC
            LIMIT 1)
        ) AS imagen_base64
      FROM categorias c
      ORDER BY c.id ASC
    `);
    res.json(rows);
  } catch (e) {
    console.error("GET /categorias", e);
    res.status(500).json({ error: "Error al listar categorías" });
  }
});

app.post("/categorias", requireAuth, async (req, res) => {
  try {
    const { nombre = "", codigo = null, descripcion = null, imagen_base64 = null } = req.body || {};
    if (!nombre.trim()) return res.status(400).json({ error: "El nombre es obligatorio" });

    const { rows } = await pool.query(
      `INSERT INTO categorias (nombre, codigo, descripcion, imagen_base64)
       VALUES ($1,$2,$3,$4)
       ON CONFLICT (nombre) DO UPDATE SET
         codigo = COALESCE(EXCLUDED.codigo, categorias.codigo),
         descripcion = COALESCE(EXCLUDED.descripcion, categorias.descripcion),
         imagen_base64 = COALESCE(EXCLUDED.imagen_base64, categorias.imagen_base64)
       RETURNING id, nombre, codigo, descripcion, imagen_base64`,
      [nombre.trim(), codigo, descripcion, imagen_base64]
    );
    res.status(201).json(rows[0]);
  } catch (e) {
    console.error("POST /categorias", e);
    res.status(500).json({ error: "Error al crear categoría" });
  }
});

app.put("/categorias/:id", requireAuth, async (req, res) => {
  try {
    const id = Number(req.params.id);
    const { nombre = "", codigo = null, descripcion = null, imagen_base64 = null } = req.body || {};
    if (!id) return res.status(400).json({ error: "ID inválido" });
    if (!nombre.trim()) return res.status(400).json({ error: "El nombre es obligatorio" });

    const { rows } = await pool.query(
      `UPDATE categorias
       SET nombre=$1, codigo=$2, descripcion=$3, imagen_base64=$4
       WHERE id=$5
       RETURNING id, nombre, codigo, descripcion, imagen_base64`,
      [nombre.trim(), codigo, descripcion, imagen_base64, id]
    );
    if (!rows.length) return res.status(404).json({ error: "Categoría no encontrada" });
    res.json(rows[0]);
  } catch (e) {
    console.error("PUT /categorias/:id", e);
    res.status(500).json({ error: "Error al actualizar categoría" });
  }
});

app.delete("/categorias/:id", requireAuth, async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!id) return res.status(400).json({ error: "ID inválido" });
    await pool.query("DELETE FROM categorias WHERE id=$1", [id]);
    res.json({ ok: true });
  } catch (e) {
    console.error("DELETE /categorias/:id", e);
    res.status(500).json({ error: "Error al eliminar categoría" });
  }
});

/* ----------------------------------- Productos ------------------------------ */
/*
 Tabla `productos` esperada:
  id SERIAL PK,
  codigo TEXT UNIQUE NULL,
  nombre TEXT NOT NULL,
  descripcion TEXT NULL,
  marca TEXT NULL,
  precio NUMERIC(12,2) DEFAULT 0,
  costo  NUMERIC(12,2) DEFAULT 0,
  stock INTEGER DEFAULT 0,
  categoria_id INTEGER NULL REFERENCES categorias(id) ON DELETE SET NULL,
  imagen TEXT NULL,
  imagen_base64 TEXT NULL
*/

async function resolveCategoriaId(client, categoria_id, categoria_nombre) {
  const maybeId = Number(categoria_id);
  if (Number.isInteger(maybeId) && maybeId > 0) return maybeId;

  const name = (categoria_nombre || "").trim();
  if (!name) return null;

  const sel = await client.query(
    "SELECT id FROM categorias WHERE TRIM(LOWER(nombre)) = TRIM(LOWER($1)) LIMIT 1",
    [name]
  );
  if (sel.rowCount) return sel.rows[0].id;

  const ins = await client.query(
    "INSERT INTO categorias (nombre) VALUES ($1) RETURNING id",
    [name]
  );
  return ins.rows[0].id;
}

function toNumber(n, def = 0) {
  const v = Number(n);
  return Number.isFinite(v) ? v : def;
}

// ---------- GET /productos ----------
app.get("/productos", requireAuth, async (req, res) => {
  try {
    const buscar = (req.query.buscar || "").trim().toLowerCase();

    let rows;

    if (buscar) {
      rows = (
        await pool.query(
          `
          SELECT
            p.id,
            p.codigo,
            p.nombre,
            p.descripcion,
            p.marca,
            p.precio,
            p.costo,
            p.stock,
            p.categoria_id,
            c.nombre AS categoria,
            COALESCE(p.imagen_base64, p.imagen) AS imagen_base64,
            p.imagen
          FROM productos p
          LEFT JOIN categorias c ON c.id = p.categoria_id
          WHERE p.activo = true
            AND (
              LOWER(p.nombre) LIKE '%' || $1 || '%'
              OR LOWER(p.codigo) LIKE '%' || $1 || '%'
              OR LOWER(p.marca)  LIKE '%' || $1 || '%'
            )
          ORDER BY p.nombre ASC
        `,
          [buscar]
        )
      ).rows;
    } else {
      rows = (
        await pool.query(
          `
          SELECT
            p.id,
            p.codigo,
            p.nombre,
            p.descripcion,
            p.marca,
            p.precio,
            p.costo,
            p.stock,
            p.categoria_id,
            c.nombre AS categoria,
            COALESCE(p.imagen_base64, p.imagen) AS imagen_base64,
            p.imagen
          FROM productos p
          LEFT JOIN categorias c ON c.id = p.categoria_id
          WHERE p.activo = true
          ORDER BY p.nombre ASC
        `
        )
      ).rows;
    }

    res.json(rows);
  } catch (e) {
    console.error("GET /productos", e);
    res.status(500).json({ error: "Error al listar productos" });
  }
});

// ---------- POST /productos ----------
app.post("/productos", requireAuth, upload.single("imagen"), async (req, res) => {
  const {
    codigo = null,
    nombre = "",
    descripcion = null,
    marca = null,
    categoria_id = null,
    categoria = null,
    precio = 0,
    costo = 0,
    stock = 0,
    imagen_base64 = null,
  } = req.body || {};

  const nombreFinal =
    (String(nombre || "").trim()) ||
    (String(codigo || "").trim()) ||
    "SIN NOMBRE";

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const catId = await resolveCategoriaId(client, categoria_id, categoria);

    let imagenPathOrBase64 = null;
    if (req.file) {
      imagenPathOrBase64 = `/uploads/${req.file.filename}`;
    } else if (imagen_base64 && String(imagen_base64).startsWith("data:")) {
      imagenPathOrBase64 = saveDataUrlToFile(imagen_base64, "prod");
    }

    const insertSql = `
      INSERT INTO productos
        (codigo, nombre, descripcion, marca, precio, costo, stock, categoria_id, imagen)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
      RETURNING id
    `;
    const params = [
      codigo || null,
      nombreFinal,
      descripcion || null,
      marca || null,
      toNumber(precio, 0),
      toNumber(costo, 0),
      toNumber(stock, 0),
      catId,
      imagenPathOrBase64
    ];

    const r = await client.query(insertSql, params);

    if (catId) {
      await client.query(
        `UPDATE categorias c
            SET codigo = COALESCE(c.codigo, $1),
                imagen_base64 = COALESCE(c.imagen_base64, $2)
          WHERE c.id = $3`,
        [codigo || null, imagenPathOrBase64 || null, catId]
      );
    }

    await client.query("COMMIT");
    res.status(201).json({ id: r.rows[0].id });
  } catch (e) {
    await client.query("ROLLBACK");
    console.error("POST /productos", e);
    res.status(500).json({ error: "Error al crear producto" });
  } finally {
    client.release();
  }
});

// ---------- PUT /productos/:id ----------
app.put("/productos/:id", requireAuth, upload.single("imagen"), async (req, res) => {
  const id = Number(req.params.id);
  if (!id) return res.status(400).json({ error: "ID inválido" });

  const {
    codigo = null,
    nombre = "",
    descripcion = null,
    marca = null,
    categoria_id = null,
    categoria = null,
    precio = 0,
    costo = 0,
    stock = 0,
    imagen_base64 = null,
  } = req.body || {};

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const catId = await resolveCategoriaId(client, categoria_id, categoria);

    let idx = 1;
    const sets = [];
    const values = [];

    sets.push(`codigo=$${idx++}`);      values.push(codigo);
    if (String(nombre || "").trim()) {
      sets.push(`nombre=$${idx++}`);    values.push(String(nombre).trim());
    }
    sets.push(`descripcion=$${idx++}`); values.push(descripcion);
    sets.push(`marca=$${idx++}`);       values.push(marca);
    sets.push(`precio=$${idx++}`);      values.push(toNumber(precio, 0));
    sets.push(`costo=$${idx++}`);       values.push(toNumber(costo, 0));
    sets.push(`stock=$${idx++}`);       values.push(Number.parseInt(stock, 10) || 0);
    sets.push(`categoria_id=$${idx++}`);values.push(catId);

    let nuevaImg = null;
    if (req.file) {
      nuevaImg = `/uploads/${req.file.filename}`;
    } else if (imagen_base64 && String(imagen_base64).startsWith("data:")) {
      nuevaImg = saveDataUrlToFile(imagen_base64, "prod");
    }
    if (nuevaImg) { sets.push(`imagen=$${idx++}`); values.push(nuevaImg); }

    values.push(id);

    const q = `
      UPDATE productos
      SET ${sets.join(", ")}
      WHERE id=$${idx}
      RETURNING id
    `;
    const { rows } = await client.query(q, values);
    if (!rows.length) {
      await client.query("ROLLBACK");
      return res.status(404).json({ error: "Producto no encontrado" });
    }

    if (catId) {
      await client.query(
        `UPDATE categorias c
            SET codigo = COALESCE(c.codigo, $1),
                imagen_base64 = COALESCE(c.imagen_base64, $2)
          WHERE c.id = $3`,
        [codigo || null, nuevaImg || null, catId]
      );
    }

    await client.query("COMMIT");
    res.json({ ok: true, id });
  } catch (e) {
    await client.query("ROLLBACK");
    console.error("PUT /productos/:id", e);
    res.status(500).json({ error: "Error al actualizar producto" });
  } finally {
    client.release();
  }
});

// ---------- DELETE /productos/:id ----------
app.delete("/productos/:id", async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!id) return res.status(400).json({ ok: false, msg: "ID inválido" });

    // ✅ En vez de borrar (DELETE), desactivamos
    await pool.query(
      "UPDATE productos SET activo = false WHERE id = $1",
      [id]
    );

    return res.json({ ok: true, msg: "Producto desactivado" });
  } catch (err) {
    console.error("DELETE /productos/:id error:", err);
    return res.status(500).json({ ok: false, msg: "Error al desactivar" });
  }
});

/* ======================= PEDIDOS A PROVEEDOR (BACKEND) ======================= */
/** Carpeta para PDFs */
const DATA_DIR = path.join(process.cwd(), "data");
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
const PDF_DIR = path.join(DATA_DIR, "pedidos_pdf");
if (!fs.existsSync(PDF_DIR)) fs.mkdirSync(PDF_DIR, { recursive: true });

const moneyPY = (n) => Number(n || 0);
const fmtPY = (n) => new Intl.NumberFormat("es-PY").format(Number(n || 0));
const hoyStr = () => new Date().toISOString().slice(0, 10);

function costoPromedio(costoAnterior, stockAnterior, costoCompra, cantidadCompra) {
  const sa = Number(stockAnterior || 0);
  const ca = Number(costoAnterior || 0);
  const cc = Number(costoCompra || 0);
  const qn = Number(cantidadCompra || 0);
  if (sa + qn <= 0) return cc;
  return Math.round(((sa * ca) + (qn * cc)) / (sa + qn));
}

async function bootstrapPedidos(pool) {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS pedidos_prov (
      id SERIAL PRIMARY KEY,
      proveedor_id INTEGER NOT NULL REFERENCES proveedores(id),
      fecha_pedido DATE NOT NULL,
      observacion  TEXT,
      estado TEXT NOT NULL DEFAULT 'pendiente',  -- pendiente|enviado|recibido|cancelado
      subtotal NUMERIC(14,2) NOT NULL DEFAULT 0,
      iva      NUMERIC(14,2) NOT NULL DEFAULT 0,
      total    NUMERIC(14,2) NOT NULL DEFAULT 0,
      creado_en TIMESTAMP DEFAULT NOW()
    );
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS pedidos_prov_items (
      id SERIAL PRIMARY KEY,
      pedido_id   INTEGER NOT NULL REFERENCES pedidos_prov(id) ON DELETE CASCADE,
      producto_id INTEGER NOT NULL REFERENCES productos(id),
      descripcion TEXT,
      cantidad    INTEGER NOT NULL,
      precio_unit NUMERIC(14,2) NOT NULL,
      total       NUMERIC(14,2) NOT NULL
    );
  `);
  await pool.query(`ALTER TABLE productos ADD COLUMN IF NOT EXISTS alerta BOOLEAN DEFAULT FALSE;`);
}
await bootstrapPedidos(pool);

/* ---------- PDF generator ---------- */
async function generarPDFPedido(pool, pedidoId) {
  const { rows: pr } = await pool.query(`SELECT * FROM pedidos_prov WHERE id=$1`, [pedidoId]);
  if (!pr.length) return null;
  const pedido = pr[0];

  const { rows: provr } = await pool.query(`SELECT * FROM proveedores WHERE id=$1`, [pedido.proveedor_id]);
  const prov = provr[0] || {};

  const { rows: items } = await pool.query(`
    SELECT i.*, p.nombre, p.codigo
    FROM pedidos_prov_items i
    LEFT JOIN productos p ON p.id = i.producto_id
    WHERE i.pedido_id=$1
    ORDER BY i.id ASC
  `, [pedidoId]);

  const pdfName = `pedido_${pedidoId}.pdf`;
  const outPath = path.join(PDF_DIR, pdfName);

  const doc = new PDFDocument({ size: "A4", margin: 40 });
  const stream = fs.createWriteStream(outPath);
  doc.pipe(stream);

  doc.fontSize(18).text("AUTOSERVICE • Orden de Compra");
  doc.moveDown(0.3).fontSize(10)
    .text(`N° Pedido: ${pedido.id}`)
    .text(`Fecha: ${pedido.fecha_pedido.toISOString().slice(0,10)}`);
  doc.moveDown(0.5).fontSize(12).text("Proveedor", { underline: true });
  doc.fontSize(10)
    .text(`Nombre: ${prov.nombre || pedido.proveedor_id}`)
    .text(`RUC: ${prov.ruc || "-"}`)
    .text(`Contacto: ${prov.contacto || "-"}`)
    .text(`Teléfono: ${prov.telefono || "-"}`);
  doc.moveDown(0.5).fontSize(12).text("Observación", { underline: true });
  doc.fontSize(10).text(pedido.observacion || "-");
  doc.moveDown(0.8);

  const header = ["#", "Producto", "Descripción", "Cant.", "Costo (Gs.)", "Total (Gs.)"];
  const widths = [30, 170, 150, 60, 80, 80];
  const startX = doc.x;
  let y = doc.y;
  doc.fontSize(10).fillColor("#000");
  header.forEach((h, i) => {
    doc.text(h, startX + widths.slice(0, i).reduce((a,b)=>a+b,0), y, { width: widths[i] });
  });
  y += 16;

  items.forEach((it, idx) => {
    const cells = [
      String(idx + 1),
      `${it.nombre || ""}${it.codigo ? " — " + it.codigo : ""}`,
      it.descripcion || "-",
      String(it.cantidad),
      fmtPY(it.precio_unit),
      fmtPY(it.total)
    ];
    cells.forEach((c, i) => {
      doc.text(c, startX + widths.slice(0, i).reduce((a,b)=>a+b,0), y, { width: widths[i] });
    });
    y += 16;
    if (y > 750) { doc.addPage(); y = doc.y; }
  });

  y += 10;
  const rightX = startX + widths[0] + widths[1] + widths[2] + widths[3];
  doc.text("Subtotal", rightX, y, { width: widths[4], align: "right" });
  doc.text(fmtPY(pedido.subtotal), rightX + widths[4], y, { width: widths[5], align: "right" });
  y += 16;
  doc.text("IVA 10%", rightX, y, { width: widths[4], align: "right" });
  doc.text(fmtPY(pedido.iva), rightX + widths[4], y, { width: widths[5], align: "right" });
  y += 16;
  doc.font("Helvetica-Bold");
  doc.text("TOTAL", rightX, y, { width: widths[4], align: "right" });
  doc.text(fmtPY(pedido.total), rightX + widths[4], y, { width: widths[5], align: "right" });
  doc.font("Helvetica");

  doc.moveDown(2);
  doc.fontSize(9).fillColor("#666").text("© 2025 Consorcio SPY — Generado automáticamente", { align: "center" });
  doc.end();

  return new Promise(resolve => stream.on("finish", () => resolve({ file: pdfName })));
}

/* ---------- Helpers estado ---------- */
function normalizeOutPedidoRow(p) {
  // Adaptamos salida a lo que espera el front
  return {
    id: p.id,
    fecha: p.fecha_pedido, // front usa p.fecha
    proveedor_id: p.proveedor_id,
    proveedor_nombre: p.proveedor_nombre || p.nombre_proveedor || null,
    estado: (p.estado || 'pendiente').replace(/^\w/, c => c.toUpperCase()), // Pendiente/Enviado/Recibido/Cancelado
    subtotal: p.subtotal,
    iva: p.iva,
    total: p.total,
    total_estimado: p.total // compat
  };
}

app.get("/pedidos", requireAuth, async (req, res) => {
  try {
    const { rows: pedidos } = await pool.query(`
      SELECT 
        p.id, 
        p.proveedor_id, 
        pr.nombre AS proveedor_nombre,
        p.fecha_pedido, 
        p.fecha_recepcion, 
        p.subtotal, 
        p.iva, 
        p.total
      FROM pedidos_prov p
      LEFT JOIN proveedores pr ON pr.id = p.proveedor_id
      ORDER BY p.id DESC
    `);

    for (let p of pedidos) {
      const { rows: items } = await pool.query(`
        SELECT 
          i.id,
          i.producto_id,
          prod.nombre AS producto_nombre,
          prod.codigo AS producto_codigo,
          cat.nombre AS categoria_nombre,
          i.descripcion,
          i.cantidad,
          i.precio_unit,
          i.total
        FROM pedidos_prov_items i
        LEFT JOIN productos prod ON prod.id = i.producto_id
        LEFT JOIN categorias cat ON cat.id = prod.categoria_id
        WHERE i.pedido_id = $1
        ORDER BY i.id
      `, [p.id]);

      p.items = items;
    }

    res.json(pedidos);

  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Error obteniendo pedidos" });
  }
});
/* ---------- LISTAR pedidos + ítems embebidos ---------- */
app.get('/api/pedidos', requireAuth, async (_req, res) => {
  try {
    // === 1) PEDIDOS ===
    const { rows: pedidos } = await pool.query(`
      SELECT 
        p.id,
        p.proveedor_id,
        pr.nombre AS proveedor_nombre,
        p.fecha_pedido,
        p.fecha_recepcion,
        p.subtotal,
        p.iva,
        p.total
      FROM pedidos_prov p
      LEFT JOIN proveedores pr ON pr.id = p.proveedor_id
      ORDER BY p.id DESC
    `);

    // === 2) ITEMS con PRODUCTO y CATEGORÍA ===
    const { rows: items } = await pool.query(`
      SELECT 
        i.id,
        i.pedido_id,
        i.producto_id,
        prod.nombre AS producto_nombre,
        prod.codigo AS producto_codigo,
        cat.nombre AS categoria_nombre,
        i.descripcion,
        i.cantidad,
        i.precio_unit,
        i.total
      FROM pedidos_prov_items i
      LEFT JOIN productos prod ON prod.id = i.producto_id
      LEFT JOIN categorias cat ON cat.id = prod.categoria_id
      ORDER BY i.pedido_id, i.id
    `);

    // === 3) Agrupar items por pedido ===
    const itemsByPedido = items.reduce((acc, it) => {
      (acc[it.pedido_id] ||= []).push({
        id: it.id,
        producto_id: it.producto_id,
        producto_nombre: it.producto_nombre || "¿?",
        categoria_nombre: it.categoria_nombre || "Sin categoría",
        descripcion: it.descripcion,
        cantidad: it.cantidad,
        precio_unit: it.precio_unit,
        total: it.total
      });
      return acc;
    }, {});

    // === 4) Adjuntar items a cada pedido ===
    const response = pedidos.map(p => ({
      ...p,
      items: itemsByPedido[p.id] || []
    }));

    res.json(response);

  } catch (error) {
    console.error('GET /api/pedidos', error);
    res.status(500).json({ error: 'Error al listar pedidos' });
  }
});

/* ---------- OBTENER pedido por id (con ítems) ---------- */
async function getPedidoFull(id) {
  const { rows } = await pool.query(`
    SELECT p.*, pr.nombre AS proveedor_nombre
    FROM pedidos_prov p
    LEFT JOIN proveedores pr ON pr.id = p.proveedor_id
    WHERE p.id=$1
    LIMIT 1
  `, [id]);
  if (!rows.length) return null;
  const base = normalizeOutPedidoRow(rows[0]);

  const { rows: items } = await pool.query(`
    SELECT i.*, prod.nombre AS producto_nombre
    FROM pedidos_prov_items i
    LEFT JOIN productos prod ON prod.id = i.producto_id
    WHERE i.pedido_id=$1
    ORDER BY i.id
  `, [id]);

  base.items = items.map(it => ({
    id: it.id,
    producto_id: it.producto_id,
    producto_nombre: it.producto_nombre || null,
    descripcion: it.descripcion,
    cantidad: it.cantidad,
    costo_estimado: it.precio_unit,
    precio_unit: it.precio_unit,
    total: it.total
  }));
  return base;
}

app.get('/api/pedidos/:id', requireAuth, async (req, res) => {
  const id = Number(req.params.id);
  try {
    const p = await getPedidoFull(id);
    if (!p) return res.status(404).json({ error: 'Pedido no encontrado' });
    res.json(p);
  } catch (e) {
    console.error('GET /api/pedidos/:id', e);
    res.status(500).json({ error: 'Error al obtener pedido' });
  }
});

/* ---------- CREAR pedido (y PDF) ---------- */
app.post("/api/pedidos", requireAuth, async (req, res) => {
  const { proveedor_id, fecha_pedido, fecha_recepcion, observacion, items } = req.body || {};

  // Validación
  if (!proveedor_id || !Array.isArray(items) || !items.length) {
    return res.status(400).json({ ok: false, msg: "Proveedor e ítems son obligatorios." });
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const fechaPedidoFinal = fecha_pedido || hoyStr();
    const fechaRecepcionFinal = fecha_recepcion || fecha_pedido;

    // INSERT CORRECTO (4 valores + estado)
    const { rows: rp } = await client.query(
      `
      INSERT INTO pedidos_prov 
        (proveedor_id, fecha_pedido, fecha_recepcion, observacion, estado)
      VALUES ($1, $2, $3, $4, 'pendiente')
      RETURNING id
      `,
      [
        proveedor_id,
        fechaPedidoFinal,
        fechaRecepcionFinal,
        observacion || ""
      ]
    );

    const pedidoId = rp[0].id;

    // Calcular totales + guardar items
    let subtotal = 0;

    for (const it of items) {
      const cantidad = Number(it.cantidad || 0);
      const precio_unit = Number(it.costo_estimado ?? it.precio_unit ?? 0);
      const total = cantidad * precio_unit;

      subtotal += total;

      await client.query(
        `
        INSERT INTO pedidos_prov_items 
          (pedido_id, producto_id, descripcion, cantidad, precio_unit, total)
        VALUES ($1, $2, $3, $4, $5, $6)
        `,
        [
          pedidoId,
          it.producto_id,
          it.descripcion || "",
          cantidad,
          precio_unit,
          total
        ]
      );
    }

    const iva = Math.round(subtotal * 0.10);
    const total = subtotal + iva;

    await client.query(
      `
      UPDATE pedidos_prov 
      SET subtotal = $1, iva = $2, total = $3 
      WHERE id = $4
      `,
      [subtotal, iva, total, pedidoId]
    );

    await client.query("COMMIT");

    // Generar PDF
    const pdf = await generarPDFPedido(pool, pedidoId);

    res.status(201).json({ 
      ok: true, 
      pedidoId, 
      pdf_file: pdf?.file 
    });

  } catch (e) {
    await client.query("ROLLBACK");
    console.error("POST /api/pedidos ERROR:", e);
    res.status(500).json({ ok: false, msg: "No se pudo crear el pedido" });
  } finally {
    client.release();
  }
});

/* ---------- CAMBIAR estado genérico ---------- */
app.put("/api/pedidos/:id/estado", requireAuth, async (req, res) => {
  const id = Number(req.params.id);
  const { estado } = req.body || {};
  const valid = ["pendiente","enviado","recibido","cancelado"];
  if (!valid.includes(estado)) return res.status(400).json({ ok:false, msg:"Estado inválido" });

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const { rows: prs } = await client.query(`SELECT estado FROM pedidos_prov WHERE id=$1`, [id]);
    if (!prs.length) { await client.query("ROLLBACK"); return res.status(404).json({ ok:false, msg:"Pedido no encontrado" }); }
    const prev = prs[0].estado;

    await client.query(`UPDATE pedidos_prov SET estado=$1 WHERE id=$2`, [estado, id]);

    // Si se recibe el pedido: actualizar stock y costo promedio
    if (estado === "recibido" && prev !== "recibido") {
      const { rows: items } = await client.query(`SELECT * FROM pedidos_prov_items WHERE pedido_id=$1`, [id]);
      for (const it of items) {
        const { rows: prd } = await client.query(`SELECT stock, costo FROM productos WHERE id=$1`, [it.producto_id]);
        if (!prd.length) continue;
        const stockAnterior = Number(prd[0].stock || 0);
        const costoAnterior = Number(prd[0].costo || 0);
        const nuevoStock = stockAnterior + Number(it.cantidad || 0);
        const nuevoCosto = costoPromedio(costoAnterior, stockAnterior, Number(it.precio_unit || 0), Number(it.cantidad || 0));
        await client.query(`UPDATE productos SET stock=$1, costo=$2 WHERE id=$3`, [nuevoStock, nuevoCosto, it.producto_id]);
      }
      // alerta simple (puedes cambiar a stock_min)
      await client.query(`UPDATE productos SET alerta = (stock <= 3)`);
    }

    await client.query("COMMIT");
    res.json({ ok:true });
  } catch (e) {
    await client.query("ROLLBACK");
    console.error("PUT /api/pedidos/:id/estado", e);
    res.status(500).json({ ok:false, msg:"No se pudo cambiar el estado" });
  } finally {
    client.release();
  }
});

/* ---------- PDF ---------- */
app.get("/api/pedidos/:id/pdf", requireAuth, async (req, res) => {
  const id = Number(req.params.id);
  const pdfName = `pedido_${id}.pdf`;
  const full = path.join(PDF_DIR, pdfName);
  if (!fs.existsSync(full)) {
    // si falta, lo regeneramos
    await generarPDFPedido(pool, id);
  }
  if (!fs.existsSync(full)) return res.status(404).send("PDF no encontrado");
  res.setHeader("Content-Type", "application/pdf");
  res.sendFile(full);
});

/* ==================== RUTAS DE COMPATIBILIDAD (legacy) ===================== */
// Front antiguo: POST /pedidos (crear)
app.post("/pedidos", requireAuth, (req, res) => app._router.handle({ ...req, url: "/api/pedidos", method: "POST" }, res));

// Front antiguo: GET /pedidos/:id (detalle)
app.get("/pedidos/:id", requireAuth, async (req, res) => {
  const id = Number(req.params.id);
  try {
    const data = await getPedidoFull(id);
    if (!data) return res.status(404).json({ error: "Pedido no encontrado" });
    res.json(data);
  } catch (e) {
    console.error("GET /pedidos/:id", e);
    res.status(500).json({ error: "Error al obtener pedido" });
  }
});

// Front antiguo: POST /pedidos/:id/enviar
app.post("/pedidos/:id/enviar", requireAuth, async (req, res) => {
  const id = Number(req.params.id);
  try {
    await pool.query(`UPDATE pedidos_prov SET estado='enviado' WHERE id=$1`, [id]);
    res.json({ ok: true });
  } catch (e) {
    console.error("POST /pedidos/:id/enviar", e);
    res.status(500).json({ error: "No se pudo enviar el pedido" });
  }
});

// Front antiguo: POST /pedidos/:id/recibir
app.post("/pedidos/:id/recibir", requireAuth, async (req, res) => {
  const id = Number(req.params.id);
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    // Reutilizamos lógica de /api/pedidos/:id/estado => recibido
    const call = await client.query(`SELECT estado,total FROM pedidos_prov WHERE id=$1`, [id]);
    if (!call.rowCount) { await client.query("ROLLBACK"); return res.status(404).json({ error: "Pedido no encontrado" }); }

    // si todavía no estaba recibido, ejecutar la actualización
    if (call.rows[0].estado !== 'recibido') {
      // items -> actualizar stock/costo promedio
      const { rows: items } = await client.query(`SELECT * FROM pedidos_prov_items WHERE pedido_id=$1`, [id]);
      for (const it of items) {
        const { rows: prd } = await client.query(`SELECT stock, costo FROM productos WHERE id=$1`, [it.producto_id]);
        if (!prd.length) continue;
        const stockAnterior = Number(prd[0].stock || 0);
        const costoAnterior = Number(prd[0].costo || 0);
        const nuevoStock = stockAnterior + Number(it.cantidad || 0);
        const nuevoCosto = costoPromedio(costoAnterior, stockAnterior, Number(it.precio_unit || 0), Number(it.cantidad || 0));
        await client.query(`UPDATE productos SET stock=$1, costo=$2 WHERE id=$3`, [nuevoStock, nuevoCosto, it.producto_id]);
      }
      await client.query(`UPDATE productos SET alerta = (stock <= 3)`);
      await client.query(`UPDATE pedidos_prov SET estado='recibido' WHERE id=$1`, [id]);
    }
    await client.query("COMMIT");
    res.json({ ok: true, compra_generada: id, total: call.rows[0].total });
  } catch (e) {
    await client.query("ROLLBACK");
    console.error("POST /pedidos/:id/recibir", e);
    res.status(500).json({ error: "No se pudo recibir el pedido" });
  } finally {
    client.release();
  }
});

// Front antiguo: PDF
app.get("/pedidos/:id/pdf", requireAuth, (req, res) => {
  const id = Number(req.params.id);
  req.url = `/api/pedidos/${id}/pdf`;
  app._router.handle(req, res);
});
/* =================== FIN PEDIDOS A PROVEEDOR (BACKEND) =================== */

/* ----------------------------------- Health --------------------------------- */
app.get("/health", (_req, res) => res.json({ ok: true }));

/* ----------------------------------- Server --------------------------------- */
app.get("/compras", requireAuth, async (_req, res) => {
  try {
    const { rows } = await pool.query(`
      SELECT 
        c.id,
        c.fecha,
        c.factura,
        c.subtotal,
        c.iva,
        c.total,

        p.nombre AS proveedor_nombre,
        p.ruc AS proveedor_ruc,

        -- Lista de códigos de productos sin repetidos
        (
          SELECT STRING_AGG(DISTINCT pr.codigo, ', ')
          FROM compras_items ci
          JOIN productos pr ON pr.id = ci.producto_id
          WHERE ci.compra_id = c.id
        ) AS productos,

        -- Lista de categorías sin repetidos
        (
          SELECT STRING_AGG(DISTINCT cat.nombre, ', ')
          FROM compras_items ci
          JOIN productos pr ON pr.id = ci.producto_id
          LEFT JOIN categorias cat ON cat.id = pr.categoria_id
          WHERE ci.compra_id = c.id
        ) AS categorias

      FROM compras c
      LEFT JOIN proveedores p ON p.id = c.proveedor_id
      
      ORDER BY c.id DESC;
    `);

    res.json(rows);

  } catch (e) {
    console.error("GET /compras", e);
    res.status(500).json({ error: "Error al listar compras" });
  }
});
app.post("/compras", requireAuth, async (req, res) => {
  const { proveedor_id, fecha, factura, items } = req.body || {};

  if (!proveedor_id || !fecha || !Array.isArray(items) || !items.length) {
    return res.status(400).json({
      ok: false,
      msg: "Proveedor, fecha e ítems son obligatorios"
    });
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    let subtotal = 0;
    for (const it of items) {
      subtotal += Number(it.cantidad) * Number(it.costo);
    }
    const iva = Math.round(subtotal * 0.10);
    const total = subtotal + iva;

    const qCab = await client.query(
      `INSERT INTO compras (proveedor_id, fecha, factura, subtotal, iva, total)
       VALUES ($1,$2,$3,$4,$5,$6)
       RETURNING id`,
      [proveedor_id, fecha, factura, subtotal, iva, total]
    );
    const compraId = qCab.rows[0].id;

    for (const it of items) {
      await client.query(
        `INSERT INTO compras_items (compra_id, producto_id, cantidad, costo, subtotal)
         VALUES ($1,$2,$3,$4,$5)`,
        [compraId, it.producto_id, it.cantidad, it.costo, it.cantidad * it.costo]
      );

      const prod = await client.query(
        "SELECT stock, costo FROM productos WHERE id=$1",
        [it.producto_id]
      );

      if (prod.rowCount) {
        const sAnt = Number(prod.rows[0].stock);
        const cAnt = Number(prod.rows[0].costo);
        const sNew = sAnt + Number(it.cantidad);

        const cNew =
          sAnt + Number(it.cantidad) === 0
            ? it.costo
            : Math.round(((sAnt * cAnt) + (Number(it.cantidad) * it.costo)) / (sAnt + Number(it.cantidad)));

        await client.query(
          "UPDATE productos SET stock=$1, costo=$2 WHERE id=$3",
          [sNew, cNew, it.producto_id]
        );
      }
    }

    await client.query("COMMIT");
    res.json({ ok: true, compra_id: compraId });

  } catch (e) {
    await client.query("ROLLBACK");
    console.error("POST /compras", e);
    res.status(500).json({ ok: false, msg: "Error al registrar compra" });
  } finally {
    client.release();
  }
});

app.get("/compras/:id", requireAuth, async (req, res) => {
  const id = Number(req.params.id);
  try {
    const cab = await pool.query(`
      SELECT 
        c.id,
        c.fecha,
        c.factura,
        c.subtotal,
        c.iva,
        c.total,
        p.nombre AS proveedor_nombre,
        p.ruc AS proveedor_ruc
      FROM compras c
      LEFT JOIN proveedores p ON p.id = c.proveedor_id
      WHERE c.id=$1
    `, [id]);

    if (!cab.rowCount) 
      return res.status(404).json({ error: "Compra no encontrada" });

    const items = await pool.query(`
      SELECT 
        ci.id,
        ci.producto_id,
        pr.nombre AS producto_nombre,
        pr.codigo,
        ci.cantidad,
        ci.costo,
        ci.subtotal
      FROM compras_items ci
      LEFT JOIN productos pr ON pr.id = ci.producto_id
      WHERE ci.compra_id=$1
      ORDER BY ci.id
    `, [id]);

    res.json({
      ...cab.rows[0],
      items: items.rows
    });

  } catch (e) {
    console.error("GET /compras/:id", e);
    res.status(500).json({ error: "Error al obtener compra" });
  }
});

/* ---------- ELIMINAR PEDIDO ---------- */
app.delete("/api/pedidos/:id", requireAuth, async (req, res) => {
  const id = Number(req.params.id);

  try {
    // IMPORTANTE: la tabla items debe tener ON DELETE CASCADE
    const { rowCount } = await pool.query(
      "DELETE FROM pedidos_prov WHERE id = $1",
      [id]
    );

    if (rowCount === 0) {
      return res.status(404).json({ ok: false, msg: "Pedido no encontrado" });
    }

    return res.json({ ok: true });
  } catch (err) {
    console.error("Error eliminando pedido:", err);
    return res.status(500).json({ ok: false, msg: "Error eliminando pedido" });
  }
});

app.get("/ventas", async (_req, res) => {
  try {
    const result = await pool.query(`
      SELECT 
        v.id,
        v.fecha,
        v.total,
        v.estado_pago,
        v.nro_comprobante,
        fp.nombre AS forma_pago_nombre,
        COALESCE(c.nombre || ' ' || c.apellido, 'Consumidor Final') AS cliente_nombre
      FROM ventas v
      LEFT JOIN clientes c ON c.id = v.cliente_id
      LEFT JOIN formas_pago fp ON fp.id = v.forma_pago_id
      ORDER BY v.id DESC
    `);

    res.json(result.rows);
  } catch (err) {
    console.error("❌ Error listando ventas:", err);
    res.status(500).json({ ok: false, msg: "Error listando ventas" });
  }
});
app.post("/ventas", async (req, res) => {
  const { cliente_id, total, forma_pago_id, items, estado_pago, nro_comprobante } = req.body || {};

  const client = await pool.connect();
  try {
    // Validaciones básicas
    if (!forma_pago_id) return res.status(400).json({ ok: false, msg: "Falta forma_pago_id" });
    if (!Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ ok: false, msg: "No hay items" });
    }

    const fpId = Number(forma_pago_id);
    const totalFinal = Number(total || 0);

    // ✅ Requerir comprobante solo si NO es efectivo
    const compStr = (nro_comprobante || "").toString().trim();
    if (fpId !== 1 && !compStr) {
      return res.status(400).json({ ok: false, msg: "Falta nro_comprobante" });
    }

    // ✅ tipo de caja
    const tipoCajaNecesaria = (fpId === 1) ? "efectivo" : "transferencia";

    await client.query("BEGIN");

    // ✅ buscar caja abierta del tipo correcto
    const cajaQ = await client.query(
      "SELECT id FROM caja WHERE estado='abierta' AND tipo=$1 ORDER BY id DESC LIMIT 1",
      [tipoCajaNecesaria]
    );

    if (cajaQ.rows.length === 0) {
      await client.query("ROLLBACK");
      return res.status(400).json({
        ok: false,
        msg: `Debe abrir la caja de ${tipoCajaNecesaria} antes de realizar una venta`,
      });
    }

    const caja_id_final = cajaQ.rows[0].id;

    // Normalizar cliente_id
    const clienteIdFinal =
      cliente_id && String(cliente_id) !== "0" ? Number(cliente_id) : null;

    // comprobante normalizado
    const compFinal = fpId === 1 ? null : compStr;

    // ✅ insertar venta
    const v = await client.query(
      `INSERT INTO ventas (fecha, cliente_id, caja_id, total, forma_pago_id, estado_pago, nro_comprobante)
       VALUES ((now() AT TIME ZONE 'America/Asuncion')::date, $1,$2,$3,$4,$5,$6)
       RETURNING id`,
      [
        clienteIdFinal,
        caja_id_final,
        totalFinal,
        fpId,
        (estado_pago || "pendiente").toString().trim().toLowerCase(),
        compFinal,
      ]
    );

    const ventaId = v.rows[0].id;

    // ✅ items + stock
    for (const it of items) {
      const productoId = Number(it.producto_id);
      const cantidad = Number(it.cantidad);
      const precio = Number(it.precio ?? it.precio_unitario ?? 0);
      const subtotal = Number(it.subtotal ?? (cantidad * precio));

      await client.query(
        `INSERT INTO ventas_items (venta_id, producto_id, cantidad, precio, subtotal)
         VALUES ($1,$2,$3,$4,$5)`,
        [ventaId, productoId, cantidad, precio, subtotal]
      );

      await client.query(
        `UPDATE productos SET stock = stock - $1 WHERE id = $2`,
        [cantidad, productoId]
      );
    }

    // ✅ CLAVE: sumar a la caja
    await client.query(
      `UPDATE caja
       SET saldo_actual = COALESCE(saldo_actual, 0) + $1
       WHERE id = $2`,
      [totalFinal, caja_id_final]
    );

    await client.query("COMMIT");

    return res.json({
      ok: true,
      id: ventaId,
      caja_id: caja_id_final,
      tipo_caja: tipoCajaNecesaria
    });

  } catch (err) {
    try { await client.query("ROLLBACK"); } catch {}
    console.error("❌ Error guardando venta:", err);
    return res.status(500).json({
      ok: false,
      msg: "Error guardando venta",
      error: err.message,
    });
  } finally {
    client.release();
  }
});
app.get("/ventas/:id", async (req, res) => {
  try {
    const ven = await pool.query(
      "SELECT * FROM ventas WHERE id = $1",
      [req.params.id]
    );

    if (ven.rows.length === 0) {
      return res.status(404).json({ ok: false, msg: "Venta no encontrada" });
    }

    const items = await pool.query(
      `SELECT vi.*, p.nombre AS producto_nombre
       FROM ventas_items vi
       JOIN productos p ON p.id = vi.producto_id
       WHERE venta_id = $1`,
      [req.params.id]
    );

    res.json({
      id: ven.rows[0].id,
      fecha: ven.rows[0].fecha,
      cliente_id: ven.rows[0].cliente_id,
      forma_pago_id: ven.rows[0].forma_pago_id,
      nro_comprobante: ven.rows[0].nro_comprobante, // ✅ incluye comprobante
      total: ven.rows[0].total,
      items: items.rows
    });

  } catch (err) {
    console.error("❌ Error obteniendo detalle venta:", err);
    res.status(500).json({ ok: false, msg: "Error obteniendo venta" });
  }
});
// ELIMINAR VENTA
app.delete("/ventas/:id", async (req, res) => {
  const { id } = req.params;

  try {
    await pool.query("DELETE FROM ventas WHERE id = $1", [id]);
    res.json({ ok: true });
  } catch (err) {
    console.error("❌ Error eliminando venta:", err);
    res.status(500).json({ ok: false, msg: "Error eliminando venta" });
  }
});

app.put("/ventas/:id", requireAuth, async (req, res) => {
  const id = Number(req.params.id);
  const { fecha, forma_pago_id, estado_pago, total, items } = req.body || {};

  if (!id) return res.status(400).json({ ok: false, msg: "ID inválido" });
  if (!fecha) return res.status(400).json({ ok: false, msg: "Falta fecha" });
  if (!forma_pago_id) return res.status(400).json({ ok: false, msg: "Falta forma_pago_id" });
  if (!Array.isArray(items) || items.length === 0) {
    return res.status(400).json({ ok: false, msg: "No hay items" });
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    // 1) Traer items anteriores para ajustar stock
    const prevItemsQ = await client.query(
      `SELECT producto_id, cantidad
       FROM ventas_items
       WHERE venta_id = $1`,
      [id]
    );
    const prevItems = prevItemsQ.rows || [];

    // 2) Actualizar cabecera (incluye total)
    await client.query(
      `UPDATE ventas
       SET fecha = $1,
           forma_pago_id = $2,
           estado_pago = $3,
           total = $4
       WHERE id = $5`,
      [
        fecha,
        Number(forma_pago_id),
        (estado_pago || "pendiente").toString().trim().toLowerCase(),
        Number(total || 0),
        id
      ]
    );

    // 3) Borrar items anteriores
    await client.query(`DELETE FROM ventas_items WHERE venta_id = $1`, [id]);

    // 4) Reinsertar items nuevos
    for (const it of items) {
      const producto_id = Number(it.producto_id);
      const cantidad = Number(it.cantidad);
      const precio = Number(it.precio_unitario ?? it.precio ?? 0);
      const subtotal = cantidad * precio;

      if (!producto_id || cantidad <= 0 || precio < 0) {
        throw new Error("Item inválido en edición");
      }

      await client.query(
        `INSERT INTO ventas_items (venta_id, producto_id, cantidad, precio, subtotal)
         VALUES ($1,$2,$3,$4,$5)`,
        [id, producto_id, cantidad, precio, subtotal]
      );
    }

    // 5) ✅ Ajustar stock correctamente
    //    (a) devolver cantidades previas
    for (const p of prevItems) {
      await client.query(
        `UPDATE productos SET stock = stock + $1 WHERE id = $2`,
        [Number(p.cantidad), Number(p.producto_id)]
      );
    }
    //    (b) descontar cantidades nuevas
    for (const it of items) {
      await client.query(
        `UPDATE productos SET stock = stock - $1 WHERE id = $2`,
        [Number(it.cantidad), Number(it.producto_id)]
      );
    }

    await client.query("COMMIT");
    return res.json({ ok: true });

  } catch (err) {
    await client.query("ROLLBACK");
    console.error("❌ Error actualizando venta:", err);
    return res.status(500).json({ ok: false, msg: "Error actualizando venta", error: err.message });
  } finally {
    client.release();
  }
});
app.get("/ventas/:id/ticket", async (req, res) => {
    const ventaId = req.params.id;

    try {
        const v = await pool.query(
            `SELECT v.*, c.nombre, c.apellido 
             FROM ventas v 
             LEFT JOIN clientes c ON c.id = v.cliente_id 
             WHERE v.id = $1`,
            [ventaId]
        );

        if (v.rows.length === 0)
            return res.status(404).send("Venta no encontrada");

        const venta = v.rows[0];

        const items = await pool.query(
            `SELECT vi.*, p.nombre AS producto_nombre
             FROM ventas_items vi 
             JOIN productos p ON p.id = vi.producto_id
             WHERE vi.venta_id = $1`,
            [ventaId]
        );

        /* --------------- TICKET ESTILO SUPERMERCADO (80mm) --------------- */

        // Ancho: 80 mm ≈ 226 puntos PDF
        const ticketWidth = 226;
        const maxItems = items.rows.length;
        const ticketHeight = 200 + maxItems * 25; // altura dinámica

        const doc = new PDFDocument({
            size: [ticketWidth, ticketHeight],
            margins: { top: 10, left: 10, right: 10, bottom: 10 }
        });

        res.setHeader("Content-Type", "application/pdf");
        res.setHeader("Content-Disposition", `inline; filename=ticket_${ventaId}.pdf`);

        doc.pipe(res);

        const fmt = n => Number(n || 0).toLocaleString("es-PY");

        /* --- HEADER --- */
        doc.fontSize(12).text("SPYnet / Productos", { align: "center" });
        doc.moveDown(0.3);
        doc.fontSize(8).text(`Ticket Nº: ${ventaId}`, { align: "center" });
        doc.text(`Fecha: ${venta.fecha.toISOString().slice(0,10)}`, { align: "center" });

        doc.moveDown(0.5);
        doc.text("----------------------------------------");

        /* --- CLIENTE --- */
        doc.fontSize(9).text("CLIENTE:", { bold: true });
        doc.fontSize(8).text(`${venta.nombre || "Consumidor Final"} ${venta.apellido || ""}`);
        doc.text(`Pago: ${venta.forma_pago_id}`);
        doc.text("----------------------------------------");

        /* --- DETALLE --- */
        doc.fontSize(9).text("DETALLE:");
        doc.moveDown(0.2);

        items.rows.forEach(it => {
            doc.fontSize(8)
                .text(it.producto_nombre)
                .text(
                    `${it.cantidad} x Gs. ${fmt(it.precio)}  =  Gs. ${fmt(it.subtotal)}`,
                    { align: "right" }
                );
            doc.moveDown(0.2);
        });

        doc.text("----------------------------------------");

        /* --- TOTAL --- */
        doc.fontSize(10).text(`TOTAL: Gs. ${fmt(venta.total)}`, {
            align: "right",
            bold: true
        });

        doc.moveDown(1);
        doc.fontSize(9).text("¡Gracias por su compra!", { align: "center" });

        doc.end();

    } catch (err) {
        console.error("❌ Error generando ticket:", err);
        res.status(500).send("Error generando ticket");
    }
});

app.get("/formas-pago", async (req, res) => {
  const result = await pool.query("SELECT * FROM formas_pago WHERE activo = true ORDER BY nombre");
  res.json(result.rows);
});
app.post("/formas-pago", async (req, res) => {
  const { nombre, tipo, descripcion } = req.body;
  await pool.query(
    "INSERT INTO formas_pago (nombre, tipo, descripcion) VALUES ($1, $2, $3)",
    [nombre, tipo, descripcion]
  );
  res.json({ ok: true });
});
app.put("/formas-pago/:id", async (req, res) => {
  const { id } = req.params;
  const { nombre, tipo, descripcion, activo } = req.body;

  await pool.query(`
    UPDATE formas_pago SET 
      nombre = $1, tipo = $2, descripcion = $3, activo = $4
    WHERE id = $5`,
    [nombre, tipo, descripcion, activo, id]
  );

  res.json({ ok: true });
});

app.get("/compras/:id/pdf", requireAuth, async (req, res) => {
    const id = Number(req.params.id);

    // Obtener datos de la compra
    const cab = await pool.query(
        `SELECT c.*, p.nombre AS proveedor_nombre, p.ruc AS proveedor_ruc
         FROM compras c
         LEFT JOIN proveedores p ON p.id = c.proveedor_id
         WHERE c.id=$1`,
        [id]
    );

    if (!cab.rowCount) return res.status(404).send("Compra no encontrada");

    const comp = cab.rows[0];

    const items = await pool.query(`
        SELECT ci.*, pr.nombre AS producto_nombre
        FROM compras_items ci
        LEFT JOIN productos pr ON pr.id = ci.producto_id
        WHERE ci.compra_id=$1
    `, [id]);


    // Crear PDF
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `inline; filename=compra_${id}.pdf`);

    const doc = new PDFDocument({ margin:30 });
    doc.pipe(res);

    // Encabezado
    doc.fontSize(20).text("Compras – Energy Green", { align:"center" });
    doc.moveDown(1);

    doc.fontSize(12).text(`ID Compra: ${comp.id}`);
    doc.text(`Fecha: ${comp.fecha.toISOString().slice(0,10)}`);
    doc.text(`Proveedor: ${comp.proveedor_nombre}`);
    doc.text(`RUC: ${comp.proveedor_ruc}`);
    doc.text(`Factura: ${comp.factura || "-"}`);
    doc.moveDown(1);

    // Tabla
    doc.fontSize(12).text("Detalle de Productos", { underline:true });
    doc.moveDown(0.5);

    items.rows.forEach(it => {
        doc.fontSize(11).text(
            `${it.producto_nombre}  | Cant: ${it.cantidad} | Costo: ${it.costo} | Subtotal: ${it.subtotal}`
        );
    });

    doc.moveDown(1);
    doc.fontSize(14).text(`TOTAL: Gs. ${comp.total}`, { align:"right" });

    doc.end();
});

app.delete("/compras/:id", requireAuth, async (req, res) => {
    const id = Number(req.params.id);

    if (!id) {
        return res.json({ ok: false, msg: "ID inválido" });
    }

    try {
        const client = await pool.connect();
        await client.query("BEGIN");

        // 1 Borrar ítems de la compra
        await client.query(
            "DELETE FROM compras_items WHERE compra_id=$1",
            [id]
        );

        // 2 Borrar compra
        const { rowCount } = await client.query(
            "DELETE FROM compras WHERE id=$1",
            [id]
        );

        await client.query("COMMIT");
        client.release();

        if (!rowCount) {
            return res.json({ ok: false, msg: "Compra no encontrada" });
        }

        res.json({ ok: true, msg: "Compra eliminada correctamente" });

    } catch (err) {
        console.error("DELETE /compras/:id", err);
        res.json({ ok: false, msg: "Error eliminando compra" });
    }
});

app.get("/productos/barcode/:codigo", async (req, res) => {
  const codigo = req.params.codigo;

  const result = await pool.query(
    "SELECT * FROM productos WHERE codigo = $1",
    [codigo]
  );

  if (result.rows.length === 0) {
    return res.status(404).json({ error: "Producto no encontrado" });
  }

  res.json(result.rows[0]);
});

function toISODate(fecha) {
  const s = String(fecha || "").trim();

  // si viene YYYY-MM-DD (ok)
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;

  // si viene DD/MM/YYYY -> convertir a YYYY-MM-DD
  const m = s.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (m) return `${m[3]}-${m[2]}-${m[1]}`;

  return s;
}


app.post("/caja/abrir", async (req, res) => {
  const { tipo, fecha, saldo_inicial } = req.body || {};

  try {
    const tipoNorm = String(tipo || "").trim().toLowerCase();
    const fechaISO = toISODate(fecha);

    const cajaAbierta = await pool.query(
      "SELECT id FROM caja WHERE estado='abierta' AND tipo=$1 LIMIT 1",
      [tipoNorm]
    );

    if (cajaAbierta.rows.length > 0) {
      return res.status(400).json({ ok: false, msg: "Ya existe una caja abierta" });
    }

    const q = await pool.query(
      `INSERT INTO caja (tipo, fecha, saldo_inicial, estado)
       VALUES ($1, $2, $3, 'abierta')
       RETURNING *`,
      [tipoNorm, fechaISO, Number(saldo_inicial || 0)]
    );

    return res.json({ ok: true, caja: q.rows[0] });
  } catch (err) {
    console.error("❌ /caja/abrir:", err);
    return res.status(500).json({ ok: false, msg: "Error al abrir caja" });
  }
});

app.get("/caja/abierta", async (req, res) => {
  try {
    const tipo = req.query.tipo ? String(req.query.tipo).trim().toLowerCase() : null;

    const q = tipo
      ? `
        SELECT
          c.*,
          (COALESCE(c.saldo_inicial,0) + COALESCE(SUM(v.total),0))::numeric AS saldo_actual
        FROM caja c
        LEFT JOIN ventas v ON v.caja_id = c.id
        WHERE c.estado='abierta' AND c.tipo=$1
        GROUP BY c.id
        ORDER BY c.id DESC
        LIMIT 1
      `
      : `
        SELECT
          c.*,
          (COALESCE(c.saldo_inicial,0) + COALESCE(SUM(v.total),0))::numeric AS saldo_actual
        FROM caja c
        LEFT JOIN ventas v ON v.caja_id = c.id
        WHERE c.estado='abierta'
        GROUP BY c.id
        ORDER BY c.id DESC
        LIMIT 1
      `;

    const params = tipo ? [tipo] : [];
    const r = await pool.query(q, params);

    res.json({ abierta: r.rows.length > 0, caja: r.rows[0] || null });
  } catch (err) {
    console.error("GET /caja/abierta", err);
    res.status(500).json({ abierta: false, msg: "Error consultando caja" });
  }
});
app.get("/caja/estado", async (req, res) => {
  try {
    const tipo = req.query.tipo ? String(req.query.tipo).trim().toLowerCase() : null;
    const fecha = req.query.fecha ? toISODate(req.query.fecha) : null;

    if (!tipo) {
      return res.status(400).json({ abierta: false, msg: "Falta tipo (efectivo/transferencia)" });
    }
    if (!fecha) {
      return res.status(400).json({ abierta: false, msg: "Falta fecha (YYYY-MM-DD)" });
    }

    // 1) buscar caja abierta de ese tipo y fecha
    const cajaQ = await pool.query(
      `SELECT * FROM caja
       WHERE estado='abierta' AND tipo=$1 AND fecha::date=$2::date
       ORDER BY id DESC
       LIMIT 1`,
      [tipo, fecha]
    );

    if (!cajaQ.rowCount) {
      return res.json({ abierta: false, caja: null });
    }

    const caja = cajaQ.rows[0];

    // 2) sumar ventas de ESA caja
    const ventasQ = await pool.query(
      `SELECT COALESCE(SUM(total),0) AS total_ventas
       FROM ventas
       WHERE caja_id = $1
         AND (estado_pago IS NULL OR estado_pago <> 'anulado')`,
      [caja.id]
    );

    const saldo_inicial = Number(caja.saldo_inicial || 0);
    const total_ventas = Number(ventasQ.rows[0].total_ventas || 0);
    const saldo_actual = saldo_inicial + total_ventas;

    return res.json({
      abierta: true,
      caja: {
        ...caja,
        total_ventas,
        saldo_actual
      }
    });
  } catch (err) {
    console.error("GET /caja/estado", err);
    res.status(500).json({ abierta: false, msg: "Error estado caja" });
  }
});

// ✅ Alias para compatibilidad con el front (que llama /formas_pago)
app.get("/formas_pago", requireAuth, async (req, res) => {
  const result = await pool.query("SELECT * FROM formas_pago WHERE activo = true ORDER BY nombre");
  res.json(result.rows);
});

app.post("/formas_pago", requireAuth, async (req, res) => {
  const { nombre, tipo, descripcion } = req.body;
  await pool.query(
    "INSERT INTO formas_pago (nombre, tipo, descripcion) VALUES ($1, $2, $3)",
    [nombre, tipo, descripcion]
  );
  res.json({ ok: true });
});

app.put("/formas_pago/:id", requireAuth, async (req, res) => {
  const { id } = req.params;
  const { nombre, tipo, descripcion, activo } = req.body;

  await pool.query(`
    UPDATE formas_pago SET 
      nombre = $1, tipo = $2, descripcion = $3, activo = $4
    WHERE id = $5
  `, [nombre, tipo, descripcion, activo, id]);

  res.json({ ok: true });
});

// ================== RESUMEN CAJA (DIA / MES) ==================
function monthStartISO(fechaISO) {
  // fechaISO: YYYY-MM-DD
  const m = String(fechaISO || "").slice(0, 7);
  return /^\d{4}-\d{2}$/.test(m) ? `${m}-01` : null;
}

// GET /caja/resumen-dia?dia=2026-02-11   (o dia=11/02/2026)
// Helpers (asegurate de tener toISODate(d) que convierte "16/02/2026" -> "2026-02-16")
function numRow(r) {
  return {
    efectivo: Number(r?.efectivo || 0),
    transferencia: Number(r?.transferencia || 0),
    total: Number(r?.total || 0),
  };
}

// ✅ Día: acepta ?dia= o ?fecha=
app.get("/caja/resumen-dia", async (req, res) => {
  try {
    const diaParam = req.query.dia || req.query.fecha;
    if (!diaParam) return res.status(400).json({ ok: false, msg: "Falta dia o fecha" });

    const ymd = toISODate(diaParam); // YYYY-MM-DD

    const q = await pool.query(
      `
      SELECT
        COALESCE(SUM(CASE WHEN fp.id = 1 THEN v.total ELSE 0 END), 0) AS efectivo,
        COALESCE(SUM(CASE WHEN fp.id <> 1 THEN v.total ELSE 0 END), 0) AS transferencia,
        COALESCE(SUM(v.total), 0) AS total
      FROM ventas v
      LEFT JOIN formas_pago fp ON fp.id = v.forma_pago_id
      WHERE v.fecha::date = $1::date
      `,
      [ymd]
    );

    return res.json({ ok: true, dia: ymd, ...numRow(q.rows[0]) });
  } catch (err) {
    console.error("GET /caja/resumen-dia", err);
    return res.status(500).json({ ok: false, msg: "Error resumen día" });
  }
});

// ✅ Mes: acepta ?mes= o ?fecha=
app.get("/caja/resumen-mes", async (req, res) => {
  try {
    const mesParam = req.query.mes || req.query.fecha;
    if (!mesParam) return res.status(400).json({ ok: false, msg: "Falta mes o fecha" });

    let ymd = String(mesParam).trim();
    if (/^\d{4}-\d{2}$/.test(ymd)) ymd = `${ymd}-01`;
    ymd = toISODate(ymd);

    const q = await pool.query(
      `
      SELECT
        COALESCE(SUM(CASE WHEN fp.id = 1 THEN v.total ELSE 0 END), 0) AS efectivo,
        COALESCE(SUM(CASE WHEN fp.id <> 1 THEN v.total ELSE 0 END), 0) AS transferencia,
        COALESCE(SUM(v.total), 0) AS total
      FROM ventas v
      LEFT JOIN formas_pago fp ON fp.id = v.forma_pago_id
      WHERE date_trunc('month', v.fecha::date) = date_trunc('month', $1::date)
      `,
      [ymd]
    );

    return res.json({ ok: true, mes: ymd.slice(0, 7), ...numRow(q.rows[0]) });
  } catch (err) {
    console.error("GET /caja/resumen-mes", err);
    return res.status(500).json({ ok: false, msg: "Error resumen mes" });
  }
});

// ✅ Único: /caja/resumen?fecha=16/02/2026 ó 2026-02-16
app.get("/caja/resumen", async (req, res) => {
  try {
    const fechaParam = req.query.fecha || req.query.dia || req.query.mes;
    if (!fechaParam) return res.status(400).json({ ok: false, msg: "Falta fecha" });

    const ymd = toISODate(fechaParam);

    const diaQ = await pool.query(
      `
      SELECT
        COALESCE(SUM(CASE WHEN fp.id = 1 THEN v.total ELSE 0 END), 0) AS efectivo,
        COALESCE(SUM(CASE WHEN fp.id <> 1 THEN v.total ELSE 0 END), 0) AS transferencia,
        COALESCE(SUM(v.total), 0) AS total
      FROM ventas v
      LEFT JOIN formas_pago fp ON fp.id = v.forma_pago_id
      WHERE v.fecha::date = $1::date
      `,
      [ymd]
    );

    const mesQ = await pool.query(
      `
      SELECT
        COALESCE(SUM(CASE WHEN fp.id = 1 THEN v.total ELSE 0 END), 0) AS efectivo,
        COALESCE(SUM(CASE WHEN fp.id <> 1 THEN v.total ELSE 0 END), 0) AS transferencia,
        COALESCE(SUM(v.total), 0) AS total
      FROM ventas v
      LEFT JOIN formas_pago fp ON fp.id = v.forma_pago_id
      WHERE date_trunc('month', v.fecha::date) = date_trunc('month', $1::date)
      `,
      [ymd]
    );

    return res.json({
      ok: true,
      fecha: ymd,
      dia: numRow(diaQ.rows[0]),
      mes: numRow(mesQ.rows[0]),
    });
  } catch (err) {
    console.error("GET /caja/resumen", err);
    return res.status(500).json({ ok: false, msg: "Error resumen caja" });
  }
});
// ✅ APARTADO NUEVO: Movimientos con comprobante (para la pantalla Formas de Pago)
app.get("/formas-pago/movimientos", async (_req, res) => {
  try {
    const q = await pool.query(`
      SELECT
        v.id,
        v.fecha,
        v.total,
        v.estado_pago,
        fp.nombre AS forma_pago_nombre,
        v.nro_comprobante,
        COALESCE(c.nombre || ' ' || c.apellido, 'Consumidor Final') AS cliente_nombre
      FROM ventas v
      LEFT JOIN formas_pago fp ON fp.id = v.forma_pago_id
      LEFT JOIN clientes c ON c.id = v.cliente_id
      ORDER BY v.id DESC
      LIMIT 50
    `);

    res.json(q.rows);
  } catch (err) {
    console.error("❌ Error en /formas-pago/movimientos:", err);
    res.status(500).json({ ok: false, msg: "Error cargando movimientos" });
  }
});

app.get("/ventas/:id/pagare", async (req, res) => {
  const ventaId = Number(req.params.id);

  try {
    const v = await pool.query(
      `
      SELECT
        v.id,
        v.fecha,
        v.total,
        v.estado_pago,
        v.nro_comprobante,
        fp.nombre AS forma_pago_nombre,
        COALESCE(c.nombre || ' ' || c.apellido, 'Consumidor Final') AS cliente_nombre
      FROM ventas v
      LEFT JOIN clientes c ON c.id = v.cliente_id
      LEFT JOIN formas_pago fp ON fp.id = v.forma_pago_id
      WHERE v.id = $1
      LIMIT 1
      `,
      [ventaId]
    );

    if (!v.rows.length) return res.status(404).send("Venta no encontrada");
    const venta = v.rows[0];

    const itemsQ = await pool.query(
      `
      SELECT
        vi.cantidad,
        vi.precio,
        vi.subtotal,
        p.nombre AS producto_nombre
      FROM ventas_items vi
      JOIN productos p ON p.id = vi.producto_id
      WHERE vi.venta_id = $1
      ORDER BY vi.id ASC
      `,
      [ventaId]
    );

    const items = itemsQ.rows;

    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `inline; filename=pagare_${ventaId}.pdf`);

    const doc = new PDFDocument({ size: "A4", margin: 40 });
    doc.pipe(res);

    const fmt = (n) => Number(n || 0).toLocaleString("es-PY");
    const fechaStr = venta.fecha ? new Date(venta.fecha).toISOString().slice(0, 10) : "";

    // =========================================================
    // ✅ LOGOS + ENCABEZADO COMO TU IMAGEN
    // =========================================================
    const logoLeft  = path.join(process.cwd(), "public", "img", "logo1.jpg");
    const logoRight = path.join(process.cwd(), "public", "img", "logo2.png");

    const pageW = doc.page.width;
    const leftX = 40;
    const rightX = pageW - 40;

    const headerTopY = 35;

    // Logos
    if (fs.existsSync(logoLeft)) {
      doc.image(logoLeft, leftX, headerTopY, { width: 90 });
    }
    if (fs.existsSync(logoRight)) {
      doc.image(logoRight, rightX - 90, headerTopY + 5, { width: 90 });
    }

    // Bloque centrado (entre logos)
    const midX = leftX + 100;              // deja espacio al logo izquierdo
    const midW = (rightX - 100) - midX;    // deja espacio al logo derecho

    // Título grande
    doc.font("Helvetica")
      .fontSize(28)
      .text("Consorcio Spy E.A.S.", midX, headerTopY, {
        width: midW,
        align: "center"
      });

    // Línea "Servicio de Internet..."
    doc.fontSize(14)
      .text("Servicio de Internet (Telecomunicaciones)", midX, headerTopY + 32, {
        width: midW,
        align: "center"
      });

    // Texto chico (2 líneas)
    doc.fontSize(9)
      .text("Comercio al por menor de equipos de telecomunicaciones", midX, headerTopY + 52, {
        width: midW,
        align: "center"
      })
      .text("Instalaciones eléctricas, electromecánicas y electrónicas", midX, headerTopY + 64, {
        width: midW,
        align: "center"
      });

    // Línea horizontal (tipo separador del encabezado)
    const lineY1 = headerTopY + 82;
    doc.lineWidth(1);
    doc.moveTo(midX + 25, lineY1).lineTo(midX + midW - 25, lineY1).stroke();

    // Dirección grande centrada
    doc.fontSize(14)
      .text("Calle, Tte Eligio Montania - Valenzuela", midX, headerTopY + 92, {
        width: midW,
        align: "center"
      })
      .text("Cordillera - Paraguay", midX, headerTopY + 110, {
        width: midW,
        align: "center"
      });

    // Línea final del encabezado
    const lineY2 = headerTopY + 132;
    doc.moveTo(leftX, lineY2).lineTo(rightX, lineY2).stroke();

    // =========================================================
    // ✅ TITULO PAGARÉ (debajo del encabezado)
    // =========================================================
    doc.font("Helvetica-Bold")
      .fontSize(18)
      .text("PAGARÉ", 0, lineY2 + 12, { align: "center" });

    // =========================================================
    // ✅ CAJA PRINCIPAL (bajamos todo porque ahora hay encabezado)
    // =========================================================
    const boxX = 40, boxY = lineY2 + 55, boxW = 515, boxH = 250;
    doc.roundedRect(boxX, boxY, boxW, boxH, 10).lineWidth(1).stroke();

    doc.font("Helvetica").fontSize(11);
    doc.text(`N° Venta: ${venta.id}`, boxX + 15, boxY + 15);
    doc.text(`Fecha: ${fechaStr}`, boxX + 380, boxY + 15);

    doc.moveTo(boxX + 15, boxY + 40).lineTo(boxX + boxW - 15, boxY + 40).stroke();

    doc.text("Deudor (Cliente):", boxX + 15, boxY + 55);
    doc.font("Helvetica-Bold").text(venta.cliente_nombre, boxX + 130, boxY + 55, { width: 360 });
    doc.font("Helvetica");

    doc.text("Forma de pago:", boxX + 15, boxY + 80);
    doc.font("Helvetica-Bold").text(venta.forma_pago_nombre || "-", boxX + 130, boxY + 80);
    doc.font("Helvetica");

    doc.text("Estado:", boxX + 15, boxY + 105);
    doc.font("Helvetica-Bold").text((venta.estado_pago || "-").toString(), boxX + 130, boxY + 105);
    doc.font("Helvetica");

    doc.text("Comprobante:", boxX + 15, boxY + 130);
    doc.font("Helvetica-Bold").text(venta.nro_comprobante || "—", boxX + 130, boxY + 130);
    doc.font("Helvetica");

    doc.text("Monto:", boxX + 15, boxY + 155);
    doc.font("Helvetica-Bold").text(`Gs. ${fmt(venta.total)}`, boxX + 130, boxY + 155);
    doc.font("Helvetica");

    const textoLegal =
      "Por este PAGARÉ me obligo a pagar incondicionalmente a la orden de la empresa el monto indicado. " +
      "En caso de mora, asumiré los gastos e intereses que correspondan según lo acordado.";
    doc.fontSize(10).text(textoLegal, boxX + 15, boxY + 185, { width: boxW - 30, align: "justify" });

    // Firmas
    const sigY = boxY + boxH + 55;
    doc.moveTo(70, sigY).lineTo(270, sigY).stroke();
    doc.moveTo(330, sigY).lineTo(530, sigY).stroke();
    doc.fontSize(10).text("Firma del Cliente", 70, sigY + 5, { width: 200, align: "center" });
    doc.fontSize(10).text("Firma / Encargado", 330, sigY + 5, { width: 200, align: "center" });

    // Detalle
    doc.fontSize(12).text("Detalle", 40, sigY + 45);

    let y = sigY + 65;
    doc.fontSize(10).text("Descripción", 40, y);
    doc.text("Cant.", 340, y);
    doc.text("Precio", 400, y);
    doc.text("Subtotal", 470, y);
    y += 15;
    doc.moveTo(40, y).lineTo(555, y).stroke();
    y += 8;

    items.slice(0, 12).forEach((it) => {
      doc.text(it.producto_nombre || "", 40, y, { width: 290 });
      doc.text(String(it.cantidad ?? ""), 340, y);
      doc.text(`Gs. ${fmt(it.precio ?? 0)}`, 400, y);
      doc.text(`Gs. ${fmt(it.subtotal ?? 0)}`, 470, y);
      y += 16;
    });

    doc.moveTo(40, y + 5).lineTo(555, y + 5).stroke();
    doc.font("Helvetica-Bold").text("TOTAL:", 380, y + 12);
    doc.text(`Gs. ${fmt(venta.total)}`, 470, y + 12);
    doc.font("Helvetica");

    doc.end();
  } catch (err) {
    console.error("❌ Error generando pagaré:", err);
    res.status(500).send("Error generando pagaré");
  }
});
app.get("/", (_req, res) => {
  res.send("SPYnet OK ✅");
});
app.listen(PORT, () => {
  console.log(`✅ Servidor corriendo en http://localhost:${PORT}`);
});