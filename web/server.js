const express = require("express");
const { Pool } = require("pg");

const app = express();
const port = parseInt(process.env.PORT || "8080", 10);

if (!process.env.DATABASE_URL) {
  console.error("Falta DATABASE_URL");
  process.exit(1);
}

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

app.get("/", (req, res) => {
  res.send("OK: Express funcionando");
});

app.get("/db", async (req, res) => {
  try {
    const r = await pool.query("SELECT now() as now");
    res.json({ ok: true, now: r.rows[0].now });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

app.get("/api/vendedor", async (req, res) => {
  try {
    const r = await pool.query("SELECT * FROM vendedores ORDER BY id DESC LIMIT 20");
    res.json({ ok: true, rows: r.rows });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

app.listen(port, "0.0.0.0", () => {
  console.log(`Web escuchando en ${port}`);
});
