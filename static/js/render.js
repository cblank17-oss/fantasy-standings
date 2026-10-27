// Display: standings table, points-by-week grid, projected standings.

export const $ = id => document.getElementById(id);
export const esc = s => String(s ?? "").replace(/[&<>"']/g, c =>
  ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const num = n => (Math.round(n * 100) / 100).toString();

function movement(delta, since) {
  if (delta > 0) return `<span class="move-up" title="Up ${delta} from ${since}">▲${delta}</span>`;
  if (delta < 0) return `<span class="move-down" title="Down ${-delta} from ${since}">▼${-delta}</span>`;
  return "";
}

export function titleFor(res) {
  const { weeks, league } = res;
  const span = !weeks.length ? "no completed weeks yet"
    : weeks.length === 1 ? `week ${weeks[0]}` : `weeks ${weeks[0]}–${weeks.at(-1)}`;
  return `${league.name} · ${league.season} · ${span}`;
}

export function renderStandings(res) {
  const { rules, standings, weeks } = res;
  $("standingsTitle").textContent = titleFor(res);
  $("copyBtn").hidden = !weeks.length;
  const head = `<tr><th>#</th><th class="l">Team</th><th>Pts</th>${rules.map(r => `<th>${esc(r.label)}</th>`).join("")}
    <th title="Weeks finishing last in points scored">Shotguns</th><th>PF</th><th>PA</th></tr>`;
  const body = standings.map(s => {
    const h = s.rankHistory, prev = h.length > 1 ? h.at(-2) : s.rank;
    return `<tr><td>${s.rank} ${movement(prev - s.rank, "last week")}</td>
      <td class="l">${esc(s.name)}<div class="owner">${esc(s.owners.join(", "))}</div></td>
      <td class="total">${num(s.total)}</td>
      ${rules.map(r => `<td>${num(s.byRule[r.id])}</td>`).join("")}
      <td>${s.shotguns}</td><td>${s.pf.toFixed(2)}</td><td>${s.pa.toFixed(2)}</td></tr>`;
  }).join("");
  $("standings").innerHTML = `<table><thead>${head}</thead><tbody>${body}</tbody></table>`;
}

export function renderWeekly(res) {
  const { league, rules, standings, weeks } = res;
  $("weeklyCard").hidden = !weeks.length;
  const names = Object.fromEntries(Object.values(league.teams).map(t => [t.id, t.name]));
  const nTeams = Object.keys(league.teams).length;
  const maxWeek = Math.max(1, ...standings.flatMap(s => Object.values(s.weekly).map(w => w.total)));
  const cell = (s, w) => {
    const x = s.weekly[w];
    if (!x) return `<td>–</td>`;
    const level = x.total <= 0 ? 0 : x.total >= maxWeek ? 2 : 1;
    const parts = rules.map(r => `${r.label}: ${num(x.earned[r.id] ?? 0)}`).join("\n");
    const vs = x.oppId != null
      ? `${x.result} ${x.points.toFixed(2)}–${x.oppPoints.toFixed(2)} vs ${names[x.oppId] ?? "?"}`
      : `Bye · ${x.points.toFixed(2)}`;
    return `<td><span class="cell c${level}" title="${esc(`${vs}\nScoring rank ${x.rank} of ${nTeams}\n${parts}`)}">${num(x.total)}</span></td>`;
  };
  $("weekly").innerHTML = `<table class="wk"><thead><tr><th class="l">Team</th>${weeks.map(w => `<th>W${w}</th>`).join("")}<th>Total</th></tr></thead>
    <tbody>${standings.map(s => `<tr><td class="l">${esc(s.name)}</td>${weeks.map(w => cell(s, w)).join("")}<td><b>${num(s.total)}</b></td></tr>`).join("")}</tbody></table>`;
}

export function renderProjection(proj, { asOf, note }) {
  $("projCard").hidden = !proj;
  if (!proj) return;
  const { week, rules, standings, league, shotgunners } = proj;
  const names = Object.fromEntries(Object.values(league.teams).map(t => [t.id, t.name]));
  $("projTitle").textContent = `Projected standings after Week ${week}`;
  $("projShotgun").innerHTML = shotgunners.length
    ? `Projected shotgunner: <b>${shotgunners.map(r => esc(r.name)).join(" &amp; ")}</b> (${shotgunners[0].weekly[week].points.toFixed(2)} projected)`
    : "";
  const head = `<tr><th>#</th><th class="l">Team</th><th>Pts</th><th>Week ${week}</th>${rules.map(r => `<th>${esc(r.label)}</th>`).join("")}
    <th>Shotguns</th><th>Projected</th><th class="l">Matchup</th></tr>`;
  const body = standings.map(r => {
    const w = r.weekly[week];
    const matchup = !w ? "–" : w.oppId == null ? "Bye"
      : `${w.result} vs ${esc(names[w.oppId] ?? "?")} <span class="owner">(${w.points.toFixed(1)}–${w.oppPoints.toFixed(1)})</span>`;
    return `<tr><td>${r.rank} ${movement(r.prevRank - r.rank, "current standings")}</td>
      <td class="l">${esc(r.name)}${w?.shotgun ? `<span class="badge">SHOTGUN</span>` : ""}</td>
      <td class="total">${num(r.total)}</td>
      <td>${w ? "+" + num(w.total) : "–"}</td>
      ${rules.map(x => `<td>${num(r.byRule[x.id])}</td>`).join("")}
      <td>${r.shotguns}</td>
      <td>${w ? w.points.toFixed(2) : "–"}<div class="owner">${w?.live != null ? w.live.toFixed(2) + " so far" : ""}</div></td>
      <td class="l">${matchup}</td></tr>`;
  }).join("");
  $("projected").innerHTML = `<table><thead>${head}</thead><tbody>${body}</tbody></table>`;
  $("projNote").textContent = `Uses ESPN's live projections (points scored so far + projected remaining).`
    + (asOf ? ` As of ${new Date(asOf).toLocaleString()}` : "") + (note ? ` · ${note}` : "") + ".";
}

export function standingsText(res) {
  const lines = [titleFor(res), ""];
  for (const s of res.standings) {
    const parts = res.rules.map(r => `${r.label} ${num(s.byRule[r.id])}`).join(", ");
    lines.push(`${s.rank}. ${s.name}: ${num(s.total)} pts (${parts}; ${s.shotguns} shotguns, ${s.pf.toFixed(1)} PF)`);
  }
  return lines.join("\n");
}

export function showError(msg) {
  $("error").hidden = !msg;
  $("error").textContent = msg || "";
}
