// League History tab: headline tiles, all-time table, finishes grid,
// season-by-season summary and records.

import { $, esc } from "./render.js";

const num = n => (Math.round(n * 100) / 100).toString();
const ordinal = n => n + ({ 1: "st", 2: "nd", 3: "rd" }[(n % 100 > 10 && n % 100 < 14) ? 0 : n % 10] || "th");
const record = (w, l, t) => `${w}-${l}${t ? "-" + t : ""}`;
const joinNames = list => list.map(x => esc(x)).join(" &amp; ");

// A past team name, plus who that manager is now when the name has changed.
function teamThen(h, x) {
  const now = h.names[x.manager];
  return `${esc(x.team)}${now && now !== x.team ? ` <span class="owner">now ${esc(now)}</span>` : ""}`;
}

// Sortable all-time columns. `value` drives sorting; `cell` renders.
function columns(h) {
  return [
    { key: "seasons", label: "Seasons", value: m => m.seasons, dir: -1 },
    { key: "titles", label: "Titles", value: m => m.titles, dir: -1, cell: m => m.titles ? `🏆 ${m.titles}` : "0" },
    { key: "playoffs", label: "Playoffs", value: m => m.playoffs, dir: -1 },
    { key: "avgFinish", label: "Avg finish", value: m => m.avgFinish ?? 99, dir: 1, cell: m => m.avgFinish ? m.avgFinish.toFixed(1) : "–" },
    { key: "bestFinish", label: "Best", value: m => m.bestFinish ?? 99, dir: 1, cell: m => m.bestFinish ? ordinal(m.bestFinish) : "–" },
    { key: "total", label: "Pts", value: m => m.total, dir: -1, cell: m => `<b>${num(m.total)}</b>` },
    ...h.rules.map(r => ({ key: `rule:${r.id}`, label: r.label, value: m => m.byRule[r.id], dir: -1, cell: m => num(m.byRule[r.id]) })),
    { key: "perWeek", label: "Pts/wk", value: m => m.perWeek, dir: -1, cell: m => m.perWeek.toFixed(2) },
    { key: "shotguns", label: "Shotguns", value: m => m.shotguns, dir: -1 },
    { key: "record", label: "H2H record", value: m => (m.wins + m.ties / 2) / Math.max(1, m.wins + m.losses + m.ties), dir: -1, cell: m => record(m.wins, m.losses, m.ties) },
    { key: "pf", label: "PF", value: m => m.pf, dir: -1, cell: m => m.pf.toFixed(0) },
  ];
}

const DEFAULT_SORT = { key: "titles", dir: -1 };

function sortManagers(h, sort) {
  const cols = columns(h), col = cols.find(c => c.key === sort.key) || cols[1];
  // Ties fall back to titles, then lifetime points.
  return [...h.managers].sort((a, b) =>
    sort.dir * (col.value(a) - col.value(b)) || b.titles - a.titles || b.total - a.total || a.name.localeCompare(b.name));
}

function tiles(h) {
  const top = (f, label, fmt = String) => {
    const best = Math.max(...h.managers.map(f));
    const who = h.managers.filter(m => f(m) === best).map(m => m.name);
    return `<div class="kpi"><div class="label">${label}</div><div class="value">${fmt(best)}</div>
      <div class="who">${joinNames(who)}</div></div>`;
  };
  const first = h.seasons[0], last = h.seasons.at(-1);
  return `<div class="kpis">
    ${top(m => m.titles, "Most championships")}
    ${top(m => m.shotguns, "Most lifetime shotguns")}
    ${top(m => m.total, "Most doubleheader points", num)}
    <div class="kpi"><div class="label">League history</div><div class="value">${h.seasons.length} seasons</div>
      <div class="who">${first}–${last} · ${h.managers.length} managers</div></div>
  </div>`;
}

function managerCell(m) {
  const yrs = Object.keys(m.bySeason).map(Number);
  const span = `${Math.min(...yrs)}–${m.active ? "now" : Math.max(...yrs)}`;
  const aka = [...new Set(m.names.map(n => n.name))];
  const title = aka.length > 1 ? `Also played as: ${aka.slice(0, -1).reverse().join(", ")}` : "";
  return `<td class="l" title="${esc(title)}">${esc(m.name)}<div class="owner">${span}${m.active ? "" : " · former manager"}</div></td>`;
}

function allTime(h, sorted, sort) {
  const cols = columns(h);
  const head = `<tr><th class="l">Manager</th>${cols.map(c => {
    const on = c.key === sort.key;
    return `<th class="sortable" data-sort="${c.key}"${on ? ` aria-sort="${sort.dir < 0 ? "descending" : "ascending"}"` : ""}>${esc(c.label)}${on ? (sort.dir < 0 ? " ▼" : " ▲") : ""}</th>`;
  }).join("")}</tr>`;
  const body = sorted.map(m => `<tr>${managerCell(m)}${cols.map(c => `<td>${c.cell ? c.cell(m) : c.value(m)}</td>`).join("")}</tr>`).join("");
  return `<section class="card">
    <div class="toolbar"><h2>All-time standings</h2><span class="hint" style="margin:0">Click a column to sort</span></div>
    <div class="table-wrap"><table id="allTime" class="sticky-first"><thead>${head}</thead><tbody>${body}</tbody></table></div>
  </section>`;
}

function finishes(h, sorted) {
  const cell = (m, season) => {
    const x = m.bySeason[season];
    if (!x) return `<td><span class="fin fin-none">–</span></td>`;
    const lines = [`${x.team} · ${season}`];
    let cls, label;
    if (x.inProgress) {
      cls = "fin-live"; label = `${ordinal(x.dhRank)}*`;
      lines.push(`In progress: ${ordinal(x.dhRank)} in the doubleheader standings`);
    } else {
      cls = x.finish === 1 ? "fin-champ" : x.last ? "fin-last" : x.madePlayoffs ? "fin-playoffs" : "fin-other";
      label = (x.finish === 1 ? "🏆 " : "") + ordinal(x.finish);
      lines.push(`Final: ${ordinal(x.finish)}${x.finish === 1 ? " (champion)" : x.last ? " (last place)" : x.madePlayoffs ? " (made playoffs)" : ""}`,
        `Doubleheader regular season: ${ordinal(x.dhRank)}, ${num(x.total)} pts`);
    }
    lines.push(`Record ${record(...x.record)} · ${x.shotguns} shotgun${x.shotguns === 1 ? "" : "s"}`);
    return `<td><span class="fin ${cls}" title="${esc(lines.join("\n"))}">${label}</span></td>`;
  };
  return `<section class="card">
    <div class="toolbar"><h2>Finishes by season</h2><span class="hint" style="margin:0">Hover a cell for details</span></div>
    <div class="table-wrap"><table class="wk sticky-first"><thead><tr><th class="l">Manager</th>${h.seasons.map(s => `<th>${s}</th>`).join("")}</tr></thead>
      <tbody>${sorted.map(m => `<tr><td class="l">${esc(m.name)}</td>${h.seasons.map(s => cell(m, s)).join("")}</tr>`).join("")}</tbody></table></div>
    <div class="legend">
      <span><span class="fin fin-champ">🏆 1st</span> Champion</span>
      <span><span class="fin fin-playoffs">3rd</span> Made playoffs</span>
      <span><span class="fin fin-other">8th</span> Missed playoffs</span>
      <span><span class="fin fin-last">12th</span> Last place</span>
      <span><span class="fin fin-live">2nd*</span> Season in progress (doubleheader rank)</span>
    </div>
  </section>`;
}

function seasonTable(h) {
  const teams = list => list.length ? list.map(x => teamThen(h, x)).join(" &amp; ") : "–";
  const rows = [...h.summaries].reverse().map(s => `<tr>
      <td class="l"><b>${s.season}</b>${s.complete ? "" : `<div class="owner">in progress · ${s.weeks} wk${s.weeks === 1 ? "" : "s"}</div>`}</td>
      <td class="l">${s.complete ? "🏆 " + teams(s.champion) : "–"}</td>
      <td class="l">${s.complete ? teams(s.runnerUp) : "–"}</td>
      <td class="l">${teams(s.dhLeader)}${s.dhLeader.length ? ` <span class="owner">(${num(s.dhLeader[0].value)})</span>` : ""}</td>
      <td class="l">${teams(s.mostShotguns)}${s.mostShotguns.length ? ` <span class="owner">(${s.mostShotguns[0].value})</span>` : ""}</td>
      <td class="l">${s.complete ? teams(s.last) : "–"}</td></tr>`).join("");
  return `<section class="card">
    <h2>Season by season</h2>
    <div class="table-wrap"><table class="wrap"><thead><tr><th class="l">Season</th><th class="l">Champion</th><th class="l">Runner-up</th>
      <th class="l">Doubleheader leader</th><th class="l">Most shotguns</th><th class="l">Last place</th></tr></thead><tbody>${rows}</tbody></table></div>
  </section>`;
}

function records(h) {
  const r = h.records;
  const where = x => `${x.season}${x.week ? ` · Wk ${x.week}` : ""}${x.opp ? ` vs ${esc(x.opp)}` : ""}${x.inProgress ? " · in progress" : ""}`;
  const card = (label, rec, fmt) => !rec ? "" : `<div class="record">
      <div class="label">${label}</div><div class="value">${fmt(rec.value)}</div>
      ${rec.holders.map(x => `<div class="who">${teamThen(h, x)}<div class="owner">${where(x)}</div></div>`).join("")}
    </div>`;
  const pts = v => v.toFixed(2);
  return `<section class="card">
    <h2>Records</h2>
    <div class="records">
      ${card("Highest score in a week", r.highScore, pts)}
      ${card("Lowest score in a week", r.lowScore, pts)}
      ${card("Biggest blowout", r.blowout, v => `+${pts(v)}`)}
      ${card("Narrowest win", r.closest, v => `+${pts(v)}`)}
      ${card("Most doubleheader points in a season", r.bestSeason, num)}
      ${card("Fewest doubleheader points in a season", r.worstSeason, num)}
      ${card("Most shotguns in a season", r.mostShotguns, String)}
    </div>
  </section>`;
}

let sort = DEFAULT_SORT;

export function renderHistory(h) {
  const el = $("historyView");
  const sorted = sortManagers(h, sort);
  el.innerHTML = tiles(h) + allTime(h, sorted, sort) + finishes(h, sorted) + seasonTable(h) + records(h)
    + `<p class="hint">Doubleheader points and shotguns count regular-season weeks only, scored with the current rules for every season.
       Finishes are ESPN's final standings, including playoffs. Managers are tracked by ESPN account, so a team that changed hands counts as a new manager.</p>`;
  el.querySelectorAll("th.sortable").forEach(th => th.onclick = () => {
    const col = columns(h).find(c => c.key === th.dataset.sort);
    sort = sort.key === col.key ? { key: col.key, dir: -sort.dir } : { key: col.key, dir: col.dir };
    renderHistory(h);
  });
}

export function renderHistoryMessage(msg) {
  $("historyView").innerHTML = `<section class="card"><div class="empty">${esc(msg)}</div></section>`;
}
