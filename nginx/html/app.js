const API = "/api";

const elApiStatus = document.getElementById("apiStatus");
const elGridBody = document.getElementById("gridBody");
const btnReload = document.getElementById("btnReload");

// MOCK temporal: luego lo cambiaremos por GET /api/records
let records = [
  {
    id: "R-0001",
    agent: "Cesar",
    group: "gusanitos",
    visibility: "group",
    status: "draft",
    next_due_at: futureMinutes(3),
    busy: null,
    filters: [
      { n: 1, status: "not_started", by: null },
      { n: 2, status: "not_started", by: null },
      { n: 3, status: "not_started", by: null },
    ],
    expanded: false,
  },
  {
    id: "R-0002",
    agent: "Emilia",
    group: "pericotitos",
    visibility: "private_superior",
    status: "in_filter_1",
    next_due_at: futureMinutes(0.5),
    busy: { filter: 1, by: "Sandy (cerradores)" },
    filters: [
      { n: 1, status: "in_progress", by: "Sandy" },
      { n: 2, status: "not_started", by: null },
      { n: 3, status: "not_started", by: null },
    ],
    expanded: true,
  },
];

function futureMinutes(mins) {
  return new Date(Date.now() + mins * 60 * 1000).toISOString();
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

function childRowHtml(record, f) {
  // Fila “desplegable” de filtro
  const locked = (record.status === `in_filter_${f.n}`) && record.busy;
  const lockText = locked ? `En proceso por ${record.busy.by}` : "—";

  // Si no corresponde aún (ej: f2 pero f1 no completado), lo marcamos gris
  const isBlocked = isFilterBlocked(record, f.n);
  const statusBadge = isBlocked
    ? `<span class="badge gray">Bloqueado</span>`
    : badgeForFilter(f.status);

  return `
    <tr class="child ${locked ? "busy" : ""}">
      <td></td>
      <td colspan="2">↳ <b>Filtro ${f.n}</b></td>
      <td colspan="2">${statusBadge}</td>
      <td>${lockText}</td>
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

// Regla simple para el mock:
// - si record.status está en filtro 1/2/3, el resto queda “bloqueado”
// - si draft, todos visibles pero “bloqueados” según progreso (aquí aún no modelamos progreso real)
function isFilterBlocked(record, n) {
  // ejemplo muy básico: si está en draft, solo F1 “disponible”, F2/F3 bloqueados
  if (record.status === "draft") return n !== 1;
  if (record.status === "in_filter_1") return n !== 1;
  if (record.status === "in_filter_2") return n !== 2;
  if (record.status === "in_filter_3") return n !== 3;
  if (record.status === "done") return false;
  return false;
}

function hintForFilter(record, n) {
  if (record.status === "draft" && n !== 1) return "Disponible después de completar el filtro anterior";
  if (record.status.startsWith("in_filter") && !record.status.endsWith(String(n))) return "Bloqueado mientras otro filtro está en proceso";
  return "Campos: operadora, agendado, ofertas, reacción, comentario, llamar en";
}

function render() {
  elGridBody.innerHTML = "";

  records.forEach((r, idx) => {
    const isBusy = !!r.busy;
    const rowClass = `main ${isBusy ? "busy" : ""}`;

    const toggleSymbol = r.expanded ? "▼" : "▶";

    const busyText = r.busy ? `Filtro ${r.busy.filter} - ${r.busy.by}` : "—";

    elGridBody.insertAdjacentHTML("beforeend", `
      <tr class="${rowClass}" data-id="${r.id}">
        <td>
          <button class="toggle" data-toggle="${r.id}">${toggleSymbol}</button>
        </td>
        <td>${r.id}</td>
        <td>${r.agent}</td>
        <td>${r.group}</td>
        <td>${r.visibility}</td>
        <td>${badgeForStatus(r.status)}</td>
        <td>${remainingText(r.next_due_at)}</td>
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

  // listeners expand/collapse
  document.querySelectorAll("[data-toggle]").forEach(btn => {
    btn.addEventListener("click", (e) => {
      const id = e.currentTarget.getAttribute("data-toggle");
      const rec = records.find(x => x.id === id);
      rec.expanded = !rec.expanded;
      render();
    });
  });
}

btnReload.addEventListener("click", async () => {
  await checkHealth();
  render();
});

// refresca contador cada 1s (solo visual)
setInterval(() => {
  render();
}, 1000);

(async function init() {
  await checkHealth();
  render();
})();