// Entry point. Two modes:
//   published  (GitHub Pages) data.json exists: read-only standings.
//   local      (python3 app.py) no data.json: league form + rule editor.
// Two tabs: Standings and League History (#history), history loaded on first open.

import { parseLeague, scoreboardUrl } from "./espn.js";
import { compute, project, PRESETS } from "./scoring.js";
import { $, renderStandings, renderWeekly, renderProjection, standingsText, showError } from "./render.js";
import { initEditor } from "./editor.js";
import { computeHistory } from "./history.js";
import { renderHistory, renderHistoryMessage } from "./history-view.js";

const state = {
  raw: null,      // ESPN league JSON the standings are built from
  liveRaw: null,  // newer ESPN JSON for projections (published mode)
  config: null, options: {}, asOf: null, note: "",
};
let result = null;
const hist = { seasons: null, loading: null, load: null }; // load(): mode-specific fetch of all seasons

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
  showHistory(); // rule edits apply to history too
}

// ---- League History tab ----

function showHistory() {
  if (!hist.seasons) return;
  try { renderHistory(computeHistory(hist.seasons, state.config)); }
  catch (e) { renderHistoryMessage(e.message); }
}

async function openHistory() {
  if (hist.seasons) return showHistory();
  if (!hist.loading) {
    renderHistoryMessage("Loading league history…");
    hist.loading = hist.load()
      .then(seasons => { hist.seasons = seasons; showHistory(); })
      .catch(e => renderHistoryMessage(e.message))
      .finally(() => { hist.loading = null; });
  }
  await hist.loading;
}

function setTab(tab) {
  const onHistory = tab === "history";
  $("standingsView").hidden = onHistory;
  $("historyView").hidden = !onHistory;
  document.querySelectorAll("[data-tab]").forEach(b => b.setAttribute("aria-selected", String(b.dataset.tab === tab)));
  if (onHistory) openHistory();
}

function initTabs() {
  document.querySelectorAll("[data-tab]").forEach(b => b.onclick = () => {
    history.replaceState(null, "", b.dataset.tab === "history" ? "#history" : location.pathname + location.search);
    setTab(b.dataset.tab);
  });
  window.addEventListener("hashchange", () => setTab(location.hash === "#history" ? "history" : "standings"));
  setTab(location.hash === "#history" ? "history" : "standings");
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

async function fetchPublishedHistory() {
  const r = await fetch("history.json", { cache: "no-cache" });
  if (!r.ok) throw new Error("League history isn't published yet. It appears after the next full update.");
  return (await r.json()).seasons;
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

let localKey = null;

async function fetchLocal(form, fresh) {
  const res = await fetch("/api/league", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ...form, fresh }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || "Request failed");
  state.raw = data;
  state.asOf = new Date().toISOString();
  if (localKey !== `${form.leagueId}|${form.season}`) hist.seasons = null; // different league or season
  localKey = `${form.leagueId}|${form.season}`;
  recompute();
}

async function fetchLocalHistory(form) {
  if (!form.leagueId || !form.season) throw new Error("Load your league on the Standings tab first.");
  const res = await fetch("/api/history", {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(form),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || "Couldn't load league history.");
  return data.seasons;
}

function initLocal() {
  const ed = initEditor({
    onConfig: c => { state.config = c; recompute(); },
    onOptions: o => { state.options = o; recompute(); },
    onLoad: fetchLocal,
  });
  state.config = ed.config;
  state.options = ed.options;
  hist.load = () => fetchLocalHistory(ed.readForm());
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
    hist.load = fetchPublishedHistory;
    applyPublished(published);
    recompute();
    refresh = async () => { await refreshPublished(); recompute(); };
  } else {
    refresh = initLocal();
  }

  initTabs();
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
