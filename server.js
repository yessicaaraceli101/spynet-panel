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
import { fileURLToPath } from "url";
import nodemailer from "nodemailer";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

console.log(
  "SERVER CORRECTO (server.js) ->",
  new Date().toISOString(),
  "CWD:",
  process.cwd()
);


const { Pool } = pkg;
const EDIT_SALES_PASSWORD = process.env.EDIT_SALES_PASSWORD || "editar123";
let EDIT_SALES_HASH = null;

(async () => {
  EDIT_SALES_HASH = await bcrypt.hash(EDIT_SALES_PASSWORD, 10);
})();

const app = express();
const PORT = process.env.PORT || 4000;


async function enviarPedidoProveedor({

  empresaId,

  proveedorEmail,

  proveedorNombre,

  pedidoId,

  pdfPath,

  empresaNombre

}) {

  if (!proveedorEmail) {

    console.log(
      "Proveedor sin email"
    );

    return;
  }

  /* =========================
     OBTENER SMTP EMPRESA
  ========================= */

  const { rows } = await pool.query(
    `
    SELECT
      smtp_host,
      smtp_port,
      smtp_secure,
      smtp_user,
      smtp_pass,
      smtp_from
    FROM empresas
    WHERE id = $1
    LIMIT 1
    `,
    [empresaId]
  );

  if (!rows.length) {
    throw new Error(
      "Empresa no encontrada"
    );
  }

  const empresa = rows[0];

  /* =========================
     VALIDAR SMTP
  ========================= */

  if (
    !empresa.smtp_host ||
    !empresa.smtp_user ||
    !empresa.smtp_pass
  ) {
    throw new Error(
      "SMTP no configurado"
    );
  }

  /* =========================
     TRANSPORTER
  ========================= */

  const transporter =
    nodemailer.createTransport({

      host:
        empresa.smtp_host,

      port:
        Number(
          empresa.smtp_port || 465
        ),

      secure:
        !!empresa.smtp_secure,

      auth: {

        user:
          empresa.smtp_user,

        pass:
          empresa.smtp_pass
      }
    });

  /* =========================
     ENVIAR EMAIL
  ========================= */

  await transporter.sendMail({

    from: `
      "${empresaNombre}"
      <${empresa.smtp_from}>
    `,

    to:
      proveedorEmail,

    subject:
      `Pedido #${pedidoId}`,

    html: `
      <div
        style="
          font-family:Arial,sans-serif
        "
      >

        <h2>
          Orden de Compra
        </h2>

        <p>
          Hola
          ${proveedorNombre || ""}.
        </p>

        <p>
          Adjuntamos el pedido N°
          <b>#${pedidoId}</b>.
        </p>

        <p>
          Favor revisar el PDF adjunto.
        </p>

        <br>

        <p>
          Saludos.
        </p>

      </div>
    `,

    attachments: [
      {
        filename:
          `pedido_${pedidoId}.pdf`,

        path:
          pdfPath
      }
    ]
  });

  console.log(
    "Pedido enviado a:",
    proveedorEmail
  );
}
app.use(
  "/uploads",
  express.static(
    path.join(__dirname, "uploads")
  )
);

app.use((req, res, next) => {
  res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, private");
  next();
});


console.log("SUPABASE_URL:", process.env.SUPABASE_URL ? "OK" : "FALTA");
console.log("SERVICE_ROLE:", process.env.SUPABASE_SERVICE_ROLE_KEY ? "OK" : "FALTA");

console.log("ENV KEYS:", Object.keys(process.env).filter(k => k.includes("SUPABASE") || k.includes("SERVICE")));
console.log("SUPABASE_URL exists:", !!process.env.SUPABASE_URL);
console.log("SUPABASE_SERVICE_ROLE_KEY exists:", !!process.env.SUPABASE_SERVICE_ROLE_KEY);
console.log("SERVICE_ROLE exists:", !!process.env.SERVICE_ROLE);

function normTipoCaja(t) {
  let s = String(t || "").trim().toLowerCase();
  if (s === "trasferencia") s = "transferencia";
  if (s.includes("trans")) s = "transferencia";   // transferencia, transferencias, etc.
  if (s.includes("efect")) s = "efectivo";        // efectivo
  return s;
}


if (!process.env.SUPABASE_URL) {
  throw new Error("FALTA SUPABASE_URL en .env");
}
if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
  throw new Error("FALTA SUPABASE_SERVICE_ROLE_KEY en .env");
}


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

function requireAdmin(req, res, next) {

  if (
    !req.session.user ||
    !req.session.isAdmin
  ) {

    return res.status(401).json({
      ok:false,
      msg:"No autenticado"
    });
  }

  next();
}

/* ----------------------------- PostgreSQL Pool ------------------------------ */
/* ----------------------------- PostgreSQL Pool ------------------------------ */
const sslRequired = String(process.env.PGSSLMODE || "").trim().toLowerCase() === "require";

const pool = new Pool({
  host: process.env.PGHOST,
  port: Number(process.env.PGPORT || 5432),
  user: process.env.PGUSER,
  password: process.env.PGPASSWORD,
  database: process.env.PGDATABASE,

  ssl: sslRequired ? { rejectUnauthorized: false } : false,

  max: Number(process.env.PGPOOL_MAX || 10),
  idleTimeoutMillis: 60_000,           // Aumentado para dar más tiempo
  connectionTimeoutMillis: 30_000,     // Aumentado para dar más tiempo
});

pool.on("error", (err) => {
  console.error("Pool error:", err.message);
});

// Fijar timezone en cada conexión
pool.on('connect', async (client) => {
  await client.query('SET TIMEZONE = "America/Asuncion"');
  console.log('Timezone de sesión fijado a America/Asuncion');
});

// ------------------------------------------
// FUNCIONES DE BOOTSTRAP (sin cambios)
// ------------------------------------------
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

async function bootstrapFormasPagoTodasEmpresas() {
  try {
    const formasBase = [
      { nombre: "Efectivo",       tipo: "efectivo" },
      { nombre: "Débito",         tipo: "transferencia" },
      { nombre: "Crédito",        tipo: "transferencia" },
      { nombre: "QR",             tipo: "transferencia" },
      { nombre: "BNF",            tipo: "transferencia" },
      { nombre: "Continental",    tipo: "transferencia" },
      { nombre: "Banco Familiar", tipo: "transferencia" },
      { nombre: "Ueno Bank",      tipo: "transferencia" },
      { nombre: "Banco Basa",     tipo: "transferencia" },
      { nombre: "Mango",          tipo: "transferencia" },
      { nombre: "Otro Banco",     tipo: "transferencia" },
    ];

    const { rows: empresas } = await pool.query(
      `SELECT id FROM empresas`
    );

    for (const emp of empresas) {
      for (const f of formasBase) {
        await pool.query(
          `
          INSERT INTO formas_pago (nombre, tipo, activo, empresa_id)
          SELECT 
            $1::text,
            $2::text,
            true,
            $3::int
          WHERE NOT EXISTS (
            SELECT 1
            FROM formas_pago
            WHERE LOWER(nombre) = LOWER($1::text)
              AND empresa_id = $3::int
          )
          `,
          [f.nombre, f.tipo, emp.id]
        );
      }
    }

    console.log("Formas de pago sincronizadas para todas las empresas");
  } catch (e) {
    console.error("bootstrapFormasPagoTodasEmpresas:", e);
  }
}

// ------------------------------------------
// BLOQUE PRINCIPAL DE CONEXIÓN Y BOOTSTRAP
// ------------------------------------------
(async () => {
  try {
    const client = await pool.connect();
    console.log("Conectado a PostgreSQL");
    const info = await client.query(
      "SELECT current_database() AS db, current_schema() AS schema"
    );
    console.log("DB:", info.rows[0]);
    client.release();

    // EJECUTAR BOOTSTRAPS AHORA, DESPUÉS DE CONFIRMAR CONEXIÓN
    try {
      await bootstrapUsuarios();
      console.log('Usuarios bootstrap finalizado');
    } catch (e) {
      console.error('❌ Error en bootstrapUsuarios:', e.message);
    }

    try {
      await bootstrapFormasPagoTodasEmpresas();
      console.log('Formas de pago bootstrap finalizado');
    } catch (e) {
      console.error('❌ Error en bootstrapFormasPagoTodasEmpresas:', e.message);
    }

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


const logosDir = path.join(__dirname, "public/uploads/logos");

if (!fs.existsSync(logosDir)) {
  fs.mkdirSync(logosDir, { recursive: true });
}

const logoStorage = multer.diskStorage({
  destination: (_req, _file, cb) => {
    cb(null, logosDir);
  },

  filename: (req, file, cb) => {
    const empresaId = req.params.id;
    const ext = path.extname(file.originalname || "") || ".png";

    cb(null, `empresa-${empresaId}${ext}`);
  },
});

const uploadLogo = multer({ storage: logoStorage });



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

/* --------------------------------- Auth/Sesión ------------------------------ */
function requireAuth(req, res, next) {
  if (req.session && req.session.user) return next();
  return res.status(401).json({ error: "No autorizado" });
}

function getEmpresaId(req) {
  return Number(req.session?.user?.empresa_id || 0);
}

function requireEmpresa(req, res, next) {
  if (!req.session || !req.session.user) {
    return res.status(401).json({ error: "No autorizado" });
  }

  const empresaId = getEmpresaId(req);

  if (!empresaId) {
    return res.status(403).json({
      error: "El usuario no tiene empresa asignada"
    });
  }

  next();
}


/* =========================================
   MIDDLEWARE ADMIN
========================================= */

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

  if (!usuario || !password) {
    return res.status(400).json({ error: "Faltan credenciales" });
  }

  try {
    const { rows } = await pool.query(
      `
      SELECT 
        u.id,
        u.usuario,
        u.nombre,
        u.genero,
        u.password_hash,
        u.rol,
        u.activo,
        u.empresa_id,
        e.nombre AS empresa_nombre,
        e.logo AS empresa_logo,
        e.color_principal
      FROM usuarios u
      LEFT JOIN empresas e ON e.id = u.empresa_id
      WHERE lower(u.usuario) = lower($1)
      LIMIT 1
      `,
      [usuario.trim()]
    );

    if (!rows.length) {
      return res.status(401).json({ error: "Credenciales inválidas" });
    }

    const u = rows[0];

    if (u.activo === false) {
      return res.status(403).json({ error: "Usuario inactivo" });
    }

    if (u.empresa_id && u.empresa_nombre === null) {
      return res.status(403).json({ error: "La empresa asignada no existe" });
    }

    let ok = false;

    if (u.password_hash?.startsWith("$2")) {
      ok = await bcrypt.compare(password, u.password_hash);
    } else {
      ok = password === u.password_hash;
    }

    if (!ok) {
      return res.status(401).json({ error: "Credenciales inválidas" });
    }

    req.session.user = {
      id: u.id,
      usuario: u.usuario,
      nombre: u.nombre,
      genero: u.genero || 'M',   // ← agregado
      rol: u.rol,
      empresa_id: u.empresa_id,
      empresa_nombre: u.empresa_nombre,
      empresa_logo: u.empresa_logo,
      color_principal: u.color_principal
    };

    return res.json({
      ok: true,
      user: req.session.user
    });

  } catch (e) {
    console.error("POST /login", e);
    return res.status(500).json({ error: "Error en el servidor" });
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

    res.json({
      ok: true
    });
  });
});

/* ---------------------------------- Clientes -------------------------------- */
app.get("/clientes", requireEmpresa, async (req, res) => {
  try {
    const empresaId = getEmpresaId(req);

    const result = await pool.query(
      `
      SELECT *
      FROM clientes
      WHERE empresa_id = $1
      ORDER BY id DESC
      `,
      [empresaId]
    );

    res.json(result.rows);
  } catch (err) {
    console.error("GET /clientes", err.message);
    res.status(500).json({ error: "Error al listar clientes" });
  }
});

app.post("/clientes", requireEmpresa, async (req, res) => {
  try {
    const empresaId = getEmpresaId(req);
    const {
      nombre,
      apellido,
      ci,
      telefono,
      pais,
      ciudad,
      direccion,
      estado
    } = req.body;

    const q = `
      INSERT INTO clientes (
        nombre,
        apellido,
        ci,
        telefono,
        pais,
        ciudad,
        direccion,
        estado,
        empresa_id
      )
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
      RETURNING *
    `;

    const { rows } = await pool.query(q, [
      nombre,
      apellido,
      ci,
      telefono,
      pais,
      ciudad,
      direccion,
      estado,
      empresaId
    ]);

    res.json({
      message: "Cliente guardado correctamente",
      cliente: rows[0]
    });
  } catch (err) {
    console.error("POST /clientes", err.message);
    res.status(500).json({ error: "Error al guardar cliente" });
  }
});

app.put("/clientes/:id", requireEmpresa, async (req, res) => {
  try {
    const empresaId = getEmpresaId(req);
    const { id } = req.params;

    const {
      nombre,
      apellido,
      ci,
      telefono,
      pais,
      ciudad,
      direccion,
      estado
    } = req.body;

    const q = `
      UPDATE clientes
      SET
        nombre = $1,
        apellido = $2,
        ci = $3,
        telefono = $4,
        pais = $5,
        ciudad = $6,
        direccion = $7,
        estado = $8
      WHERE id = $9
        AND empresa_id = $10
      RETURNING *
    `;

    const { rows } = await pool.query(q, [
      nombre,
      apellido,
      ci,
      telefono,
      pais,
      ciudad,
      direccion,
      estado,
      id,
      empresaId
    ]);

    if (!rows.length) {
      return res.status(404).json({
        error: "Cliente no encontrado o no pertenece a esta empresa"
      });
    }

    res.json({
      message: "Cliente actualizado correctamente",
      cliente: rows[0]
    });
  } catch (err) {
    console.error("PUT /clientes/:id", err.message);
    res.status(500).json({ error: "Error al actualizar cliente" });
  }
});

app.delete("/clientes/:id", requireEmpresa, async (req, res) => {
  try {
    const empresaId = getEmpresaId(req);

    const { rowCount } = await pool.query(
      `
      DELETE FROM clientes
      WHERE id = $1
        AND empresa_id = $2
      `,
      [req.params.id, empresaId]
    );

    if (!rowCount) {
      return res.status(404).json({
        error: "Cliente no encontrado o no pertenece a esta empresa"
      });
    }

    res.json({ message: "Cliente eliminado correctamente" });
  } catch (err) {
    console.error("DELETE /clientes/:id", err.message);
    res.status(500).json({ error: "Error al eliminar cliente" });
  }
});
/* -------------------------------- Proveedores ------------------------------- */
app.get("/proveedores", requireEmpresa, async (req, res) => {
  try {
    const empresaId = getEmpresaId(req);

    const { rows } = await pool.query(
      `
      SELECT 
        id,
        nombre,
        ruc,
        contacto,
        email,
        telefono,
        pais,
        ciudad,
        direccion,
        estado
      FROM proveedores
      WHERE empresa_id = $1
      ORDER BY id DESC
      `,
      [empresaId]
    );

    res.json(rows);

  } catch (e) {

    console.error("GET /proveedores", e);

    res.status(500).json({
      error: "Error al listar proveedores"
    });
  }
});

app.post("/proveedores", requireEmpresa, async (req, res) => {
  try {

    const empresaId = getEmpresaId(req);

    const {
      nombre = "",
      ruc = "",
      contacto = null,

      // NUEVO
      email = null,

      telefono = null,
      pais = null,
      ciudad = null,
      direccion = null,
      estado = true

    } = req.body || {};

    if (!nombre.trim()) {
      return res.status(400).json({
        error: "El nombre es obligatorio"
      });
    }

    if (!ruc.trim()) {
      return res.status(400).json({
        error: "El RUC es obligatorio"
      });
    }

    const { rows } = await pool.query(
      `
      INSERT INTO proveedores (
        nombre,
        ruc,
        contacto,
        email,
        telefono,
        pais,
        ciudad,
        direccion,
        estado,
        empresa_id
      )
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)

      RETURNING 
        id,
        nombre,
        ruc,
        contacto,
        email,
        telefono,
        pais,
        ciudad,
        direccion,
        estado
      `,
      [
        nombre.trim(),
        ruc.trim(),
        contacto,
        email,
        telefono,
        pais,
        ciudad,
        direccion,
        !!estado,
        empresaId
      ]
    );

    res.status(201).json(rows[0]);

  } catch (e) {

    console.error("POST /proveedores", e);

    res.status(500).json({
      error: "Error al crear proveedor"
    });
  }
});

app.put("/proveedores/:id", requireEmpresa, async (req, res) => {
  try {

    const empresaId = getEmpresaId(req);

    const id = Number(req.params.id);

    const {
      nombre = "",
      ruc = "",
      contacto = null,

      // NUEVO
      email = null,

      telefono = null,
      pais = null,
      ciudad = null,
      direccion = null,
      estado = true

    } = req.body || {};

    if (!id) {
      return res.status(400).json({
        error: "ID inválido"
      });
    }

    if (!nombre.trim()) {
      return res.status(400).json({
        error: "El nombre es obligatorio"
      });
    }

    if (!ruc.trim()) {
      return res.status(400).json({
        error: "El RUC es obligatorio"
      });
    }

    const { rows } = await pool.query(
      `
      UPDATE proveedores
      SET
        nombre = $1,
        ruc = $2,
        contacto = $3,
        email = $4,
        telefono = $5,
        pais = $6,
        ciudad = $7,
        direccion = $8,
        estado = $9

      WHERE id = $10
        AND empresa_id = $11

      RETURNING 
        id,
        nombre,
        ruc,
        contacto,
        email,
        telefono,
        pais,
        ciudad,
        direccion,
        estado
      `,
      [
        nombre.trim(),
        ruc.trim(),
        contacto,
        email,
        telefono,
        pais,
        ciudad,
        direccion,
        !!estado,
        id,
        empresaId
      ]
    );

    if (!rows.length) {
      return res.status(404).json({
        error: "Proveedor no encontrado o no pertenece a esta empresa"
      });
    }

    res.json(rows[0]);

  } catch (e) {

    console.error("PUT /proveedores/:id", e);

    res.status(500).json({
      error: "Error al actualizar proveedor"
    });
  }
});

app.delete("/proveedores/:id", requireEmpresa, async (req, res) => {
  try {

    const empresaId = getEmpresaId(req);

    const id = Number(req.params.id);

    if (!id) {
      return res.status(400).json({
        error: "ID inválido"
      });
    }

    const { rowCount } = await pool.query(
      `
      DELETE FROM proveedores
      WHERE id = $1
        AND empresa_id = $2
      `,
      [id, empresaId]
    );

    if (!rowCount) {
      return res.status(404).json({
        error: "Proveedor no encontrado o no pertenece a esta empresa"
      });
    }

    res.json({ ok: true });

  } catch (e) {

    console.error("DELETE /proveedores/:id", e);

    res.status(500).json({
      error: "Error al eliminar proveedor"
    });
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
        empresa_id INTEGER REFERENCES empresas(id),
        creado_en TIMESTAMP DEFAULT NOW()
      );
    `);

    await pool.query(`
      ALTER TABLE categorias
      ADD COLUMN IF NOT EXISTS empresa_id INTEGER REFERENCES empresas(id)
    `);

    await pool.query(`
      UPDATE categorias
      SET empresa_id = 1
      WHERE empresa_id IS NULL
    `);

    await pool.query(`
      DROP INDEX IF EXISTS categorias_nombre_uk
    `);

    await pool.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS categorias_nombre_empresa_uk
      ON categorias (LOWER(nombre), empresa_id)
    `);

  } catch (e) {
    console.error("Bootstrap categorias:", e.message);
  }
}
bootstrapCategorias();

/*  GET /categorias  */
app.get("/categorias", requireEmpresa, async (req, res) => {
  try {
    const empresaId = getEmpresaId(req);

    const { rows } = await pool.query(
      `
      SELECT
        c.id,
        c.nombre,
        COALESCE(
          c.codigo,
          (
            SELECT p.codigo
            FROM productos p
            WHERE p.categoria_id = c.id
              AND p.empresa_id = $1
              AND p.codigo IS NOT NULL
            ORDER BY p.id DESC
            LIMIT 1
          )
        ) AS codigo,
        c.descripcion,
        COALESCE(
          c.imagen_base64,
          (
            SELECT COALESCE(p.imagen_base64, p.imagen)
            FROM productos p
            WHERE p.categoria_id = c.id
              AND p.empresa_id = $1
              AND (p.imagen_base64 IS NOT NULL OR p.imagen IS NOT NULL)
            ORDER BY p.id DESC
            LIMIT 1
          )
        ) AS imagen_base64,
        COALESCE(
          STRING_AGG(p.nombre, ', ' ORDER BY p.nombre)
            FILTER (WHERE p.nombre IS NOT NULL),
          '-'
        ) AS productos
      FROM categorias c
      LEFT JOIN productos p
        ON p.categoria_id = c.id
       AND p.empresa_id = $1
       AND COALESCE(p.activo, true) = true
      WHERE c.empresa_id = $1
      GROUP BY
        c.id,
        c.nombre,
        c.codigo,
        c.descripcion,
        c.imagen_base64
      ORDER BY c.id ASC
      `,
      [empresaId]
    );

    res.json(rows);
  } catch (e) {
    console.error("GET /categorias", e);
    res.status(500).json({ error: "Error al listar categorías" });
  }
});
async function bootstrapComprasTipoPago() {
  try {
    await pool.query(`
      ALTER TABLE compras
      ADD COLUMN IF NOT EXISTS tipo_pago TEXT DEFAULT 'efectivo'
    `);

    await pool.query(`
      ALTER TABLE compras
      ADD COLUMN IF NOT EXISTS empresa_id INTEGER REFERENCES empresas(id)
    `);

    await pool.query(`
      ALTER TABLE compras_items
      ADD COLUMN IF NOT EXISTS empresa_id INTEGER REFERENCES empresas(id)
    `);

    await pool.query(`
      UPDATE compras
      SET tipo_pago = 'efectivo'
      WHERE tipo_pago IS NULL OR TRIM(tipo_pago) = ''
    `);

    await pool.query(`
      UPDATE compras
      SET empresa_id = 1
      WHERE empresa_id IS NULL
    `);

    await pool.query(`
      UPDATE compras_items
      SET empresa_id = 1
      WHERE empresa_id IS NULL
    `);

  } catch (e) {
    console.error("bootstrapComprasTipoPago:", e.message);
  }
}
bootstrapComprasTipoPago();

async function bootstrapComprasMoneda() {
  try {
    await pool.query(`
      ALTER TABLE compras
      ADD COLUMN IF NOT EXISTS moneda TEXT DEFAULT 'PYG'
    `);

    await pool.query(`
      ALTER TABLE compras
      ADD COLUMN IF NOT EXISTS tipo_cambio NUMERIC(14,2) DEFAULT 1
    `);

    await pool.query(`
      ALTER TABLE compras
      ADD COLUMN IF NOT EXISTS subtotal_moneda NUMERIC(14,2) DEFAULT 0
    `);

    await pool.query(`
      ALTER TABLE compras
      ADD COLUMN IF NOT EXISTS iva_moneda NUMERIC(14,2) DEFAULT 0
    `);

    await pool.query(`
      ALTER TABLE compras
      ADD COLUMN IF NOT EXISTS total_moneda NUMERIC(14,2) DEFAULT 0
    `);

    await pool.query(`
      UPDATE compras
      SET moneda = 'PYG'
      WHERE moneda IS NULL OR TRIM(moneda) = ''
    `);

    await pool.query(`
      UPDATE compras
      SET tipo_cambio = 1
      WHERE tipo_cambio IS NULL OR tipo_cambio <= 0
    `);

    await pool.query(`
      UPDATE compras
      SET subtotal_moneda = subtotal
      WHERE subtotal_moneda IS NULL OR subtotal_moneda = 0
    `);

    await pool.query(`
      UPDATE compras
      SET iva_moneda = iva
      WHERE iva_moneda IS NULL OR iva_moneda = 0
    `);

    await pool.query(`
      UPDATE compras
      SET total_moneda = total
      WHERE total_moneda IS NULL OR total_moneda = 0
    `);

  } catch (e) {
    console.error("bootstrapComprasMoneda:", e.message);
  }
}
bootstrapComprasMoneda();

app.post("/categorias", requireEmpresa, async (req, res) => {
  try {
    const empresaId = getEmpresaId(req);

    const {
      nombre = "",
      codigo = null,
      descripcion = null,
      imagen_base64 = null
    } = req.body || {};

    if (!nombre.trim()) {
      return res.status(400).json({ error: "El nombre es obligatorio" });
    }

    const { rows } = await pool.query(
      `
      INSERT INTO categorias (
        nombre,
        codigo,
        descripcion,
        imagen_base64,
        empresa_id
      )
      VALUES ($1,$2,$3,$4,$5)
      ON CONFLICT (LOWER(nombre), empresa_id)
      DO UPDATE SET
        codigo = COALESCE(EXCLUDED.codigo, categorias.codigo),
        descripcion = COALESCE(EXCLUDED.descripcion, categorias.descripcion),
        imagen_base64 = COALESCE(EXCLUDED.imagen_base64, categorias.imagen_base64)
      RETURNING 
        id,
        nombre,
        codigo,
        descripcion,
        imagen_base64
      `,
      [
        nombre.trim(),
        codigo,
        descripcion,
        imagen_base64,
        empresaId
      ]
    );

    res.status(201).json(rows[0]);
  } catch (e) {
    console.error("POST /categorias", e);
    res.status(500).json({ error: "Error al crear categoría" });
  }
});

app.put("/categorias/:id", requireEmpresa, async (req, res) => {
  try {
    const empresaId = getEmpresaId(req);
    const id = Number(req.params.id);

    const {
      nombre = "",
      codigo = null,
      descripcion = null,
      imagen_base64 = null
    } = req.body || {};

    if (!id) {
      return res.status(400).json({ error: "ID inválido" });
    }

    if (!nombre.trim()) {
      return res.status(400).json({ error: "El nombre es obligatorio" });
    }

    const { rows } = await pool.query(
      `
      UPDATE categorias
      SET
        nombre = $1,
        codigo = $2,
        descripcion = $3,
        imagen_base64 = $4
      WHERE id = $5
        AND empresa_id = $6
      RETURNING 
        id,
        nombre,
        codigo,
        descripcion,
        imagen_base64
      `,
      [
        nombre.trim(),
        codigo,
        descripcion,
        imagen_base64,
        id,
        empresaId
      ]
    );

    if (!rows.length) {
      return res.status(404).json({
        error: "Categoría no encontrada o no pertenece a esta empresa"
      });
    }

    res.json(rows[0]);
  } catch (e) {
    console.error("PUT /categorias/:id", e);
    res.status(500).json({ error: "Error al actualizar categoría" });
  }
});

app.delete("/categorias/:id", requireEmpresa, async (req, res) => {
  try {
    const empresaId = getEmpresaId(req);
    const id = Number(req.params.id);

    if (!id) {
      return res.status(400).json({ error: "ID inválido" });
    }

    const { rowCount } = await pool.query(
      `
      DELETE FROM categorias
      WHERE id = $1
        AND empresa_id = $2
      `,
      [id, empresaId]
    );

    if (!rowCount) {
      return res.status(404).json({
        error: "Categoría no encontrada o no pertenece a esta empresa"
      });
    }

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
  codigo TEXT NULL,
  nombre TEXT NOT NULL,
  descripcion TEXT NULL,
  marca TEXT NULL,
  precio NUMERIC(12,2) DEFAULT 0,
  costo  NUMERIC(12,2) DEFAULT 0,
  stock INTEGER DEFAULT 0,
  categoria_id INTEGER NULL REFERENCES categorias(id) ON DELETE SET NULL,
  imagen TEXT NULL,
  imagen_base64 TEXT NULL,
  empresa_id INTEGER REFERENCES empresas(id)
*/

async function resolveCategoriaId(client, categoria_id, categoria_nombre, empresaId) {
  const maybeId = Number(categoria_id);

  if (Number.isInteger(maybeId) && maybeId > 0) {
    const check = await client.query(
      `
      SELECT id
      FROM categorias
      WHERE id = $1
        AND empresa_id = $2
      LIMIT 1
      `,
      [maybeId, empresaId]
    );

    if (check.rowCount) {
      return maybeId;
    }

    return null;
  }

  const name = (categoria_nombre || "").trim();

  if (!name) {
    return null;
  }

  const sel = await client.query(
    `
    SELECT id
    FROM categorias
    WHERE TRIM(LOWER(nombre)) = TRIM(LOWER($1))
      AND empresa_id = $2
    LIMIT 1
    `,
    [name, empresaId]
  );

  if (sel.rowCount) {
    return sel.rows[0].id;
  }

  const ins = await client.query(
    `
    INSERT INTO categorias (
      nombre,
      empresa_id
    )
    VALUES ($1,$2)
    RETURNING id
    `,
    [name, empresaId]
  );

  return ins.rows[0].id;
}

function toNumber(n, def = 0) {
  const v = Number(n);
  return Number.isFinite(v) ? v : def;
}
// ---------- GET /productos ----------
app.get("/productos", requireEmpresa, async (req, res) => {
  try {
    const empresaId = getEmpresaId(req);
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
          LEFT JOIN categorias c 
            ON c.id = p.categoria_id
           AND c.empresa_id = $2
          WHERE p.empresa_id = $2
            AND COALESCE(p.activo, true) = true
            AND (
              LOWER(COALESCE(p.nombre, '')) LIKE '%' || $1 || '%'
              OR LOWER(COALESCE(p.codigo, '')) LIKE '%' || $1 || '%'
              OR LOWER(COALESCE(p.marca, '')) LIKE '%' || $1 || '%'
              OR LOWER(COALESCE(c.nombre, '')) LIKE '%' || $1 || '%'
            )
          ORDER BY p.nombre ASC
          `,
          [buscar, empresaId]
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
          LEFT JOIN categorias c 
            ON c.id = p.categoria_id
           AND c.empresa_id = $1
          WHERE p.empresa_id = $1
            AND COALESCE(p.activo, true) = true
          ORDER BY p.nombre ASC
          `,
          [empresaId]
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
app.post("/productos", requireEmpresa, upload.single("imagen"), async (req, res) => {
  const empresaId = getEmpresaId(req);

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

    const catId = await resolveCategoriaId(
      client,
      categoria_id,
      categoria,
      empresaId
    );

    let imagenPathOrBase64 = null;

    if (req.file) {
      imagenPathOrBase64 = `/uploads/${req.file.filename}`;
    } else if (imagen_base64 && String(imagen_base64).startsWith("data:")) {
      imagenPathOrBase64 = saveDataUrlToFile(imagen_base64, "prod");
    }

    const insertSql = `
      INSERT INTO productos (
        codigo,
        nombre,
        descripcion,
        marca,
        precio,
        costo,
        stock,
        categoria_id,
        imagen,
        empresa_id
      )
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
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
      imagenPathOrBase64,
      empresaId
    ];

    const r = await client.query(insertSql, params);

    if (catId) {
      await client.query(
        `
        UPDATE categorias c
        SET
          codigo = COALESCE(c.codigo, $1),
          imagen_base64 = COALESCE(c.imagen_base64, $2)
        WHERE c.id = $3
          AND c.empresa_id = $4
        `,
        [
          codigo || null,
          imagenPathOrBase64 || null,
          catId,
          empresaId
        ]
      );
    }

    await client.query("COMMIT");

    res.status(201).json({
      id: r.rows[0].id
    });

  } catch (e) {
    await client.query("ROLLBACK");
    console.error("POST /productos", e);
    res.status(500).json({
      error: "Error al crear producto"
    });
  } finally {
    client.release();
  }
});
// ---------- PUT /productos/:id ----------
app.put("/productos/:id", requireEmpresa, upload.single("imagen"), async (req, res) => {
  const empresaId = getEmpresaId(req);
  const id = Number(req.params.id);

  if (!id) {
    return res.status(400).json({ error: "ID inválido" });
  }

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

    const catId = await resolveCategoriaId(
      client,
      categoria_id,
      categoria,
      empresaId
    );

    let idx = 1;
    const sets = [];
    const values = [];

    sets.push(`codigo=$${idx++}`);
    values.push(codigo || null);

    if (String(nombre || "").trim()) {
      sets.push(`nombre=$${idx++}`);
      values.push(String(nombre).trim());
    }

    sets.push(`descripcion=$${idx++}`);
    values.push(descripcion || null);

    sets.push(`marca=$${idx++}`);
    values.push(marca || null);

    sets.push(`precio=$${idx++}`);
    values.push(toNumber(precio, 0));

    sets.push(`costo=$${idx++}`);
    values.push(toNumber(costo, 0));

    sets.push(`stock=$${idx++}`);
    values.push(Number.parseInt(stock, 10) || 0);

    sets.push(`categoria_id=$${idx++}`);
    values.push(catId);

    let nuevaImg = null;

    if (req.file) {
      nuevaImg = `/uploads/${req.file.filename}`;
    } else if (imagen_base64 && String(imagen_base64).startsWith("data:")) {
      nuevaImg = saveDataUrlToFile(imagen_base64, "prod");
    }

    if (nuevaImg) {
      sets.push(`imagen=$${idx++}`);
      values.push(nuevaImg);
    }

    values.push(id);
    const idParam = idx++;

    values.push(empresaId);
    const empresaParam = idx++;

    const q = `
      UPDATE productos
      SET ${sets.join(", ")}
      WHERE id = $${idParam}
        AND empresa_id = $${empresaParam}
      RETURNING id
    `;

    const { rows } = await client.query(q, values);

    if (!rows.length) {
      await client.query("ROLLBACK");
      return res.status(404).json({
        error: "Producto no encontrado o no pertenece a esta empresa"
      });
    }

    if (catId) {
      await client.query(
        `
        UPDATE categorias c
        SET
          codigo = COALESCE(c.codigo, $1),
          imagen_base64 = COALESCE(c.imagen_base64, $2)
        WHERE c.id = $3
          AND c.empresa_id = $4
        `,
        [
          codigo || null,
          nuevaImg || null,
          catId,
          empresaId
        ]
      );
    }

    await client.query("COMMIT");

    res.json({
      ok: true,
      id
    });

  } catch (e) {
    await client.query("ROLLBACK");
    console.error("PUT /productos/:id", e);
    res.status(500).json({
      error: "Error al actualizar producto"
    });
  } finally {
    client.release();
  }
});

// ---------- DELETE /productos/:id ----------
app.delete("/productos/:id", requireEmpresa, async (req, res) => {
  try {
    const empresaId = getEmpresaId(req);
    const id = Number(req.params.id);

    if (!id) {
      return res.status(400).json({
        ok: false,
        msg: "ID inválido"
      });
    }

    const { rowCount } = await pool.query(
      `
      UPDATE productos
      SET activo = false
      WHERE id = $1
        AND empresa_id = $2
      `,
      [id, empresaId]
    );

    if (!rowCount) {
      return res.status(404).json({
        ok: false,
        msg: "Producto no encontrado o no pertenece a esta empresa"
      });
    }

    return res.json({
      ok: true,
      msg: "Producto desactivado"
    });

  } catch (err) {
    console.error("DELETE /productos/:id error:", err);
    return res.status(500).json({
      ok: false,
      msg: "Error al desactivar"
    });
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
const hoyStr = () => {
  const ahora = new Date();
  // Forzar la fecha en zona horaria America/Asuncion
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Asuncion",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  });
  return formatter.format(ahora);
};

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
      observacion TEXT,
      estado TEXT NOT NULL DEFAULT 'pendiente',
      subtotal NUMERIC(14,2) NOT NULL DEFAULT 0,
      iva NUMERIC(14,2) NOT NULL DEFAULT 0,
      total NUMERIC(14,2) NOT NULL DEFAULT 0,
      empresa_id INTEGER REFERENCES empresas(id),
      creado_en TIMESTAMP DEFAULT NOW()
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS pedidos_prov_items (
      id SERIAL PRIMARY KEY,
      pedido_id INTEGER NOT NULL REFERENCES pedidos_prov(id) ON DELETE CASCADE,
      producto_id INTEGER NOT NULL REFERENCES productos(id),
      descripcion TEXT,
      cantidad INTEGER NOT NULL,
      precio_unit NUMERIC(14,2) NOT NULL,
      total NUMERIC(14,2) NOT NULL,
      empresa_id INTEGER REFERENCES empresas(id)
    );
  `);

  await pool.query(`
    ALTER TABLE pedidos_prov
    ADD COLUMN IF NOT EXISTS empresa_id INTEGER REFERENCES empresas(id)
  `);

  await pool.query(`
    ALTER TABLE pedidos_prov_items
    ADD COLUMN IF NOT EXISTS empresa_id INTEGER REFERENCES empresas(id)
  `);

  await pool.query(`
    ALTER TABLE productos
    ADD COLUMN IF NOT EXISTS alerta BOOLEAN DEFAULT FALSE
  `);

  await pool.query(`
    UPDATE pedidos_prov
    SET empresa_id = 1
    WHERE empresa_id IS NULL
  `);

  await pool.query(`
    UPDATE pedidos_prov_items
    SET empresa_id = 1
    WHERE empresa_id IS NULL
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_pedidos_prov_empresa_id
    ON pedidos_prov(empresa_id)
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_pedidos_prov_items_empresa_id
    ON pedidos_prov_items(empresa_id)
  `);
}

await bootstrapPedidos(pool);

async function generarPDFPedido(pool, pedidoId, empresaId) {

  // =====================================================
  // PEDIDO
  // =====================================================

  const { rows: pr } = await pool.query(
    `
    SELECT *
    FROM pedidos_prov
    WHERE id = $1
      AND empresa_id = $2
    LIMIT 1
    `,
    [pedidoId, empresaId]
  );

  if (!pr.length) return null;

  const pedido = pr[0];

  // =====================================================
  // EMPRESA
  // =====================================================

  const { rows: empr } = await pool.query(
    `
    SELECT
      nombre,
      logo
    FROM empresas
    WHERE id = $1
    LIMIT 1
    `,
    [empresaId]
  );

  const empresa = empr[0] || {};

  // =====================================================
  // PROVEEDOR
  // =====================================================

  const { rows: provr } = await pool.query(
    `
    SELECT
      nombre,
      ruc,
      contacto,
      email,
      telefono
    FROM proveedores
    WHERE id = $1
      AND empresa_id = $2
    LIMIT 1
    `,
    [pedido.proveedor_id, empresaId]
  );

  const prov = provr[0] || {};

  // =====================================================
  // ITEMS
  // =====================================================

  const { rows: items } = await pool.query(
    `
    SELECT
      i.*,
      p.nombre,
      p.codigo
    FROM pedidos_prov_items i

    LEFT JOIN productos p
      ON p.id = i.producto_id
     AND p.empresa_id = $2

    WHERE i.pedido_id = $1
      AND i.empresa_id = $2

    ORDER BY i.id ASC
    `,
    [pedidoId, empresaId]
  );

  // =====================================================
  // PDF
  // =====================================================

  const pdfName = `pedido_${empresaId}_${pedidoId}.pdf`;

  const outPath = path.join(
    PDF_DIR,
    pdfName
  );

  const doc = new PDFDocument({
    size: "A4",
    margin: 40
  });

  const stream = fs.createWriteStream(outPath);

  doc.pipe(stream);

  // =====================================================
  // COLORES
  // =====================================================

  const COLOR_PRIMARY = "#2563eb";
  const COLOR_SECONDARY = "#64748b";
  const COLOR_BORDER = "#cbd5e1";
  const COLOR_LIGHT = "#f1f5f9";
  const COLOR_TEXT = "#1e293b";

  // =====================================================
  // HEADER
  // =====================================================

  doc
    .rect(0, 0, 595, 110)
    .fill("#eff6ff");

  // =====================================================
  // LOGO
  // =====================================================

  if (empresa.logo) {

    try {

      const cleanLogo = empresa.logo
        .replace(/^\/+/, "")
        .replace("uploads/", "");

      const logoPath = path.join(
        __dirname,
        "public",
        "uploads",
        cleanLogo
      );

      if (fs.existsSync(logoPath)) {

        doc.image(
          logoPath,
          40,
          25,
          {
            fit: [90, 90],
            align: "left"
          }
        );

      }

    } catch (e) {

      console.error(
        "Error cargando logo:",
        e.message
      );

    }

  }

  // =====================================================
  // TITULO
  // =====================================================

  doc
    .fillColor(COLOR_PRIMARY)
    .font("Helvetica-Bold")
    .fontSize(24)
    .text(
      empresa.nombre || "EMPRESA",
      150,
      30
    );

  doc
    .fillColor(COLOR_SECONDARY)
    .fontSize(16)
    .text(
      "ORDEN DE COMPRA",
      150,
      60
    );

  // =====================================================
  // DATOS PEDIDO
  // =====================================================

  // 🔥 NUEVA FUNCIÓN AUXILIAR PARA FORMATEAR FECHA EN ZONA HORARIA DE PARAGUAY
  const formatFechaPY = (fecha) => {
    if (!fecha) return "-";
    const d = new Date(fecha);
    if (isNaN(d.getTime())) return "-";
    const formatter = new Intl.DateTimeFormat("en-CA", {
      timeZone: "America/Asuncion",
      year: "numeric",
      month: "2-digit",
      day: "2-digit"
    });
    return formatter.format(d);
  };

  doc
    .roundedRect(40, 130, 515, 80, 8)
    .fillAndStroke("#ffffff", COLOR_BORDER);

  doc
    .fillColor(COLOR_TEXT)
    .font("Helvetica-Bold")
    .fontSize(11)
    .text("DATOS DEL PEDIDO", 55, 145);

  doc
    .font("Helvetica")
    .fontSize(10)
    .text(`Pedido N°: ${pedido.id}`, 55, 170)
    .text(
      `Fecha: ${formatFechaPY(pedido.fecha_pedido)}`,
      220,
      170
    );

  // =====================================================
  // PROVEEDOR
  // =====================================================

  doc
    .roundedRect(40, 230, 515, 110, 8)
    .fillAndStroke("#ffffff", COLOR_BORDER);

  doc
    .fillColor(COLOR_PRIMARY)
    .font("Helvetica-Bold")
    .fontSize(12)
    .text("PROVEEDOR", 55, 245);

  doc
    .fillColor(COLOR_TEXT)
    .font("Helvetica")
    .fontSize(10)
    .text(`Nombre: ${prov.nombre || "-"}`, 55, 270)
    .text(`RUC: ${prov.ruc || "-"}`, 55, 288)
    .text(`Contacto: ${prov.contacto || "-"}`, 55, 306)
    .text(`Teléfono: ${prov.telefono || "-"}`, 300, 270)
    .text(`Email: ${prov.email || "-"}`, 300, 288);

  // =====================================================
  // OBSERVACION
  // =====================================================

  let currentY = 360;

  if (pedido.observacion) {

    doc
      .roundedRect(40, currentY, 515, 70, 8)
      .fillAndStroke("#ffffff", COLOR_BORDER);

    doc
      .fillColor(COLOR_PRIMARY)
      .font("Helvetica-Bold")
      .fontSize(11)
      .text("OBSERVACIÓN", 55, currentY + 15);

    doc
      .fillColor(COLOR_TEXT)
      .font("Helvetica")
      .fontSize(10)
      .text(
        pedido.observacion,
        55,
        currentY + 35,
        {
          width: 470
        }
      );

    currentY += 90;

  }

  // =====================================================
  // TABLA HEADER
  // =====================================================

  currentY += 10;

  const startX = 40;

  const cols = [
    35,
    180,
    120,
    60,
    60,
    80
  ];

  const headers = [
    "#",
    "Producto",
    "Descripción",
    "Cant.",
    "Costo",
    "Total"
  ];

  let x = startX;

  headers.forEach((h, i) => {

    doc
      .rect(x, currentY, cols[i], 25)
      .fillAndStroke(COLOR_PRIMARY, COLOR_PRIMARY);

    doc
      .fillColor("#ffffff")
      .font("Helvetica-Bold")
      .fontSize(9)
      .text(
        h,
        x + 5,
        currentY + 8,
        {
          width: cols[i] - 10,
          align: "center"
        }
      );

    x += cols[i];

  });

  currentY += 25;

  // =====================================================
  // ITEMS
  // =====================================================

  items.forEach((it, idx) => {

    if (currentY > 720) {

      doc.addPage();

      currentY = 40;

    }

    const values = [

      String(idx + 1),

      `${it.nombre || ""}${
        it.codigo
          ? " - " + it.codigo
          : ""
      }`,

      it.descripcion || "-",

      String(it.cantidad || 0),

      fmtPY(it.precio_unit || 0),

      fmtPY(it.total || 0)

    ];

    let xx = startX;

    values.forEach((val, i) => {

      doc
        .rect(xx, currentY, cols[i], 24)
        .fillAndStroke(
          idx % 2 === 0
            ? "#ffffff"
            : COLOR_LIGHT,
          COLOR_BORDER
        );

      doc
        .fillColor(COLOR_TEXT)
        .font("Helvetica")
        .fontSize(9)
        .text(
          String(val),
          xx + 4,
          currentY + 7,
          {
            width: cols[i] - 8,
            align: i >= 3 ? "right" : "left"
          }
        );

      xx += cols[i];

    });

    currentY += 24;

  });

  // =====================================================
  // TOTALES
  // =====================================================

  currentY += 20;

  const totalBoxX = 340;

  doc
    .roundedRect(totalBoxX, currentY, 215, 80, 8)
    .fillAndStroke("#ffffff", COLOR_BORDER);

  doc
    .fillColor(COLOR_TEXT)
    .font("Helvetica")
    .fontSize(10)
    .text("Subtotal:", totalBoxX + 15, currentY + 15)
    .text(
      fmtPY(pedido.subtotal || 0),
      totalBoxX + 100,
      currentY + 15,
      {
        width: 90,
        align: "right"
      }
    );

  doc
    .text("IVA 10%:", totalBoxX + 15, currentY + 35)
    .text(
      fmtPY(pedido.iva || 0),
      totalBoxX + 100,
      currentY + 35,
      {
        width: 90,
        align: "right"
      }
    );

  doc
    .font("Helvetica-Bold")
    .fontSize(12)
    .fillColor(COLOR_PRIMARY)
    .text("TOTAL:", totalBoxX + 15, currentY + 58)
    .text(
      fmtPY(pedido.total || 0),
      totalBoxX + 100,
      currentY + 58,
      {
        width: 90,
        align: "right"
      }
    );

  // =====================================================
  // FOOTER
  // =====================================================

  doc
    .fillColor(COLOR_SECONDARY)
    .fontSize(9)
    .font("Helvetica")
    .text(
      `Documento generado automáticamente • ${empresa.nombre || "EMPRESA"}`,
      40,
      780,
      {
        align: "center",
        width: 515
      }
    );

  // =====================================================
  // FINALIZAR
  // =====================================================

  doc.end();

  return new Promise((resolve) => {

    stream.on("finish", () => {

      resolve({
        file: pdfName,
        path: outPath,
        fullPath: outPath
      });

    });

  });

}
/* ---------- Helpers estado ---------- */
function normalizeOutPedidoRow(p) {
  return {
    id: p.id,
    fecha: p.fecha_pedido,
    proveedor_id: p.proveedor_id,
    proveedor_nombre: p.proveedor_nombre || p.nombre_proveedor || null,
    estado: (p.estado || "pendiente").replace(/^\w/, c => c.toUpperCase()),
    subtotal: p.subtotal,
    iva: p.iva,
    total: p.total,
    total_estimado: p.total
  };
}

app.get("/pedidos", requireEmpresa, async (req, res) => {
  try {
    const empresaId = getEmpresaId(req);

    const { rows: pedidos } = await pool.query(
      `
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
      LEFT JOIN proveedores pr 
        ON pr.id = p.proveedor_id
       AND pr.empresa_id = $1
      WHERE p.empresa_id = $1
      ORDER BY p.id DESC
      `,
      [empresaId]
    );

    for (let p of pedidos) {
      const { rows: items } = await pool.query(
        `
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
        LEFT JOIN productos prod 
          ON prod.id = i.producto_id
         AND prod.empresa_id = $2
        LEFT JOIN categorias cat 
          ON cat.id = prod.categoria_id
         AND cat.empresa_id = $2
        WHERE i.pedido_id = $1
          AND i.empresa_id = $2
        ORDER BY i.id
        `,
        [p.id, empresaId]
      );

      p.items = items;
    }

    res.json(pedidos);

  } catch (err) {
    console.error("GET /pedidos", err);
    res.status(500).json({ error: "Error obteniendo pedidos" });
  }
});


/* ---------- LISTAR pedidos + ítems embebidos ---------- */
app.get("/api/pedidos", requireEmpresa, async (req, res) => {
  try {

    const empresaId = getEmpresaId(req);

    // === 1) PEDIDOS ===
    const { rows: pedidos } = await pool.query(
      `
      SELECT 
        p.id,
        p.proveedor_id,

        pr.nombre AS proveedor_nombre,

        -- NUEVO
        pr.email AS proveedor_email,

        p.fecha_pedido,
        p.fecha_recepcion,
        p.subtotal,
        p.iva,
        p.total

      FROM pedidos_prov p

      LEFT JOIN proveedores pr 
        ON pr.id = p.proveedor_id
       AND pr.empresa_id = $1

      WHERE p.empresa_id = $1

      ORDER BY p.id DESC
      `,
      [empresaId]
    );

    // === 2) ITEMS con PRODUCTO y CATEGORÍA ===
    const { rows: items } = await pool.query(
      `
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

      LEFT JOIN productos prod 
        ON prod.id = i.producto_id
       AND prod.empresa_id = $1

      LEFT JOIN categorias cat 
        ON cat.id = prod.categoria_id
       AND cat.empresa_id = $1

      WHERE i.empresa_id = $1

      ORDER BY i.pedido_id, i.id
      `,
      [empresaId]
    );

    // === 3) Agrupar items por pedido ===
    const itemsByPedido = items.reduce((acc, it) => {

      (acc[it.pedido_id] ||= []).push({
        id: it.id,
        producto_id: it.producto_id,

        producto_nombre:
          it.producto_nombre || "¿?",

        categoria_nombre:
          it.categoria_nombre || "Sin categoría",

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

      // NUEVO
      proveedor_email:
        p.proveedor_email || "",

      items:
        itemsByPedido[p.id] || []
    }));

    res.json(response);

  } catch (error) {

    console.error("GET /api/pedidos", error);

    res.status(500).json({
      error: "Error al listar pedidos"
    });
  }
});
/* ---------- OBTENER pedido por id (con ítems) ---------- */
async function getPedidoFull(id, empresaId) {
  const { rows } = await pool.query(
    `
    SELECT 
      p.*,
      pr.nombre AS proveedor_nombre
    FROM pedidos_prov p
    LEFT JOIN proveedores pr 
      ON pr.id = p.proveedor_id
     AND pr.empresa_id = $2
    WHERE p.id = $1
      AND p.empresa_id = $2
    LIMIT 1
    `,
    [id, empresaId]
  );

  if (!rows.length) return null;

  const base = normalizeOutPedidoRow(rows[0]);

  const { rows: items } = await pool.query(
    `
    SELECT 
      i.*,
      prod.nombre AS producto_nombre
    FROM pedidos_prov_items i
    LEFT JOIN productos prod 
      ON prod.id = i.producto_id
     AND prod.empresa_id = $2
    WHERE i.pedido_id = $1
      AND i.empresa_id = $2
    ORDER BY i.id
    `,
    [id, empresaId]
  );

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

app.get("/api/pedidos/:id", requireEmpresa, async (req, res) => {
  const id = Number(req.params.id);
  const empresaId = getEmpresaId(req);

  try {
    const p = await getPedidoFull(id, empresaId);

    if (!p) {
      return res.status(404).json({
        error: "Pedido no encontrado o no pertenece a esta empresa"
      });
    }

    res.json(p);
  } catch (e) {
    console.error("GET /api/pedidos/:id", e);
    res.status(500).json({
      error: "Error al obtener pedido"
    });
  }
});
/* ---------- CREAR pedido (y PDF) ---------- */
app.post("/api/pedidos", requireEmpresa, async (req, res) => {

  const empresaId = getEmpresaId(req);

  const {
    proveedor_id,
    fecha_pedido,
    observacion,
    items,
    enviar_email 
  } = req.body || {};

  if (!proveedor_id || !Array.isArray(items) || !items.length) {
    return res.status(400).json({
      ok: false,
      msg: "Proveedor e ítems son obligatorios."
    });
  }

  const client = await pool.connect();

  try {

    await client.query("BEGIN");

    const provQ = await client.query(
      `SELECT id FROM proveedores
       WHERE id = $1 AND empresa_id = $2 LIMIT 1`,
      [proveedor_id, empresaId]
    );

    if (!provQ.rowCount) {
      await client.query("ROLLBACK");
      return res.status(404).json({
        ok: false,
        msg: "Proveedor no encontrado o no pertenece a esta empresa"
      });
    }

    const fechaPedidoFinal = fecha_pedido || hoyStr();

    const { rows: rp } = await client.query(
      `INSERT INTO pedidos_prov (
        proveedor_id, fecha_pedido, fecha_recepcion,
        observacion, estado, empresa_id
       )
       VALUES ($1, $2, NULL, $3, 'pendiente', $4)
       RETURNING id`,
      [proveedor_id, fechaPedidoFinal, observacion || "", empresaId]
    );

    const pedidoId = rp[0].id;
    let subtotal = 0;

    for (const it of items) {

      const productoId = Number(it.producto_id || 0);
      const cantidad = Number(it.cantidad || 0);
      const precioUnit = Number(it.costo_estimado ?? it.precio_unit ?? 0);

      if (!productoId || cantidad <= 0 || precioUnit < 0) {
        await client.query("ROLLBACK");
        return res.status(400).json({
          ok: false,
          msg: "Ítem inválido en el pedido"
        });
      }

      const prodQ = await client.query(
        `SELECT id FROM productos
         WHERE id = $1 AND empresa_id = $2
         AND COALESCE(activo, true) = true LIMIT 1`,
        [productoId, empresaId]
      );

      if (!prodQ.rowCount) {
        await client.query("ROLLBACK");
        return res.status(404).json({
          ok: false,
          msg: `Producto ${productoId} no encontrado o no pertenece a esta empresa`
        });
      }

      const totalLinea = cantidad * precioUnit;
      subtotal += totalLinea;

      await client.query(
        `INSERT INTO pedidos_prov_items (
          pedido_id, producto_id, descripcion,
          cantidad, precio_unit, total, empresa_id
         )
         VALUES ($1,$2,$3,$4,$5,$6,$7)`,
        [pedidoId, productoId, it.descripcion || "",
         cantidad, precioUnit, totalLinea, empresaId]
      );
    }

    const iva = Math.round(subtotal * 0.10);
    const total = subtotal + iva;

    await client.query(
      `UPDATE pedidos_prov
       SET subtotal = $1, iva = $2, total = $3
       WHERE id = $4 AND empresa_id = $5`,
      [subtotal, iva, total, pedidoId, empresaId]
    );

    await client.query("COMMIT");

    /* =========================================================
       GENERAR PDF
    ========================================================= */
    const pdf = await generarPDFPedido(pool, pedidoId, empresaId);

   
    res.status(201).json({
      ok: true,
      pedidoId,
      pdf_file: pdf?.file
    });

    /* =========================================================
       ENVIAR EMAIL EN SEGUNDO PLANO (no bloquea la respuesta)
    ========================================================= */
    if (!enviar_email) return; // si no pidió enviar, terminamos

    // Obtener datos del proveedor + empresa
    const { rows: provRows } = await pool.query(
      `SELECT
        pr.nombre, pr.email,
        e.nombre AS empresa_nombre,
        e.smtp_host, e.smtp_port, e.smtp_secure,
        e.smtp_user, e.smtp_pass, e.smtp_from
       FROM proveedores pr
       INNER JOIN empresas e ON e.id = pr.empresa_id
       WHERE pr.id = $1 AND pr.empresa_id = $2 LIMIT 1`,
      [proveedor_id, empresaId]
    );

    const provData = provRows[0];

    if (!provData?.email || !provData?.smtp_user || !provData?.smtp_pass) return;


    nodemailer.createTransport({
      host: "smtp.gmail.com",
      port: 587,
      secure: false,
      requireTLS: true,
      tls: { rejectUnauthorized: false, family: 4 },
      auth: { user: provData.smtp_user, pass: provData.smtp_pass }
    })
    .sendMail({
      from: `"${provData.empresa_nombre}" <${provData.smtp_from || provData.smtp_user}>`,
      to: provData.email,
      subject: `Pedido #${pedidoId}`,
      html: `
        <div style="font-family:Arial,sans-serif">
          <h2>Orden de Compra</h2>
          <p>Hola ${provData.nombre || ""}.</p>
          <p>Adjuntamos el pedido N° <b>#${pedidoId}</b>.</p>
          <p>Favor revisar el PDF adjunto.</p>
        </div>
      `,
      attachments: [{
        filename: `pedido_${pedidoId}.pdf`,
        path: pdf?.fullPath || pdf?.path || pdf?.file
      }]
    })
    .then(() => console.log("Pedido enviado al proveedor:", provData.email))
    .catch(err => console.error("ERROR ENVIANDO EMAIL:", err));

  } catch (e) {

    await client.query("ROLLBACK");
    console.error("POST /api/pedidos ERROR:", e);

    res.status(500).json({
      ok: false,
      msg: "No se pudo crear el pedido"
    });

  } finally {
    client.release();
  }
});
/* ---------- CAMBIAR estado genérico ---------- */
app.put("/api/pedidos/:id/estado", requireEmpresa, async (req, res) => {
  const empresaId = getEmpresaId(req);
  const id = Number(req.params.id);
  const { estado } = req.body || {};

  const valid = ["pendiente", "enviado", "recibido", "cancelado"];

  if (!id) {
    return res.status(400).json({ ok: false, msg: "ID inválido" });
  }

  if (!valid.includes(estado)) {
    return res.status(400).json({ ok: false, msg: "Estado inválido" });
  }

  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    const { rows: prs } = await client.query(
      `
      SELECT estado
      FROM pedidos_prov
      WHERE id = $1
        AND empresa_id = $2
      LIMIT 1
      `,
      [id, empresaId]
    );

    if (!prs.length) {
      await client.query("ROLLBACK");
      return res.status(404).json({
        ok: false,
        msg: "Pedido no encontrado o no pertenece a esta empresa"
      });
    }

    const prev = prs[0].estado;

    await client.query(
      `
      UPDATE pedidos_prov
      SET estado = $1,
          fecha_recepcion = CASE WHEN $1 = 'recibido' THEN NOW() ELSE NULL END
      WHERE id = $2
        AND empresa_id = $3
      `,
      [estado, id, empresaId]
    );

    if (estado === "recibido" && prev !== "recibido") {
      const { rows: items } = await client.query(
        `
        SELECT *
        FROM pedidos_prov_items
        WHERE pedido_id = $1
          AND empresa_id = $2
        `,
        [id, empresaId]
      );

      for (const it of items) {
        const { rows: prd } = await client.query(
          `
          SELECT stock, costo
          FROM productos
          WHERE id = $1
            AND empresa_id = $2
          LIMIT 1
          `,
          [it.producto_id, empresaId]
        );

        if (!prd.length) continue;

        const stockAnterior = Number(prd[0].stock || 0);
        const costoAnterior = Number(prd[0].costo || 0);
        const nuevoStock = stockAnterior + Number(it.cantidad || 0);

        const nuevoCosto = costoPromedio(
          costoAnterior,
          stockAnterior,
          Number(it.precio_unit || 0),
          Number(it.cantidad || 0)
        );

        await client.query(
          `
          UPDATE productos
          SET stock = $1,
              costo = $2
          WHERE id = $3
            AND empresa_id = $4
          `,
          [nuevoStock, nuevoCosto, it.producto_id, empresaId]
        );
      }

      await client.query(
        `
        UPDATE productos
        SET alerta = (stock <= 3)
        WHERE empresa_id = $1
        `,
        [empresaId]
      );
    }

    await client.query("COMMIT");
    res.json({ ok: true });

  } catch (e) {
    await client.query("ROLLBACK");
    console.error("PUT /api/pedidos/:id/estado", e);
    res.status(500).json({ ok: false, msg: "No se pudo cambiar el estado" });
  } finally {
    client.release();
  }
});


app.get("/api/formas-pago", requireEmpresa, async (req, res) => {
  try {
    const empresaId = getEmpresaId(req);

    const { rows } = await pool.query(
      `
      SELECT id, nombre, tipo
      FROM formas_pago
      WHERE empresa_id = $1
      ORDER BY id
      `,
      [empresaId]
    );

    res.json(rows);

  } catch (err) {
    console.error(err);

    res.status(500).json({
      error: "Error cargando formas de pago"
    });
  }
});



/* ---------- PDF ---------- */
app.get("/api/pedidos/:id/pdf", requireEmpresa, async (req, res) => {
  const empresaId = getEmpresaId(req);
  const id = Number(req.params.id);

  const pdfName = `pedido_${empresaId}_${id}.pdf`;
  const full = path.join(PDF_DIR, pdfName);

  if (!fs.existsSync(full)) {
    await generarPDFPedido(pool, id, empresaId);
  }

  if (!fs.existsSync(full)) {
    return res.status(404).send("PDF no encontrado");
  }

  res.setHeader("Content-Type", "application/pdf");
  res.sendFile(full);
});

/* ==================== RUTAS DE COMPATIBILIDAD (legacy) ===================== */

// Front antiguo: POST /pedidos (crear)
app.post("/pedidos", requireEmpresa, (req, res) => {
  req.url = "/api/pedidos";
  req.method = "POST";
  app._router.handle(req, res);
});

// Front antiguo: GET /pedidos/:id (detalle)
app.get("/pedidos/:id", requireEmpresa, async (req, res) => {
  const empresaId = getEmpresaId(req);
  const id = Number(req.params.id);

  try {
    const data = await getPedidoFull(id, empresaId);

    if (!data) {
      return res.status(404).json({
        error: "Pedido no encontrado o no pertenece a esta empresa"
      });
    }

    res.json(data);
  } catch (e) {
    console.error("GET /pedidos/:id", e);
    res.status(500).json({ error: "Error al obtener pedido" });
  }
});

app.post("/pedidos/:id/enviar", requireEmpresa, async (req, res) => {
  const empresaId = getEmpresaId(req);
  const id = Number(req.params.id);

  try {
    const { rowCount } = await pool.query(
      `
      UPDATE pedidos_prov
      SET estado = 'enviado',
          fecha_recepcion = NULL
      WHERE id = $1
        AND empresa_id = $2
      `,
      [id, empresaId]
    );

    if (!rowCount) {
      return res.status(404).json({
        error: "Pedido no encontrado o no pertenece a esta empresa"
      });
    }

    res.json({ ok: true });
  } catch (e) {
    console.error("POST /pedidos/:id/enviar", e);
    res.status(500).json({ error: "No se pudo enviar el pedido" });
  }
});

// Front antiguo: PUT /api/pedidos/:id/recibir
app.put("/api/pedidos/:id/recibir", requireEmpresa, async (req, res) => {
  const empresaId = getEmpresaId(req);
  const id = Number(req.params.id);

  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    const call = await client.query(
      `
      SELECT estado, total
      FROM pedidos_prov
      WHERE id = $1
        AND empresa_id = $2
      LIMIT 1
      `,
      [id, empresaId]
    );

    if (!call.rowCount) {
      await client.query("ROLLBACK");
      return res.status(404).json({
        error: "Pedido no encontrado o no pertenece a esta empresa"
      });
    }

    if (call.rows[0].estado !== "recibido") {
      const { rows: items } = await client.query(
        `
        SELECT *
        FROM pedidos_prov_items
        WHERE pedido_id = $1
          AND empresa_id = $2
        `,
        [id, empresaId]
      );

      for (const it of items) {
        const { rows: prd } = await client.query(
          `
          SELECT stock, costo
          FROM productos
          WHERE id = $1
            AND empresa_id = $2
          LIMIT 1
          `,
          [it.producto_id, empresaId]
        );

        if (!prd.length) continue;

        const stockAnterior = Number(prd[0].stock || 0);
        const costoAnterior = Number(prd[0].costo || 0);
        const nuevoStock = stockAnterior + Number(it.cantidad || 0);

        const nuevoCosto = costoPromedio(
          costoAnterior,
          stockAnterior,
          Number(it.precio_unit || 0),
          Number(it.cantidad || 0)
        );

        await client.query(
          `
          UPDATE productos
          SET stock = $1,
              costo = $2
          WHERE id = $3
            AND empresa_id = $4
          `,
          [nuevoStock, nuevoCosto, it.producto_id, empresaId]
        );
      }

      await client.query(
        `
        UPDATE productos
        SET alerta = (stock <= 3)
        WHERE empresa_id = $1
        `,
        [empresaId]
      );

      await client.query(
        `
        UPDATE pedidos_prov
        SET estado = 'recibido',
            fecha_recepcion = NOW()
        WHERE id = $1
          AND empresa_id = $2
        `,
        [id, empresaId]
      );
    }

    await client.query("COMMIT");

    res.json({
      ok: true,
      compra_generada: id,
      total: call.rows[0].total
    });

  } catch (e) {
    await client.query("ROLLBACK");
    console.error("PUT /api/pedidos/:id/recibir", e);
    res.status(500).json({ error: "No se pudo recibir el pedido" });
  } finally {
    client.release();
  }
});
// Front antiguo: PDF
app.get("/pedidos/:id/pdf", requireEmpresa, (req, res) => {
  const id = Number(req.params.id);
  req.url = `/api/pedidos/${id}/pdf`;
  app._router.handle(req, res);
});

/* =================== FIN PEDIDOS A PROVEEDOR (BACKEND) =================== */

/* ----------------------------------- Health --------------------------------- */
app.get("/health", (_req, res) => res.json({ ok: true }));

/* ----------------------------------- Server --------------------------------- */


app.get("/compras/proxima-factura", requireEmpresa, async (req, res) => {
  try {
    const empresaId = getEmpresaId(req);
    const proveedor_id = Number(req.query.proveedor_id || 0);

    if (!proveedor_id) {
      return res.status(400).json({
        ok: false,
        msg: "Falta proveedor_id"
      });
    }

    const provQ = await pool.query(
      `
      SELECT id
      FROM proveedores
      WHERE id = $1
        AND empresa_id = $2
      LIMIT 1
      `,
      [proveedor_id, empresaId]
    );

    if (!provQ.rowCount) {
      return res.status(404).json({
        ok: false,
        msg: "Proveedor no encontrado o no pertenece a esta empresa"
      });
    }

    const lastQ = await pool.query(
      `
      SELECT factura
      FROM compras
      WHERE proveedor_id = $1
        AND empresa_id = $2
        AND factura IS NOT NULL
        AND TRIM(factura) <> ''
      ORDER BY id DESC
      LIMIT 1
      `,
      [proveedor_id, empresaId]
    );

    const last = (lastQ.rows[0]?.factura || "").toString().trim();

    if (!last) {
      return res.json({
        ok: true,
        factura: "0001",
        last: null
      });
    }

    const m = last.match(/(\d+)\s*$/);

    if (!m) {
      return res.json({
        ok: true,
        factura: `${last}-1`,
        last
      });
    }

    const digits = m[1];
    const prefix = last.slice(0, last.length - digits.length);
    const next = String(Number(digits) + 1).padStart(digits.length, "0");

    return res.json({
      ok: true,
      factura: `${prefix}${next}`,
      last
    });

  } catch (err) {
    console.error("GET /compras/proxima-factura", err);

    return res.status(500).json({
      ok: false,
      msg: "Error generando próxima factura"
    });
  }
});

app.get("/compras", requireEmpresa, async (req, res) => {
  try {
    const empresaId = getEmpresaId(req);

    const { rows } = await pool.query(
      `
      SELECT 
        c.id,
        c.fecha,
        c.factura,
        c.subtotal,
        c.iva,
        c.total,
        c.subtotal_moneda,
        c.iva_moneda,
        c.total_moneda,
        c.moneda,
        c.tipo_cambio,
        c.proveedor_id,
        c.tipo_pago,
        p.nombre AS proveedor_nombre,
        p.ruc AS proveedor_ruc,

        (
          SELECT STRING_AGG(
            COALESCE(pr.codigo, '-'),
            ', '
            ORDER BY pr.codigo
          )
          FROM compras_items ci
          JOIN productos pr 
            ON pr.id = ci.producto_id
           AND pr.empresa_id = $1
          WHERE ci.compra_id = c.id
            AND ci.empresa_id = $1
        ) AS productos,

        (
          SELECT STRING_AGG(
            COALESCE(pr.nombre, 'SIN NOMBRE'),
            ', '
            ORDER BY pr.nombre
          )
          FROM compras_items ci
          JOIN productos pr 
            ON pr.id = ci.producto_id
           AND pr.empresa_id = $1
          WHERE ci.compra_id = c.id
            AND ci.empresa_id = $1
        ) AS nombres_productos,

        (
          SELECT STRING_AGG(
            DISTINCT COALESCE(cat.nombre, 'Sin categoría'),
            ', '
            ORDER BY COALESCE(cat.nombre, 'Sin categoría')
          )
          FROM compras_items ci
          JOIN productos pr 
            ON pr.id = ci.producto_id
           AND pr.empresa_id = $1
          LEFT JOIN categorias cat 
            ON cat.id = pr.categoria_id
           AND cat.empresa_id = $1
          WHERE ci.compra_id = c.id
            AND ci.empresa_id = $1
        ) AS categorias,

        (
          SELECT COALESCE(SUM(ci.cantidad), 0)
          FROM compras_items ci
          WHERE ci.compra_id = c.id
            AND ci.empresa_id = $1
        ) AS cantidad_total,

        (
          SELECT STRING_AGG(
            COALESCE(pr.codigo, '-') || ' - ' ||
            COALESCE(pr.nombre, 'SIN NOMBRE') || ' x' ||
            COALESCE(ci.cantidad::text, '0'),
            ' | '
            ORDER BY pr.nombre
          )
          FROM compras_items ci
          JOIN productos pr 
            ON pr.id = ci.producto_id
           AND pr.empresa_id = $1
          WHERE ci.compra_id = c.id
            AND ci.empresa_id = $1
        ) AS detalle_productos

      FROM compras c
      LEFT JOIN proveedores p 
        ON p.id = c.proveedor_id
       AND p.empresa_id = $1
      WHERE c.empresa_id = $1
      ORDER BY c.id DESC
      `,
      [empresaId]
    );

    res.json(rows);

  } catch (e) {
    console.error("GET /compras", e);
    res.status(500).json({
      error: "Error al listar compras"
    });
  }
});
app.post("/compras", requireEmpresa, async (req, res) => {
  const empresaId = getEmpresaId(req);

  const {
    proveedor_id,
    fecha,
    factura,
    tipo_pago,
    moneda = "PYG",
    tipo_cambio = 1,
    subtotal = 0,
    iva = 0,
    total = 0,
    subtotal_moneda = 0,
    iva_moneda = 0,
    total_moneda = 0,
    items,
    calcular_iva = true   // 🔥 NUEVO FLAG (por defecto true para compras normales)
  } = req.body || {};

  const tipoPagoFinal = normTipoCaja(tipo_pago || "efectivo");
  const monedaFinal = String(moneda || "PYG").trim().toUpperCase();
  const tipoCambioFinal = Number(tipo_cambio || 1);

  if (!proveedor_id || !fecha || !Array.isArray(items) || !items.length) {
    return res.status(400).json({
      ok: false,
      msg: "Proveedor, fecha e ítems son obligatorios"
    });
  }

  if (!["efectivo", "transferencia"].includes(tipoPagoFinal)) {
    return res.status(400).json({
      ok: false,
      msg: "Forma de pago inválida"
    });
  }

  if (!["PYG", "USD", "BRL"].includes(monedaFinal)) {
    return res.status(400).json({
      ok: false,
      msg: "Moneda inválida"
    });
  }

  if (monedaFinal !== "PYG" && (!Number.isFinite(tipoCambioFinal) || tipoCambioFinal <= 0)) {
    return res.status(400).json({
      ok: false,
      msg: "Tipo de cambio inválido"
    });
  }

  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    const provQ = await client.query(
      `
      SELECT id
      FROM proveedores
      WHERE id = $1
        AND empresa_id = $2
      LIMIT 1
      `,
      [proveedor_id, empresaId]
    );

    if (!provQ.rowCount) {
      await client.query("ROLLBACK");
      return res.status(404).json({
        ok: false,
        msg: "Proveedor no encontrado o no pertenece a esta empresa"
      });
    }

    let subtotalPyg = Number(subtotal || 0);

    if (!subtotalPyg || subtotalPyg <= 0) {
      subtotalPyg = 0;

      for (const it of items) {
        subtotalPyg += Number(it.cantidad || 0) * Number(it.costo || 0);
      }
    }

    // 🔥 CÁLCULO DE IVA SEGÚN EL FLAG
    let ivaPyg, totalPyg;
    if (calcular_iva === false) {
      // Sin IVA: usamos el total enviado o el subtotal
      ivaPyg = 0;
      totalPyg = Number(total) || subtotalPyg;
    } else {
      // Con IVA: calculamos el 10%
      ivaPyg = Number(iva || Math.round(subtotalPyg * 0.10));
      totalPyg = Number(total || (subtotalPyg + ivaPyg));
    }

    let subtotalMon = Number(subtotal_moneda || 0);
    let ivaMon = Number(iva_moneda || 0);
    let totalMon = Number(total_moneda || 0);

    if (monedaFinal === "PYG") {
      subtotalMon = subtotalPyg;
      ivaMon = ivaPyg;
      totalMon = totalPyg;
    } else {
      if (!subtotalMon || subtotalMon <= 0) {
        subtotalMon = subtotalPyg / tipoCambioFinal;
      }

      if (!ivaMon || ivaMon <= 0) {
        ivaMon = ivaPyg / tipoCambioFinal;
      }

      if (!totalMon || totalMon <= 0) {
        totalMon = totalPyg / tipoCambioFinal;
      }
    }

    const qCab = await client.query(
      `
      INSERT INTO compras (
        proveedor_id,
        fecha,
        factura,
        tipo_pago,
        moneda,
        tipo_cambio,
        subtotal,
        iva,
        total,
        subtotal_moneda,
        iva_moneda,
        total_moneda,
        empresa_id
      )
      VALUES (
        $1,$2,$3,$4,$5,$6,
        $7,$8,$9,$10,$11,$12,$13
      )
      RETURNING id
      `,
      [
        proveedor_id,
        fecha,
        factura,
        tipoPagoFinal,
        monedaFinal,
        tipoCambioFinal,
        subtotalPyg,
        ivaPyg,
        totalPyg,
        subtotalMon,
        ivaMon,
        totalMon,
        empresaId
      ]
    );

    const compraId = qCab.rows[0].id;

    for (const it of items) {
      const productoId = Number(it.producto_id || 0);

      const prodQ = await client.query(
        `
        SELECT stock, costo
        FROM productos
        WHERE id = $1
          AND empresa_id = $2
        LIMIT 1
        `,
        [productoId, empresaId]
      );

      if (!prodQ.rowCount) {
        await client.query("ROLLBACK");

        return res.status(404).json({
          ok: false,
          msg: `Producto ${productoId} no encontrado o no pertenece a esta empresa`
        });
      }

      await client.query(
        `
        INSERT INTO compras_items (
          compra_id,
          producto_id,
          cantidad,
          costo,
          subtotal,
          empresa_id
        )
        VALUES ($1,$2,$3,$4,$5,$6)
        `,
        [
          compraId,
          productoId,
          it.cantidad,
          it.costo,
          Number(it.cantidad) * Number(it.costo),
          empresaId
        ]
      );

      const sAnt = Number(prodQ.rows[0].stock || 0);
      const cAnt = Number(prodQ.rows[0].costo || 0);
      const sNew = sAnt + Number(it.cantidad);

      const cNew =
        sAnt + Number(it.cantidad) === 0
          ? Number(it.costo)
          : Math.round(
              ((sAnt * cAnt) + (Number(it.cantidad) * Number(it.costo))) /
              (sAnt + Number(it.cantidad))
            );

      await client.query(
        `
        UPDATE productos
        SET stock = $1,
            costo = $2
        WHERE id = $3
          AND empresa_id = $4
        `,
        [sNew, cNew, productoId, empresaId]
      );
    }

    await client.query("COMMIT");

    res.json({
      ok: true,
      compra_id: compraId
    });

  } catch (e) {
    await client.query("ROLLBACK");
    console.error("POST /compras", e);

    res.status(500).json({
      ok: false,
      msg: "Error al registrar compra"
    });

  } finally {
    client.release();
  }
});
app.get("/compras/:id", requireEmpresa, async (req, res) => {
  const empresaId = getEmpresaId(req);
  const id = Number(req.params.id);

  try {
    const cab = await pool.query(
      `
      SELECT 
        c.id,
        c.proveedor_id,
        c.fecha,
        c.factura,
        c.tipo_pago,
        c.moneda,
        c.tipo_cambio,
        c.subtotal,
        c.iva,
        c.total,
        c.subtotal_moneda,
        c.iva_moneda,
        c.total_moneda,
        p.nombre AS proveedor_nombre,
        p.ruc AS proveedor_ruc
      FROM compras c
      LEFT JOIN proveedores p 
        ON p.id = c.proveedor_id
       AND p.empresa_id = $2
      WHERE c.id = $1
        AND c.empresa_id = $2
      LIMIT 1
      `,
      [id, empresaId]
    );

    if (!cab.rowCount) {
      return res.status(404).json({
        ok: false,
        error: "Compra no encontrada o no pertenece a esta empresa"
      });
    }

    const items = await pool.query(
      `
      SELECT 
        ci.id,
        ci.producto_id,
        pr.nombre AS producto_nombre,
        pr.codigo,
        cat.nombre AS categoria_nombre,
        ci.cantidad,
        ci.costo,
        ci.subtotal
      FROM compras_items ci
      LEFT JOIN productos pr 
        ON pr.id = ci.producto_id
       AND pr.empresa_id = $2
      LEFT JOIN categorias cat 
        ON cat.id = pr.categoria_id
       AND cat.empresa_id = $2
      WHERE ci.compra_id = $1
        AND ci.empresa_id = $2
      ORDER BY ci.id
      `,
      [id, empresaId]
    );

    return res.json({
      ok: true,
      ...cab.rows[0],
      items: items.rows
    });

  } catch (e) {
    console.error("GET /compras/:id", e);

    return res.status(500).json({
      ok: false,
      error: "Error al obtener compra"
    });
  }
});

app.put("/compras/:id", requireEmpresa, async (req, res) => {
  const empresaId = getEmpresaId(req);
  const id = Number(req.params.id);

  const {
    proveedor_id,
    fecha,
    factura,
    tipo_pago,
    moneda,
    tipo_cambio,
    items
  } = req.body || {};

  const tipoPagoFinal = normTipoCaja(tipo_pago || "efectivo");
  const monedaFinal = String(moneda || "PYG").toUpperCase();
  const tipoCambioFinal = Number(tipo_cambio || 1);

  if (!id) {
    return res.status(400).json({ ok: false, msg: "ID inválido" });
  }

  if (!proveedor_id) {
    return res.status(400).json({ ok: false, msg: "Falta proveedor_id" });
  }

  if (!fecha) {
    return res.status(400).json({ ok: false, msg: "Falta fecha" });
  }

  if (!Array.isArray(items) || items.length === 0) {
    return res.status(400).json({ ok: false, msg: "No hay items" });
  }

  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    const compraCheck = await client.query(
      `
      SELECT id
      FROM compras
      WHERE id = $1
        AND empresa_id = $2
      LIMIT 1
      `,
      [id, empresaId]
    );

    if (!compraCheck.rowCount) {
      await client.query("ROLLBACK");

      return res.status(404).json({
        ok: false,
        msg: "Compra no encontrada o no pertenece a esta empresa"
      });
    }

    const prevItemsQ = await client.query(
      `
      SELECT producto_id, cantidad
      FROM compras_items
      WHERE compra_id = $1
        AND empresa_id = $2
      `,
      [id, empresaId]
    );

    const prevItems = prevItemsQ.rows || [];

    await client.query(
      `
      DELETE FROM compras_items
      WHERE compra_id = $1
        AND empresa_id = $2
      `,
      [id, empresaId]
    );

    let subtotalCalc = 0;

    for (const it of items) {
      const producto_id = Number(it.producto_id);
      const cantidad = Number(it.cantidad || 0);
      const costo = Number(it.costo || 0);

      if (!producto_id || cantidad <= 0 || costo <= 0) {
        await client.query("ROLLBACK");

        return res.status(400).json({
          ok: false,
          msg: "Item inválido"
        });
      }

      const sub = cantidad * costo;
      subtotalCalc += sub;

      await client.query(
        `
        INSERT INTO compras_items (
          compra_id,
          producto_id,
          cantidad,
          costo,
          subtotal,
          empresa_id
        )
        VALUES ($1,$2,$3,$4,$5,$6)
        `,
        [
          id,
          producto_id,
          cantidad,
          costo,
          sub,
          empresaId
        ]
      );
    }

    const ivaCalc = Math.round(subtotalCalc * 0.10);
    const totalCalc = subtotalCalc + ivaCalc;

    const subtotalMonedaFinal =
      monedaFinal === "PYG"
        ? subtotalCalc
        : subtotalCalc / tipoCambioFinal;

    const ivaMonedaFinal =
      monedaFinal === "PYG"
        ? ivaCalc
        : ivaCalc / tipoCambioFinal;

    const totalMonedaFinal =
      monedaFinal === "PYG"
        ? totalCalc
        : totalCalc / tipoCambioFinal;

    await client.query(
      `
      UPDATE compras
      SET proveedor_id = $1,
          fecha = $2,
          factura = $3,
          tipo_pago = $4,
          moneda = $5,
          tipo_cambio = $6,
          subtotal = $7,
          iva = $8,
          total = $9,
          subtotal_moneda = $10,
          iva_moneda = $11,
          total_moneda = $12
      WHERE id = $13
        AND empresa_id = $14
      `,
      [
        Number(proveedor_id),
        fecha,
        factura || null,
        tipoPagoFinal,
        monedaFinal,
        tipoCambioFinal,
        subtotalCalc,
        ivaCalc,
        totalCalc,
        subtotalMonedaFinal,
        ivaMonedaFinal,
        totalMonedaFinal,
        id,
        empresaId
      ]
    );

    for (const p of prevItems) {
      await client.query(
        `
        UPDATE productos
        SET stock = stock - $1
        WHERE id = $2
          AND empresa_id = $3
        `,
        [
          Number(p.cantidad),
          Number(p.producto_id),
          empresaId
        ]
      );
    }

    for (const it of items) {
      await client.query(
        `
        UPDATE productos
        SET stock = stock + $1,
            costo = $2
        WHERE id = $3
          AND empresa_id = $4
        `,
        [
          Number(it.cantidad),
          Number(it.costo),
          Number(it.producto_id),
          empresaId
        ]
      );
    }

    await client.query("COMMIT");

    return res.json({ ok: true });

  } catch (e) {
    try {
      await client.query("ROLLBACK");
    } catch {}

    console.error("PUT /compras/:id", e);

    return res.status(500).json({
      ok: false,
      msg: "Error actualizando compra",
      error: e.message
    });

  } finally {
    client.release();
  }
});

/* ---------- ELIMINAR PEDIDO ---------- */
app.delete("/api/pedidos/:id", requireEmpresa, async (req, res) => {
  const empresaId = getEmpresaId(req);
  const id = Number(req.params.id);

  try {
    const { rowCount } = await pool.query(
      `
      DELETE FROM pedidos_prov
      WHERE id = $1
        AND empresa_id = $2
      `,
      [id, empresaId]
    );

    if (rowCount === 0) {
      return res.status(404).json({
        ok: false,
        msg: "Pedido no encontrado o no pertenece a esta empresa"
      });
    }

    return res.json({ ok: true });

  } catch (err) {
    console.error("Error eliminando pedido:", err);

    return res.status(500).json({
      ok: false,
      msg: "Error eliminando pedido"
    });
  }
});

app.get("/ventas", requireEmpresa, async (req, res) => {
  try {
    const empresaId = getEmpresaId(req);

    const result = await pool.query(
      `
      SELECT 
        v.id,
        v.fecha,
        v.total,
        v.total_pyg,
        v.total_moneda,
        v.moneda,
        v.tipo_cambio,
        v.estado_pago,
        v.nro_comprobante,

        fp.nombre AS forma_pago_nombre,

        COALESCE(
          c.nombre || ' ' || c.apellido,
          'Consumidor Final'
        ) AS cliente_nombre,

        COALESCE((
          SELECT STRING_AGG(
            p.nombre || ' x' || vi.cantidad,
            ', '
            ORDER BY vi.id
          )
          FROM ventas_items vi
          JOIN productos p
            ON p.id = vi.producto_id
          WHERE vi.venta_id = v.id
            AND vi.empresa_id = $1
        ), '-') AS productos

      FROM ventas v

      LEFT JOIN clientes c
        ON c.id = v.cliente_id

      LEFT JOIN formas_pago fp
        ON fp.id = v.forma_pago_id

      WHERE v.empresa_id = $1

      ORDER BY v.id DESC
      `,
      [empresaId]
    );

    res.json(result.rows);

  } catch (err) {
    console.error("❌ Error listando ventas:", err);

    res.status(500).json({
      ok: false,
      msg: "Error listando ventas"
    });
  }
});
app.post("/ventas", requireEmpresa, async (req, res) => {
  const empresaId = getEmpresaId(req);

  const {
    cliente_id,
    total,
    total_pyg,
    total_moneda,
    moneda,
    tipo_cambio,
    forma_pago_id,
    items,
    estado_pago,
    nro_comprobante,
    fecha,
    banco_nombre
  } = req.body || {};

  const client = await pool.connect();

  try {
    if (!forma_pago_id) {
      return res.status(400).json({
        ok: false,
        msg: "Falta forma_pago_id"
      });
    }

    if (!Array.isArray(items) || items.length === 0) {
      return res.status(400).json({
        ok: false,
        msg: "No hay items"
      });
    }

    const fpId = Number(forma_pago_id);

    const monedaFinal = String(moneda || "PYG").trim().toUpperCase();
    const tipoCambioFinal = Number(tipo_cambio || 1);
    const totalPygFinal = Number(total_pyg || total || 0);
    const totalMonedaFinal = Number(total_moneda || totalPygFinal || 0);
    const totalFinal = totalPygFinal;

    if (!["PYG", "USD", "BRL"].includes(monedaFinal)) {
      return res.status(400).json({
        ok: false,
        msg: "Moneda inválida"
      });
    }

    if (!Number.isFinite(fpId) || fpId <= 0) {
      return res.status(400).json({
        ok: false,
        msg: "forma_pago_id inválido"
      });
    }

    if (!Number.isFinite(totalPygFinal) || totalPygFinal <= 0) {
      return res.status(400).json({
        ok: false,
        msg: "Total inválido"
      });
    }

    if (monedaFinal !== "PYG" && (!Number.isFinite(tipoCambioFinal) || tipoCambioFinal <= 0)) {
      return res.status(400).json({
        ok: false,
        msg: "tipo_cambio inválido"
      });
    }

    console.log("=================================");
    console.log("FORMA PAGO RECIBIDA:");
    console.log("forma_pago_id:", forma_pago_id);
    console.log("fpId:", fpId);
    console.log("empresaId:", empresaId);

    const debugFormas = await client.query(`
      SELECT id, nombre, empresa_id
      FROM formas_pago
      ORDER BY id
    `);
    console.table(debugFormas.rows);
    console.log("=================================");

    const formaPagoQ = await client.query(
      `
      SELECT id, nombre, tipo
      FROM formas_pago
      WHERE id = $1
        AND empresa_id = $2
      LIMIT 1
      `,
      [fpId, empresaId]
    );

    if (!formaPagoQ.rowCount) {
      return res.status(404).json({
        ok: false,
        msg: "Forma de pago no encontrada o no pertenece a esta empresa"
      });
    }

    const formaPago = formaPagoQ.rows[0];

    const REQUIERE_COMPROBANTE = [
      "QR",
      "BNF",
      "Continental",
      "Banco Familiar",
      "Ueno Bank",
      "Banco Basa",
      "Mango",
      "Débito",
      "Crédito",
      "Otro Banco"
    ];

    const compStr = (nro_comprobante || "").toString().trim();

    if (
      REQUIERE_COMPROBANTE.includes(formaPago.nombre) &&
      !compStr
    ) {
      return res.status(400).json({
        ok: false,
        msg: "Falta nro_comprobante"
      });
    }

    const tipoCajaNecesaria =
      formaPago.tipo === "efectivo"
        ? "efectivo"
        : "transferencia";
    
    await client.query("BEGIN");

    const fechaFinal = fecha || new Date().toLocaleDateString("en-CA", {
      timeZone: "America/Asuncion"
    });

    // 🔥 CAMBIO CLAVE: usar CURRENT_DATE en lugar de fechaFinal
    const cajaQ = await client.query(
      `
      SELECT id, tipo
      FROM caja
      WHERE estado = 'abierta'
        AND lower(tipo) = lower($1)
        AND fecha::date = CURRENT_DATE   -- ← Ahora siempre la fecha del servidor
        AND empresa_id = $2
      ORDER BY id DESC
      LIMIT 1
      `,
      [tipoCajaNecesaria, empresaId]
    );

    if (cajaQ.rows.length === 0) {
      await client.query("ROLLBACK");
      return res.status(400).json({
        ok: false,
        msg: `Debe abrir la caja de ${tipoCajaNecesaria} antes de realizar una venta`,
      });
    }

    const caja_id_final = cajaQ.rows[0].id;

    let clienteIdFinal =
      cliente_id && String(cliente_id) !== "0" ? Number(cliente_id) : null;

    if (clienteIdFinal) {
      const clienteQ = await client.query(
        `
        SELECT id
        FROM clientes
        WHERE id = $1
          AND empresa_id = $2
        LIMIT 1
        `,
        [clienteIdFinal, empresaId]
      );

      if (!clienteQ.rowCount) {
        await client.query("ROLLBACK");
        return res.status(404).json({
          ok: false,
          msg: "Cliente no encontrado o no pertenece a esta empresa"
        });
      }
    }

    const usuarioId = req.session?.user?.id || null;
    const cajeroNombre =
      req.session?.user?.nombre ||
      req.session?.user?.usuario ||
      "Sin usuario";

    const compFinal =
      REQUIERE_COMPROBANTE.includes(formaPago.nombre)
        ? compStr
        : null;

    const nombreFormaPago = String(formaPago.nombre || "")
      .trim()
      .toLowerCase();

    const esOtroBanco =
      nombreFormaPago.includes("otro banco");

    const bancoNombreFinal = esOtroBanco
      ? String(banco_nombre || "").trim()
      : null;

    console.log("=================================");
    console.log("FORMA PAGO:", formaPago.nombre);
    console.log("BANCO RECIBIDO:", banco_nombre);
    console.log("BANCO FINAL:", bancoNombreFinal);
    console.log("=================================");

    const v = await client.query(
      `
      INSERT INTO ventas (
        fecha,
        cliente_id,
        caja_id,
        usuario_id,
        cajero_nombre,
        total,
        total_pyg,
        total_moneda,
        moneda,
        tipo_cambio,
        forma_pago_id,
        estado_pago,
        nro_comprobante,
        banco_nombre,
        empresa_id
      )
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
      RETURNING id
      `,
      [
        fechaFinal,
        clienteIdFinal,
        caja_id_final,
        usuarioId,
        cajeroNombre,
        totalFinal,
        totalPygFinal,
        totalMonedaFinal,
        monedaFinal,
        tipoCambioFinal,
        fpId,
        (estado_pago || "pendiente")
          .toString()
          .trim()
          .toLowerCase(),
        compFinal,
        bancoNombreFinal,
        empresaId
      ]
    );

    const ventaId = v.rows[0].id;

    for (const it of items) {
      const productoId = Number(it.producto_id);
      const cantidad = Number(it.cantidad || 0);
      const precio = Number(it.precio ?? it.precio_unitario ?? 0);
      const subtotal = Number(it.subtotal ?? cantidad * precio);

      if (!productoId || productoId <= 0) {
        await client.query("ROLLBACK");
        return res.status(400).json({
          ok: false,
          msg: "Item con producto_id inválido"
        });
      }

      if (!Number.isFinite(cantidad) || cantidad <= 0) {
        await client.query("ROLLBACK");
        return res.status(400).json({
          ok: false,
          msg: "Item con cantidad inválida"
        });
      }

      if (!Number.isFinite(precio) || precio < 0) {
        await client.query("ROLLBACK");
        return res.status(400).json({
          ok: false,
          msg: "Item con precio inválido"
        });
      }

      const prodQ = await client.query(
        `
        SELECT id, stock
        FROM productos
        WHERE id = $1
          AND empresa_id = $2
          AND COALESCE(activo, true) = true
        LIMIT 1
        `,
        [productoId, empresaId]
      );

      if (!prodQ.rowCount) {
        await client.query("ROLLBACK");
        return res.status(404).json({
          ok: false,
          msg: `Producto ID ${productoId} no encontrado o no pertenece a esta empresa`
        });
      }

      await client.query(
        `
        INSERT INTO ventas_items (
          venta_id,
          producto_id,
          cantidad,
          precio,
          subtotal,
          empresa_id
        )
        VALUES ($1,$2,$3,$4,$5,$6)
        `,
        [
          ventaId,
          productoId,
          cantidad,
          precio,
          subtotal,
          empresaId
        ]
      );

      const upd = await client.query(
        `
        UPDATE productos
        SET stock = stock - $1
        WHERE id = $2
          AND empresa_id = $3
          AND stock >= $1
        RETURNING id
        `,
        [
          cantidad,
          productoId,
          empresaId
        ]
      );

      if (upd.rows.length === 0) {
        await client.query("ROLLBACK");
        return res.status(400).json({
          ok: false,
          msg: `Stock insuficiente para el producto ID ${productoId}`
        });
      }
    }

    console.log("Venta registrada en caja:", caja_id_final, "Cajero:", cajeroNombre);

    await client.query("COMMIT");

    return res.json({
      ok: true,
      id: ventaId,
      caja_id: caja_id_final,
      cajero: cajeroNombre,
      tipo_caja: tipoCajaNecesaria,
      caja_tipo_real: cajaQ.rows[0].tipo,
      moneda: monedaFinal,
      total_pyg: totalPygFinal,
      total_moneda: totalMonedaFinal
    });

  } catch (err) {
    try {
      await client.query("ROLLBACK");
    } catch {}

    console.error("❌ Error guardando venta:", err);

    return res.status(500).json({
      ok: false,
      msg: "Error guardando venta",
      error: err.message
    });

  } finally {
    client.release();
  }
});
app.get("/ventas/:id", requireEmpresa, async (req, res) => {
  try {
    const empresaId = getEmpresaId(req);
    const ventaId = Number(req.params.id);

    const ven = await pool.query(
      `
      SELECT
        v.id,
        v.fecha,
        v.cliente_id,
        v.forma_pago_id,
        v.estado_pago,
        v.nro_comprobante,
        v.total,
        v.total_pyg,
        v.total_moneda,
        v.moneda,
        v.tipo_cambio
      FROM ventas v
      WHERE v.id = $1
        AND v.empresa_id = $2
      LIMIT 1
      `,
      [ventaId, empresaId]
    );

    if (ven.rows.length === 0) {
      return res.status(404).json({
        ok: false,
        msg: "Venta no encontrada o no pertenece a esta empresa"
      });
    }

    const items = await pool.query(
      `
      SELECT
        vi.id,
        vi.venta_id,
        vi.producto_id,
        vi.cantidad,
        vi.precio,
        vi.subtotal,
        p.nombre AS producto_nombre
      FROM ventas_items vi
      LEFT JOIN productos p 
        ON p.id = vi.producto_id
       AND p.empresa_id = $2
      WHERE vi.venta_id = $1
        AND vi.empresa_id = $2
      ORDER BY vi.id ASC
      `,
      [ventaId, empresaId]
    );

    res.json({
      id: ven.rows[0].id,
      fecha: ven.rows[0].fecha,
      cliente_id: ven.rows[0].cliente_id,
      forma_pago_id: ven.rows[0].forma_pago_id,
      estado_pago: ven.rows[0].estado_pago,
      nro_comprobante: ven.rows[0].nro_comprobante,
      total: ven.rows[0].total,
      total_pyg: ven.rows[0].total_pyg,
      total_moneda: ven.rows[0].total_moneda,
      moneda: ven.rows[0].moneda,
      tipo_cambio: ven.rows[0].tipo_cambio,
      items: items.rows.map(it => ({
        id: it.id,
        producto_id: it.producto_id,
        producto_nombre: it.producto_nombre || "Producto",
        cantidad: Number(it.cantidad || 0),
        precio_unitario: Number(it.precio || 0),
        subtotal: Number(it.subtotal || 0)
      }))
    });

  } catch (err) {
    console.error("❌ Error obteniendo detalle venta:", err);
    res.status(500).json({ ok: false, msg: "Error obteniendo venta" });
  }
});

// ELIMINAR VENTA
app.delete("/ventas/:id", requireEmpresa, async (req, res) => {
  const empresaId = getEmpresaId(req);
  const id = Number(req.params.id);

  try {
    const { rowCount } = await pool.query(
      `
      DELETE FROM ventas
      WHERE id = $1
        AND empresa_id = $2
      `,
      [id, empresaId]
    );

    if (!rowCount) {
      return res.status(404).json({
        ok: false,
        msg: "Venta no encontrada o no pertenece a esta empresa"
      });
    }

    res.json({ ok: true });

  } catch (err) {
    console.error("❌ Error eliminando venta:", err);
    res.status(500).json({ ok: false, msg: "Error eliminando venta" });
  }
});

app.put("/ventas/:id", requireEmpresa, async (req, res) => {
  const empresaId = getEmpresaId(req);
  const id = Number(req.params.id);

  const {
    fecha,
    forma_pago_id,
    estado_pago,
    total,
    total_pyg,
    total_moneda,
    moneda,
    tipo_cambio,
    items
  } = req.body || {};

  if (!id) return res.status(400).json({ ok: false, msg: "ID inválido" });
  if (!fecha) return res.status(400).json({ ok: false, msg: "Falta fecha" });
  if (!forma_pago_id) return res.status(400).json({ ok: false, msg: "Falta forma_pago_id" });
  if (!Array.isArray(items) || items.length === 0) {
    return res.status(400).json({ ok: false, msg: "No hay items" });
  }

  const monedaFinal = String(moneda || "PYG").trim().toUpperCase();
  const tipoCambioFinal = Number(tipo_cambio || 1);
  const totalPygFinal = Number(total_pyg || total || 0);
  const totalMonedaFinal = Number(total_moneda || totalPygFinal || 0);

  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    const ventaCheck = await client.query(
      `
      SELECT id
      FROM ventas
      WHERE id = $1
        AND empresa_id = $2
      LIMIT 1
      `,
      [id, empresaId]
    );

    if (!ventaCheck.rowCount) {
      await client.query("ROLLBACK");
      return res.status(404).json({
        ok: false,
        msg: "Venta no encontrada o no pertenece a esta empresa"
      });
    }

    const prevItemsQ = await client.query(
      `
      SELECT producto_id, cantidad
      FROM ventas_items
      WHERE venta_id = $1
        AND empresa_id = $2
      `,
      [id, empresaId]
    );

    const prevItems = prevItemsQ.rows || [];

    await client.query(
      `
      UPDATE ventas
      SET fecha = $1,
          forma_pago_id = $2,
          estado_pago = $3,
          total = $4,
          total_pyg = $5,
          total_moneda = $6,
          moneda = $7,
          tipo_cambio = $8
      WHERE id = $9
        AND empresa_id = $10
      `,
      [
        fecha,
        Number(forma_pago_id),
        (estado_pago || "pendiente").toString().trim().toLowerCase(),
        totalPygFinal,
        totalPygFinal,
        totalMonedaFinal,
        monedaFinal,
        tipoCambioFinal,
        id,
        empresaId
      ]
    );

    await client.query(
      `
      DELETE FROM ventas_items
      WHERE venta_id = $1
        AND empresa_id = $2
      `,
      [id, empresaId]
    );

    for (const it of items) {
      const producto_id = Number(it.producto_id);
      const cantidad = Number(it.cantidad);
      const precio = Number(it.precio_unitario ?? it.precio ?? 0);
      const subtotal = cantidad * precio;

      if (!producto_id || cantidad <= 0 || precio < 0) {
        throw new Error("Item inválido en edición");
      }

      await client.query(
        `
        INSERT INTO ventas_items (
          venta_id,
          producto_id,
          cantidad,
          precio,
          subtotal,
          empresa_id
        )
        VALUES ($1,$2,$3,$4,$5,$6)
        `,
        [id, producto_id, cantidad, precio, subtotal, empresaId]
      );
    }

    for (const p of prevItems) {
      await client.query(
        `
        UPDATE productos
        SET stock = stock + $1
        WHERE id = $2
          AND empresa_id = $3
        `,
        [Number(p.cantidad), Number(p.producto_id), empresaId]
      );
    }

    for (const it of items) {
      await client.query(
        `
        UPDATE productos
        SET stock = stock - $1
        WHERE id = $2
          AND empresa_id = $3
        `,
        [Number(it.cantidad), Number(it.producto_id), empresaId]
      );
    }

    await client.query("COMMIT");
    return res.json({ ok: true });

  } catch (err) {
    await client.query("ROLLBACK");
    console.error("❌ Error actualizando venta:", err);
    return res.status(500).json({
      ok: false,
      msg: "Error actualizando venta",
      error: err.message
    });
  } finally {
    client.release();
  }
});

app.get("/ventas/:id/ticket", requireEmpresa, async (req, res) => {
  const empresaId = getEmpresaId(req);
  const ventaId = Number(req.params.id);

  try {
    const v = await pool.query(
      `
      SELECT
        v.*,
        COALESCE(v.cajero_nombre, 'Sin usuario') AS cajero_nombre,
        c.nombre,
        c.apellido,
        c.ci,
        fp.nombre AS forma_pago_nombre,
        e.nombre AS empresa_nombre,
        e.direccion AS empresa_direccion,
        e.telefono AS empresa_telefono,
        e.ciudad AS empresa_ciudad,
        e.ruc AS empresa_ruc,
        e.email AS empresa_email,
        e.pie_ticket AS empresa_pie
      FROM ventas v
      LEFT JOIN clientes c
        ON c.id = v.cliente_id AND c.empresa_id = $2
      LEFT JOIN formas_pago fp
        ON fp.id = v.forma_pago_id AND fp.empresa_id = $2
      LEFT JOIN empresas e
        ON e.id = v.empresa_id
      WHERE v.id = $1
        AND v.empresa_id = $2
      LIMIT 1
      `,
      [ventaId, empresaId]
    );

    if (v.rows.length === 0) return res.status(404).send("Venta no encontrada");

    const venta = v.rows[0];

    const items = await pool.query(
      `
      SELECT
        vi.*,
        p.nombre AS producto_nombre,
        p.codigo AS producto_codigo
      FROM ventas_items vi
      JOIN productos p
        ON p.id = vi.producto_id AND p.empresa_id = $2
      WHERE vi.venta_id = $1
        AND vi.empresa_id = $2
      ORDER BY vi.id ASC
      `,
      [ventaId, empresaId]
    );

    // ── Moneda de la venta ─────────────────────────────────
    const moneda      = String(venta.moneda || "PYG").trim().toUpperCase();
    const tipoCambio  = Number(venta.tipo_cambio || 1);
    const totalPyg    = Number(venta.total_pyg ?? venta.total ?? 0);
    const totalMoneda = Number(venta.total_moneda ?? totalPyg);

    // Símbolo y función de formato según moneda
    let simbolo = "Gs.";
    const fmtGs = (n) => Number(n || 0).toLocaleString("es-PY");

    const fmtMoneda = (n) => {
      if (moneda === "USD") return `US$ ${Number(n || 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
      if (moneda === "BRL") return `R$ ${Number(n || 0).toLocaleString("pt-BR",  { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
      return `Gs. ${fmtGs(n)}`;
    };

    // Total a mostrar: en moneda extranjera si aplica, siempre también Gs.
    const totalDisplay        = fmtMoneda(totalMoneda);
    const totalGsDisplay      = moneda !== "PYG" ? `Gs. ${fmtGs(totalPyg)}` : null;
    const tipoCambioDisplay   = moneda !== "PYG" ? `TC: 1 ${moneda} = Gs. ${fmtGs(tipoCambio)}` : null;

    // Precio unitario de cada ítem en moneda extranjera
    const precioItemEnMoneda = (precio) => {
      if (moneda === "PYG") return null;
      const enMoneda = tipoCambio > 0 ? Number(precio) / tipoCambio : 0;
      return fmtMoneda(enMoneda);
    };

    const subtotalItemEnMoneda = (subtotal) => {
      if (moneda === "PYG") return null;
      const enMoneda = tipoCambio > 0 ? Number(subtotal) / tipoCambio : 0;
      return fmtMoneda(enMoneda);
    };

    // ── Cálculo de altura preciso ──────────────────────────
    const TW = 226;
    const L  = 10;
    const W  = TW - L * 2;

    const extraHeader = [
      venta.empresa_direccion,
      venta.empresa_ruc,
      venta.empresa_telefono,
      venta.empresa_email,
      venta.empresa_ciudad
    ].filter(Boolean).length * 11;

    const H_HEADER  = 38 + extraHeader;
    const H_FACTURA = 26;
    const H_DATOS   = 58;
    const H_MONEDA  = moneda !== "PYG" ? 22 : 0; // línea de tipo de cambio
    const H_THEAD   = 24;
    const H_ITEMS   = items.rows.length * (moneda !== "PYG" ? 30 : 24);
    const H_CODIGOS = items.rows.filter(i => i.producto_codigo).length * 11;
    const H_TOTALES = 52 + (moneda !== "PYG" ? 22 : 0); // línea extra en moneda
    const H_PIE     = 36;
    const H_PADDING = 24;

    const ticketHeight =
      H_HEADER + H_FACTURA + H_DATOS + H_MONEDA + H_THEAD +
      H_ITEMS + H_CODIGOS + H_TOTALES + H_PIE + H_PADDING;

    const doc = new PDFDocument({
      size: [TW, ticketHeight],
      margins: { top: 0, left: 0, right: 0, bottom: 0 }
    });

    res.setHeader("Content-Type", "application/pdf");
    res.setHeader(
      "Content-Disposition",
      `inline; filename=ticket_${empresaId}_${ventaId}.pdf`
    );
    doc.pipe(res);

    let y = 12;

    // ── ENCABEZADO EMPRESA ─────────────────────────────────
    doc.font("Helvetica-Bold").fontSize(10)
       .text((venta.empresa_nombre || "MI EMPRESA").toUpperCase(), L, y, {
         width: W, align: "center"
       });
    y += 14;

    doc.font("Helvetica").fontSize(7.5);

    if (venta.empresa_direccion) {
      doc.text(venta.empresa_direccion, L, y, { width: W, align: "center" }); y += 11;
    }
    if (venta.empresa_ruc) {
      doc.text(`RUC: ${venta.empresa_ruc}`, L, y, { width: W, align: "center" }); y += 11;
    }
    if (venta.empresa_ciudad && venta.empresa_telefono) {
      doc.text(
        `Tel: ${venta.empresa_telefono}    ${venta.empresa_ciudad.toUpperCase()}`,
        L, y, { width: W, align: "center" }
      ); y += 11;
    } else if (venta.empresa_telefono) {
      doc.text(`Tel: ${venta.empresa_telefono}`, L, y, { width: W, align: "center" }); y += 11;
    } else if (venta.empresa_ciudad) {
      doc.text(venta.empresa_ciudad.toUpperCase(), L, y, { width: W, align: "center" }); y += 11;
    }
    if (venta.empresa_email) {
      doc.text(venta.empresa_email.toLowerCase(), L, y, { width: W, align: "center" }); y += 11;
    }

    y += 5;
    const dash = () => doc.moveTo(L, y).lineTo(L + W, y).dash(1.5, { space: 2 }).stroke().undash();
    dash(); y += 7;

    // ── FACTURA DE VENTA + NÚMERO ──────────────────────────
    doc.font("Helvetica-Bold").fontSize(8.5)
       .text("FACTURA DE VENTA", L, y, { width: W * 0.58 });
    doc.text(String(ventaId).padStart(5, "0"), L, y, { width: W, align: "right" });
    y += 13;

    dash(); y += 7;

    // ── DATOS VENTA ────────────────────────────────────────
    // Fecha en formato dd/mm/yyyy
    // venta.fecha puede ser: Date object (pg), "2026-05-27", "2026-05-27T..."
    const fechaStr = (() => {
      if (!venta.fecha) return "—";
      let d;
      if (venta.fecha instanceof Date) {
        // PostgreSQL ya lo parsea como objeto Date
        d = venta.fecha;
      } else {
        // String: tomamos solo los primeros 10 chars y forzamos mediodía
        const str = String(venta.fecha).slice(0, 10);
        d = new Date(str + "T12:00:00");
      }
      if (!d || isNaN(d.getTime())) return "—";
      const dd   = String(d.getDate()).padStart(2, "0");
      const mm   = String(d.getMonth() + 1).padStart(2, "0");
      const yyyy = d.getFullYear();
      return `${dd}/${mm}/${yyyy}`;
    })();

    const horaStr = (() => {
      const d = venta.created_at ? new Date(venta.created_at) : null;
      if (!d || isNaN(d)) return "";
      return d.toLocaleTimeString("es-PY", {
        hour: "2-digit", minute: "2-digit",
        timeZone: "America/Asuncion"
      });
    })();

    const clienteNombre = `${venta.nombre || "Consumidor Final"} ${venta.apellido || ""}`.trim();
    const ciStr  = venta.ci || "—";
    const cajero = venta.cajero_nombre || "Sin usuario";

    doc.font("Helvetica").fontSize(7.5);

    doc.text(`Fecha: ${fechaStr}`, L, y, { width: W * 0.58 });
    if (horaStr) doc.text(`Hora: ${horaStr}`, L, y, { width: W, align: "right" });
    y += 12;

    doc.text(`Cliente: ${clienteNombre}`, L, y, { width: W }); y += 12;
    doc.text(`RUC/CI: ${ciStr}`, L, y, { width: W }); y += 12;

    doc.font("Helvetica-Bold").text("Cajero: ", L, y, { continued: true });
    doc.font("Helvetica").text(cajero, { width: W });
    y += 12;

    // ── TIPO DE CAMBIO (solo si no es PYG) ─────────────────
    if (tipoCambioDisplay) {
      doc.font("Helvetica").fontSize(7)
         .fillColor("#444444")
         .text(tipoCambioDisplay, L, y, { width: W, align: "center" })
         .fillColor("#000000");
      y += 13;
    }

    y += 4;
    dash(); y += 7;

    // ── CABECERA TABLA ─────────────────────────────────────
    const C1 = L;
    const C2 = L + 88;
    const C3 = L + 116;
    const C4 = L + 144;

    doc.font("Helvetica-Bold").fontSize(7);
    doc.text("ARTÍCULO", C1, y, { width: 86 });
    doc.text("UND",      C2, y, { width: 26, align: "center" });
    doc.text("CANT",     C3, y, { width: 26, align: "center" });
    doc.text("TOTAL",    C4, y, { width: W - 144, align: "right" });
    y += 10;

    dash(); y += 5;

    // ── ITEMS ──────────────────────────────────────────────
    for (const it of items.rows) {
      const nombre   = (it.producto_nombre || "-").toUpperCase();
      const codigo   = it.producto_codigo || "";
      const unidad   = (it.unidad || "UND").toUpperCase();
      const cantidad = Number(it.cantidad || 0);
      const subtotal = Number(it.subtotal ?? (it.precio * it.cantidad) ?? 0);

      // Mostrar subtotal: en moneda extranjera si aplica, si no en Gs.
      const subtotalTexto = moneda !== "PYG"
        ? subtotalItemEnMoneda(subtotal)
        : fmtGs(subtotal);

      doc.font("Helvetica").fontSize(7.5);
      doc.text(nombre,              C1, y, { width: 86 });
      doc.text(unidad,              C2, y, { width: 26, align: "center" });
      doc.text(cantidad.toFixed(2), C3, y, { width: 26, align: "center" });
      doc.text(subtotalTexto,       C4, y, { width: W - 144, align: "right" });
      y += 13;

      // Si hay moneda extranjera, mostrar equivalente en Gs. debajo
      if (moneda !== "PYG") {
        doc.font("Helvetica").fontSize(6.5)
           .fillColor("#666666")
           .text(`(Gs. ${fmtGs(subtotal)})`, C4, y, { width: W - 144, align: "right" })
           .fillColor("#000000");
        y += 10;
      }

      if (codigo) {
        doc.font("Helvetica").fontSize(6.5)
           .fillColor("#555555")
           .text(codigo, C1, y, { width: 86 })
           .fillColor("#000000");
        y += 11;
      }
    }

    y += 4;
    doc.moveTo(L, y).lineTo(L + W, y).lineWidth(0.8).stroke().lineWidth(0.5);
    y += 7;

    // ── TOTAL ──────────────────────────────────────────────
    doc.font("Helvetica-Bold").fontSize(9);

    if (moneda !== "PYG") {
      // Línea 1: total en moneda extranjera (destacado)
      doc.text("T O T A L . . .", L, y, { width: W * 0.55 });
      doc.text(totalDisplay, L, y, { width: W, align: "right" });
      y += 13;

      // Línea 2: equivalente en Gs. (más chico)
      doc.font("Helvetica").fontSize(7.5)
         .fillColor("#444444")
         .text(`Equivalente: ${totalGsDisplay}`, L, y, { width: W, align: "right" })
         .fillColor("#000000");
      y += 12;
    } else {
      doc.text("T O T A L . . .", L, y, { width: W * 0.55 });
      doc.text(fmtGs(totalPyg), L, y, { width: W, align: "right" });
      y += 15;
    }

    // ── FORMA DE PAGO ──────────────────────────────────────
    if (venta.forma_pago_nombre) {
      doc.font("Helvetica").fontSize(8);

      let labelFP = venta.forma_pago_nombre.toUpperCase();
      if (venta.banco_nombre)    labelFP += ` (${venta.banco_nombre.toUpperCase()})`;
      if (venta.nro_comprobante) labelFP += `  ${String(venta.nro_comprobante).padStart(8, "0")}`;

      doc.text(labelFP,      L, y, { width: W * 0.65 });
      doc.text(totalDisplay, L, y, { width: W, align: "right" });
      y += 12;
    }

    y += 5;
    dash(); y += 10;

    // ── PIE ────────────────────────────────────────────────
    const pie = venta.empresa_pie || "MUCHAS GRACIAS POR SU COMPRA.\nVUELVA PRONTO.";

    doc.font("Helvetica").fontSize(7)
       .text(pie, L, y, { width: W, align: "center" });

    doc.end();

  } catch (err) {
    console.error("❌ Error generando ticket:", err);
    res.status(500).send("Error generando ticket");
  }
});
app.get("/formas-pago", requireEmpresa, async (req, res) => {
  try {
    const empresaId = getEmpresaId(req);

    const result = await pool.query(
      `
      SELECT *
      FROM formas_pago
      WHERE activo = true
        AND empresa_id = $1
      ORDER BY nombre
      `,
      [empresaId]
    );

    res.json(result.rows);
  } catch (err) {
    console.error("GET /formas-pago", err);
    res.status(500).json({ ok: false, msg: "Error listando formas de pago" });
  }
});

app.post("/formas-pago", requireEmpresa, async (req, res) => {
  try {
    const empresaId = getEmpresaId(req);
    const { nombre, tipo, descripcion } = req.body;

    await pool.query(
      `
      INSERT INTO formas_pago (
        nombre,
        tipo,
        descripcion,
        empresa_id
      )
      VALUES ($1, $2, $3, $4)
      `,
      [nombre, tipo, descripcion, empresaId]
    );

    res.json({ ok: true });
  } catch (err) {
    console.error("POST /formas-pago", err);
    res.status(500).json({ ok: false, msg: "Error creando forma de pago" });
  }
});

app.put("/formas-pago/:id", requireEmpresa, async (req, res) => {
  try {
    const empresaId = getEmpresaId(req);
    const { id } = req.params;
    const { nombre, tipo, descripcion, activo } = req.body;

    const { rowCount } = await pool.query(
      `
      UPDATE formas_pago
      SET 
        nombre = $1,
        tipo = $2,
        descripcion = $3,
        activo = $4
      WHERE id = $5
        AND empresa_id = $6
      `,
      [nombre, tipo, descripcion, activo, id, empresaId]
    );

    if (!rowCount) {
      return res.status(404).json({
        ok: false,
        msg: "Forma de pago no encontrada o no pertenece a esta empresa"
      });
    }

    res.json({ ok: true });
  } catch (err) {
    console.error("PUT /formas-pago/:id", err);
    res.status(500).json({ ok: false, msg: "Error actualizando forma de pago" });
  }
});

app.get("/compras/:id/pdf", requireEmpresa, async (req, res) => {
  const empresaId = getEmpresaId(req);
  const id = Number(req.params.id);

  try {
    const cab = await pool.query(
      `
      SELECT 
        c.*,
        p.nombre AS proveedor_nombre,
        p.ruc AS proveedor_ruc,
        e.nombre AS empresa_nombre
      FROM compras c
      LEFT JOIN proveedores p 
        ON p.id = c.proveedor_id
       AND p.empresa_id = $2
      LEFT JOIN empresas e
        ON e.id = c.empresa_id
      WHERE c.id = $1
        AND c.empresa_id = $2
      LIMIT 1
      `,
      [id, empresaId]
    );

    if (!cab.rowCount) {
      return res.status(404).send("Compra no encontrada");
    }

    const comp = cab.rows[0];

    const items = await pool.query(
      `
      SELECT 
        ci.*,
        pr.nombre AS producto_nombre
      FROM compras_items ci
      LEFT JOIN productos pr 
        ON pr.id = ci.producto_id
       AND pr.empresa_id = $2
      WHERE ci.compra_id = $1
        AND ci.empresa_id = $2
      ORDER BY ci.id
      `,
      [id, empresaId]
    );

    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `inline; filename=compra_${empresaId}_${id}.pdf`);

    const doc = new PDFDocument({ margin: 30 });
    doc.pipe(res);

    doc.fontSize(20).text(`Compras – ${comp.empresa_nombre || "Empresa"}`, {
      align: "center"
    });

    doc.moveDown(1);

    doc.fontSize(12).text(`ID Compra: ${comp.id}`);
    doc.text(`Fecha: ${comp.fecha ? comp.fecha.toISOString().slice(0, 10) : "-"}`);
    doc.text(`Proveedor: ${comp.proveedor_nombre || "-"}`);
    doc.text(`RUC: ${comp.proveedor_ruc || "-"}`);
    doc.text(`Factura: ${comp.factura || "-"}`);
    doc.moveDown(1);

    doc.fontSize(12).text("Detalle de Productos", { underline: true });
    doc.moveDown(0.5);

    items.rows.forEach(it => {
      doc.fontSize(11).text(
        `${it.producto_nombre || "-"} | Cant: ${it.cantidad} | Costo: ${it.costo} | Subtotal: ${it.subtotal}`
      );
    });

    doc.moveDown(1);
    doc.fontSize(14).text(`TOTAL: Gs. ${Number(comp.total || 0).toLocaleString("es-PY")}`, {
      align: "right"
    });

    doc.end();

  } catch (err) {
    console.error("GET /compras/:id/pdf", err);
    res.status(500).send("Error generando PDF de compra");
  }
});

app.delete("/compras/:id", requireEmpresa, async (req, res) => {
  const empresaId = getEmpresaId(req);
  const id = Number(req.params.id);

  if (!id) {
    return res.json({
      ok: false,
      msg: "ID inválido"
    });
  }

  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    const compraQ = await client.query(
      `
      SELECT id
      FROM compras
      WHERE id = $1
        AND empresa_id = $2
      LIMIT 1
      `,
      [id, empresaId]
    );

    if (!compraQ.rowCount) {
      await client.query("ROLLBACK");

      return res.json({
        ok: false,
        msg: "Compra no encontrada o no pertenece a esta empresa"
      });
    }

    await client.query(
      `
      DELETE FROM compras_items
      WHERE compra_id = $1
        AND empresa_id = $2
      `,
      [id, empresaId]
    );

    const { rowCount } = await client.query(
      `
      DELETE FROM compras
      WHERE id = $1
        AND empresa_id = $2
      `,
      [id, empresaId]
    );

    await client.query("COMMIT");

    if (!rowCount) {
      return res.json({
        ok: false,
        msg: "Compra no encontrada"
      });
    }

    res.json({
      ok: true,
      msg: "Compra eliminada correctamente"
    });

  } catch (err) {
    await client.query("ROLLBACK");
    console.error("DELETE /compras/:id", err);

    res.json({
      ok: false,
      msg: "Error eliminando compra"
    });
  } finally {
    client.release();
  }
});

app.get("/productos/barcode/:codigo", requireEmpresa, async (req, res) => {
  try {
    const empresaId = getEmpresaId(req);
    const codigo = req.params.codigo;

    const result = await pool.query(
      `
      SELECT *
      FROM productos
      WHERE codigo = $1
        AND empresa_id = $2
        AND COALESCE(activo, true) = true
      LIMIT 1
      `,
      [codigo, empresaId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({
        error: "Producto no encontrado"
      });
    }

    res.json(result.rows[0]);
  } catch (err) {
    console.error("GET /productos/barcode/:codigo", err);
    res.status(500).json({ error: "Error buscando producto por código" });
  }
});

function toISODate(fecha) {
  const s = String(fecha || "").trim();

  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;

  const m = s.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (m) return `${m[3]}-${m[2]}-${m[1]}`;

  return s;
}


app.post("/caja/abrir", requireEmpresa, async (req, res) => {
  const empresaId = getEmpresaId(req);

  const {
    tipo,
    saldo_gs = 0,
    saldo_us = 0,
    saldo_rs = 0,
    saldo_inicial = 0
  } = req.body || {};

  try {
    const tipoNorm = normTipoCaja(tipo);

    // 🔥 Verificar si ya existe una caja abierta del mismo tipo (sin filtrar por fecha)
    const existeQ = await pool.query(
      `
      SELECT id
      FROM caja
      WHERE estado = 'abierta'
        AND tipo = $1
        AND empresa_id = $2
      LIMIT 1
      `,
      [tipoNorm, empresaId]
    );

    if (existeQ.rowCount > 0) {
      return res.status(400).json({
        ok: false,
        msg: `Ya existe una caja ${tipoNorm} abierta. Debe cerrarla antes de abrir una nueva.`
      });
    }

    const saldoGsFinal = Number(saldo_gs || saldo_inicial || 0);
    const saldoUsFinal = Number(saldo_us || 0);
    const saldoRsFinal = Number(saldo_rs || 0);

    // 🔥 Insertar con fecha actual (solo como dato histórico)
    const q = await pool.query(
      `
      INSERT INTO caja (
        tipo,
        fecha,
        saldo_inicial,
        saldo_gs,
        saldo_us,
        saldo_rs,
        estado,
        empresa_id
      )
      VALUES ($1, CURRENT_DATE, $2, $3, $4, $5, 'abierta', $6)
      RETURNING *
      `,
      [
        tipoNorm,
        saldoGsFinal,
        saldoGsFinal,
        saldoUsFinal,
        saldoRsFinal,
        empresaId
      ]
    );

    return res.json({
      ok: true,
      caja: q.rows[0]
    });

  } catch (err) {
    console.error("/caja/abrir:", err);
    return res.status(500).json({
      ok: false,
      msg: "Error al abrir caja"
    });
  }
});

app.get("/caja/abierta", requireEmpresa, async (req, res) => {
  try {
    const empresaId = getEmpresaId(req);
    const tipo = req.query.tipo ? normTipoCaja(req.query.tipo) : null;

    let q = `
      SELECT *
      FROM caja
      WHERE estado = 'abierta'
        AND empresa_id = $1
    `;
    const params = [empresaId];

    if (tipo) {
      params.push(tipo);
      q += ` AND tipo = $${params.length}`;
    }

    q += ` ORDER BY id DESC LIMIT 1`;

    const r = await pool.query(q, params);

    if (!r.rowCount) {
      return res.json({ abierta: false, caja: null });
    }

    const caja = r.rows[0];

    // Calcular totales de ventas asociadas
    const ventasQ = await pool.query(
      `
      SELECT
        COALESCE(SUM(COALESCE(total_pyg, total, 0)), 0)::numeric AS total_ventas_gs,
        COALESCE(SUM(CASE WHEN COALESCE(moneda, 'PYG') = 'USD' THEN COALESCE(total_moneda, 0) ELSE 0 END), 0)::numeric AS total_ventas_us,
        COALESCE(SUM(CASE WHEN COALESCE(moneda, 'PYG') = 'BRL' THEN COALESCE(total_moneda, 0) ELSE 0 END), 0)::numeric AS total_ventas_rs
      FROM ventas
      WHERE caja_id = $1
        AND empresa_id = $2
        AND (estado_pago IS NULL OR estado_pago <> 'anulado')
      `,
      [caja.id, empresaId]
    );

    const total_ventas_gs = Number(ventasQ.rows[0].total_ventas_gs || 0);
    const total_ventas_us = Number(ventasQ.rows[0].total_ventas_us || 0);
    const total_ventas_rs = Number(ventasQ.rows[0].total_ventas_rs || 0);

    const saldo_inicial_gs = Number(caja.saldo_gs ?? caja.saldo_inicial ?? 0);
    const saldo_inicial_us = Number(caja.saldo_us || 0);
    const saldo_inicial_rs = Number(caja.saldo_rs || 0);

    return res.json({
      abierta: true,
      caja: {
        ...caja,
        total_ventas_gs,
        total_ventas_us,
        total_ventas_rs,
        saldo_actual_gs: saldo_inicial_gs + total_ventas_gs,
        saldo_actual_us: saldo_inicial_us + total_ventas_us,
        saldo_actual_rs: saldo_inicial_rs + total_ventas_rs,
        saldo_actual: saldo_inicial_gs + total_ventas_gs
      }
    });

  } catch (err) {
    console.error("GET /caja/abierta", err);
    return res.status(500).json({
      abierta: false,
      msg: "Error consultando caja"
    });
  }
});
app.get("/caja/estado", requireEmpresa, async (req, res) => {
  try {
    const empresaId = getEmpresaId(req);
    const tipo = req.query.tipo ? normTipoCaja(req.query.tipo) : null;

    if (!tipo) {
      return res.status(400).json({
        abierta: false,
        msg: "Falta tipo (efectivo/transferencia)"
      });
    }

    const cajaQ = await pool.query(
      `
      SELECT *
      FROM caja
      WHERE estado = 'abierta'
        AND tipo = $1
        AND empresa_id = $2
      ORDER BY id DESC
      LIMIT 1
      `,
      [tipo, empresaId]
    );

    if (!cajaQ.rowCount) {
      return res.json({ abierta: false, caja: null });
    }

    const caja = cajaQ.rows[0];

    const ventasQ = await pool.query(
      `
      SELECT COALESCE(SUM(total), 0) AS total_ventas
      FROM ventas
      WHERE caja_id = $1
        AND empresa_id = $2
        AND (estado_pago IS NULL OR estado_pago <> 'anulado')
      `,
      [caja.id, empresaId]
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
    res.status(500).json({
      abierta: false,
      msg: "Error estado caja"
    });
  }
});

// Alias para compatibilidad con el front (que llama /formas_pago)
app.get("/formas_pago", requireEmpresa, async (req, res) => {
  try {
    const empresaId = getEmpresaId(req);

    const result = await pool.query(
      `
      SELECT *
      FROM formas_pago
      WHERE activo = true
        AND empresa_id = $1
      ORDER BY nombre
      `,
      [empresaId]
    );

    res.json(result.rows);
  } catch (err) {
    console.error("GET /formas_pago", err);
    res.status(500).json({ ok: false, msg: "Error listando formas de pago" });
  }
});

app.post("/formas_pago", requireEmpresa, async (req, res) => {
  try {
    const empresaId = getEmpresaId(req);
    const { nombre, tipo, descripcion } = req.body;

    await pool.query(
      `
      INSERT INTO formas_pago (
        nombre,
        tipo,
        descripcion,
        empresa_id
      )
      VALUES ($1, $2, $3, $4)
      `,
      [nombre, tipo, descripcion, empresaId]
    );

    res.json({ ok: true });
  } catch (err) {
    console.error("POST /formas_pago", err);
    res.status(500).json({ ok: false, msg: "Error creando forma de pago" });
  }
});

app.put("/formas_pago/:id", requireEmpresa, async (req, res) => {
  try {
    const empresaId = getEmpresaId(req);
    const { id } = req.params;
    const { nombre, tipo, descripcion, activo } = req.body;

    const { rowCount } = await pool.query(
      `
      UPDATE formas_pago
      SET 
        nombre = $1,
        tipo = $2,
        descripcion = $3,
        activo = $4
      WHERE id = $5
        AND empresa_id = $6
      `,
      [nombre, tipo, descripcion, activo, id, empresaId]
    );

    if (!rowCount) {
      return res.status(404).json({
        ok: false,
        msg: "Forma de pago no encontrada o no pertenece a esta empresa"
      });
    }

    res.json({ ok: true });

  } catch (err) {
    console.error("PUT /formas_pago/:id", err);
    res.status(500).json({ ok: false, msg: "Error actualizando forma de pago" });
  }
});

// ================== RESUMEN CAJA (DIA / MES) ==================
function monthStartISO(fechaISO) {
  const m = String(fechaISO || "").slice(0, 7);
  return /^\d{4}-\d{2}$/.test(m) ? `${m}-01` : null;
}

function numRow(r) {
  return {
    efectivo: Number(r?.efectivo || 0),
    transferencia: Number(r?.transferencia || 0),
    total: Number(r?.total || 0),
  };
}

app.get("/caja/resumen-dia", requireEmpresa, async (req, res) => {
  try {
    const empresaId = getEmpresaId(req);
    const diaParam = req.query.dia || req.query.fecha;

    if (!diaParam) {
      return res.status(400).json({
        ok: false,
        msg: "Falta dia o fecha"
      });
    }

    const ymd = toISODate(diaParam);

    const q = await pool.query(
      `
      SELECT
        -- INGRESO EFECTIVO (ventas)
        COALESCE((
          SELECT SUM(v.total)
          FROM ventas v
          LEFT JOIN formas_pago fp 
            ON fp.id = v.forma_pago_id
           AND fp.empresa_id = $2
          WHERE v.fecha::date = $1::date
            AND v.empresa_id = $2
            AND lower(fp.tipo) LIKE '%efect%'
            AND (v.estado_pago IS NULL OR v.estado_pago <> 'anulado')
        ), 0) AS ingreso_efectivo,

        -- EGRESO EFECTIVO (compras + cuentas pagadas)
        COALESCE((
          SELECT SUM(c.total)
          FROM compras c
          WHERE c.fecha::date = $1::date
            AND c.empresa_id = $2
            AND c.tipo_pago = 'efectivo'
        ), 0)
        +
        COALESCE((
          SELECT SUM(cp.monto_pyg)
          FROM cuentas_pagar cp
          WHERE cp.fecha_pago::date = $1::date
            AND cp.empresa_id = $2
            AND cp.estado = 'pagado'
            AND cp.caja_tipo = 'efectivo'
        ), 0) AS egreso_efectivo,

        -- INGRESO TRANSFERENCIA (ventas)
        COALESCE((
          SELECT SUM(v.total)
          FROM ventas v
          LEFT JOIN formas_pago fp 
            ON fp.id = v.forma_pago_id
           AND fp.empresa_id = $2
          WHERE v.fecha::date = $1::date
            AND v.empresa_id = $2
            AND lower(fp.tipo) LIKE '%transf%'
            AND (v.estado_pago IS NULL OR v.estado_pago <> 'anulado')
        ), 0) AS ingreso_transferencia,

        -- EGRESO TRANSFERENCIA (compras + cuentas pagadas)
        COALESCE((
          SELECT SUM(c.total)
          FROM compras c
          WHERE c.fecha::date = $1::date
            AND c.empresa_id = $2
            AND c.tipo_pago = 'transferencia'
        ), 0)
        +
        COALESCE((
          SELECT SUM(cp.monto_pyg)
          FROM cuentas_pagar cp
          WHERE cp.fecha_pago::date = $1::date
            AND cp.empresa_id = $2
            AND cp.estado = 'pagado'
            AND cp.caja_tipo = 'transferencia'
        ), 0) AS egreso_transferencia
      `,
      [ymd, empresaId]
    );

    const r = q.rows[0];

    const ingreso_efectivo = Number(r.ingreso_efectivo || 0);
    const egreso_efectivo = Number(r.egreso_efectivo || 0);
    const saldo_efectivo = ingreso_efectivo - egreso_efectivo;

    const ingreso_transferencia = Number(r.ingreso_transferencia || 0);
    const egreso_transferencia = Number(r.egreso_transferencia || 0);
    const saldo_transferencia = ingreso_transferencia - egreso_transferencia;

    const saldo_total = saldo_efectivo + saldo_transferencia;

    return res.json({
      ok: true,
      dia: ymd,

      ingreso_efectivo,
      egreso_efectivo,
      saldo_efectivo,

      ingreso_transferencia,
      egreso_transferencia,
      saldo_transferencia,

      saldo_total
    });

  } catch (err) {
    console.error("GET /caja/resumen-dia", err);
    return res.status(500).json({
      ok: false,
      msg: "Error resumen día"
    });
  }
});

// ===============================
// RESUMEN DEL MES (con cuentas pagadas)
// ===============================
app.get("/caja/resumen-mes", requireEmpresa, async (req, res) => {
  try {
    const empresaId = getEmpresaId(req);
    const mesParam = req.query.mes || req.query.fecha;

    if (!mesParam) {
      return res.status(400).json({
        ok: false,
        msg: "Falta mes o fecha"
      });
    }

    let ymd = String(mesParam).trim();

    if (/^\\d{4}-\\d{2}$/.test(ymd)) {
      ymd = `${ymd}-01`;
    }

    ymd = toISODate(ymd);

    const q = await pool.query(
      `
      SELECT
        -- INGRESO EFECTIVO (ventas)
        COALESCE((
          SELECT SUM(v.total)
          FROM ventas v
          LEFT JOIN formas_pago fp 
            ON fp.id = v.forma_pago_id
           AND fp.empresa_id = $2
          WHERE date_trunc('month', v.fecha::date) = date_trunc('month', $1::date)
            AND v.empresa_id = $2
            AND lower(fp.tipo) LIKE '%efect%'
            AND (v.estado_pago IS NULL OR v.estado_pago <> 'anulado')
        ), 0) AS ingreso_efectivo,

        -- EGRESO EFECTIVO (compras + cuentas pagadas)
        COALESCE((
          SELECT SUM(c.total)
          FROM compras c
          WHERE date_trunc('month', c.fecha::date) = date_trunc('month', $1::date)
            AND c.empresa_id = $2
            AND c.tipo_pago = 'efectivo'
        ), 0)
        +
        COALESCE((
          SELECT SUM(cp.monto_pyg)
          FROM cuentas_pagar cp
          WHERE date_trunc('month', cp.fecha_pago::date) = date_trunc('month', $1::date)
            AND cp.empresa_id = $2
            AND cp.estado = 'pagado'
            AND cp.caja_tipo = 'efectivo'
        ), 0) AS egreso_efectivo,

        -- INGRESO TRANSFERENCIA (ventas)
        COALESCE((
          SELECT SUM(v.total)
          FROM ventas v
          LEFT JOIN formas_pago fp 
            ON fp.id = v.forma_pago_id
           AND fp.empresa_id = $2
          WHERE date_trunc('month', v.fecha::date) = date_trunc('month', $1::date)
            AND v.empresa_id = $2
            AND lower(fp.tipo) LIKE '%transf%'
            AND (v.estado_pago IS NULL OR v.estado_pago <> 'anulado')
        ), 0) AS ingreso_transferencia,

        -- EGRESO TRANSFERENCIA (compras + cuentas pagadas)
        COALESCE((
          SELECT SUM(c.total)
          FROM compras c
          WHERE date_trunc('month', c.fecha::date) = date_trunc('month', $1::date)
            AND c.empresa_id = $2
            AND c.tipo_pago = 'transferencia'
        ), 0)
        +
        COALESCE((
          SELECT SUM(cp.monto_pyg)
          FROM cuentas_pagar cp
          WHERE date_trunc('month', cp.fecha_pago::date) = date_trunc('month', $1::date)
            AND cp.empresa_id = $2
            AND cp.estado = 'pagado'
            AND cp.caja_tipo = 'transferencia'
        ), 0) AS egreso_transferencia
      `,
      [ymd, empresaId]
    );

    const r = q.rows[0];

    const ingreso_efectivo = Number(r.ingreso_efectivo || 0);
    const egreso_efectivo = Number(r.egreso_efectivo || 0);
    const saldo_efectivo = ingreso_efectivo - egreso_efectivo;

    const ingreso_transferencia = Number(r.ingreso_transferencia || 0);
    const egreso_transferencia = Number(r.egreso_transferencia || 0);
    const saldo_transferencia = ingreso_transferencia - egreso_transferencia;

    const saldo_total = saldo_efectivo + saldo_transferencia;

    return res.json({
      ok: true,
      mes: ymd.slice(0, 7),

      ingreso_efectivo,
      egreso_efectivo,
      saldo_efectivo,

      ingreso_transferencia,
      egreso_transferencia,
      saldo_transferencia,

      saldo_total
    });

  } catch (err) {
    console.error("GET /caja/resumen-mes", err);
    return res.status(500).json({
      ok: false,
      msg: "Error resumen mes"
    });
  }
});


app.get("/caja/resumen", requireEmpresa, async (req, res) => {
  try {
    const empresaId = getEmpresaId(req);
    const fechaParam = req.query.fecha || req.query.dia || req.query.mes;

    if (!fechaParam) {
      return res.status(400).json({ ok: false, msg: "Falta fecha" });
    }

    const ymd = toISODate(fechaParam);

    const diaQ = await pool.query(
      `
      SELECT
        COALESCE((
          SELECT SUM(v.total)
          FROM ventas v
          LEFT JOIN formas_pago fp 
            ON fp.id = v.forma_pago_id
           AND fp.empresa_id = $2
          WHERE v.fecha::date = $1::date
            AND v.empresa_id = $2
            AND lower(COALESCE(fp.tipo, '')) LIKE '%efect%'
            AND (v.estado_pago IS NULL OR v.estado_pago <> 'anulado')
        ), 0) AS ingreso_efectivo,

        COALESCE((
          SELECT SUM(c.total)
          FROM compras c
          WHERE c.fecha::date = $1::date
            AND c.empresa_id = $2
            AND c.tipo_pago = 'efectivo'
        ), 0) AS egreso_compras_efectivo,

        COALESCE((
          SELECT SUM(v.total)
          FROM ventas v
          LEFT JOIN formas_pago fp 
            ON fp.id = v.forma_pago_id
           AND fp.empresa_id = $2
          WHERE v.fecha::date = $1::date
            AND v.empresa_id = $2
            AND lower(COALESCE(fp.tipo, '')) LIKE '%transf%'
            AND (v.estado_pago IS NULL OR v.estado_pago <> 'anulado')
        ), 0) AS ingreso_transferencia,

        COALESCE((
          SELECT SUM(c.total)
          FROM compras c
          WHERE c.fecha::date = $1::date
            AND c.empresa_id = $2
            AND c.tipo_pago = 'transferencia'
        ), 0) AS egreso_compras_transferencia
      `,
      [ymd, empresaId]
    );

    const mesQ = await pool.query(
      `
      SELECT
        COALESCE((
          SELECT SUM(v.total)
          FROM ventas v
          LEFT JOIN formas_pago fp 
            ON fp.id = v.forma_pago_id
           AND fp.empresa_id = $2
          WHERE date_trunc('month', v.fecha::date) = date_trunc('month', $1::date)
            AND v.empresa_id = $2
            AND lower(COALESCE(fp.tipo, '')) LIKE '%efect%'
            AND (v.estado_pago IS NULL OR v.estado_pago <> 'anulado')
        ), 0) AS ingreso_efectivo,

        COALESCE((
          SELECT SUM(c.total)
          FROM compras c
          WHERE date_trunc('month', c.fecha::date) = date_trunc('month', $1::date)
            AND c.empresa_id = $2
            AND c.tipo_pago = 'efectivo'
        ), 0) AS egreso_compras_efectivo,

        COALESCE((
          SELECT SUM(v.total)
          FROM ventas v
          LEFT JOIN formas_pago fp 
            ON fp.id = v.forma_pago_id
           AND fp.empresa_id = $2
          WHERE date_trunc('month', v.fecha::date) = date_trunc('month', $1::date)
            AND v.empresa_id = $2
            AND lower(COALESCE(fp.tipo, '')) LIKE '%transf%'
            AND (v.estado_pago IS NULL OR v.estado_pago <> 'anulado')
        ), 0) AS ingreso_transferencia,

        COALESCE((
          SELECT SUM(c.total)
          FROM compras c
          WHERE date_trunc('month', c.fecha::date) = date_trunc('month', $1::date)
            AND c.empresa_id = $2
            AND c.tipo_pago = 'transferencia'
        ), 0) AS egreso_compras_transferencia
      `,
      [ymd, empresaId]
    );

    const dia = diaQ.rows[0] || {};
    const mes = mesQ.rows[0] || {};

    return res.json({
      ok: true,
      fecha: ymd,
      dia: {
        ingreso_efectivo: Number(dia.ingreso_efectivo || 0),
        egreso_compras_efectivo: Number(dia.egreso_compras_efectivo || 0),
        ingreso_transferencia: Number(dia.ingreso_transferencia || 0),
        egreso_compras_transferencia: Number(dia.egreso_compras_transferencia || 0)
      },
      mes: {
        ingreso_efectivo: Number(mes.ingreso_efectivo || 0),
        egreso_compras_efectivo: Number(mes.egreso_compras_efectivo || 0),
        ingreso_transferencia: Number(mes.ingreso_transferencia || 0),
        egreso_compras_transferencia: Number(mes.egreso_compras_transferencia || 0)
      }
    });

  } catch (err) {
    console.error("GET /caja/resumen", err);
    return res.status(500).json({ ok: false, msg: "Error resumen caja" });
  }
});
// APARTADO NUEVO: Movimientos con comprobante (para la pantalla Formas de Pago)
app.get("/formas-pago/movimientos", requireEmpresa, async (req, res) => {
  try {
    const empresaId = getEmpresaId(req);

    const q = await pool.query(
      `
      SELECT
        v.id,
        v.fecha,
        v.total,
        v.estado_pago,

        CASE
          WHEN lower(trim(fp.nombre)) LIKE '%otro banco%'
               AND v.banco_nombre IS NOT NULL
               AND trim(v.banco_nombre) <> ''
          THEN fp.nombre || ' (' || trim(v.banco_nombre) || ')'
          ELSE fp.nombre
        END AS forma_pago_nombre,

        v.nro_comprobante,

        COALESCE(
          c.nombre || ' ' || c.apellido,
          'Consumidor Final'
        ) AS cliente_nombre

      FROM ventas v

      LEFT JOIN formas_pago fp
        ON fp.id = v.forma_pago_id
       AND fp.empresa_id = $1

      LEFT JOIN clientes c
        ON c.id = v.cliente_id
       AND c.empresa_id = $1

      WHERE v.empresa_id = $1

      ORDER BY v.id DESC
      LIMIT 50
      `,
      [empresaId]
    );

    console.table(q.rows);

    res.json(q.rows);

  } catch (err) {
    console.error("❌ Error en /formas-pago/movimientos:", err);

    res.status(500).json({
      ok: false,
      msg: "Error cargando movimientos"
    });
  }
});

app.get("/ventas/:id/pagare", requireEmpresa, async (req, res) => {
  const empresaId = getEmpresaId(req);
  const ventaId = Number(req.params.id);
 
  try {
    /* ── 1. Datos de la venta ── */
    const vRow = await pool.query(
      `SELECT
         v.id,
         v.fecha,
         v.total,
         v.total_pyg,
         v.moneda,
         v.tipo_cambio,
         v.estado_pago,
         v.nro_comprobante,
         COALESCE(v.cajero_nombre, 'Sin usuario')          AS cajero_nombre,
         fp.nombre                                          AS forma_pago_nombre,
         COALESCE(c.nombre || ' ' || c.apellido,
                  'Consumidor Final')                      AS cliente_nombre,
         COALESCE(c.ci, '')                                AS cliente_ruc,
         COALESCE(c.direccion, '')                         AS cliente_direccion,
         COALESCE(c.telefono, '')                          AS cliente_telefono,
         e.nombre                                          AS empresa_nombre,
         COALESCE(e.ruc,       '')                         AS empresa_ruc,
         COALESCE(e.direccion, '')                         AS empresa_direccion,
         COALESCE(e.telefono,  '')                         AS empresa_telefono,
         COALESCE(e.email,     '')                         AS empresa_email,
         COALESCE(e.timbrado,  '')                         AS timbrado,
         COALESCE(e.nro_establecimiento, '001')            AS nro_est,
         COALESCE(e.nro_punto_expedicion, '001')           AS nro_punto
         FROM ventas v
         LEFT JOIN clientes       c  ON c.id = v.cliente_id      AND c.empresa_id = $2
         LEFT JOIN formas_pago    fp ON fp.id = v.forma_pago_id  AND fp.empresa_id = $2
         LEFT JOIN empresas       e  ON e.id = v.empresa_id
         WHERE v.id = $1 AND v.empresa_id = $2
         LIMIT 1`,
         [ventaId, empresaId]
        );
 
    if (!vRow.rows.length) return res.status(404).send("Venta no encontrada");
    const venta = vRow.rows[0];
 
    /* ── 2. Ítems de la venta ── */
    const itemsQ = await pool.query(
      `SELECT
         vi.cantidad,
         vi.precio,
         vi.subtotal,
         COALESCE(vi.iva_tipo, '10')   AS iva_tipo,   -- '5' | '10' | 'exenta'
         p.nombre                      AS producto_nombre
       FROM ventas_items vi
       JOIN productos p ON p.id = vi.producto_id AND p.empresa_id = $2
       WHERE vi.venta_id = $1 AND vi.empresa_id = $2
       ORDER BY vi.id ASC`,
      [ventaId, empresaId]
    );
    const items = itemsQ.rows;
 
    /* ── 3. Totales IVA ── */
    let totalExenta = 0, totalIva5 = 0, totalIva10 = 0;
    for (const it of items) {
      const sub = Number(it.subtotal || 0);
      if (it.iva_tipo === "exenta") totalExenta += sub;
      else if (it.iva_tipo === "5")  totalIva5   += sub;
      else                           totalIva10  += sub;
    }
    const ivaCalc5  = Math.round(totalIva5  * 5  / 105);
    const ivaCalc10 = Math.round(totalIva10 * 10 / 110);
    const totalIva  = ivaCalc5 + ivaCalc10;
    const totalPyg  = Number(venta.total_pyg ?? venta.total ?? 0);
 
    /* ── 4. Helpers ── */
    const fmtGs  = (n) => Number(n || 0).toLocaleString("es-PY");
    const fechaObj = venta.fecha ? new Date(venta.fecha) : new Date();
    const dia    = String(fechaObj.getDate()).padStart(2, "0");
    const mes    = String(fechaObj.getMonth() + 1).padStart(2, "0");
    const anio   = fechaObj.getFullYear();
 
    /* número de factura: nro_comprobante puede ser "0001114" o se genera */
    const nroFactura = venta.nro_comprobante
      ? String(venta.nro_comprobante).padStart(7, "0")
      : String(venta.id).padStart(7, "0");
    const nroCompleto = `${venta.nro_est}-${venta.nro_punto}-${nroFactura}`;
 
    /* ── 5. Construir PDF con PDFDocument (pdfkit) ── */
    // Tamaño oficio: 216 × 330 mm → 612 × 935 pts  (o carta 612×792)
    // Usamos carta apaisada para que quepa la tabla cómodamente
    const PAGE_W = 794;  // A4 landscape width ≈ 842, usamos un poco menos
    const PAGE_H = 560;
    const M = 28;        // margen general
 
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader(
      "Content-Disposition",
      `inline; filename=factura_${empresaId}_${ventaId}.pdf`
    );
 
    const doc = new PDFDocument({ size: [PAGE_W, PAGE_H], margin: M });
    doc.pipe(res);
 
    // ── Paleta ──
    const COLOR_BORDE  = "#000000";
    const COLOR_TITULO = "#cc0000";   // rojo para número grande
    const COLOR_HEADER = "#1a1a2e";   // azul oscuro encabezado tabla
    const COLOR_WHITE  = "#ffffff";
    const COLOR_LIGHT  = "#f5f5f5";
 
    const lw = (w) => doc.lineWidth(w);
    const fr = (x, y, w, h, opts = {}) => doc.rect(x, y, w, h);
 
    /* ════════════════════════════════════════
       BLOQUE SUPERIOR: empresa + datos factura
    ════════════════════════════════════════ */
    const hdrH = 95;
    const hdrY = M;
 
    // Borde exterior
    lw(1.2);
    doc.rect(M, hdrY, PAGE_W - M * 2, hdrH).stroke(COLOR_BORDE);
 
    // Logo empresa (izquierda)
    const logoPath = path.join(process.cwd(), "public", "img", "logo2.png");
    if (fs.existsSync(logoPath)) {
      doc.image(logoPath, M + 6, hdrY + 8, { width: 52 });
    }
 
    // Nombre empresa
    doc.font("Helvetica-Bold").fontSize(13)
   .fillColor(COLOR_BORDE)
   .text(venta.empresa_nombre || "EMPRESA", M + 64, hdrY + 10, {
     width: 310, align: "center"  // ← center
   });

   doc.font("Helvetica").fontSize(7.5).fillColor("#333")
   .text(venta.empresa_direccion,          M + 64, hdrY + 28, { width: 310, align: "center" })
   .text(`Tel: ${venta.empresa_telefono}`, M + 64, hdrY + 39, { width: 310, align: "center" })
   .text(`Email: ${venta.empresa_email}`,  M + 64, hdrY + 50, { width: 310, align: "center" });
    // Línea vertical divisoria
    const divX = PAGE_W - M - 200;
    lw(1);
    doc.moveTo(divX, hdrY).lineTo(divX, hdrY + hdrH).stroke(COLOR_BORDE);
 
    // Bloque derecho: timbrado + RUC + FACTURA
    const rX = divX + 8;
    const rW = PAGE_W - M - divX - 16;
 
    doc.font("Helvetica").fontSize(7)
       .fillColor("#000")
       .text(`Timbrado N°: ${venta.timbrado}`,          rX, hdrY + 8,  { width: rW })
 
    doc.font("Helvetica-Bold").fontSize(9)
       .text(`R.U.C.: ${venta.empresa_ruc}`, rX, hdrY + 40, { width: rW });
 
    doc.font("Helvetica-Bold").fontSize(13)
       .text("FACTURA", rX, hdrY + 53, { width: rW, align: "center" });
 
    // Número de factura en rojo grande
    doc.font("Helvetica-Bold").fontSize(14)
       .fillColor(COLOR_TITULO)
       .text(nroCompleto, rX, hdrY + 70, { width: rW, align: "center" });
    doc.fillColor("#000");
 
    /* ════════════════════════════════════════
       BLOQUE CLIENTE
    ════════════════════════════════════════ */
    const cliY = hdrY + hdrH + 4;
    const cliH = 58;
 
    lw(0.8);
    doc.rect(M, cliY, PAGE_W - M * 2, cliH).stroke(COLOR_BORDE);
 
    const col2 = PAGE_W / 2 + 20;
 
    // fila 1
    doc.font("Helvetica").fontSize(7.5);
    const lineH = 14;
 
    const drawField = (label, value, x, y, w) => {
      doc.font("Helvetica-Bold").text(label, x, y, { continued: true })
         .font("Helvetica").text(` ${value}`, { width: w });
      // underline
      doc.moveTo(x, y + 10).lineTo(x + w, y + 10).lineWidth(0.4).stroke("#aaa");
      lw(0.8);
    };
 
    const r1y = cliY + 6;
    drawField("Fecha de Emisión:", `${dia}  /  ${mes}  /  ${anio}`,
              M + 6, r1y, 260);
    // Condición de venta
    const cond = (venta.forma_pago_nombre || "CONTADO").toUpperCase();
    const esContado = cond.includes("CONTADO");
    doc.font("Helvetica-Bold").fontSize(7.5)
       .text("Cond. de Venta:", col2, r1y, { width: 80 });
    doc.font("Helvetica").fontSize(7.5)
       .text(`Contado [${esContado ? "X" : " "}]  Crédito [${esContado ? " " : "X"}]`,
             col2 + 82, r1y, { width: 130 });
 
    const r2y = r1y + lineH;
    drawField("Nombre o Razón Social:", venta.cliente_nombre, M + 6, r2y, PAGE_W - M * 2 - 12);
 
    const r3y = r2y + lineH;
    drawField("Dirección:", venta.cliente_direccion, M + 6, r3y, 260);
    drawField("R.U.C.:", venta.cliente_ruc,           col2, r3y, 160);
 
    const r4y = r3y + lineH;
    drawField("Cajero:", venta.cajero_nombre,         M + 6, r4y, 200);
    drawField("Tel.:", venta.cliente_telefono,        col2, r4y, 160);
 
    /* ════════════════════════════════════════
       TABLA DE ÍTEMS
    ════════════════════════════════════════ */
    const tblY  = cliY + cliH + 4;
    const tblX  = M;
    const tblW  = PAGE_W - M * 2;
 
    // Anchos de columna
    const colCant   = 45;
    const colDesc   = tblW - colCant - 90 - 85 - 85 - 85;
    const colPU     = 90;
    const colExenta = 85;
    const colIva5   = 85;
    const colIva10  = 85;
 
    const colXs = [
      tblX,
      tblX + colCant,
      tblX + colCant + colDesc,
      tblX + colCant + colDesc + colPU,
      tblX + colCant + colDesc + colPU + colExenta,
      tblX + colCant + colDesc + colPU + colExenta + colIva5,
    ];
 
    const rowH = 15;
    const hdrRowH = 22;
 
    // Cabecera tabla
    doc.rect(tblX, tblY, tblW, hdrRowH).fillAndStroke(COLOR_HEADER, COLOR_BORDE);
    doc.fillColor(COLOR_WHITE).font("Helvetica-Bold").fontSize(7.5);
 
    const thCentered = (txt, x, w, y = tblY + 4, h = hdrRowH - 8) => {
      doc.text(txt, x + 2, y, { width: w - 4, align: "center", height: h });
    };
 
    thCentered("CANT.",             colXs[0], colCant);
    thCentered("DESCRIPCIÓN",       colXs[1], colDesc);
    thCentered("PRECIO\nUNITARIO",  colXs[2], colPU);
 
    // Sub-cabecera "VALOR DE VENTAS"
    const vvX = colXs[3];
    const vvW = colExenta + colIva5 + colIva10;
    doc.text("VALOR DE VENTAS", vvX + 2, tblY + 2, { width: vvW - 4, align: "center" });
    thCentered("EXENTAS",  colXs[3], colExenta, tblY + 10, 10);
    thCentered("IVA 5 %",  colXs[4], colIva5,   tblY + 10, 10);
    thCentered("IVA 10 %", colXs[5], colIva10,  tblY + 10, 10);
 
    doc.fillColor("#000");
 
    // Líneas verticales cabecera
    lw(0.6);
    for (let i = 1; i < colXs.length; i++) {
      doc.moveTo(colXs[i], tblY).lineTo(colXs[i], tblY + hdrRowH).stroke(COLOR_BORDE);
    }
    // borde derecho
    doc.moveTo(tblX + tblW, tblY).lineTo(tblX + tblW, tblY + hdrRowH).stroke(COLOR_BORDE);
 
    // Filas de ítems (máx 8 para que quepan en la página)
    const MAX_ROWS = 8;
    const filledRows = items.slice(0, MAX_ROWS);
    while (filledRows.length < MAX_ROWS) filledRows.push(null);
 
    let rowY = tblY + hdrRowH;
    filledRows.forEach((it, idx) => {
      const bg = idx % 2 === 0 ? "#ffffff" : COLOR_LIGHT;
      doc.rect(tblX, rowY, tblW, rowH).fillAndStroke(bg, COLOR_BORDE);
 
      if (it) {
        const cant  = Number(it.cantidad  || 0);
        const pu    = Number(it.precio    || 0);
        const sub   = Number(it.subtotal  || 0);
        const isEx  = it.iva_tipo === "exenta";
        const is5   = it.iva_tipo === "5";
 
        doc.fillColor("#000").font("Helvetica").fontSize(7.5);
        const cell = (txt, x, w, align = "center") =>
          doc.text(String(txt), x + 2, rowY + 4, { width: w - 4, align });
 
        cell(cant,             colXs[0], colCant);
        cell(it.producto_nombre || "", colXs[1], colDesc, "left");
        cell(fmtGs(pu),        colXs[2], colPU);
        cell(isEx ? fmtGs(sub) : "",  colXs[3], colExenta);
        cell(is5  ? fmtGs(sub) : "",  colXs[4], colIva5);
        cell(!isEx && !is5 ? fmtGs(sub) : "", colXs[5], colIva10);
      }
 
      // líneas verticales
      for (let i = 1; i < colXs.length; i++) {
        lw(0.4);
        doc.moveTo(colXs[i], rowY).lineTo(colXs[i], rowY + rowH).stroke(COLOR_BORDE);
      }
      doc.moveTo(tblX + tblW, rowY).lineTo(tblX + tblW, rowY + rowH).stroke(COLOR_BORDE);
 
      rowY += rowH;
    });
 
    /* ── Sub-Totales ── */
    lw(0.8);
    doc.rect(tblX, rowY, tblW, rowH).fillAndStroke(COLOR_LIGHT, COLOR_BORDE);
    doc.fillColor("#000").font("Helvetica-Bold").fontSize(7.5)
       .text("SUB - TOTALES", tblX + 4, rowY + 4, {
         width: colCant + colDesc + colPU - 8, align: "left"
       });
 
    const subCell = (val, x, w) =>
      doc.text(fmtGs(val), x + 2, rowY + 4, { width: w - 4, align: "center" });
    subCell(totalExenta, colXs[3], colExenta);
    subCell(totalIva5,   colXs[4], colIva5);
    subCell(totalIva10,  colXs[5], colIva10);
 
    for (let i = 1; i < colXs.length; i++) {
      doc.moveTo(colXs[i], rowY).lineTo(colXs[i], rowY + rowH).stroke(COLOR_BORDE);
    }
    doc.moveTo(tblX + tblW, rowY).lineTo(tblX + tblW, rowY + rowH).stroke(COLOR_BORDE);
 
    rowY += rowH;
 
    /* ════════════════════════════════════════
       TOTAL A PAGAR + EN LETRAS
    ════════════════════════════════════════ */
    const ftrH = 30;
    lw(0.8);
    doc.rect(tblX, rowY, tblW, ftrH).stroke(COLOR_BORDE);
 
    doc.font("Helvetica-Bold").fontSize(8)
       .text("TOTAL A PAGAR", tblX + 4, rowY + 6, { width: 95 });
 
    doc.font("Helvetica-Bold").fontSize(7.5)
       .text(`GS. [${totalPyg > 0 && venta.moneda === "PYG" ? "X" : " "}]`, tblX + 100, rowY + 6, { width: 50 });
    doc.font("Helvetica-Bold").fontSize(7.5)
       .text(`U$ [${venta.moneda === "USD" ? "X" : " "}]`, tblX + 152, rowY + 6, { width: 50 });
 
    // "En letras" — si tienes una función numToWords, úsala; si no, dejamos espacio
    const enLetras = typeof numToWords === "function"
      ? numToWords(totalPyg)
      : "(ver importe arriba)";
    doc.font("Helvetica").fontSize(7.5)
       .text(`(En Letras): ${enLetras}`, tblX + 200, rowY + 6, {
         width: tblW - 370, align: "left"
       });
 
    // Caja total derecha
    const totBoxW = 160;
    const totBoxX = tblX + tblW - totBoxW;
    doc.rect(totBoxX, rowY, totBoxW, ftrH).stroke(COLOR_BORDE);
    doc.font("Helvetica-Bold").fontSize(10)
       .text(`Gs ${fmtGs(totalPyg)}`, totBoxX + 4, rowY + 8, {
         width: totBoxW - 8, align: "center"
       });
 
    rowY += ftrH;
 
    /* ════════════════════════════════════════
       LIQUIDACIÓN IVA
    ════════════════════════════════════════ */
    const ivaH = 20;
    lw(0.8);
    doc.rect(tblX, rowY, tblW, ivaH).stroke(COLOR_BORDE);
 
    const ivaColW = tblW / 3;
    doc.font("Helvetica-Bold").fontSize(7.5).fillColor("#000");
    doc.text(`LIQUIDACIÓN DEL IVA (5%): Gs ${fmtGs(ivaCalc5)}`,
             tblX + 4, rowY + 5, { width: ivaColW - 8 });
    doc.moveTo(tblX + ivaColW, rowY).lineTo(tblX + ivaColW, rowY + ivaH).stroke(COLOR_BORDE);
    doc.text(`(10%): Gs ${fmtGs(ivaCalc10)}`,
             tblX + ivaColW + 4, rowY + 5, { width: ivaColW - 8, align: "center" });
    doc.moveTo(tblX + ivaColW * 2, rowY).lineTo(tblX + ivaColW * 2, rowY + ivaH).stroke(COLOR_BORDE);
    doc.text(`TOTAL IVA: Gs ${fmtGs(totalIva)}`,
             tblX + ivaColW * 2 + 4, rowY + 5, { width: ivaColW - 8, align: "right" });
 
    rowY += ivaH;
 
    /* ════════════════════════════════════════
       PIE: ref venta + imprenta (pequeño)
    ════════════════════════════════════════ */
    doc.font("Helvetica").fontSize(6).fillColor("#666")
       .text(
         `Ref.: Venta N° ${String(venta.id).padStart(5, "0")}  |  Cajero: ${venta.cajero_nombre}  |  Forma de Pago: ${venta.forma_pago_nombre || "—"}`,
         tblX, rowY + 4, { width: tblW, align: "left" }
       );
 
    doc.end();
  } catch (err) {
    console.error("❌ Error generando factura:", err);
    res.status(500).send("Error generando factura");
  }
});
app.post("/caja/cerrar", requireEmpresa, async (req, res) => {
  try {
    const empresaId = getEmpresaId(req);
    const tipo = req.body?.tipo ? normTipoCaja(req.body.tipo) : null;

    // 🔥 Buscar caja abierta sin filtrar por fecha
    let query = `
      SELECT id
      FROM caja
      WHERE estado = 'abierta'
        AND empresa_id = $1
    `;
    const params = [empresaId];
    if (tipo) {
      params.push(tipo);
      query += ` AND tipo = $${params.length}`;
    }
    query += ` ORDER BY id DESC LIMIT 1`;

    const r = await pool.query(query, params);

    if (!r.rowCount) {
      return res.status(400).json({
        ok: false,
        msg: `No hay caja abierta${tipo ? ' de tipo ' + tipo : ''} para cerrar`
      });
    }

    const cajaId = r.rows[0].id;

    // Calcular saldo de cierre
    const saldoCierre = await pool.query(
      `
      SELECT (COALESCE(c.saldo_inicial, 0) + COALESCE(SUM(v.total), 0))::numeric AS total
      FROM caja c
      LEFT JOIN ventas v ON v.caja_id = c.id AND v.empresa_id = $2
      WHERE c.id = $1 AND c.empresa_id = $2
      GROUP BY c.id
      `,
      [cajaId, empresaId]
    );

    const saldoFinal = Number(saldoCierre.rows[0]?.total || 0);

    await pool.query(
      `
      UPDATE caja
      SET estado = 'cerrada',
          cerrado_en = NOW(),
          saldo_cierre = $1
      WHERE id = $2
        AND empresa_id = $3
      `,
      [saldoFinal, cajaId, empresaId]
    );

    return res.json({
      ok: true,
      caja_id: cajaId,
      saldo_cierre: saldoFinal
    });

  } catch (err) {
    console.error("POST /caja/cerrar", err);
    return res.status(500).json({
      ok: false,
      msg: "Error al cerrar caja"
    });
  }
});

app.get("/debug/db", async (_req, res) => {
  try {
    const r = await pool.query(`
      SELECT
        current_database() AS db,
        inet_server_addr() AS ip,
        inet_server_port() AS port,
        current_user AS "user"
    `);

    res.json({ ok: true, ...r.rows[0] });
  } catch (e) {
    console.error("GET /debug/db", e);
    res.status(500).json({ ok: false, error: e.message });
  }
});



app.post("/caja/cerrar/:id", requireEmpresa, async (req, res) => {
  try {
    const empresaId = getEmpresaId(req);
    const cajaId = Number(req.params.id);

    // Log para depuración (verás esto en la consola del servidor)
    console.log("🔴 POST /caja/cerrar/:id - ID:", cajaId, "Body:", req.body);

    if (!cajaId || isNaN(cajaId)) {
      return res.status(400).json({ ok: false, msg: "ID de caja inválido" });
    }

    // 1. Verificar que la caja existe, está abierta y pertenece a la empresa
    const cajaQ = await pool.query(
      `SELECT id, saldo_inicial FROM caja 
       WHERE id = $1 
         AND empresa_id = $2 
         AND estado = 'abierta'`,
      [cajaId, empresaId]
    );

    if (cajaQ.rows.length === 0) {
      return res.status(404).json({ ok: false, msg: "Caja no encontrada o ya cerrada" });
    }

    const saldoInicial = Number(cajaQ.rows[0].saldo_inicial || 0);

    // 2. Calcular el total de ventas asociadas a esta caja (sin anuladas)
    const ventasSum = await pool.query(
      `SELECT COALESCE(SUM(total), 0) AS total_ventas
       FROM ventas
       WHERE caja_id = $1 AND empresa_id = $2 AND (estado_pago IS NULL OR estado_pago <> 'anulado')`,
      [cajaId, empresaId]
    );
    const totalVentas = Number(ventasSum.rows[0].total_ventas || 0);
    const saldoCierre = saldoInicial + totalVentas;

    // 3. Actualizar la caja (cerrarla)
    const result = await pool.query(
      `
      UPDATE caja
      SET estado = 'cerrada',
          cerrado_en = NOW(),
          saldo_cierre = $1
      WHERE id = $2
        AND empresa_id = $3
        AND estado = 'abierta'
      RETURNING id
      `,
      [saldoCierre, cajaId, empresaId]
    );

    if (result.rows.length === 0) {
      return res.status(400).json({ ok: false, msg: "No se pudo cerrar la caja (posiblemente ya cerrada)" });
    }

    // Éxito
    return res.json({ ok: true, caja_id: cajaId });

  } catch (err) {
    console.error("POST /caja/cerrar/:id - Error:", err);

    // Si el error es del trigger de la base de datos (por horario), lo manejamos
    if (err.code === 'P0001' && err.message && err.message.includes('23:59')) {
      return res.status(400).json({ ok: false, msg: err.message });
    }

    // Cualquier otro error, devolvemos 500 con el mensaje
    return res.status(500).json({ ok: false, msg: "Error al cerrar caja", error: err.message });
  }
});

app.get("/debug/formas-pago-pool", requireEmpresa, async (req, res) => {
  try {
    const empresaId = getEmpresaId(req);

    const r = await pool.query(
      `
      SELECT id, nombre, tipo
      FROM formas_pago
      WHERE empresa_id = $1
      ORDER BY id
      `,
      [empresaId]
    );

    res.json(r.rows);
  } catch (e) {
    console.error("GET /debug/formas-pago-pool", e);
    res.status(500).json({ ok: false, error: e.message });
  }
});

app.post("/usuarios/seed-admin", async (_req, res) => {
  try {
    const empresaQ = await pool.query(
      `
      INSERT INTO empresas (nombre, ruc, logo, color_principal)
      VALUES ('SPYnet', '', 'img/logo.png', '#2563eb')
      ON CONFLICT DO NOTHING
      RETURNING id
      `
    );

    let empresaId = empresaQ.rows[0]?.id;

    if (!empresaId) {
      const empresaExiste = await pool.query(
        `
        SELECT id
        FROM empresas
        WHERE nombre = 'SPYnet'
        ORDER BY id ASC
        LIMIT 1
        `
      );

      empresaId = empresaExiste.rows[0]?.id || 1;
    }

    const usuario = "admin";
    const nombre = "Juan Perez";
    const password = "1234";

    const existe = await pool.query(
      `
      SELECT id
      FROM usuarios
      WHERE usuario = $1
      LIMIT 1
      `,
      [usuario]
    );

    if (existe.rowCount) {
      await pool.query(
        `
        UPDATE usuarios
        SET empresa_id = COALESCE(empresa_id, $1)
        WHERE usuario = $2
        `,
        [empresaId, usuario]
      );

      return res.json({
        ok: true,
        msg: "El admin ya existe"
      });
    }

    const hash = await bcrypt.hash(password, 10);

    await pool.query(
      `
      INSERT INTO usuarios (
        nombre,
        usuario,
        password_hash,
        rol,
        empresa_id
      )
      VALUES ($1,$2,$3,$4,$5)
      `,
      [
        nombre,
        usuario,
        hash,
        "admin",
        empresaId
      ]
    );

    res.json({
      ok: true,
      msg: "Admin creado"
    });

  } catch (err) {
    console.error("POST /usuarios/seed-admin", err);
    res.status(500).json({
      ok: false,
      msg: "Error creando admin"
    });
  }
});

app.post("/api/usuarios", requireEmpresa, async (req, res) => {
  try {
    const empresaId = getEmpresaId(req);
    const { nombre, usuario, password, rol, genero } = req.body;

    if (!nombre || !usuario || !password) {
      return res.status(400).json({ error: "Faltan datos obligatorios" });
    }

    const hash = await bcrypt.hash(password, 10);

    const { rows } = await pool.query(
      `
      INSERT INTO usuarios (nombre, usuario, password_hash, rol, genero, empresa_id)
      VALUES ($1, $2, $3, $4, $5, $6)
      RETURNING id, nombre, usuario, rol, genero, empresa_id
      `,
      [nombre, usuario, hash, rol || 'usuario', genero || 'M', empresaId]
    );

    return res.json(rows[0]);

  } catch (err) {
    console.error("POST /api/usuarios", err);
    res.status(500).json({ error: "Error al crear usuario" });
  }
});

app.put("/api/usuarios/:id", requireEmpresa, async (req, res) => {
  try {
    const empresaId = getEmpresaId(req);
    const id = Number(req.params.id);
    const { nombre, usuario, password, rol, genero } = req.body;

    if (!id) return res.status(400).json({ error: "ID inválido" });

    let rows;

    if (password && password.trim() !== "") {
      const hash = await bcrypt.hash(password, 10);

      const r = await pool.query(
        `
        UPDATE usuarios
        SET nombre = $1,
            usuario = $2,
            password_hash = $3,
            rol = $4,
            genero = $5
        WHERE id = $6
          AND empresa_id = $7
        RETURNING id, nombre, usuario, rol, genero, empresa_id
        `,
        [nombre, usuario, hash, rol, genero || 'M', id, empresaId]
      );
      rows = r.rows;

    } else {
      const r = await pool.query(
        `
        UPDATE usuarios
        SET nombre = $1,
            usuario = $2,
            rol = $3,
            genero = $4
        WHERE id = $5
          AND empresa_id = $6
        RETURNING id, nombre, usuario, rol, genero, empresa_id
        `,
        [nombre, usuario, rol, genero || 'M', id, empresaId]
      );
      rows = r.rows;
    }

    if (!rows.length) {
      return res.status(404).json({ error: "Usuario no encontrado o no pertenece a esta empresa" });
    }

    return res.json(rows[0]);

  } catch (err) {
    console.error("PUT /api/usuarios/:id", err);
    res.status(500).json({ error: "Error al actualizar usuario" });
  }
});

app.get("/api/usuarios", requireEmpresa, async (req, res) => {
  try {
    const empresaId = getEmpresaId(req);

    if (!empresaId) {
      return res.status(401).json({ error: "Empresa no identificada" });
    }

    const { rows } = await pool.query(
      `
      SELECT
        id,
        nombre,
        usuario,
        rol,
        genero,
        empresa_id
      FROM usuarios
      WHERE empresa_id = $1
      ORDER BY id ASC
      `,
      [empresaId]
    );

    res.json(rows);

  } catch (err) {
    console.error("GET /api/usuarios", err);
    res.status(500).json({ error: "Error al listar usuarios" });
  }
});

function fmtGs(n) {
  return `Gs. ${Number(n || 0).toLocaleString("es-PY")}`;
}

function fmtFechaLargaPY(fechaISO) {
  const d = new Date(`${fechaISO}T00:00:00`);
  return d.toLocaleDateString("es-PY");
}

function drawSimpleTable(doc, {
  x,
  y,
  colWidths,
  headers,
  rows,
  headerFill = "#2563eb",
  rowHeight = 24,
  fontSize = 10
}) {
  const tableWidth = colWidths.reduce((a, b) => a + b, 0);

  doc.save();
  doc.rect(x, y, tableWidth, rowHeight).fill(headerFill);
  doc.fillColor("#ffffff").font("Helvetica-Bold").fontSize(fontSize);

  let cx = x;

  headers.forEach((h, i) => {
    doc.text(h, cx + 6, y + 7, {
      width: colWidths[i] - 12,
      align: i === headers.length - 1 ? "right" : "left"
    });

    cx += colWidths[i];
  });

  let currentY = y + rowHeight;

  doc.font("Helvetica").fillColor("#111827");

  rows.forEach((row, idx) => {
    const bg = idx % 2 === 0 ? "#f9fafb" : "#ffffff";

    doc.rect(x, currentY, tableWidth, rowHeight).fill(bg);

    let rx = x;

    row.forEach((cell, i) => {
      doc.fillColor("#111827").text(String(cell ?? ""), rx + 6, currentY + 7, {
        width: colWidths[i] - 12,
        align: i === row.length - 1 ? "right" : "left"
      });

      rx += colWidths[i];
    });

    doc.strokeColor("#d1d5db")
      .lineWidth(0.5)
      .rect(x, currentY, tableWidth, rowHeight)
      .stroke();

    currentY += rowHeight;
  });

  doc.restore();
  return currentY;
}

app.get("/caja/informe/pdf", requireEmpresa, async (req, res) => {
  try {
    const empresaId = getEmpresaId(req);
    
    // 🔥 FUNCIÓN LOCAL PARA FECHA EN ZONA HORARIA DE PARAGUAY
    const hoyLocalPY = () => {
      const ahora = new Date();
      const formatter = new Intl.DateTimeFormat("en-CA", {
        timeZone: "America/Asuncion",
        year: "numeric",
        month: "2-digit",
        day: "2-digit"
      });
      return formatter.format(ahora);
    };

    // 🔥 FECHA PARAM: si no viene, usa fecha local de Paraguay
    const fechaParam = req.query.fecha || hoyLocalPY();
    const fecha = toISODate(fechaParam);
    const usuarioNombre = req.session?.user?.nombre || req.session?.user?.usuario || "Usuario";

    const primaryBlue = "#2563eb";
    const primaryGreen = "#16a34a";
    const primaryRed = "#dc2626";
    const darkText = "#111827";
    const mutedText = "#4b5563";
    const lineColor = "#d1d5db";

    const logoPath = path.join(process.cwd(), "public", "img", "logo2.png");

    const empresaQ = await pool.query(
      "SELECT nombre, telefono, email FROM empresas WHERE id=$1 LIMIT 1",
      [empresaId]
    );

    const empresaNombre = empresaQ.rows[0]?.nombre || "Empresa";
    const empresaTelefono = empresaQ.rows[0]?.telefono || "";
    const empresaEmail = empresaQ.rows[0]?.email || "";

    // 🔥 TODAS LAS CONSULTAS USAN `fecha` (YYYY-MM-DD) y la BD ya está en America/Asuncion
    const diaQ = await pool.query(
      `
      SELECT
        COALESCE((SELECT SUM(v.total) FROM ventas v LEFT JOIN formas_pago fp ON fp.id=v.forma_pago_id AND fp.empresa_id=$2
          WHERE v.fecha::date=$1::date AND v.empresa_id=$2 AND lower(COALESCE(fp.tipo,'')) LIKE '%efect%' AND (v.estado_pago IS NULL OR v.estado_pago <> 'anulado')),0) AS ingreso_efectivo,
        COALESCE((SELECT SUM(c.total) FROM compras c WHERE c.fecha::date=$1::date AND c.empresa_id=$2 AND c.tipo_pago='efectivo'),0) AS egreso_efectivo,
        COALESCE((SELECT SUM(v.total) FROM ventas v LEFT JOIN formas_pago fp ON fp.id=v.forma_pago_id AND fp.empresa_id=$2
          WHERE v.fecha::date=$1::date AND v.empresa_id=$2 AND lower(COALESCE(fp.tipo,'')) LIKE '%transf%' AND (v.estado_pago IS NULL OR v.estado_pago <> 'anulado')),0) AS ingreso_transferencia,
        COALESCE((SELECT SUM(c.total) FROM compras c WHERE c.fecha::date=$1::date AND c.empresa_id=$2 AND c.tipo_pago='transferencia'),0) AS egreso_transferencia
      `,
      [fecha, empresaId]
    );

    const mesQ = await pool.query(
      `
      SELECT
        COALESCE((SELECT SUM(v.total) FROM ventas v LEFT JOIN formas_pago fp ON fp.id=v.forma_pago_id AND fp.empresa_id=$2
          WHERE date_trunc('month', v.fecha::date)=date_trunc('month', $1::date) AND v.empresa_id=$2 AND lower(COALESCE(fp.tipo,'')) LIKE '%efect%' AND (v.estado_pago IS NULL OR v.estado_pago <> 'anulado')),0) AS ingreso_efectivo,
        COALESCE((SELECT SUM(c.total) FROM compras c WHERE date_trunc('month', c.fecha::date)=date_trunc('month', $1::date) AND c.empresa_id=$2 AND c.tipo_pago='efectivo'),0) AS egreso_efectivo,
        COALESCE((SELECT SUM(v.total) FROM ventas v LEFT JOIN formas_pago fp ON fp.id=v.forma_pago_id AND fp.empresa_id=$2
          WHERE date_trunc('month', v.fecha::date)=date_trunc('month', $1::date) AND v.empresa_id=$2 AND lower(COALESCE(fp.tipo,'')) LIKE '%transf%' AND (v.estado_pago IS NULL OR v.estado_pago <> 'anulado')),0) AS ingreso_transferencia,
        COALESCE((SELECT SUM(c.total) FROM compras c WHERE date_trunc('month', c.fecha::date)=date_trunc('month', $1::date) AND c.empresa_id=$2 AND c.tipo_pago='transferencia'),0) AS egreso_transferencia
      `,
      [fecha, empresaId]
    );

    const dia = diaQ.rows[0];
    const mes = mesQ.rows[0];

    const diaIngresoEf = Number(dia.ingreso_efectivo || 0);
    const diaEgresoEf = Number(dia.egreso_efectivo || 0);
    const diaSaldoEf = diaIngresoEf - diaEgresoEf;

    const diaIngresoTr = Number(dia.ingreso_transferencia || 0);
    const diaEgresoTr = Number(dia.egreso_transferencia || 0);
    const diaSaldoTr = diaIngresoTr - diaEgresoTr;

    const saldoDia = diaSaldoEf + diaSaldoTr;

    const mesIngresoEf = Number(mes.ingreso_efectivo || 0);
    const mesEgresoEf = Number(mes.egreso_efectivo || 0);
    const mesSaldoEf = mesIngresoEf - mesEgresoEf;

    const mesIngresoTr = Number(mes.ingreso_transferencia || 0);
    const mesEgresoTr = Number(mes.egreso_transferencia || 0);
    const mesSaldoTr = mesIngresoTr - mesEgresoTr;

    const saldoMes = mesSaldoEf + mesSaldoTr;

    const ventasQ = await pool.query(
      `
      SELECT
        v.id,
        v.fecha,
        COALESCE(c.nombre || ' ' || c.apellido, 'Consumidor Final') AS cliente,
        COALESCE(fp.nombre, '-') AS forma_pago,
        v.total,
        COALESCE((
          SELECT STRING_AGG(p.nombre || ' x' || vi.cantidad, ', ' ORDER BY vi.id)
          FROM ventas_items vi
          JOIN productos p ON p.id = vi.producto_id AND p.empresa_id = $2
          WHERE vi.venta_id = v.id AND vi.empresa_id = $2
        ), '-') AS detalle_productos
      FROM ventas v
      LEFT JOIN clientes c ON c.id = v.cliente_id AND c.empresa_id = $2
      LEFT JOIN formas_pago fp ON fp.id = v.forma_pago_id AND fp.empresa_id = $2
      WHERE v.fecha::date = $1::date
        AND v.empresa_id = $2
        AND (v.estado_pago IS NULL OR v.estado_pago <> 'anulado')
      ORDER BY v.id DESC
      `,
      [fecha, empresaId]
    );

    const comprasQ = await pool.query(
      `
      SELECT
        c.id,
        c.fecha,
        COALESCE(p.nombre, '-') AS proveedor,
        COALESCE(c.factura, '-') AS factura,
        COALESCE(c.tipo_pago, '-') AS tipo_pago,
        c.total,
        COALESCE((
          SELECT STRING_AGG(pr.nombre || ' x' || ci.cantidad, ', ' ORDER BY ci.id)
          FROM compras_items ci
          JOIN productos pr ON pr.id = ci.producto_id AND pr.empresa_id = $2
          WHERE ci.compra_id = c.id AND ci.empresa_id = $2
        ), '-') AS detalle_productos
      FROM compras c
      LEFT JOIN proveedores p ON p.id = c.proveedor_id AND p.empresa_id = $2
      WHERE c.fecha::date = $1::date
        AND c.empresa_id = $2
      ORDER BY c.id DESC
      `,
      [fecha, empresaId]
    );

    let egresosRows = [];
    try {
      const egresosQ = await pool.query(
        `
        SELECT fecha, COALESCE(concepto, '-') AS concepto, COALESCE(descripcion, '-') AS descripcion, monto
        FROM egresos
        WHERE fecha::date = $1::date
          AND empresa_id = $2
        ORDER BY id DESC
        `,
        [fecha, empresaId]
      );
      egresosRows = egresosQ.rows;
    } catch (e) {
      egresosRows = [];
    }

    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `inline; filename=informe_caja_${empresaId}_${fecha}.pdf`);

    const doc = new PDFDocument({ size: "A4", margin: 40 });
    doc.pipe(res);

    if (fs.existsSync(logoPath)) {
      doc.image(logoPath, 40, 32, { width: 70 });
    }

    doc.font("Helvetica-Bold").fontSize(24).fillColor(darkText).text("Informe de Caja", 120, 40);
    doc.font("Helvetica").fontSize(11).fillColor(mutedText)
      .text(`${empresaNombre}`, 120, 72)
      .text(empresaTelefono ? `Tel: ${empresaTelefono}` : "", 120, 88)
      .text(empresaEmail ? `Email: ${empresaEmail}` : "", 120, 104);

    doc.moveTo(40, 128).lineTo(555, 128).strokeColor(lineColor).lineWidth(1).stroke();
    doc.y = 145;

    doc.font("Helvetica-Bold").fontSize(14).fillColor(darkText).text("Resumen del Día");
    let y = doc.y + 8;

    y = drawSimpleTable(doc, {
      x: 40,
      y,
      colWidths: [320, 180],
      headers: ["Concepto", "Monto"],
      headerFill: primaryBlue,
      rows: [
        ["Ingreso Efectivo", fmtGs(diaIngresoEf)],
        ["Egreso Efectivo", fmtGs(diaEgresoEf)],
        ["Saldo Efectivo", fmtGs(diaSaldoEf)],
        ["Ingreso Transferencia", fmtGs(diaIngresoTr)],
        ["Egreso Transferencia", fmtGs(diaEgresoTr)],
        ["Saldo Transferencia", fmtGs(diaSaldoTr)],
        ["Saldo Total del Día", fmtGs(saldoDia)],
      ]
    });

    y += 28;
    doc.font("Helvetica-Bold").fontSize(14).fillColor(darkText).text("Resumen del Mes", 40, y);
    y += 25;

    y = drawSimpleTable(doc, {
      x: 40,
      y,
      colWidths: [320, 180],
      headers: ["Concepto", "Monto"],
      headerFill: primaryGreen,
      rows: [
        ["Ingreso Efectivo", fmtGs(mesIngresoEf)],
        ["Egreso Efectivo", fmtGs(mesEgresoEf)],
        ["Saldo Efectivo", fmtGs(mesSaldoEf)],
        ["Ingreso Transferencia", fmtGs(mesIngresoTr)],
        ["Egreso Transferencia", fmtGs(mesEgresoTr)],
        ["Saldo Transferencia", fmtGs(mesSaldoTr)],
        ["Saldo Total del Mes", fmtGs(saldoMes)],
      ]
    });

    doc.addPage();

    doc.font("Helvetica-Bold").fontSize(16).fillColor(darkText).text("Detalle de Ventas del Día", 40, 30);
    y = 70;

    // 🔥 Formatear fecha en zona horaria de Paraguay para la tabla (usamos la misma lógica de hoyLocalPY)
    const formatFechaParaTabla = (fechaObj) => {
      if (!fechaObj) return "-";
      const d = new Date(fechaObj);
      if (isNaN(d)) return "-";
      const formatter = new Intl.DateTimeFormat("en-CA", {
        timeZone: "America/Asuncion",
        year: "numeric",
        month: "2-digit",
        day: "2-digit"
      });
      return formatter.format(d);
    };

    const rowsVentas = ventasQ.rows.length
      ? ventasQ.rows.map(v => [
          formatFechaParaTabla(v.fecha),
          v.cliente,
          v.detalle_productos,
          v.forma_pago,
          fmtGs(v.total)
        ])
      : [["-", "Sin ventas registradas", "-", "-", fmtGs(0)]];

    y = drawSimpleTable(doc, {
      x: 40,
      y,
      colWidths: [70, 120, 190, 85, 80],
      headers: ["Fecha", "Cliente", "Productos", "Pago", "Total"],
      headerFill: primaryBlue,
      rows: rowsVentas
    });

    y += 30;
    if (y > 680) {
      doc.addPage();
      y = 50;
    }

    doc.font("Helvetica-Bold").fontSize(16).fillColor(darkText).text("Detalle de Compras del Día", 40, y);
    y += 25;

    const rowsCompras = comprasQ.rows.length
      ? comprasQ.rows.map(c => [
          formatFechaParaTabla(c.fecha),
          c.proveedor,
          c.detalle_productos,
          c.tipo_pago,
          fmtGs(c.total)
        ])
      : [["-", "Sin compras registradas", "-", "-", fmtGs(0)]];

    y = drawSimpleTable(doc, {
      x: 40,
      y,
      colWidths: [70, 120, 190, 85, 80],
      headers: ["Fecha", "Proveedor", "Productos", "Tipo pago", "Total"],
      headerFill: primaryGreen,
      rows: rowsCompras
    });

    y += 30;
    if (y > 680) {
      doc.addPage();
      y = 50;
    }

    doc.font("Helvetica-Bold").fontSize(16).fillColor(darkText).text("Detalle de Egresos del Día", 40, y);
    y += 25;

    const rowsEgresos = egresosRows.length
      ? egresosRows.map(e => [
          formatFechaParaTabla(e.fecha),
          e.concepto,
          e.descripcion,
          fmtGs(e.monto)
        ])
      : [["-", "Sin egresos registrados", "-", fmtGs(0)]];

    y = drawSimpleTable(doc, {
      x: 40,
      y,
      colWidths: [80, 140, 220, 75],
      headers: ["Fecha", "Concepto", "Descripción", "Monto"],
      headerFill: primaryRed,
      rows: rowsEgresos
    });

    doc.fontSize(9).fillColor("#6b7280");
    doc.text(
      `Documento generado automáticamente por ${empresaNombre} • Usuario: ${usuarioNombre}`,
      40,
      780,
      { align: "center", width: 515 }
    );

    doc.end();

  } catch (err) {
    console.error("GET /caja/informe/pdf", err);
    res.status(500).send("Error generando informe PDF");
  }
});
app.get("/cuentas-pagar", requireEmpresa, async (req, res) => {
  try {
    const empresaId = getEmpresaId(req);

    const { rows } = await pool.query(
      `
      SELECT
        id,
        proveedor,
        factura,
        concepto,
        moneda,
        tipo_cambio,
        monto,
        monto_pyg,
        monto_moneda,
        vencimiento,
        estado,
        fecha_pago,
        pagado_en,
        caja_tipo,
        caja
      FROM cuentas_pagar
      WHERE empresa_id = $1
      ORDER BY id DESC
      `,
      [empresaId]
    );

    res.json(rows);
  } catch (err) {
    console.error("GET /cuentas-pagar", err);
    res.status(500).json({ error: "Error al listar cuentas a pagar" });
  }
});

app.get("/config/monedas", requireEmpresa, async (req, res) => {
  try {
    const empresaId = getEmpresaId(req);

    const { rows } = await pool.query(
      `
      SELECT moneda, tipo_cambio
      FROM configuracion_monedas
      WHERE empresa_id = $1
      ORDER BY moneda
      `,
      [empresaId]
    );

    res.json({ ok: true, monedas: rows });
  } catch (err) {
    console.error("GET /config/monedas", err);
    res.status(500).json({ ok: false, msg: "Error obteniendo monedas" });
  }
});


app.put("/config/monedas", requireEmpresa, requireAdmin, async (req, res) => {
  try {
    const empresaId = getEmpresaId(req);
    const usd = Number(req.body?.USD || 0);
    const brl = Number(req.body?.BRL || 0);

    if (usd <= 0 || brl <= 0) {
      return res.status(400).json({ ok: false, msg: "Tipo de cambio inválido" });
    }

    await pool.query(
      `
      INSERT INTO configuracion_monedas (moneda, tipo_cambio, actualizado_en, empresa_id)
      VALUES 
        ('USD', $1, NOW(), $3),
        ('BRL', $2, NOW(), $3)
      ON CONFLICT (moneda, empresa_id)
      DO UPDATE SET 
        tipo_cambio = EXCLUDED.tipo_cambio,
        actualizado_en = NOW()
      `,
      [usd, brl, empresaId]
    );

    res.json({ ok: true, msg: "Tipo de cambio actualizado" });
  } catch (err) {
    console.error("PUT /config/monedas", err);
    res.status(500).json({ ok: false, msg: "Error actualizando monedas" });
  }
});

app.post("/cuentas-pagar", requireEmpresa, async (req, res) => {
  try {
    const empresaId = getEmpresaId(req);

    const {
      proveedor,
      factura,
      concepto,
      moneda = "PYG",
      tipo_cambio = 1,
      monto,
      monto_pyg,
      monto_moneda,
      vencimiento,
      estado,
      fecha_pago,
      caja_tipo
    } = req.body;

    const monedaFinal = String(moneda || "PYG").toUpperCase();
    const tipoCambioFinal = Number(tipo_cambio || 1);
    const montoPygFinal = Number(monto_pyg || monto || 0);
    const montoMonedaFinal = Number(
      monto_moneda || (monedaFinal === "PYG" ? montoPygFinal : montoPygFinal / tipoCambioFinal)
    );

    const { rows } = await pool.query(
      `
      INSERT INTO cuentas_pagar (
        proveedor,
        factura,
        concepto,
        moneda,
        tipo_cambio,
        monto,
        monto_pyg,
        monto_moneda,
        vencimiento,
        estado,
        fecha_pago,
        caja_tipo,
        empresa_id
      )
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
      RETURNING *
      `,
      [
        proveedor,
        factura,
        concepto,
        monedaFinal,
        tipoCambioFinal,
        montoPygFinal,
        montoPygFinal,
        montoMonedaFinal,
        vencimiento,
        estado,
        fecha_pago,
        caja_tipo,
        empresaId
      ]
    );

    res.json(rows[0]);
  } catch (err) {
    console.error("Error POST /cuentas-pagar:", err);
    res.status(500).json({ error: err.message });
  }
});

app.put("/cuentas-pagar/:id", requireEmpresa, async (req, res) => {
  try {
    const empresaId = getEmpresaId(req);
    const { id } = req.params;

    const {
      proveedor,
      factura,
      concepto,
      moneda = "PYG",
      tipo_cambio = 1,
      monto,
      monto_pyg,
      monto_moneda,
      vencimiento,
      estado,
      fecha_pago,
      caja_tipo
    } = req.body;

    const monedaFinal = String(moneda || "PYG").toUpperCase();
    const tipoCambioFinal = Number(tipo_cambio || 1);
    const montoPygFinal = Number(monto_pyg || monto || 0);
    const montoMonedaFinal = Number(
      monto_moneda || (monedaFinal === "PYG" ? montoPygFinal : montoPygFinal / tipoCambioFinal)
    );

    const { rows } = await pool.query(
      `
      UPDATE cuentas_pagar
      SET proveedor = $1,
          factura = $2,
          concepto = $3,
          moneda = $4,
          tipo_cambio = $5,
          monto = $6,
          monto_pyg = $7,
          monto_moneda = $8,
          vencimiento = $9,
          estado = $10,
          fecha_pago = $11,
          caja_tipo = $12
      WHERE id = $13
        AND empresa_id = $14
      RETURNING *
      `,
      [
        proveedor,
        factura,
        concepto,
        monedaFinal,
        tipoCambioFinal,
        montoPygFinal,
        montoPygFinal,
        montoMonedaFinal,
        vencimiento,
        estado,
        fecha_pago,
        caja_tipo,
        id,
        empresaId
      ]
    );

    if (!rows.length) {
      return res.status(404).json({ error: "Cuenta no encontrada o no pertenece a esta empresa" });
    }

    res.json(rows[0]);
  } catch (err) {
    console.error("Error PUT /cuentas-pagar/:id:", err);
    res.status(500).json({ error: err.message });
  }
});

app.delete("/api/usuarios/:id", requireEmpresa, async (req, res) => {
  try {
    const empresaId = getEmpresaId(req);
    const id = Number(req.params.id);

    if (!id) return res.status(400).json({ error: "ID inválido" });

    const { rowCount } = await pool.query(
      `
      DELETE FROM usuarios
      WHERE id = $1
        AND empresa_id = $2
      `,
      [id, empresaId]
    );

    if (rowCount === 0) {
      return res.status(404).json({ error: "Usuario no encontrado o no pertenece a esta empresa" });
    }

    res.json({ ok: true });
  } catch (err) {
    console.error("DELETE /api/usuarios/:id", err);
    res.status(500).json({ error: "Error al eliminar usuario" });
  }
});

app.get("/api/notificaciones", requireEmpresa, async (req, res) => {
  try {
    const empresaId = getEmpresaId(req);
    const alertas = [];

    const stockBajo = await pool.query(
      `
      SELECT 
        p.nombre,
        COALESCE(c.nombre, 'Sin categoría') AS categoria,
        COALESCE(p.stock, 0) AS stock
      FROM productos p
      LEFT JOIN categorias c 
        ON c.id = p.categoria_id
       AND c.empresa_id = $1
      WHERE COALESCE(p.activo, true) = true
        AND p.empresa_id = $1
        AND COALESCE(p.stock, 0) <= 2
      ORDER BY COALESCE(p.stock, 0) ASC, p.nombre ASC
      LIMIT 10
      `,
      [empresaId]
    );

    stockBajo.rows.forEach(p => {
      alertas.push({
        tipo: "stock",
        titulo: "Stock crítico",
        mensaje: `${p.nombre} tiene solo ${p.stock} unidades`
      });
    });

    const cajaAbierta = await pool.query(
      `
      SELECT tipo, fecha
      FROM caja
      WHERE estado = 'abierta'
        AND empresa_id = $1
      ORDER BY id DESC
      LIMIT 1
      `,
      [empresaId]
    );

    if (cajaAbierta.rowCount) {
      const c = cajaAbierta.rows[0];
      alertas.push({
        tipo: "caja",
        titulo: "Caja abierta",
        mensaje: `Hay una caja ${c.tipo || ""} abierta`
      });
    }

    res.json({ ok: true, alertas });
  } catch (err) {
    console.error("GET /api/notificaciones", err);
    res.status(500).json({ ok: false, alertas: [] });
  }
});

app.post("/api/asistente-admin", requireEmpresa, async (req, res) => {
  try {
    const empresaId = getEmpresaId(req);

    const pregunta = String(req.body.pregunta || "")
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .trim();

    if (!pregunta) {
      return res.json({ ok: true, respuesta: "Escribí una consulta para ayudarte." });
    }

    const money = (n) =>
      "Gs. " + new Intl.NumberFormat("es-PY").format(Number(n || 0));

    const fechaPY = (f) =>
      f ? new Date(f).toLocaleDateString("es-PY") : "Pendiente";

    // ─── Detección de período ───────────────────────────────────────────────
    const esHoy  = /\b(hoy|dia|hd)\b/.test(pregunta);
    const esAyer = /\b(ayer)\b/.test(pregunta);
    const esMes  = /\b(mes|mensual|este mes)\b/.test(pregunta);
    const esTodo = !esHoy && !esAyer && !esMes; // sin período = todo

    let textoPeriodo = "en total";
    let filtroFecha  = "";        // para ventas/compras (campo: fecha)
    let filtroPedido = "";        // para pedidos       (campo: fecha_pedido)

    if (esHoy) {
      textoPeriodo = "hoy";
      filtroFecha  = " AND fecha::date = CURRENT_DATE";
      filtroPedido = " AND fecha_pedido::date = CURRENT_DATE";
    } else if (esAyer) {
      textoPeriodo = "ayer";
      filtroFecha  = " AND fecha::date = CURRENT_DATE - INTERVAL '1 day'";
      filtroPedido = " AND fecha_pedido::date = CURRENT_DATE - INTERVAL '1 day'";
    } else if (esMes) {
      textoPeriodo = "este mes";
      filtroFecha  = " AND date_trunc('month', fecha::date) = date_trunc('month', CURRENT_DATE)";
      filtroPedido = " AND date_trunc('month', fecha_pedido::date) = date_trunc('month', CURRENT_DATE)";
    }

    // ─── Detección de tema ──────────────────────────────────────────────────
    const esVenta    = /venta|vendi|vendido|ingreso|cuanto gane|cobr/.test(pregunta);
    const esCompra   = /compra|compre|proveedor.*pag|gasto/.test(pregunta);
    const esEgreso   = /egreso|gasto|salida/.test(pregunta);
    const esPedido   = /pedido|pedi|orden/.test(pregunta);
    const esStock    = /stock|inventario|producto|unidad/.test(pregunta);
    const esStockBajo= /stock bajo|stock critico|poco stock|sin stock|quedan poco/.test(pregunta);
    const esCaja     = /caja/.test(pregunta);
    const esCliente  = /cliente/.test(pregunta);
    const esProveedor= /proveedor/.test(pregunta);
    const esCuenta   = /cuenta|pagar|deuda|pendiente/.test(pregunta);
    const esMargen   = /margen|ganancia|rentabilidad|profit|gane/.test(pregunta);
    const esTodo2    = /todo|resumen|general|dame todo|informe|reporte/.test(pregunta);

    // ─── Helper de query ────────────────────────────────────────────────────
    const q = (sql, params) => pool.query(sql, params);

    // ════════════════════════════════════════════════════════════════════════
    // RESUMEN COMPLETO
    // ════════════════════════════════════════════════════════════════════════
    if (esTodo2) {
      const [ventas, compras, egresos, pedidos, stockQ, stockBajoQ, cajaQ, clientesQ, provQ, cuentasQ] =
        await Promise.all([
          q(`SELECT COUNT(*) AS c, COALESCE(SUM(COALESCE(total_pyg,total,0)),0) AS t FROM ventas   WHERE empresa_id=$1${filtroFecha}`,  [empresaId]),
          q(`SELECT COUNT(*) AS c, COALESCE(SUM(total),0) AS t                    FROM compras  WHERE empresa_id=$1${filtroFecha}`,  [empresaId]),
          q(`SELECT COUNT(*) AS c, COALESCE(SUM(monto),0) AS t                    FROM egresos  WHERE empresa_id=$1${filtroFecha}`,  [empresaId]),
          q(`SELECT COUNT(*) AS c, COALESCE(SUM(total),0) AS t                    FROM pedidos_prov WHERE empresa_id=$1${filtroPedido}`, [empresaId]),
          q(`SELECT COUNT(*) AS productos, COALESCE(SUM(stock),0) AS unidades FROM productos WHERE empresa_id=$1 AND COALESCE(activo,true)=true`, [empresaId]),
          q(`SELECT nombre, COALESCE(stock,0) AS stock FROM productos WHERE empresa_id=$1 AND COALESCE(activo,true)=true AND COALESCE(stock,0)<=2 ORDER BY stock ASC LIMIT 5`, [empresaId]),
          q(`SELECT tipo, fecha FROM caja WHERE empresa_id=$1 AND estado='abierta' ORDER BY id DESC LIMIT 3`, [empresaId]),
          q(`SELECT COUNT(*) AS total FROM clientes    WHERE empresa_id=$1`, [empresaId]),
          q(`SELECT COUNT(*) AS total FROM proveedores WHERE empresa_id=$1`, [empresaId]),
          q(`SELECT COUNT(*) AS c, COALESCE(SUM(monto),0) AS t FROM cuentas_pagar WHERE empresa_id=$1 AND LOWER(COALESCE(estado,''))='pendiente'`, [empresaId]),
        ]);

      const vt = ventas.rows[0];
      const ct = compras.rows[0];
      const et = egresos.rows[0];
      const pt = pedidos.rows[0];
      const st = stockQ.rows[0];
      const margenVal = Number(vt.t) - Number(ct.t) - Number(et.t);

      const lineasStockBajo = stockBajoQ.rowCount
        ? stockBajoQ.rows.map(p => `&nbsp;&nbsp;• ${p.nombre}: ${p.stock} uds`).join("<br>")
        : "&nbsp;&nbsp;• Ninguno";

      const lineasCaja = cajaQ.rowCount
        ? cajaQ.rows.map(c => `&nbsp;&nbsp;• ${c.tipo} desde ${fechaPY(c.fecha)}`).join("<br>")
        : "&nbsp;&nbsp;• Sin cajas abiertas";

      const respuesta =
        `<b>📊 Resumen ${textoPeriodo}:</b><br><br>` +

        `<b>💰 Ventas:</b> ${vt.c} operaciones → ${money(vt.t)}<br>` +
        `<b>🛒 Compras:</b> ${ct.c} registros → ${money(ct.t)}<br>` +
        `<b>📤 Egresos:</b> ${et.c} registros → ${money(et.t)}<br>` +
        `<b>📦 Pedidos a proveedor:</b> ${pt.c} → ${money(pt.t)}<br><br>` +

        `<b>📈 Margen estimado:</b> ${money(margenVal)}<br><br>` +

        `<b>🏪 Inventario:</b> ${st.productos} productos activos, ${st.unidades} unidades<br>` +
        `<b>⚠️ Stock bajo (≤2 uds):</b><br>${lineasStockBajo}<br><br>` +

        `<b>🗄️ Caja:</b><br>${lineasCaja}<br><br>` +

        `<b>👥 Clientes:</b> ${clientesQ.rows[0].total} registrados<br>` +
        `<b>🏭 Proveedores:</b> ${provQ.rows[0].total} registrados<br>` +
        `<b>💳 Cuentas pendientes:</b> ${cuentasQ.rows[0].c} por ${money(cuentasQ.rows[0].t)}`;

      return res.json({ ok: true, respuesta });
    }

    // ════════════════════════════════════════════════════════════════════════
    // RESPUESTAS INDIVIDUALES
    // ════════════════════════════════════════════════════════════════════════
    let respuesta = "No entendí la consulta. Podés preguntarme sobre ventas, compras, egresos, stock, caja, clientes, proveedores, pedidos, cuentas a pagar o margen. También podés escribir <b>resumen</b> para ver todo.";

    // VENTAS
    if (esVenta) {
      const r = await q(
        `SELECT COUNT(*) AS c, COALESCE(SUM(COALESCE(total_pyg,total,0)),0) AS t FROM ventas WHERE empresa_id=$1${filtroFecha}`,
        [empresaId]
      );
      respuesta = `💰 <b>Ventas ${textoPeriodo}:</b> ${r.rows[0].c} operaciones por <b>${money(r.rows[0].t)}</b>.`;
    }

    // COMPRAS
    else if (esCompra) {
      const r = await q(
        `SELECT COUNT(*) AS c, COALESCE(SUM(total),0) AS t FROM compras WHERE empresa_id=$1${filtroFecha}`,
        [empresaId]
      );
      respuesta = `🛒 <b>Compras ${textoPeriodo}:</b> ${r.rows[0].c} registros por <b>${money(r.rows[0].t)}</b>.`;
    }

    // EGRESOS
    else if (esEgreso) {
      const r = await q(
        `SELECT COUNT(*) AS c, COALESCE(SUM(monto),0) AS t FROM egresos WHERE empresa_id=$1${filtroFecha}`,
        [empresaId]
      );
      respuesta = `📤 <b>Egresos ${textoPeriodo}:</b> ${r.rows[0].c} registros por <b>${money(r.rows[0].t)}</b>.`;
    }

    // PEDIDOS
    else if (esPedido) {
      const r = await q(
        `SELECT COUNT(*) AS c, COALESCE(SUM(total),0) AS t FROM pedidos_prov WHERE empresa_id=$1${filtroPedido}`,
        [empresaId]
      );
      respuesta = `<b>Pedidos ${textoPeriodo}:</b> ${r.rows[0].c} por <b>${money(r.rows[0].t)}</b>.`;
    }

    // STOCK BAJO
    else if (esStockBajo) {
      const r = await q(
        `SELECT nombre, COALESCE(stock,0) AS stock FROM productos
         WHERE empresa_id=$1 AND COALESCE(activo,true)=true AND COALESCE(stock,0)<=2
         ORDER BY stock ASC, nombre ASC LIMIT 10`,
        [empresaId]
      );
      respuesta = r.rowCount
        ? "<b>Productos con stock bajo:</b><br>" + r.rows.map(p => `• ${p.nombre}: ${p.stock} uds`).join("<br>")
        : "No hay productos con stock bajo.";
    }

    // STOCK / INVENTARIO
    else if (esStock) {
      const r = await q(
        `SELECT COUNT(*) AS productos, COALESCE(SUM(stock),0) AS unidades FROM productos WHERE empresa_id=$1 AND COALESCE(activo,true)=true`,
        [empresaId]
      );
      respuesta = `<b>Inventario:</b> ${r.rows[0].productos} productos activos con ${r.rows[0].unidades} unidades en stock.`;
    }

    // CAJA
    else if (esCaja) {
      const r = await q(
        `SELECT tipo, fecha FROM caja WHERE empresa_id=$1 AND estado='abierta' ORDER BY id DESC LIMIT 5`,
        [empresaId]
      );
      respuesta = r.rowCount
        ? "🗄️ <b>Cajas abiertas:</b><br>" + r.rows.map(c => `• ${c.tipo} desde ${fechaPY(c.fecha)}`).join("<br>")
        : "🗄️ No hay cajas abiertas actualmente.";
    }

    // CLIENTES
    else if (esCliente) {
      const r = await q(`SELECT COUNT(*) AS total FROM clientes WHERE empresa_id=$1`, [empresaId]);
      respuesta = `👥 <b>Clientes:</b> ${r.rows[0].total} registrados.`;
    }

    // PROVEEDORES
    else if (esProveedor) {
      const r = await q(`SELECT COUNT(*) AS total FROM proveedores WHERE empresa_id=$1`, [empresaId]);
      respuesta = `🏭 <b>Proveedores:</b> ${r.rows[0].total} registrados.`;
    }

    // CUENTAS A PAGAR
    else if (esCuenta) {
      const r = await q(
        `SELECT COUNT(*) AS c, COALESCE(SUM(monto),0) AS t FROM cuentas_pagar WHERE empresa_id=$1 AND LOWER(COALESCE(estado,''))='pendiente'`,
        [empresaId]
      );
      respuesta = `💳 <b>Cuentas pendientes:</b> ${r.rows[0].c} por <b>${money(r.rows[0].t)}</b>.`;
    }

    // MARGEN / GANANCIA
    else if (esMargen) {
      const r = await q(
        `SELECT
           (SELECT COALESCE(SUM(COALESCE(total_pyg,total,0)),0) FROM ventas       WHERE empresa_id=$1${filtroFecha}) AS ventas,
           (SELECT COALESCE(SUM(total),0)                       FROM compras      WHERE empresa_id=$1${filtroFecha}) AS compras,
           (SELECT COALESCE(SUM(monto),0)                       FROM egresos      WHERE empresa_id=$1${filtroFecha}) AS egresos`,
        [empresaId]
      );
      const { ventas, compras, egresos } = r.rows[0];
      const margen = Number(ventas) - Number(compras) - Number(egresos);
      respuesta =
        `📈 <b>Margen estimado ${textoPeriodo}:</b> <b>${money(margen)}</b><br>` +
        `💰 Ventas: ${money(ventas)}<br>` +
        `🛒 Compras: ${money(compras)}<br>` +
        `📤 Egresos: ${money(egresos)}`;
    }

    return res.json({ ok: true, respuesta });

  } catch (err) {
    console.error("POST /api/asistente-admin", err);
    return res.status(500).json({ ok: false, respuesta: "Error consultando el sistema." });
  }
});


app.get("/ventas/comprobante/:nro", async (req, res) => {

  try {

    const { nro } = req.params;

    const { data, error } = await supabase
      .from("ventas")
      .select("id")
      .eq("nro_comprobante", nro)
      .limit(1);

    if (error) {
      throw error;
    }

    res.json({
      existe: data.length > 0
    });

  } catch (err) {

    console.error(err);

    res.status(500).json({
      error: "Error verificando comprobante"
    });
  }
});

app.post("/api/login", async (req, res) => {

  const { usuario, password } = req.body || {};

  if (!usuario || !password) {
    return res.status(400).json({
      ok: false,
      msg: "Faltan credenciales"
    });
  }

  try {

    const { rows } = await pool.query(
      `
      SELECT 
        u.id,
        u.usuario,
        u.nombre,
        u.password_hash,
        u.rol,
        u.activo,
        u.empresa_id,
        e.nombre AS empresa_nombre,
        e.logo AS empresa_logo,
        e.color_principal
      FROM usuarios u
      LEFT JOIN empresas e
        ON e.id = u.empresa_id
      WHERE lower(u.usuario)=lower($1)
      LIMIT 1
      `,
      [usuario.trim()]
    );

    if (!rows.length) {
      return res.status(401).json({
        ok:false,
        msg:"Usuario incorrecto"
      });
    }

    const u = rows[0];

    let ok = false;

    if (u.password_hash?.startsWith("$2")) {
      ok = await bcrypt.compare(
        password,
        u.password_hash
      );
    } else {
      ok = password === u.password_hash;
    }

    if (!ok) {
      return res.status(401).json({
        ok:false,
        msg:"Contraseña incorrecta"
      });
    }

    
    if (
      u.rol !== "admin" &&
      u.rol !== "superadmin"
    ) {
      return res.status(403).json({
        ok:false,
        msg:"Acceso denegado"
      });
    }

    req.session.user = {

  id: u.id,
  usuario: u.usuario,
  nombre: u.nombre,
  rol: u.rol,
  empresa_id: u.empresa_id,
  empresa_nombre: u.empresa_nombre,
  empresa_logo: u.empresa_logo,
  color_principal: u.color_principal
};

req.session.save(err => {

  if (err) {

    console.error("ERROR SESSION:", err);

    return res.status(500).json({
      ok:false,
      msg:"Error guardando sesión"
    });
  }

  console.log("SESSION USER:");
console.log(req.session.user);

return res.json({
  ok:true,
  user:req.session.user
});
});
  } catch(err) {

    console.error("POST /api/login", err);

    return res.status(500).json({
      ok:false,
      msg:"Error servidor"
    });
  }
});

/* =========================================
   LOGOUT ADMIN
========================================= */

app.post("/admin/logout", (req, res) => {
  req.session.admin = null;
  req.session.isAdmin = false;
  // session.user queda intacto para el sistema principal
  req.session.save((err) => {
    if (err) console.error(err);
    res.json({ ok: true });
  });
});
/* =========================================
   VERIFICAR ADMIN
========================================= */

app.get("/admin/check", (req, res) => {
  // Solo acepta si fue al panel admin específicamente
  if (!req.session.admin || req.session.isAdmin !== true) {
    return res.status(401).json({ ok: false, msg: "No autenticado" });
  }

  const user = req.session.admin;

  if (user.rol !== "admin" && user.rol !== "superadmin") {
    return res.status(403).json({ ok: false, msg: "Sin permisos" });
  }

  return res.json({ ok: true, user });
});
app.post("/admin/login", async (req, res) => {

  const { usuario, password } = req.body || {};

  if (!usuario || !password) {
    return res.status(400).json({
      ok:false,
      msg:"Faltan credenciales"
    });
  }

  try {

    const { rows } = await pool.query(
      `
      SELECT 
        u.id,
        u.usuario,
        u.nombre,
        u.password_hash,
        u.rol,
        u.empresa_id,
        e.nombre AS empresa_nombre,
        e.logo AS empresa_logo,
        e.color_principal
      FROM usuarios u
      LEFT JOIN empresas e
        ON e.id = u.empresa_id
      WHERE lower(u.usuario)=lower($1)
      LIMIT 1
      `,
      [usuario.trim()]
    );

    if (!rows.length) {
      return res.status(401).json({
        ok:false,
        msg:"Usuario incorrecto"
      });
    }

    const u = rows[0];

    let ok = false;

    if (u.password_hash?.startsWith("$2")) {

      ok = await bcrypt.compare(
        password,
        u.password_hash
      );

    } else {

      ok = password === u.password_hash;
    }

    if (!ok) {

      return res.status(401).json({
        ok:false,
        msg:"Contraseña incorrecta"
      });
    }

    // SOLO ADMIN
    if (
      u.rol !== "admin" &&
      u.rol !== "superadmin"
    ) {

      return res.status(403).json({
        ok:false,
        msg:"Acceso denegado"
      });
    }

    req.session.admin = {
  id: u.id,
  usuario: u.usuario,
  nombre: u.nombre,
  rol: u.rol,
  empresa_id: u.empresa_id,
  empresa_nombre: u.empresa_nombre,
  empresa_logo: u.empresa_logo,
  color_principal: u.color_principal
};

req.session.user = req.session.admin;
req.session.isAdmin = true;

    req.session.save(err => {

      if (err) {

        console.error(err);

        return res.status(500).json({
          ok:false,
          msg:"Error guardando sesión"
        });
      }

     console.log("SESSION ADMIN:");
console.log(req.session.admin);

return res.json({
  ok:true,
  user:req.session.admin
});
    });

  } catch(err) {

    console.error(err);

    return res.status(500).json({
      ok:false,
      msg:"Error servidor"
    });
  }
});

app.post("/api/empresas/logo",requireEmpresa,uploadLogo.single("logo"),

  async (req, res) => {

    try {

      const empresaId = getEmpresaId(req);

      if (!req.file) {

        return res.status(400).json({
          ok: false,
          msg: "No se subió archivo"
        });

      }

      const logoPath =
        `/uploads/logos/${req.file.filename}`;

      // guardar en BD
      await pool.query(
        `
        UPDATE empresas
        SET logo = $1
        WHERE id = $2
        `,
        [logoPath, empresaId]
      );

      res.json({

        ok: true,

        logo: logoPath

      });

    } catch (e) {

      console.error(e);

      res.status(500).json({
        ok: false,
        msg: "No se pudo guardar logo"
      });

    }

  }
);

app.post("/empresas/:id/logo",uploadLogo.single("logo"),
  async (req, res) => {
    try {
      const empresaId = req.params.id;

      const logoPath = `/uploads/logos/${req.file.filename}`;

      await pool.query(
        `
        UPDATE empresas
        SET logo = $1
        WHERE id = $2
        `,
        [logoPath, empresaId]
      );

      res.json({
        ok: true,
        logo: logoPath,
      });

    } catch (err) {
      console.error(err);
      res.status(500).json({
        error: "Error al subir logo",
      });
    }
  }
);
app.get("/empresas/:id", async (req, res) => {

  try {

    const empresaId = req.params.id;

    const result = await pool.query(
      `
      SELECT
        id,
        nombre,
        logo,
        color_principal
      FROM empresas
      WHERE id = $1
      `,
      [empresaId]
    );

    if (!result.rows.length) {

      return res.status(404).json({
        error: "Empresa no encontrada"
      });
    }

    res.json(result.rows[0]);

  } catch (err) {

    console.error(err);

    res.status(500).json({
      error: "Error al obtener empresa"
    });
  }
});






// ============================================
// RUTAS PARA INSUMOS (con Supabase)
// ============================================

// ---------- GET /insumos ----------
app.get("/insumos", requireEmpresa, async (req, res) => {
  try {
    const empresaId = getEmpresaId(req);

    const { data, error } = await supabase
      .from("insumos")
      .select("*")
      .eq("empresa_id", empresaId)
      .order("nombre", { ascending: true });

    if (error) throw error;

    res.json(data);
  } catch (err) {
    console.error("GET /insumos error:", err);
    res.status(500).json({ error: "Error cargando insumos" });
  }
});

// ---------- POST /insumos ----------
app.post("/insumos", requireEmpresa, async (req, res) => {
  try {
    const empresaId = getEmpresaId(req);
    const { nombre, unidad, stock, stock_min, costo_promedio } = req.body;

    if (!nombre || !unidad) {
      return res.status(400).json({ error: "Faltan nombre o unidad" });
    }

    const { data, error } = await supabase
      .from("insumos")
      .insert([
        {
          nombre,
          unidad,
          stock: stock || 0,
          stock_min: stock_min || 0,
          costo_promedio: costo_promedio || 0,
          empresa_id: empresaId,
        },
      ])
      .select();

    if (error) throw error;

    res.status(201).json(data[0]);
  } catch (err) {
    console.error("POST /insumos error:", err);

    // Detectamos el caso más común: nombre duplicado para la misma empresa
    // (constraint UNIQUE en la tabla insumos). Supabase/Postgres devuelve
    // code "23505" para violación de unicidad.
    if (err.code === "23505") {
      return res.status(409).json({
        error: `Ya existe un insumo con ese nombre. Elegí otro nombre o editá el insumo existente.`,
      });
    }

    // Para cualquier otro error, devolvemos el mensaje real de Supabase
    // en vez de un texto genérico, para poder diagnosticar rápido.
    res.status(500).json({
      error: "Error creando insumo",
      detalle: err.message || err.details || String(err),
    });
  }
});

// ---------- PUT /insumos/:id ----------
app.put("/insumos/:id", requireEmpresa, async (req, res) => {
  try {
    const empresaId = getEmpresaId(req);
    const { id } = req.params;
    const { nombre, unidad, stock, stock_min, costo_promedio } = req.body;

    const { data, error } = await supabase
      .from("insumos")
      .update({
        nombre,
        unidad,
        stock: stock || 0,
        stock_min: stock_min || 0,
        costo_promedio: costo_promedio || 0,
        updated_at: new Date(),
      })
      .eq("id", id)
      .eq("empresa_id", empresaId)
      .select();

    if (error) throw error;

    if (!data || data.length === 0) {
      return res.status(404).json({ error: "Insumo no encontrado" });
    }

    res.json(data[0]);
  } catch (err) {
    console.error("PUT /insumos/:id error:", err);

    if (err.code === "23505") {
      return res.status(409).json({
        error: `Ya existe un insumo con ese nombre. Elegí otro nombre.`,
      });
    }

    res.status(500).json({
      error: "Error actualizando insumo",
      detalle: err.message || err.details || String(err),
    });
  }
});

// ---------- DELETE /insumos/:id ----------
app.delete("/insumos/:id", requireEmpresa, async (req, res) => {
  try {
    const empresaId = getEmpresaId(req);
    const { id } = req.params;

    const { error } = await supabase
      .from("insumos")
      .delete()
      .eq("id", id)
      .eq("empresa_id", empresaId);

    if (error) throw error;

    res.json({ ok: true });
  } catch (err) {
    console.error("DELETE /insumos/:id error:", err);
    res.status(500).json({
      error: "Error eliminando insumo",
      detalle: err.message || err.details || String(err),
    });
  }
});

// ---------- GET /compras-insumo ----------
app.get("/compras-insumo", requireEmpresa, async (req, res) => {
  try {
    const empresaId = getEmpresaId(req);

    // Como compras_insumo no tiene empresa_id directamente,
    // filtramos por insumo_id que pertenezca a la empresa.
    const { data, error } = await supabase
      .from("compras_insumo")
      .select(`
        *,
        insumo:insumos!inner (
          nombre,
          empresa_id
        )
      `)
      .eq("insumo.empresa_id", empresaId)
      .order("fecha", { ascending: false });

    if (error) throw error;

    // Quitamos el objeto "insumo" anidado y lo aplanamos
    const result = data.map(item => ({
      ...item,
      insumo_nombre: item.insumo?.nombre || null,
      // eliminamos el objeto insumo para no tener duplicados
      insumo: undefined,
    }));

    res.json(result);
  } catch (err) {
    console.error("GET /compras-insumo error:", err);
    res.status(500).json({ error: "Error cargando compras de insumos" });
  }
});

// ---------- POST /compras-insumo ----------
app.post("/compras-insumo", requireEmpresa, async (req, res) => {
  try {
    const empresaId = getEmpresaId(req);
    const {
      insumo_id,
      cantidad,
      unidad,
      cantidad_compra,
      unidad_compra,
      precio_total,
      precio_unitario_base,
      precio_por_100g,
      fecha,
      proveedor_id,
      proveedor,
      proveedor_ruc,   // 🔥 NUEVO
      factura,
    } = req.body;

    // 🔥 Si no se envía factura, usar "S/F" por defecto
    const facturaFinal = (factura && factura.trim()) || "S/F";
    // 🔥 Si no se envía RUC, guardar null o cadena vacía
    const rucFinal = (proveedor_ruc && proveedor_ruc.trim()) || null;

    // Verificar que el insumo pertenece a la empresa
    const { data: insumoCheck, error: insumoErr } = await supabase
      .from("insumos")
      .select("id, stock")
      .eq("id", insumo_id)
      .eq("empresa_id", empresaId)
      .single();

    if (insumoErr || !insumoCheck) {
      return res.status(404).json({ error: "Insumo no encontrado o no pertenece a esta empresa" });
    }

    // Insertar compra
    const { data, error } = await supabase
      .from("compras_insumo")
      .insert([
        {
          insumo_id,
          cantidad,
          unidad,
          cantidad_compra,
          unidad_compra,
          precio_total,
          precio_unitario_base,
          precio_por_100g: precio_por_100g || 0,
          fecha: fecha || new Date().toISOString().slice(0, 10),
          proveedor_id,
          proveedor,
          proveedor_ruc: rucFinal,   // 🔥 NUEVO
          factura: facturaFinal,
        },
      ])
      .select();

    if (error) throw error;

    // 2. Actualizar stock del insumo usando la función SQL
    await supabase.rpc("actualizar_stock_insumo", {
      p_insumo_id: insumo_id,
      p_cantidad: cantidad,
    });

    // 3. Recalcular costo promedio
    await supabase.rpc("recalcular_costo_promedio", {
      p_insumo_id: insumo_id,
    });

    res.status(201).json(data[0]);
  } catch (err) {
    console.error("POST /compras-insumo error:", err);
    res.status(500).json({
      error: "Error registrando compra de insumo",
      detalle: err.message || err.details || String(err),
    });
  }
});

// ---------- GET /usos-insumo ----------
app.get("/usos-insumo", requireEmpresa, async (req, res) => {
  try {
    const empresaId = getEmpresaId(req);

    const { data, error } = await supabase
      .from("usos_insumo")
      .select(`
        *,
        insumo:insumos!inner (
          nombre,
          empresa_id
        )
      `)
      .eq("insumo.empresa_id", empresaId)
      .order("fecha", { ascending: false });

    if (error) throw error;

    const result = data.map(item => ({
      ...item,
      insumo_nombre: item.insumo?.nombre || null,
      insumo: undefined,
    }));

    res.json(result);
  } catch (err) {
    console.error("GET /usos-insumo error:", err);
    res.status(500).json({ error: "Error cargando usos de insumos" });
  }
});
// ---------- GET /usos-insumo ----------
app.get("/usos-insumo", requireEmpresa, async (req, res) => {
  try {
    const empresaId = getEmpresaId(req);

    const { data, error } = await supabase
      .from("usos_insumo")
      .select(`
        *,
        insumo:insumos!inner (
          nombre,
          empresa_id
        )
      `)
      .eq("insumo.empresa_id", empresaId)
      .order("fecha", { ascending: false });

    if (error) throw error;

    const result = data.map(item => ({
      ...item,
      insumo_nombre: item.insumo?.nombre || null,
      insumo: undefined,
    }));

    res.json(result);
  } catch (err) {
    console.error("GET /usos-insumo error:", err);
    res.status(500).json({ error: "Error cargando usos de insumos" });
  }
});

// ---------- POST /usos-insumo ----------
app.post("/usos-insumo", requireEmpresa, async (req, res) => {
  try {
    const empresaId = getEmpresaId(req);
    const {
      insumo_id,
      cantidad,
      unidad,
      cantidad_usada,
      unidad_usada,
      costo,
      costo_promedio,
      motivo,
      fecha,
    } = req.body;

    // Verificar insumo
    const { data: insumoCheck, error: insumoErr } = await supabase
      .from("insumos")
      .select("id, stock")
      .eq("id", insumo_id)
      .eq("empresa_id", empresaId)
      .single();

    if (insumoErr || !insumoCheck) {
      return res.status(404).json({ error: "Insumo no encontrado" });
    }

    // Insertar uso
    const { data, error } = await supabase
      .from("usos_insumo")
      .insert([
        {
          insumo_id,
          cantidad,
          unidad,
          cantidad_usada,
          unidad_usada,
          costo: costo || 0,
          costo_promedio: costo_promedio || 0,
          motivo: motivo || "",
          fecha: fecha || new Date().toISOString().slice(0, 10),
        },
      ])
      .select();

    if (error) throw error;

    // Descontar stock
    await supabase.rpc("descontar_stock_insumo", {
      p_insumo_id: insumo_id,
      p_cantidad: cantidad,
    });

    res.status(201).json(data[0]);
  } catch (err) {
    console.error("POST /usos-insumo error:", err);
    res.status(500).json({
      error: "Error registrando uso de insumo",
      detalle: err.message || err.details || String(err),
    });
  }
});

app.listen(PORT, () => {
  console.log(`Servidor corriendo en http://localhost:${PORT}`);
});