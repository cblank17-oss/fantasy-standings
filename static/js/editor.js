// Local app only: league form, scoring-rule editor and tiebreakers.

import { PRESETS, TIEBREAKERS } from "./scoring.js";
import { $, esc } from "./render.js";

const store = {
  get(k, d) { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} },
  del(k) { try { localStorage.removeItem(k); } catch {} },
};

const RULE_DEFAULTS = {
  h2h: { type: "h2h", label: "H2H win", win: 1, tie: 0.5, loss: 0, bye: 0 },
  weekly_rank: { type: "weekly_rank", label: "Top half", side: "top", count: "half", points: 1, tieMode: "all" },
  all_play: { type: "all_play", label: "All-play", perWin: 1, perTie: 0.5 },
};

const sameRules = (a, b) => JSON.stringify([a.rules, a.tiebreakers]) === JSON.stringify([b.rules, b.tiebreakers]);
const optInt = v => (/^\d+$/.test(v.trim()) ? Number(v) : null);

function ruleFields(r) {
  const n = (k, lbl) => `<div class="field"><label>${lbl}</label><input type="number" step="any" data-k="${k}" value="${esc(r[k])}"></div>`;
  const opt = (k, v, lbl) => `<option value="${v}"${r[k] === v ? " selected" : ""}>${lbl}</option>`;
  if (r.type === "h2h") return `<div class="row">${n("win", "Win")}${n("tie", "Tie")}${n("loss", "Loss")}${n("bye", "Bye")}</div>`;
  if (r.type === "all_play") return `<div class="row">${n("perWin", "Per team beaten")}${n("perTie", "Per tie")}</div>
    <p class="hint">Points for every team you outscored that week.</p>`;
  return `<div class="row">
      <div class="field"><label>Side</label><select data-k="side">${opt("side", "top", "Top")}${opt("side", "bottom", "Bottom")}</select></div>
      <div class="field"><label>How many</label><input data-k="count" value="${esc(r.count)}" placeholder="half or a number"></div>
      ${n("points", "Points")}
    </div>
    <div class="field"><label>Tied at the cutoff</label><select data-k="tieMode">
      ${opt("tieMode", "all", "Everyone tied gets the point")}${opt("tieMode", "split", "Split the remaining points")}${opt("tieMode", "none", "Nobody tied gets it")}</select></div>
    <p class="hint">"half" = top half of teams that week. Use Bottom with negative points for a low-score penalty.</p>`;
}

/**
 * onConfig(config)      rules or tiebreakers changed
 * onOptions(opts)       week range / playoffs changed
 * onLoad(form, fresh)   fetch the league; resolves when done
 */
export function initEditor({ onConfig, onOptions, onLoad }) {
  let config = store.get("config", null) || structuredClone(PRESETS.doubleheader);
  config.tiebreakers ??= [];

  const options = () => ({
    startWeek: optInt($("startWeek").value), endWeek: optInt($("endWeek").value),
    includePlayoffs: $("includePlayoffs").checked,
  });

  function render() {
    $("rules").innerHTML = config.rules.map((r, i) => `
      <div class="rule" data-i="${i}">
        <div class="rule-head"><input data-k="label" value="${esc(r.label)}" aria-label="Rule name">
          <button class="ghost" data-del="${i}" title="Remove rule">✕</button></div>
        ${ruleFields(r)}
      </div>`).join("") || `<p class="hint">Add at least one rule.</p>`;
    $("tiebreakers").innerHTML = config.tiebreakers.map((tb, i) => `
      <div class="tb-item"><span class="hint" style="margin:0;width:16px">${i + 1}.</span>
        <select data-tb="${i}">${Object.entries(TIEBREAKERS).map(([k, v]) =>
          `<option value="${k}"${k === tb ? " selected" : ""}>${esc(v)}</option>`).join("")}</select>
        <button class="ghost" data-tbdel="${i}" title="Remove">✕</button></div>`).join("");
    $("preset").value = Object.keys(PRESETS).find(k => sameRules(PRESETS[k], config)) || "custom";
  }

  function changed(rerender = false) {
    store.set("config", config);
    if (rerender) render();
    else $("preset").value = Object.keys(PRESETS).find(k => sameRules(PRESETS[k], config)) || "custom";
    onConfig(config);
  }

  $("preset").innerHTML = Object.entries(PRESETS).map(([k, v]) => `<option value="${k}">${esc(v.name)}</option>`).join("")
    + `<option value="custom" disabled>Custom</option>`;
  $("preset").onchange = () => {
    if (!PRESETS[$("preset").value]) return;
    config = structuredClone(PRESETS[$("preset").value]);
    changed(true);
  };
  $("rules").addEventListener("input", e => {
    const card = e.target.closest(".rule"), k = e.target.dataset.k;
    if (!card || !k) return;
    const r = config.rules[+card.dataset.i], v = e.target.value;
    r[k] = e.target.type === "number" ? (v === "" ? 0 : Number(v))
         : k === "count" && /^\d+$/.test(v.trim()) ? Number(v) : v;
    changed();
  });
  $("rules").addEventListener("click", e => {
    if (e.target.dataset.del === undefined) return;
    config.rules.splice(+e.target.dataset.del, 1);
    changed(true);
  });
  document.querySelectorAll("[data-add]").forEach(b => b.onclick = () => {
    const t = b.dataset.add;
    config.rules.push({ ...RULE_DEFAULTS[t], id: `${t}_${Date.now().toString(36)}` });
    changed(true);
  });
  $("tiebreakers").addEventListener("change", e => {
    if (e.target.dataset.tb === undefined) return;
    config.tiebreakers[+e.target.dataset.tb] = e.target.value;
    changed();
  });
  $("tiebreakers").addEventListener("click", e => {
    if (e.target.dataset.tbdel === undefined) return;
    config.tiebreakers.splice(+e.target.dataset.tbdel, 1);
    changed(true);
  });
  $("addTb").onclick = () => {
    config.tiebreakers.push(Object.keys(TIEBREAKERS).find(k => !config.tiebreakers.includes(k)) || "points_for");
    changed(true);
  };

  const readForm = () => ({
    leagueId: $("leagueId").value.trim(), season: $("season").value.trim(),
    espnS2: $("espnS2").value.trim(), swid: $("swid").value.trim(),
  });

  async function load(fresh = false) {
    const form = readForm();
    if (!form.leagueId || !form.season) throw new Error("Enter a league ID and season.");
    store.set("league", { leagueId: form.leagueId, season: form.season, startWeek: $("startWeek").value,
      endWeek: $("endWeek").value, includePlayoffs: $("includePlayoffs").checked });
    if ($("rememberCookies").checked) store.set("cookies", { espnS2: form.espnS2, swid: form.swid });
    else store.del("cookies");
    $("loadBtn").disabled = true; $("loadBtn").textContent = "Loading…";
    try { await onLoad(form, fresh); }
    finally { $("loadBtn").disabled = false; $("loadBtn").textContent = "Load standings"; }
  }

  ["startWeek", "endWeek", "includePlayoffs"].forEach(id => $(id).addEventListener("change", () => onOptions(options())));

  const lg = store.get("league", {});
  $("leagueId").value = lg.leagueId || "";
  $("season").value = lg.season || new Date().getFullYear();
  $("startWeek").value = lg.startWeek || "";
  $("endWeek").value = lg.endWeek || "";
  $("includePlayoffs").checked = !!lg.includePlayoffs;
  const ck = store.get("cookies", null);
  if (ck) { $("espnS2").value = ck.espnS2 || ""; $("swid").value = ck.swid || ""; $("rememberCookies").checked = true; }
  render();

  return { config, options: options(), load, readForm, autoload: !!lg.leagueId };
}
