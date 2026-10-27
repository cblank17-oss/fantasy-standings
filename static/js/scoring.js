// The standings engine. A config is a list of rules, each awarding points per
// team per week, plus tiebreakers. This is the only copy of the scoring logic:
// the real standings and the projected standings both run through compute().
//
// Rule types:
//   h2h          win / tie / loss / bye points for the head-to-head matchup.
//   weekly_rank  `points` to the top (or bottom) `count` scorers of the week.
//                `count` is an integer or "half". `tieMode` decides what
//                happens when teams tie exactly at the cutoff: "all" (each gets
//                full points), "split" (remaining points shared) or "none".
//   all_play     `perWin` points for every team you outscored that week
//                (`perTie` for exact ties).

export const PRESETS = {
  doubleheader: {
    name: "Doubleheader (H2H + top half)",
    rules: [
      { id: "h2h", type: "h2h", label: "H2H win", win: 1, tie: 0.5, loss: 0, bye: 0 },
      { id: "tophalf", type: "weekly_rank", label: "Top half", side: "top", count: "half", points: 1, tieMode: "all" },
    ],
    tiebreakers: ["points_for", "h2h_wins"],
  },
  standard: {
    name: "Standard H2H",
    rules: [{ id: "h2h", type: "h2h", label: "H2H win", win: 1, tie: 0.5, loss: 0, bye: 0 }],
    tiebreakers: ["points_for"],
  },
  allplay: {
    name: "All-play",
    rules: [{ id: "allplay", type: "all_play", label: "All-play", perWin: 1, perTie: 0.5 }],
    tiebreakers: ["points_for"],
  },
};

export const TIEBREAKERS = {
  points_for: "Points for",
  h2h_wins: "H2H wins",
  all_play_wins: "All-play wins",
  points_against: "Points against (fewer is better)",
};

const RULE_TYPES = ["h2h", "weekly_rank", "all_play"];
const H2H_KEY = { W: "win", L: "loss", T: "tie", BYE: "bye" };
const H2H_DEFAULTS = { win: 1, loss: 0, tie: 0.5, bye: 0 };

export function validate(config) {
  if (!Array.isArray(config?.rules) || !config.rules.length) throw new Error("Add at least one scoring rule.");
  const seen = new Set();
  for (const r of config.rules) {
    if (!RULE_TYPES.includes(r.type)) throw new Error(`Unknown rule type: ${r.type}`);
    if (!r.id || seen.has(r.id)) throw new Error("Each rule needs a unique id.");
    seen.add(r.id);
  }
  for (const tb of config.tiebreakers || []) {
    if (!(tb in TIEBREAKERS)) throw new Error(`Unknown tiebreaker: ${tb}`);
  }
}

function resolveCount(count, n) {
  if ((count ?? "half") === "half") return Math.floor(n / 2);
  const k = parseInt(count, 10);
  if (Number.isNaN(k)) throw new Error(`Invalid count: ${count}`);
  return Math.max(0, Math.min(k, n));
}

// scores: Map teamId -> points. Returns Map teamId -> points earned.
export function weeklyRank(scores, rule) {
  const points = Number(rule.points ?? 1);
  const k = resolveCount(rule.count, scores.size);
  const out = new Map();
  if (k === 0) return out;
  const top = rule.side !== "bottom";
  const cutoff = [...scores.values()].sort((a, b) => (top ? b - a : a - b))[k - 1];
  const clear = [...scores].filter(([, s]) => (top ? s > cutoff : s < cutoff)).map(([t]) => t);
  const at = [...scores].filter(([, s]) => s === cutoff).map(([t]) => t);
  clear.forEach(t => out.set(t, points));
  const slots = k - clear.length, mode = rule.tieMode || "all";
  if (at.length <= slots || mode === "all") at.forEach(t => out.set(t, points));
  else if (mode === "split") at.forEach(t => out.set(t, (points * slots) / at.length));
  else if (mode !== "none") throw new Error(`Unknown tieMode: ${mode}`);
  return out;
}

function allPlayRecord(scores) {
  const rec = new Map();
  for (const [t, s] of scores) {
    let w = 0, l = 0, tie = 0;
    for (const [u, o] of scores) if (u !== t) s > o ? w++ : s < o ? l++ : tie++;
    rec.set(t, [w, l, tie]);
  }
  return rec;
}

function earnedThisWeek(games, scores, rules) {
  const earned = new Map([...scores.keys()].map(t => [t, {}]));
  const ap = allPlayRecord(scores);
  for (const r of rules) {
    if (r.type === "h2h") {
      for (const g of games) {
        const k = H2H_KEY[g.result];
        earned.get(g.teamId)[r.id] = Number(r[k] ?? H2H_DEFAULTS[k]);
      }
    } else if (r.type === "weekly_rank") {
      const got = weeklyRank(scores, r);
      for (const t of scores.keys()) earned.get(t)[r.id] = got.get(t) ?? 0;
    } else if (r.type === "all_play") {
      const pw = Number(r.perWin ?? 1), pt = Number(r.perTie ?? 0.5);
      for (const [t, [w, , tie]] of ap) earned.get(t)[r.id] = w * pw + tie * pt;
    }
  }
  return { earned, ap };
}

const r6 = x => Math.round(x * 1e6) / 1e6;

function sortKey(row, tiebreakers) {
  return [-r6(row.total), ...tiebreakers.map(tb =>
    tb === "points_for" ? -r6(row.pf)
    : tb === "h2h_wins" ? -(row.wins + row.ties / 2)
    : tb === "all_play_wins" ? -(row.apWins + row.apTies / 2)
    : r6(row.pa))];
}

const cmpKeys = (a, b) => { for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return a[i] - b[i]; return 0; };

// Competition ranking (1, 2, 2, 4) after tiebreakers. Returns Map teamId -> rank.
function rank(rows, tiebreakers) {
  const keyed = rows.map(r => [r, sortKey(r, tiebreakers)]).sort((a, b) => cmpKeys(a[1], b[1]));
  const out = new Map();
  keyed.forEach(([r, k], i) => {
    out.set(r.teamId, i && cmpKeys(k, keyed[i - 1][1]) === 0 ? out.get(keyed[i - 1][0].teamId) : i + 1);
  });
  return out;
}

// extraWeek: optional { week, games } scored after the completed weeks (used for projections).
export function compute(league, config, { startWeek = null, endWeek = null, extraWeek = null } = {}) {
  validate(config);
  const { rules } = config, tiebreakers = config.tiebreakers || [];
  const weekList = Object.keys(league.weeks).map(Number).sort((a, b) => a - b)
    .filter(w => (startWeek == null || w >= startWeek) && (endWeek == null || w <= endWeek))
    .map(w => ({ week: w, games: league.weeks[w] }));
  if (extraWeek) weekList.push(extraWeek);

  const rows = new Map(Object.values(league.teams).map(t => [t.id, {
    teamId: t.id, name: t.name, abbrev: t.abbrev, owners: t.owners,
    total: 0, byRule: Object.fromEntries(rules.map(r => [r.id, 0])),
    wins: 0, losses: 0, ties: 0, apWins: 0, apLosses: 0, apTies: 0,
    pf: 0, pa: 0, shotguns: 0, weekly: {}, rankHistory: [],
  }]));

  for (const { week, games } of weekList) {
    const scores = new Map(games.map(g => [g.teamId, g.points]));
    const all = [...scores.values()], low = Math.min(...all);
    const { earned, ap } = earnedThisWeek(games, scores, rules);

    for (const g of games) {
      const row = rows.get(g.teamId);
      if (!row) continue;
      const e = earned.get(g.teamId), weekTotal = Object.values(e).reduce((a, b) => a + b, 0);
      const [aw, al, at] = ap.get(g.teamId);
      row.total += weekTotal;
      for (const [rid, p] of Object.entries(e)) row.byRule[rid] += p;
      row.wins += g.result === "W"; row.losses += g.result === "L"; row.ties += g.result === "T";
      row.apWins += aw; row.apLosses += al; row.apTies += at;
      row.pf += g.points; row.pa += g.oppPoints ?? 0;
      row.shotguns += g.points === low; // last in scoring that week (ties all count)
      row.weekly[week] = {
        points: g.points, oppId: g.oppId, oppPoints: g.oppPoints, result: g.result,
        rank: 1 + all.filter(o => o > g.points).length, earned: e, total: weekTotal,
        shotgun: g.points === low, ...(g.live != null && { live: g.live }),
      };
    }
    for (const [tid, rk] of rank([...rows.values()], tiebreakers)) rows.get(tid).rankHistory.push(rk);
  }

  const ranked = rank([...rows.values()], tiebreakers);
  const standings = [...rows.values()]
    .map(r => ({ ...r, rank: ranked.get(r.teamId) }))
    .sort((a, b) => a.rank - b.rank || a.name.localeCompare(b.name));

  return {
    league: { id: league.id, season: league.season, name: league.name, teams: league.teams },
    weeks: weekList.map(w => w.week),
    rules: rules.map(r => ({ id: r.id, label: r.label || r.id })),
    standings,
  };
}

// Standings as if this week's ESPN projections hold. Null when no week is in progress.
export function project(league, config, { startWeek = null, endWeek = null } = {}) {
  const p = league.projection;
  if (!p || (endWeek != null && endWeek < p.week)) return null;
  const res = compute(league, config, { startWeek, extraWeek: p });
  for (const r of res.standings) r.prevRank = r.rankHistory.at(-2) ?? r.rank;
  return { ...res, week: p.week, shotgunners: res.standings.filter(r => r.weekly[p.week]?.shotgun) };
}
