// Entry point. Two modes:
//   published  (GitHub Pages) data.json exists: read-only standings.
//   local      (python3 app.py) no data.json: league form + rule editor.

import { parseLeague, scoreboardUrl } from "./espn.js";
import { compute, project, PRESETS } from "./scoring.js";
import { $, renderStandings, renderWeekly, renderProjection, standingsText, showError } from "./render.js";
import { initEditor } from "./editor.js";

const state = {
  raw: null,      // ESPN league JSON the standings are built from
  liveRaw: null,  // newer ESPN JSON for projections (published mode)
  config: null, options: {}, asOf: null, note: "",
};
let result = null;

function recompute() {
  if (!state.raw) return;
  try {
    const league = parseLeague(state.raw, { includePlayoffs: state.options.includePlayoffs });
    if (state.liveRaw) league.projection = parseLeague(state.liveRaw).projection;
    const range = { startWeek: state.options.startWeek, endWeek: state.options.endWeek };
    result = compute(league, state.config, range);
    showError(null);
    renderStandings(result);
    renderWeekly(result);
    renderProjection(project(league, state.config, range), { asOf: state.asOf, note: state.note });
  } catch (e) {
    showError(e.message);
  }
}

// ---- Published mode ----

async function fetchPublished() {
  try {
    const r = await fetch("data.json", { cache: "no-cache" });
    return r.ok ? await r.json() : null;
  } catch { return null; }
}

function applyPublished(d) {
  state.raw = d.standings;
  state.liveRaw = d.live;
  state.config = d.config || PRESETS[d.preset || "doubleheader"];
  state.asOf = d.liveAt;
  document.querySelector(".sub").textContent = `Updated ${new Date(d.generatedAt).toLocaleString()}`;
}

async function refreshPublished() {
  const d = await fetchPublished();
  if (d) applyPublished(d);
  const lg = parseLeague(state.raw);
  try {
    // Works when the league is public, or the viewer is logged into ESPN and their browser allows it.
    const r = await fetch(scoreboardUrl(lg.id, lg.season), { credentials: "include", cache: "no-store" });
    if (!r.ok) throw new Error(String(r.status));
    const live = await r.json();
    const week = parseLeague(live).projection?.week, saved = parseLeague(state.liveRaw).projection?.week;
    if (week != null && (saved == null || week === saved)) {
      state.liveRaw = live;
      state.asOf = new Date().toISOString();
    }
    state.note = "live from ESPN";
  } catch {
    state.note = "couldn't reach ESPN live (private league), showing the latest automatic update";
  }
}

// ---- Local mode ----

async function fetchLocal(form, fresh) {
  const res = await fetch("/api/league", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ...form, fresh }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || "Request failed");
  state.raw = data;
  state.asOf = new Date().toISOString();
  recompute();
}

function initLocal() {
  const ed = initEditor({
    onConfig: c => { state.config = c; recompute(); },
    onOptions: o => { state.options = o; recompute(); },
    onLoad: fetchLocal,
  });
  state.config = ed.config;
  state.options = ed.options;
  const load = fresh => ed.load(fresh).catch(e => {
    showError(e.message);
    if (/private/i.test(e.message)) $("privateBox").open = true;
  });
  $("loadBtn").onclick = () => load(false);
  ["leagueId", "season"].forEach(id => $(id).addEventListener("keydown", e => { if (e.key === "Enter") load(false); }));
  if (ed.autoload) load(false);
  return () => load(true);
}

// ---- Boot ----

(async function main() {
  const published = await fetchPublished();
  let refresh;
  if (published) {
    document.querySelector(".grid > div").hidden = true;
    document.querySelector(".grid").style.gridTemplateColumns = "minmax(0, 1fr)";
    applyPublished(published);
    recompute();
    refresh = async () => { await refreshPublished(); recompute(); };
  } else {
    refresh = initLocal();
  }

  $("projRefresh").onclick = async () => {
    const btn = $("projRefresh");
    btn.disabled = true; btn.textContent = "Refreshing…";
    try { await refresh(); } finally { btn.disabled = false; btn.textContent = "Refresh projections"; }
  };
  $("copyBtn").onclick = async () => {
    if (!result) return;
    try { await navigator.clipboard.writeText(standingsText(result)); $("copyBtn").textContent = "Copied"; }
    catch { $("copyBtn").textContent = "Copy failed"; }
    setTimeout(() => { $("copyBtn").textContent = "Copy as text"; }, 1500);
  };
})();
