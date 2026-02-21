const API = "/api";

const elApiStatus = document.getElementById("apiStatus");
const elGridBody = document.getElementById("gridBody");
const btnReload = document.getElementById("btnReload");

let records = [];

function futureMinutes(mins) {
  return new Date(Date.now() + mins * 60 * 1000).toISOString();
}

let activeLockRecordId = null;
let lockRenewTimer = null;

function startLockRenew(id) {
  stopLockRenew();
  activeLockRecordId = id;

  lockRenewTimer = setInterval(async () => {
    try {
      await fetch(`${API}/records/${id}/lock/renew`, {
        method: "POST",
        headers: { "X-User": "cesar", "X-Name": "Cesar" }
      });
    } catch {}
  }, 25000); // cada 25s
}

function stopLockRenew() {
  if (lockRenewTimer) clearInterval(lockRenewTimer);
  lockRenewTimer = null;
  activeLockRecordId = null;
}

async function checkHealth() {
  try {
    const r = await fetch(`${API}/health`);
    if (!r.ok) throw new Error("bad status");
    const data = await r.json();
    elApiStatus.textContent = `API: OK (${data.time})`;
    elApiStatus.classList.remove("bad");
    elApiStatus.classList.add("ok");
  } catch (e) {
    elApiStatus.textContent = "API: ERROR";
    elApiStatus.classList.remove("ok");
    elApiStatus.classList.add("bad");
  }
}

function badgeForStatus(status) {
  switch (status) {
    case "draft": return `<span class="badge info">Draft</span>`;
    case "in_filter_1": return `<span class="badge bad">Filtro 1</span>`;
    case "in_filter_2": return `<span class="badge bad">Filtro 2</span>`;
    case "in_filter_3": return `<span class="badge bad">Filtro 3</span>`;
    case "done": return `<span class="badge ok">Done</span>`;
    case "cancelled": return `<span class="badge bad">Cancelado</span>`;
    case "paused": return `<span class="badge warn">Pausa</span>`;
    default: return `<span class="badge gray">${status}</span>`;
  }
}

function remainingText(iso) {
  if (!iso) return "-";
  const due = new Date(iso).getTime();
  const now = Date.now();
  const diff = due - now;
  const s = Math.floor(Math.abs(diff) / 1000);
  const m = Math.floor(s / 60);
  const sec = s % 60;

  const txt = `${m}:${String(sec).padStart(2, "0")}`;
  if (diff < 0) return `ATRASADO ${txt}`;
  return `Faltan ${txt}`;
}

function actionButtons(record, f) {
  const locked = (record.status === `in_filter_${f.n}`) && record.busy;

  // si está locked, mostrar acciones
  if (locked) {
    return `
      <button class="mini" data-finish="${record.id}" data-n="${f.n}">Finalizar</button>
      <button class="mini danger" data-cancel="${record.id}">Cancelar</button>
    `;
  }

  // bloqueado por secuencia o estado
  if (isFilterBlocked(record, f.n)) return `<span class="badge gray">—</span>`;

  // habilitado para iniciar
  if (f.status === "not_started") {
    return `<button class="mini" data-start="${record.id}" data-n="${f.n}">Iniciar</button>`;
  }

  return `<span class="badge gray">—</span>`;
}

function childRowHtml(record, f) {
  const locked = (record.status === `in_filter_${f.n}`) && record.busy;
  const lockText = locked ? `En proceso por ${record.busy.by}` : "—";

  const isBlocked = isFilterBlocked(record, f.n);
  const statusBadge = isBlocked
    ? `<span class="badge gray">Bloqueado</span>`
    : badgeForFilter(f.status);

  return `
    <tr class="child ${locked ? "busy" : ""}">
      <td></td>
      <td>↳ <b>Filtro ${f.n}</b></td>
      <td>${statusBadge}</td>
      <td colspan="2">${lockText}</td>
      <td>${actionButtons(record, f)}</td>
      <td colspan="2">${hintForFilter(record, f.n)}</td>
    </tr>
  `;
}

function badgeForFilter(status) {
  switch (status) {
    case "not_started": return `<span class="badge gray">No iniciado</span>`;
    case "in_progress": return `<span class="badge bad">En proceso</span>`;
    case "completed": return `<span class="badge ok">Completado</span>`;
    case "cancelled": return `<span class="badge bad">Cancelado</span>`;
    case "paused": return `<span class="badge warn">Pausa</span>`;
    default: return `<span class="badge gray">${status}</span>`;
  }
}

function getFilterStatus(record, n) {
  const f = (record.filters || []).find(x => x.n === n);
  return f ? f.status : "not_started";
}

function isFilterBlocked(record, n) {
  // si está cancelado o done, no se edita
  if (record.status === "cancelled" || record.status === "done") return true;

  const s1 = getFilterStatus(record, 1);
  const s2 = getFilterStatus(record, 2);
  const s3 = getFilterStatus(record, 3);

  if (n === 1) return s1 !== "not_started";
  if (n === 2) return !(s1 === "completed" && s2 === "not_started");
  if (n === 3) return !(s2 === "completed" && s3 === "not_started");
  return true;
}

function hintForFilter(record, n) {
  if (record.status === "draft" && n !== 1) return "Disponible después de completar el filtro anterior";
  if ((record.status || "").startsWith("in_filter") && !String(record.status).endsWith(String(n))) return "Bloqueado mientras otro filtro está en proceso";
  return "Campos: operadora, agendado, ofertas, reacción, comentario, llamar en";
}

async function loadRecordDetails(id) {
  const r = await fetch(`${API}/records/${id}`);
  if (!r.ok) throw new Error("No se pudo cargar detalle");
  const data = await r.json();

  const rec = records.find(x => x.id === id);
  if (!rec) return;

  // actualiza datos del record por si cambió estado/lock
  rec.status = data.record.status;
  rec.visibility = data.record.visibility;
  rec.next_due_at = data.record.next_due_at;

  rec.busy = data.lock
    ? { filter: rec.status?.startsWith("in_filter_") ? Number(rec.status.slice(-1)) : null, by: data.lock.locked_by_name }
    : null;

  // ahora filtros reales
  rec.filters = (data.filters || []).map(f => ({
    n: f.n,
    status: f.status,
    by: f.performed_by_name
  }));
}

function render() {
  elGridBody.innerHTML = "";

  records.forEach((r, idx) => {
    const isBusy = !!r.busy;
    const rowClass = `main ${isBusy ? "busy" : ""}`;

    const toggleSymbol = r.expanded ? "▼" : "▶";

    const busyText = r.busy ? `Filtro ${r.busy.filter} - ${r.busy.by}` : "—";

    const shortId = r.id.slice(0, 8) + "…" + r.id.slice(-4);

    elGridBody.insertAdjacentHTML("beforeend", `
      <tr class="${rowClass}" data-id="${r.id}">
        <td>
          <button class="toggle" data-toggle="${r.id}">${toggleSymbol}</button>
        </td>
        <td title="${r.id}">${shortId}</td>
        <td>${r.agent}</td>
        <td>${r.group}</td>
        <td>${r.visibility}</td>
        <td>${badgeForStatus(r.status)}</td>
        <td class="${dueClass(r.next_due_at)}">${remainingText(r.next_due_at)}</td>
        <td>${busyText}</td>
      </tr>
    `);

    // Opción A: siempre existen los filtros, pero solo se muestran si expanded=true
    if (r.expanded) {
      r.filters.forEach(f => {
        elGridBody.insertAdjacentHTML("beforeend", childRowHtml(r, f));
      });
    }
  });
}

elGridBody.addEventListener("click", async (e) => {
  const t = e.target;

  // TOGGLE
  if (t.matches("[data-toggle]")) {
    const id = t.getAttribute("data-toggle");
    const rec = records.find(x => x.id === id);
    if (!rec) return;

    rec.expanded = !rec.expanded;

    if (rec.expanded) {
      try {
        await loadRecordDetails(id);
      } catch (err) {
        alert("Error cargando filtros del registro");
        rec.expanded = false;
      }
    }
    render();
    return;
  }

  // START
  if (t.matches("[data-start]")) {
    const id = t.getAttribute("data-start");
    const n = t.getAttribute("data-n");

    const resp = await fetch(`${API}/records/${id}/filters/${n}/start`, {
      method: "POST",
      headers: { "X-User": "cesar", "X-Name": "Cesar" }
    });

    if (!resp.ok) {
      console.log("START ERROR", resp.status, await resp.text());
      alert("No se pudo iniciar. Mira consola (F12).");
      return;
    }

    startLockRenew(id);

    await loadRecords();
    // importante: mantén el expand abierto si estaba abierto
    const rec = records.find(x => x.id === id);
    if (rec) rec.expanded = true;
    await loadRecordDetails(id);

    render();
    return;
  }

  // FINISH
  if (t.matches("[data-finish]")) {
    const id = t.getAttribute("data-finish");
    const n = t.getAttribute("data-n");

    const mins = prompt("¿En cuántos minutos debe hacerse el siguiente filtro? (ej: 10). Vacío = sin hora");
    const next_due_minutes = mins && !isNaN(Number(mins)) ? Number(mins) : null;

    const resp = await fetch(`${API}/records/${id}/filters/${n}/finish`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-User": "cesar",
        "X-Name": "Cesar"
      },
      body: JSON.stringify({ next_due_minutes })
    });

    if (!resp.ok) {
      console.log("FINISH ERROR", resp.status, await resp.text());
      alert("No se pudo finalizar. Mira consola (F12).");
      return;
    }

    stopLockRenew();

    await loadRecords();
    const rec = records.find(x => x.id === id);
    if (rec) rec.expanded = true;
    await loadRecordDetails(id);

    render();
    return;
  }

  // CANCEL
  if (t.matches("[data-cancel]")) {
    const id = t.getAttribute("data-cancel");
    const reason = prompt("Motivo de cancelación:");
    if (!reason) return;

    await fetch(`${API}/records/${id}/cancel`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-User": "cesar",
        "X-Name": "Cesar"
      },
      body: JSON.stringify({ reason })
    });

    if (!resp.ok) {
      console.log("CANCEL ERROR", resp.status, await resp.text());
      alert("No se pudo cancelar. Mira consola (F12).");
      return;
    }

    stopLockRenew();

    await loadRecords();
    render();
    return;
  }
});

async function loadRecords() {
  const expandedMap = new Map(records.map(r => [r.id, r.expanded]));

  const r = await fetch(`${API}/records`);
  const data = await r.json();

  records = (data.records || []).map(row => {
    const busy = row.lock_type
      ? { filter: row.status?.startsWith("in_filter_") ? Number(row.status.slice(-1)) : null, by: row.locked_by_name }
      : null;

    const id = row.id;

    return {
      id,
      agent: row.created_by_agent_name,
      group: row.created_by_group,
      visibility: row.visibility,
      status: row.status,
      next_due_at: row.next_due_at,
      busy,
      filters: [
        { n: 1, status: "not_started", by: null },
        { n: 2, status: "not_started", by: null },
        { n: 3, status: "not_started", by: null },
      ],
      expanded: expandedMap.get(id) || false
    };
  });
}

btnReload.addEventListener("click", async () => {
  await checkHealth();
  await loadRecords();
  render();
});

function dueClass(iso) {
  if (!iso) return "due-ok";
  const diff = new Date(iso).getTime() - Date.now();
  if (diff < 0) return "due-late";
  if (diff <= 60 * 1000) return "due-soon";
  return "due-ok";
}

setInterval(async () => {
  await loadRecords();

  const expandedIds = records.filter(r => r.expanded).map(r => r.id);
  for (const id of expandedIds) {
    try { await loadRecordDetails(id); } catch {}
  }

  render();
}, 5000);

(async function init() {
  await checkHealth();
  await loadRecords();
  render();
})();