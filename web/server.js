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

function getActor(req) {
  // temporal (luego vendrá del login/JWT/LDAP)
  const user = req.header("X-User") || "demo";
  const name = req.header("X-Name") || user;
  return { user, name };
}

function ttl60s() {
  return new Date(Date.now() + 60 * 1000);
}

function statusForFilter(n) {
  return `in_filter_${n}`;
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

  const existing = new Map(fil.rows.map(f => [f.n, f]));
  
  const filled = [1,2,3].map(n => existing.get(n) || ({
    n,
    status: "not_started",
    performed_by_name: null,
    started_at: null,
    finished_at: null,
    next_due_at: null
  }));

  res.json({
    record: rec.rows[0],
    filters: filled,
    lock: lock.rows[0] || null
  });
});

app.post("/api/records/:id/filters/:n/start", async (req, res) => {
  await cleanupExpiredLocks();
  const { user, name } = getActor(req);

  const id = req.params.id;
  const n = Number(req.params.n);
  if (![1,2,3].includes(n)) return res.status(400).json({ error: "bad_filter_n" });

  // 1) Traer record
  const rec = await pool.query("SELECT * FROM records WHERE id=$1", [id]);
  if (rec.rowCount === 0) return res.status(404).json({ error: "not_found" });

  // 2) Ver si ya hay lock
  const lock = await pool.query("SELECT * FROM locks WHERE record_id=$1", [id]);
  if (lock.rowCount > 0) {
    return res.status(409).json({ error: "locked", lock: lock.rows[0] });
  }

  // 3) Validar secuencia real (no reversible)
  // - No permitir si ya está en un filtro
  const status = rec.rows[0].status;
  if ((status || "").startsWith("in_filter_")) {
    return res.status(409).json({ error: "already_in_filter", status });
  }
  if (["cancelled","done"].includes(status)) {
    return res.status(409).json({ error: "cannot_start_from_status", status });
  }

  // Revisar progreso real en filters
  const f1 = await pool.query("SELECT status FROM filters WHERE record_id=$1 AND n=1", [id]);
  const f2 = await pool.query("SELECT status FROM filters WHERE record_id=$1 AND n=2", [id]);
  const f3 = await pool.query("SELECT status FROM filters WHERE record_id=$1 AND n=3", [id]);

  const s1 = f1.rows[0]?.status || "not_started";
  const s2 = f2.rows[0]?.status || "not_started";
  const s3 = f3.rows[0]?.status || "not_started";

  // Regla secuencial:
  // n=1 permitido si s1 = not_started
  // n=2 permitido si s1 = completed y s2 = not_started
  // n=3 permitido si s2 = completed y s3 = not_started
  if (n === 1) {
    if (s1 !== "not_started") return res.status(409).json({ error: "sequence_blocked", need: "f1_not_started", s1 });
  }
  if (n === 2) {
    if (s1 !== "completed" || s2 !== "not_started") return res.status(409).json({ error: "sequence_blocked", need: "f1_completed_and_f2_not_started", s1, s2 });
  }
  if (n === 3) {
    if (s2 !== "completed" || s3 !== "not_started") return res.status(409).json({ error: "sequence_blocked", need: "f2_completed_and_f3_not_started", s2, s3 });
  }

  // 4) Set record status + lock + filter row status
  await pool.query("BEGIN");
  try {
    await pool.query(
      "UPDATE records SET status=$1, current_filter=$2 WHERE id=$3",
      [statusForFilter(n), n, id]
    );

    await pool.query(
      `INSERT INTO locks (record_id, lock_type, locked_by_user, locked_by_name, expires_at)
       VALUES ($1,'filter',$2,$3,$4)`,
      [id, user, name, ttl60s()]
    );

    await pool.query(
      `UPDATE filters
       SET status='in_progress', performed_by_user=$1, performed_by_name=$2, started_at=now()
       WHERE record_id=$3 AND n=$4`,
      [user, name, id, n]
    );

    await pool.query("COMMIT");
    res.json({ ok: true });
  } catch (e) {
    await pool.query("ROLLBACK");
    res.status(500).json({ error: "start_failed", detail: String(e.message || e) });
  }
});

app.post("/api/records/:id/filters/:n/finish", async (req, res) => {
  await cleanupExpiredLocks();
  const { user, name } = getActor(req);

  const id = req.params.id;
  const n = Number(req.params.n);
  const { next_due_minutes } = req.body || {}; // opcional

  const rec = await pool.query("SELECT * FROM records WHERE id=$1", [id]);
  if (rec.rowCount === 0) return res.status(404).json({ error: "not_found" });

  // Debe estar en ese filtro
  if (rec.rows[0].status !== statusForFilter(n)) {
    return res.status(409).json({ error: "not_in_that_filter", status: rec.rows[0].status });
  }

  // Debe tener lock y ser el mismo usuario (MVP)
  const lock = await pool.query("SELECT * FROM locks WHERE record_id=$1", [id]);
  if (lock.rowCount === 0) return res.status(409).json({ error: "no_lock" });
  if (lock.rows[0].locked_by_user !== user) {
    return res.status(403).json({ error: "not_lock_owner" });
  }

  const nextDue = (typeof next_due_minutes === "number")
    ? new Date(Date.now() + next_due_minutes * 60 * 1000)
    : null;

  await pool.query("BEGIN");
  try {
    await pool.query(
      `UPDATE filters
       SET status='completed', finished_at=now()
       WHERE record_id=$1 AND n=$2`,
      [id, n]
    );

  if (n === 3) {
    await pool.query(
      "UPDATE records SET status='done', current_filter=3, finalized_at=now() WHERE id=$1",
      [id]
    );
  } else {
    // deja listo que el siguiente filtro sea el que toca
    const nextN = n + 1;

    await pool.query(
      "UPDATE records SET status='draft', current_filter=$2, next_due_at=$3 WHERE id=$1",
      [id, nextN, nextDue]
    );

    await pool.query(
      "UPDATE filters SET next_due_at=$1 WHERE record_id=$2 AND n=$3",
      [nextDue, id, nextN]
    );
  }

    await pool.query("DELETE FROM locks WHERE record_id=$1", [id]);

    await pool.query("COMMIT");
    res.json({ ok: true });
  } catch (e) {
    await pool.query("ROLLBACK");
    res.status(500).json({ error: "finish_failed", detail: String(e.message || e) });
  }
});

app.post("/api/records/:id/cancel", async (req, res) => {
  await cleanupExpiredLocks();
  const { user, name } = getActor(req);

  const id = req.params.id;
  const { reason } = req.body || {};
  if (!reason || String(reason).trim().length < 3) {
    return res.status(400).json({ error: "reason_required" });
  }

  const rec = await pool.query("SELECT * FROM records WHERE id=$1", [id]);
  if (rec.rowCount === 0) return res.status(404).json({ error: "not_found" });

  await pool.query("BEGIN");
  try {
    // si estaba en un filtro, marcamos ese filtro cancelado
    const st = rec.rows[0].status;
    if (st.startsWith("in_filter_")) {
      const n = Number(st.slice(-1));
      await pool.query(
        `UPDATE filters
         SET status='cancelled', cancel_reason=$1, finished_at=now()
         WHERE record_id=$2 AND n=$3`,
        [reason, id, n]
      );
    }

    await pool.query(
      `UPDATE records
       SET status='cancelled', cancel_reason=$1, cancelled_by_user=$2, cancelled_at=now()
       WHERE id=$3`,
      [reason, user, id]
    );

    await pool.query("DELETE FROM locks WHERE record_id=$1", [id]);

    await pool.query("COMMIT");
    res.json({ ok: true });
  } catch (e) {
    await pool.query("ROLLBACK");
    res.status(500).json({ error: "cancel_failed", detail: String(e.message || e) });
  }
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

  const c = await makeRecord("Emilia", "pericotitos", "group", "draft", 10, null);
  await pool.query("UPDATE filters SET status='completed' WHERE record_id=$1 AND n=1", [c.id]);

  const d = await makeRecord("Cesar", "gusanitos", "group", "draft", 10, null);
  await pool.query("UPDATE filters SET status='completed' WHERE record_id=$1 AND n IN (1,2)", [d.id]);

  res.json({ ok: true, created: [a.id, b.id] });
});

app.post("/api/records/:id/lock/renew", async (req, res) => {
  await cleanupExpiredLocks();
  const { user } = getActor(req);
  const id = req.params.id;

  const lock = await pool.query("SELECT * FROM locks WHERE record_id=$1", [id]);
  if (lock.rowCount === 0) return res.status(404).json({ error: "no_lock" });

  // Solo el dueño del lock puede renovarlo
  if (lock.rows[0].locked_by_user !== user) {
    return res.status(403).json({ error: "not_lock_owner" });
  }

  await pool.query(
    "UPDATE locks SET expires_at=$1 WHERE record_id=$2",
    [ttl60s(), id]
  );

  res.json({ ok: true });
});

const PORT = process.env.PORT || 8080;
app.listen(PORT, () => console.log("web listening on", PORT));