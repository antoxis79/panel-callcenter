const express = require("express");
const cors = require("cors");
const { Pool } = require("pg");

const app = express();
app.use(cors());
app.use(express.json());

// Conexión a Postgres (usa env)
const pool = new Pool({
  connectionString: process.env.DATABASE_URL
});

// Healthcheck
app.get("/api/health", async (req, res) => {
  try {
    const r = await pool.query("SELECT now() as now");
    res.json({ ok: true, db: true, time: r.rows[0].now });
  } catch (e) {
    res.status(500).json({ ok: false, db: false, error: String(e.message || e) });
  }
});

// Limpieza simple de locks expirados (cada request a records)
async function cleanupExpiredLocks() {
  await pool.query("DELETE FROM locks WHERE expires_at < now()");
}

// GET /api/records -> lista para tabla principal
app.get("/api/records", async (req, res) => {
  await cleanupExpiredLocks();

  const q = `
    SELECT
      r.id,
      r.created_at,
      r.created_by_agent_name,
      r.created_by_group,
      r.visibility,
      r.status,
      r.current_filter,
      r.next_due_at,
      l.lock_type,
      l.locked_by_name,
      l.locked_by_user
    FROM records r
    LEFT JOIN locks l ON l.record_id = r.id
    ORDER BY r.created_at DESC
    LIMIT 200
  `;
  const out = await pool.query(q);
  res.json({ records: out.rows });
});

// GET /api/records/:id -> detalle (subida + filtros)
app.get("/api/records/:id", async (req, res) => {
  await cleanupExpiredLocks();
  const id = req.params.id;

  const rec = await pool.query("SELECT * FROM records WHERE id=$1", [id]);
  if (rec.rowCount === 0) return res.status(404).json({ error: "not_found" });

  const fil = await pool.query(
    "SELECT * FROM filters WHERE record_id=$1 ORDER BY n ASC",
    [id]
  );

  const lock = await pool.query(
    "SELECT * FROM locks WHERE record_id=$1",
    [id]
  );

  res.json({
    record: rec.rows[0],
    filters: fil.rows,
    lock: lock.rows[0] || null
  });
});

// POST /api/seed (temporal) -> crea 2 records + filters 1..3
app.post("/api/seed", async (req, res) => {
  // crea 2 registros ejemplo
  const makeRecord = async (agent, group, visibility, status, dueMinutes, busyByName, busyType, busyFilterN) => {
    const nextDue = dueMinutes == null ? null : new Date(Date.now() + dueMinutes * 60 * 1000);
    const r = await pool.query(
      `INSERT INTO records (created_by_user, created_by_agent_name, created_by_group, visibility, status, current_filter, next_due_at, base_data)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb)
       RETURNING *`,
      [
        agent.toLowerCase(),
        agent,
        group,
        visibility,
        status,
        status === "draft" ? 0 : (busyFilterN || 0),
        nextDue,
        JSON.stringify({ nombre_comercial: "Demo", numero_contacto: "999999999" })
      ]
    );

    // crea filtros 1..3
    for (let n = 1; n <= 3; n++) {
      await pool.query(
        `INSERT INTO filters (record_id, n, status, offer_data)
         VALUES ($1,$2,'not_started',$3::jsonb)
         ON CONFLICT (record_id,n) DO NOTHING`,
        [r.rows[0].id, n, JSON.stringify({ offers: [] })]
      );
    }

    // lock opcional
    if (busyByName) {
      const expires = new Date(Date.now() + 60 * 1000);
      await pool.query(
        `INSERT INTO locks (record_id, lock_type, locked_by_user, locked_by_name, expires_at)
         VALUES ($1,$2,$3,$4,$5)
         ON CONFLICT (record_id) DO UPDATE SET lock_type=EXCLUDED.lock_type, locked_by_user=EXCLUDED.locked_by_user, locked_by_name=EXCLUDED.locked_by_name, locked_at=now(), expires_at=EXCLUDED.expires_at`,
        [r.rows[0].id, busyType || "filter", "sandy", busyByName, expires]
      );
    }

    return r.rows[0];
  };

  const a = await makeRecord("Cesar", "gusanitos", "group", "draft", 3, null);
  const b = await makeRecord("Emilia", "pericotitos", "private_superior", "in_filter_1", 0.5, "Sandy (cerradores)", "filter", 1);

  res.json({ ok: true, created: [a.id, b.id] });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log("web listening on", PORT));